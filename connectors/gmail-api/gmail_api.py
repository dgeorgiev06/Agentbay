"""gmail-api: items.source/v1 (email/v1 items) over the official Gmail API v1, read-only.

Endpoints called (all GET on https://gmail.googleapis.com/gmail/v1/users/me, through ctx.http, which refuses any
host outside the env network allowlist before the request is made):
  /profile                          the account address (me) and the current historyId
  /labels                           label id -> name
  /messages?q=...                   messages.list with the native query (first sync, or after history expired)
  /messages/{id}?format=full        one message (headers, body parts, attachment metadata)
  /messages/{id}/attachments/{aid}  one attachment's bytes, only for types whose text is extracted
  /history?startHistoryId=...       changes since the stored cursor (messages added, labels added or removed,
                                    messages deleted)
plus POST https://oauth2.googleapis.com/token (refresh_token grant; the authorization_code grant in `login`, run
by `bay auth gmail`). No other method or endpoint is used: nothing can send, label, move or delete mail.

Auth: OAuth 2.0 installed app, scope gmail.readonly only. GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are the
user's own Google Cloud OAuth client; GMAIL_REFRESH_TOKEN comes from `bay auth gmail` (loopback redirect on
127.0.0.1 with PKCE) and lives in the secrets provider (keychain). Access tokens stay in memory for this call.
An app in Google's "Testing" status gets refresh tokens that expire after 7 days: an expired or revoked login
(invalid_grant) makes fetch return `blocked` naming `bay auth gmail`; it never raises.

Selector -> Gmail search: from from:, to to:, in label:/in:, since after:, has: attachment has:attachment. Only
fields where Gmail returns at least what the local matcher keeps are native (connector.yaml): subject, text and
not, and values with `*`, are matched locally by the store (bay/selector.py split) and never reach here.

Sync (connector.yaml changeFeed: the store follows the cursor and backfills): without a cursor, messages.list
with the native query and after:<since> (and before:<until> for a backfill, which skips the storedIds), newest
first, up to maxItems, then messages.get for each; the cursor is the mailbox historyId read before listing.
checkIds not listed are re-read: 404 -> deleted. With a cursor, history.list from it (_incremental: every
change to a stored message is read again, any age, so its labels are current and the store, which replaces
labels (exactLabels), re-matches it; label-only changes to other messages are mostly ignored), bounded by
maxItems on a history record boundary; messages in TRASH, SPAM or DRAFT come back as `removed`, deleted ones as
`deleted`. history.list 404 (Gmail keeps history about a week) returns `cursorExpired` without reading
anything, and the store re-lists its window. The connector reads no mode settings: every bound comes from the
store's request.

Limits: `maxItems` caps messages.get calls (what `billed` counts; Gmail reads cost nothing; a message is read at
most once per sync). HTTP 429, 5xx and
rate-limit 403s are retried with exponential backoff (Retry-After when given); when retries run out the call
returns what it read, truncated, with a warning.

Attachments: metadata always. Text only for docx (stdlib zipfile + XML), txt, csv and md, at most
attachmentMaxBytes (10 MB) per file and attachmentMaxChars (200k) of text, extracted by extract.py in a separate
`python3 -I` process with a timeout and memory, CPU and file-size limits; the bytes go through a pipe and never
touch the disk. PDFs and everything else are metadata only. A failure records textChars 0 and a reason; it never
fails the sync. The store secret-scrubs bodies and attachment text before anything is stored.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets as _rand
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from email.utils import getaddresses, parseaddr
from html.parser import HTMLParser
from pathlib import Path

from bay import vault
from bay.connect import ConnectorError
from bay.util import duration, iso

API = "https://gmail.googleapis.com/gmail/v1/users/me"
TOKEN_URL = "https://oauth2.googleapis.com/token"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"     # opened in the user's browser, never fetched here
SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN = "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"
LIST_MAX = 500                        # messages.list / history.list maxResults ceiling
OUT_OF_SCOPE = {"TRASH", "SPAM", "DRAFT"}
SYSTEM_IN = {"inbox", "sent", "starred", "important", "snoozed", "chats", "drafts", "spam", "trash", "anywhere",
             "scheduled"}
EXTRACT = Path(__file__).with_name("extract.py")
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
TEXT_MIME = {"text/plain", "text/csv", "text/markdown", "text/x-markdown"}
TEXT_EXT = (".txt", ".csv", ".md", ".markdown")
MSG_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
FIX = "run `bay auth gmail` in your terminal (it opens your browser), then sync again"


class LoginNeeded(ConnectorError):
    """No usable Gmail login: fetch reports it as `blocked`."""


class HistoryGone(Exception):
    """history.list 404: the stored historyId is older than the history Gmail keeps."""


class QuotaExhausted(ConnectorError):
    pass


# ------------------------------------------------------------------ pure helpers
def b64url(data: str) -> bytes:
    """Gmail's base64url (padding optional). Raises ValueError on anything else."""
    try:
        return base64.urlsafe_b64decode(str(data) + "=" * (-len(str(data)) % 4))
    except (ValueError, TypeError) as e:          # binascii.Error is a ValueError
        raise ValueError("not base64url") from e


def _q(v: str) -> str:
    """One Gmail search value: quoted when it has spaces or operators."""
    v = str(v).strip().replace('"', "")
    return f'"{v}"' if re.search(r"[\s(){}:\-]", v) else v


def _label(v: str) -> str:
    """Gmail search label syntax: spaces and slashes become dashes."""
    return re.sub(r"[\s/]+", "-", v.strip())


def _in_term(v: str) -> str:
    v = str(v).strip()
    low = v.lower()
    if low.startswith("in:"):
        return f"in:{_label(v[3:]).lower()}"
    if low.startswith("label:"):
        return f"label:{_label(v[6:])}"
    if low in SYSTEM_IN:
        return f"in:{low}"
    return f"label:{_label(v)}"


def _vals(v) -> list[str]:
    return [] if v is None else [str(x) for x in (v if isinstance(v, list) else [v])]


def _terms(field: str, v) -> list[str]:
    """Gmail search terms for one native selector field (one term per value)."""
    out = []
    for x in _vals(v):
        if field in ("from", "to"):
            out.append(f"{field}:{_q(x.lstrip('@'))}")
        elif field == "in":
            out.append(_in_term(x))
        elif field == "has" and x.lower() == "attachment":
            out.append("has:attachment")
    return out


def native_query(query: dict | None, since: str | None = None, until: str | None = None) -> str:
    """The native part of a selector (bay/selector.py split) as a Gmail search string. Values of one field are
    ORed ({a b}), fields ANDed. `has: link` is left to the store's local match. `until` (inclusive, to the
    second) becomes before:<epoch + 1>."""
    parts = []
    for field in ("from", "to", "in", "has"):
        t = _terms(field, (query or {}).get(field))
        if len(t) == 1:
            parts.append(t[0])
        elif t:
            parts.append("{" + " ".join(t) + "}")
    if since:
        ts = datetime.fromisoformat(since.replace("Z", "+00:00"))
        parts.append(f"after:{int(ts.timestamp())}")
    if until:
        ts = datetime.fromisoformat(until.replace("Z", "+00:00"))
        parts.append(f"before:{int(ts.timestamp()) + 1}")
    return " ".join(parts)


class _Html(HTMLParser):
    BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "blockquote", "hr"}
    SKIP = {"script", "style", "head", "title"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag in self.BLOCK:
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag in self.BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def html_to_text(html: str) -> str:
    p = _Html()
    try:
        p.feed(html)
        p.close()
    except Exception:                                     # malformed markup: keep what was parsed
        pass
    text = "".join(p.out)
    lines = [re.sub(r"[ \t ]+", " ", ln).strip() for ln in text.splitlines()]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


_ON_WROTE = re.compile(r"^\s*On\b.{0,300}\bwrote:\s*$", re.I)
_ON_START = re.compile(r"^\s*On\b.{0,300}$", re.I)
_SEPARATORS = (re.compile(r"^\s*-{2,}\s*Original Message\s*-{2,}\s*$", re.I), re.compile(r"^\s*_{10,}\s*$"))
_OUTLOOK = re.compile(r"^\s*From:\s.+$", re.I)
_OUTLOOK_NEXT = re.compile(r"^\s*(Sent|Date):\s", re.I)


def trim_quoted(text: str) -> str:
    """Drop the quoted reply chain: everything from the first "On ... wrote:" (also wrapped over two lines),
    "-----Original Message-----", an Outlook "From: / Sent:" header block or a ____ rule, and every line that
    starts with ">". Keeps the original when nothing would be left."""
    lines = text.replace("\r\n", "\n").split("\n")
    cut = len(lines)
    for i, ln in enumerate(lines):
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if _ON_WROTE.match(ln) or (_ON_START.match(ln) and nxt.strip().lower().endswith("wrote:")) \
                or any(s.match(ln) for s in _SEPARATORS) or (_OUTLOOK.match(ln) and _OUTLOOK_NEXT.match(nxt)):
            cut = i
            break
    kept = [ln for ln in lines[:cut] if not ln.lstrip().startswith(">")]
    out = "\n".join(kept).strip()
    return out or text.strip()


def text_kind(name: str, mime: str) -> tuple[str | None, str | None]:
    """(extractor kind, reason when none): docx and plain text are extracted; PDF and the rest are not."""
    n, m = (name or "").lower(), (mime or "").lower().split(";")[0].strip()
    if m == DOCX or n.endswith(".docx"):
        return "docx", None
    if m in TEXT_MIME or n.endswith(TEXT_EXT):
        return "text", None
    if m == "application/pdf" or n.endswith(".pdf"):
        return None, "PDF: metadata only (no PDF text extraction)"
    return None, "type not extracted: metadata only"


def _limits(mem_mb: int, cpu_s: int):
    def apply():                                         # runs in the child before exec
        try:
            import resource
        except ImportError:                              # pragma: no cover - not POSIX
            return
        mem = mem_mb * 1024 * 1024
        for lim, val in (("RLIMIT_AS", mem), ("RLIMIT_DATA", mem), ("RLIMIT_CPU", cpu_s), ("RLIMIT_FSIZE", 0),
                         ("RLIMIT_CORE", 0)):
            if hasattr(resource, lim):
                try:
                    resource.setrlimit(getattr(resource, lim), (val, val))
                except (ValueError, OSError):            # e.g. RLIMIT_AS on macOS: extract.py's input cap (no
                    pass                                 # entity expansion) and the timeout still bound it
    return apply


EXTRACT_ERRORS = {"not-docx": "not a readable docx file", "dtd": "docx with a DTD refused",
                  "encoding": "docx that is not UTF-8 refused",
                  "too-large": "docx expands beyond the size cap", "parse": "the file could not be parsed",
                  "kind": "internal error: unknown extractor"}


def extract_text(data: bytes, kind: str, *, max_chars: int, timeout_s: int = 20, mem_mb: int = 512) -> tuple[str, str | None]:
    """Run extract.py on `data` in a separate `python3 -I` process with a timeout and resource limits.
    Returns (text, None) or ("", reason); never raises for a bad file."""
    cmd = [sys.executable, "-I", str(EXTRACT), kind, str(max_chars)]
    try:
        r = subprocess.run(cmd, input=data, capture_output=True, timeout=timeout_s, env={}, cwd=str(EXTRACT.parent),
                           preexec_fn=_limits(mem_mb, timeout_s + 1) if os.name == "posix" else None)
    except subprocess.TimeoutExpired:
        return "", f"text extraction stopped after the {timeout_s}s time limit: metadata only"
    except OSError:
        return "", "text extraction could not start: metadata only"
    if r.returncode != 0:
        return "", f"text extraction failed (exit {r.returncode}, e.g. the memory limit): metadata only"
    try:
        out = json.loads(r.stdout.decode("utf-8"))
    except (ValueError, UnicodeError):
        return "", "text extraction returned no result: metadata only"
    if "error" in out:
        return "", f"{EXTRACT_ERRORS.get(out['error'], 'extraction failed')}: metadata only"
    text = out.get("text") or ""
    if len(text) > max_chars:
        return "", f"text is over the {max_chars}-character cap: metadata only"
    return text, None


def _quota(r) -> bool:
    if r.status == 429 or r.status >= 500:
        return True
    if r.status == 403:
        body = (r.body or b"").decode("utf-8", "replace")
        return any(x in body for x in ("rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"))
    return False


def _delay(r, attempt: int) -> float:
    ra = (r.headers or {}).get("Retry-After") or (r.headers or {}).get("retry-after")
    try:
        return min(60.0, max(0.0, float(ra)))
    except (TypeError, ValueError):
        return float(min(2 ** attempt, 32))


def _charset(part: dict) -> str:
    for h in part.get("headers") or []:
        if h.get("name", "").lower() == "content-type":
            m = re.search(r'charset="?([\w.-]+)"?', h.get("value", ""), re.I)
            if m:
                return m.group(1)
    return "utf-8"


def _decode(raw: bytes, charset: str) -> str:
    try:
        return raw.decode(charset, errors="replace")
    except LookupError:
        return raw.decode("utf-8", errors="replace")


# ------------------------------------------------------------------ connector
class GmailApi:
    def __init__(self, ctx):
        self.ctx = ctx
        c = ctx.config
        self.max_bytes = int(c.get("attachmentMaxBytes", 10 * 1024 * 1024))
        self.max_chars = int(c.get("attachmentMaxChars", 200_000))
        self.timeout_s = int(c.get("extractTimeoutS", 20))
        self.mem_mb = int(c.get("extractMemoryMB", 512))
        self.max_retries = int(c.get("maxRetries", 5))
        self.sleep = time.sleep
        self._access: str | None = None
        self._profile: dict | None = None
        self._labels: dict | None = None
        self._cache: dict[str, tuple[str, dict | None]] = {}    # one sync calls fetch once per native query
        self.billed = 0
        self.warnings: list[str] = []          # per-message notes (a body part that did not decode), per fetch

    # ------------------------------------------------------------ auth
    def _secret(self, name: str) -> str:
        val = self.ctx.secrets.get(name, optional=True)
        if not val:
            if name == REFRESH_TOKEN:
                raise LoginNeeded(f"gmail-api: there is no Gmail login yet ({REFRESH_TOKEN} is not stored); {FIX}")
            raise LoginNeeded(f"gmail-api: {name} is not stored; store your Google OAuth client with "
                              f"`bay secret set {CLIENT_ID}` and `bay secret set {CLIENT_SECRET}`, then {FIX}")
        return val

    def _refresh(self) -> None:
        cid, csec, rt = self._secret(CLIENT_ID), self._secret(CLIENT_SECRET), self._secret(REFRESH_TOKEN)
        r = self.ctx.http.request("POST", TOKEN_URL, data={"client_id": cid, "client_secret": csec,
                                                           "refresh_token": rt, "grant_type": "refresh_token"})
        try:
            body = r.json() or {}
        except ValueError:
            body = {}
        err = body.get("error") if isinstance(body, dict) else None
        if r.status in (400, 401) and err == "invalid_grant":
            raise LoginNeeded("gmail-api: the Gmail login has expired or was revoked (logins of an OAuth app in "
                              f"Google's Testing status expire after 7 days); {FIX}")
        if r.status in (400, 401) and err in ("invalid_client", "unauthorized_client"):
            raise LoginNeeded(f"gmail-api: Google does not accept the stored OAuth client ({CLIENT_ID} / "
                              f"{CLIENT_SECRET}); store the Desktop-app client again with `bay secret set`, then {FIX}")
        if r.status != 200 or not body.get("access_token"):
            raise ConnectorError(f"gmail-api: token refresh failed (HTTP {r.status}); try again later or {FIX}")
        granted = set(str(body.get("scope") or "").split())
        if granted != {SCOPE}:                 # Google states the scope on refresh: refuse anything else, or none
            what = "states no scope" if not granted else "grants more than gmail.readonly" if SCOPE in granted \
                else "does not grant gmail.readonly"
            raise LoginNeeded(f"gmail-api: the stored login {what}; remove agentbay's access at "
                              f"https://myaccount.google.com/permissions, then {FIX}")
        vault.remember(body["access_token"])
        self._access = body["access_token"]
        if body.get("refresh_token") and body["refresh_token"] != rt:
            self.ctx.secrets.store(REFRESH_TOKEN, body["refresh_token"])

    def _get(self, path: str, params: dict | None = None):
        """GET one Gmail API path with backoff on quota and server errors. The only request method this
        connector uses on Gmail."""
        if self._access is None:
            self._refresh()
        refreshed = False
        attempt = 0
        while True:
            r = self.ctx.http.request("GET", f"{API}{path}", params=params,
                                      headers={"Authorization": f"Bearer {self._access}"})
            if r.status == 401:
                if refreshed:
                    raise LoginNeeded(f"gmail-api: Google rejected the Gmail login (HTTP 401); {FIX}")
                self._refresh()
                refreshed = True
                continue
            if _quota(r):
                if attempt >= self.max_retries:
                    raise QuotaExhausted(f"gmail-api: Gmail quota or server error (HTTP {r.status}) persisted after "
                                         f"{self.max_retries} retries; kept what was read, run sync again later")
                self.sleep(_delay(r, attempt))
                attempt += 1
                continue
            return r

    def profile(self) -> dict:
        if self._profile is None:
            r = self._get("/profile")
            if r.status != 200:
                raise ConnectorError(f"gmail-api: users.getProfile failed (HTTP {r.status})")
            self._profile = r.json() or {}
        return self._profile

    def labels(self) -> dict[str, str]:
        if self._labels is None:
            r = self._get("/labels")
            if r.status != 200:
                raise ConnectorError(f"gmail-api: labels.list failed (HTTP {r.status})")
            self._labels = {x["id"]: x.get("name") or x["id"] for x in (r.json() or {}).get("labels") or []}
        return self._labels

    # ------------------------------------------------------------ items.source/v1.fetch
    def fetch(self, query: dict | None = None, since: str | None = None, until: str | None = None,
              cursor: str | None = None, maxItems: int = 100, checkIds: list[str] | None = None,
              storedIds: list[str] | None = None) -> dict:
        run = {"items": {}, "deleted": [], "removed": [], "checked": [], "warnings": [], "truncated": False}
        new_cursor = cursor
        stored = set(storedIds or [])
        billed0, req0 = self.billed, self.ctx.http.requests      # this call's share (the instance is reused)
        try:
            if cursor:
                new_cursor = self._incremental(run, cursor, query or {}, maxItems, checkIds or [], stored)
            else:
                new_cursor = self._full(run, query or {}, since, until, maxItems, checkIds or [], stored)
        except HistoryGone:
            return {"items": [], "cursor": None, "truncated": False, "billed": self.billed - billed0,
                    "requests": self.ctx.http.requests - req0, "cursorExpired": True,
                    "warnings": ["gmail-api: Gmail no longer has the history since the last sync (it keeps about a "
                                 "week)"]}
        except LoginNeeded as e:
            return {"items": [], "cursor": cursor, "truncated": True, "billed": self.billed - billed0,
                    "requests": self.ctx.http.requests - req0, "blocked": str(e)}
        except QuotaExhausted as e:
            run["truncated"] = True
            run["warnings"].append(str(e))
            new_cursor = cursor                       # resume from the old position next time
        run["warnings"] += self.warnings
        self.warnings = []
        items = sorted(run["items"].values(), key=lambda x: (x["createdAt"], x["extId"]), reverse=True)
        out = {"items": items, "cursor": new_cursor, "truncated": run["truncated"], "billed": self.billed - billed0,
               "requests": self.ctx.http.requests - req0, "checked": run["checked"], "deleted": sorted(set(run["deleted"])),
               "removed": sorted(set(run["removed"]))}
        if run["warnings"]:
            out["warnings"] = run["warnings"]
        return out

    def _full(self, run: dict, query: dict, since: str | None, until: str | None, budget: int, check: list[str],
              stored: set[str]) -> str | None:
        """messages.list with the native query, newest first, at most `budget` messages read; the cursor is
        the historyId from before the listing, so changes made while listing are replayed next time. A backfill
        (`until`) never reads a message the store already holds: history keeps those current."""
        hid = str(self.profile().get("historyId") or "") or None
        q = native_query(query, since, until)
        skip = stored if until else set()
        ids: list[str] = []
        seen: set[str] = set()
        token = None
        while True:
            want = LIST_MAX if skip else max(1, min(LIST_MAX, budget - len(ids)))
            r = self._get("/messages", {"q": q or None, "maxResults": want, "pageToken": token})
            if r.status != 200:
                raise ConnectorError(f"gmail-api: messages.list failed (HTTP {r.status}); check the selectors' "
                                     f"Gmail query: {q!r}")
            body = r.json() or {}
            page = [str(m["id"]) for m in body.get("messages") or [] if m.get("id")]
            fresh = [m for m in page if m not in seen]
            seen.update(fresh)
            ids += [m for m in fresh if m not in skip]
            token = body.get("nextPageToken")
            if len(ids) >= budget or not token or not fresh:      # a page with no new ids: stop (no endless paging)
                break
        if len(ids) > budget or (len(ids) >= budget and token):
            run["truncated"] = True
        ids = ids[:budget]
        for mid in ids:
            self._take(run, mid)
        listed = set(ids)
        for xid in check:                     # stored, not listed now: deleted, trashed, relabeled or older
            if xid in listed or self._take(run, xid) != "skipped":
                run["checked"].append(xid)
        return hid

    def _in_label_ids(self, query: dict) -> set[str]:
        """Label ids named by the query's `in` (label:/in: prefixes and Gmail's dashes ignored)."""
        want = set()
        for v in _vals(query.get("in")):
            v = v.strip()
            for pre in ("label:", "in:"):
                if v.lower().startswith(pre):
                    v = v[len(pre):]
            want.add(_label(v).casefold())
        if not want:
            return set()
        return {lid for lid, name in self.labels().items()
                if _label(name).casefold() in want or lid.casefold() in want}

    def _incremental(self, run: dict, cursor: str, query: dict, budget: int, check: list[str],
                     stored: set[str]) -> str:
        """history.list from the cursor. Every change to a stored message is read again (its labels may have
        taken it out of scope, at any age). For messages the store does not hold: new messages are read unless
        they arrive in trash, spam or drafts; label changes are read only when an added label is one the query's
        `in` names, or trash, spam or a user label was removed (restored, or a `not: {in: ...}` may now match);
        UNREAD, IMPORTANT, STARRED, CATEGORY_* and every other label-only change is ignored. Paging stops at the
        budget on a history record boundary and returns the last record read as the cursor, so the next sync
        continues there (a record is never split: the first one is read whole even if it alone is over the
        budget, so a replay always makes progress). Deletion checks are not needed: history reports deletions."""
        changed: dict[str, None] = {}
        deleted: set[str] = set()
        in_ids: set[str] | None = None
        latest, done, token, stop = cursor, cursor, None, False
        while not stop:
            r = self._get("/history", {"startHistoryId": cursor, "maxResults": LIST_MAX, "pageToken": token})
            if r.status == 404:
                raise HistoryGone()
            if r.status != 200:
                raise ConnectorError(f"gmail-api: history.list failed (HTTP {r.status})")
            body = r.json() or {}
            latest = str(body.get("historyId") or latest)
            for h in body.get("history") or []:
                want: list[str] = []
                gone: list[str] = []
                for x in h.get("messagesAdded") or []:
                    m = x.get("message") or {}
                    if m.get("id") and (m["id"] in stored or not set(m.get("labelIds") or []) & OUT_OF_SCOPE):
                        want.append(str(m["id"]))
                for key in ("labelsAdded", "labelsRemoved"):
                    for x in h.get(key) or []:
                        mid = str((x.get("message") or {}).get("id") or "")
                        if not mid:
                            continue
                        labels = set(x.get("labelIds") or [])
                        if mid in stored:
                            want.append(mid)
                        elif key == "labelsAdded":
                            if in_ids is None:
                                in_ids = self._in_label_ids(query) if query.get("in") else set()
                            if labels & in_ids:
                                want.append(mid)
                        elif labels & {"TRASH", "SPAM"} or any(lb.startswith("Label_") for lb in labels):
                            want.append(mid)
                for x in h.get("messagesDeleted") or []:
                    mid = (x.get("message") or {}).get("id")
                    if mid:
                        gone.append(str(mid))
                fresh = [m for m in dict.fromkeys(want) if m not in changed]
                if changed and len(changed) + len(fresh) > budget:
                    stop = True                    # the next sync starts at this record
                    break
                for mid in fresh:
                    changed[mid] = None
                    deleted.discard(mid)
                for mid in gone:
                    deleted.add(mid)
                    changed.pop(mid, None)
                done = str(h.get("id") or done)
            token = body.get("nextPageToken")
            if not token:
                break
        run["truncated"] = stop
        for mid in changed:
            self._take(run, mid)
        run["deleted"] += sorted(deleted)
        for xid in check:                     # only when asked; history already reports deletions
            if self._take(run, xid) != "skipped":
                run["checked"].append(xid)
        return done if stop else latest

    def _take(self, run: dict, mid: str) -> str:
        status, item = self._message(mid)
        self._record(run, mid, status, item)
        return status

    @staticmethod
    def _record(run: dict, mid: str, status: str, item: dict | None) -> None:
        if status == "deleted":
            run["deleted"].append(mid)
        elif status == "removed":
            run["removed"].append(mid)
        elif item is not None:
            run["items"][item["id"]] = item

    # ------------------------------------------------------------ messages
    def _message(self, mid: str) -> tuple[str, dict | None]:
        """("item", item) | ("deleted", None) | ("removed", None) | ("skipped", None); cached per instance."""
        if mid in self._cache:
            return self._cache[mid]
        if not MSG_ID.match(str(mid)):
            return "skipped", None
        r = self._get(f"/messages/{mid}", {"format": "full"})
        self.billed += 1
        if r.status == 404:
            res = ("deleted", None)
        elif r.status != 200:
            raise ConnectorError(f"gmail-api: messages.get failed (HTTP {r.status})")
        else:
            m = r.json() or {}
            res = ("removed", None) if set(m.get("labelIds") or []) & OUT_OF_SCOPE else ("item", self._to_item(m))
        self._cache[mid] = res
        return res

    def _to_item(self, m: dict) -> dict:
        payload = m.get("payload") or {}
        hdr: dict[str, str] = {}
        for h in payload.get("headers") or []:
            hdr.setdefault(str(h.get("name", "")).lower(), str(h.get("value", "")))
        name, addr = parseaddr(hdr.get("from", ""))
        to = [a.lower() for _, a in getaddresses([hdr.get("to", "")]) if a]
        cc = [a.lower() for _, a in getaddresses([hdr.get("cc", "")]) if a]
        plain: list[str] = []
        html: list[str] = []
        parts: list[dict] = []
        skipped: list[str] = []
        _walk(payload, plain, html, parts, skipped)
        self.warnings += [f"gmail-api: message {m['id']}: {w}" for w in skipped]
        if plain:
            text = plain[0]
        elif html:
            text = html_to_text(html[0])
        else:
            text = m.get("snippet") or ""
        text = trim_quoted(text)
        atts = [self._attachment(m["id"], p) for p in parts]
        ms = int(m.get("internalDate") or 0)
        created = iso(datetime.fromtimestamp(ms / 1000, tz=timezone.utc)) if ms else iso(self.ctx.now())
        names = self.labels()
        account = str(self.profile().get("emailAddress") or "").lower()
        subject = hdr.get("subject") or None
        author = {"email": addr.lower()}
        if name:
            author["name"] = name
        url = (f"https://mail.google.com/mail/?authuser={urllib.parse.quote(account)}#all/{m['id']}" if account
               else f"https://mail.google.com/mail/u/0/#all/{m['id']}")
        item = {
            "id": f"gmail:{m['id']}", "extId": str(m["id"]), "source": "gmail", "kind": "email",
            "author": author, "title": subject, "text": text, "url": url, "createdAt": created,
            "fetchedAt": iso(self.ctx.now()), "container": None,
            "labels": sorted({names.get(x, x) for x in m.get("labelIds") or []}),
            "threadId": str(m.get("threadId") or m["id"]),
            "from": addr.lower(), "to": to, "cc": cc, "subject": subject,
            "messageId": hdr.get("message-id") or None, "inReplyTo": hdr.get("in-reply-to") or None,
            "hasAttachments": bool(atts), "attachments": atts,
        }
        if account:
            item["account"] = account
        return item

    def _attachment(self, mid: str, part: dict) -> dict:
        body = part.get("body") or {}
        att = {"name": str(part.get("filename") or ""), "mime": str(part.get("mimeType") or "application/octet-stream"),
               "size": int(body.get("size") or 0), "textChars": 0}
        kind, why = text_kind(att["name"], att["mime"])
        if kind is None:
            att["reason"] = why
            return att
        if att["size"] > self.max_bytes:
            att["reason"] = f"over the {self.max_bytes // (1024 * 1024)} MB attachment cap: metadata only"
            return att
        data = None
        try:
            if body.get("data"):
                data = b64url(body["data"])
            elif body.get("attachmentId"):
                aid = urllib.parse.quote(str(body["attachmentId"]), safe="")
                r = self._get(f"/messages/{mid}/attachments/{aid}")
                if r.status != 200:
                    att["reason"] = f"could not download the attachment (HTTP {r.status}): metadata only"
                    return att
                data = b64url((r.json() or {}).get("data") or "")
        except ValueError:
            att["reason"] = "the attachment content is not valid base64url: metadata only"
            return att
        if data is None:
            att["reason"] = "no attachment content: metadata only"
            return att
        if len(data) > self.max_bytes:
            att["reason"] = f"over the {self.max_bytes // (1024 * 1024)} MB attachment cap: metadata only"
            return att
        text, why = extract_text(data, kind, max_chars=self.max_chars, timeout_s=self.timeout_s, mem_mb=self.mem_mb)
        if why:
            att["reason"] = why
        else:
            att["text"], att["textChars"] = text, len(text)
        return att


def _walk(part: dict, plain: list[str], html: list[str], atts: list[dict], skipped: list[str]) -> None:
    """Depth-first over a message payload: parts with a filename are attachments; the first text/plain and
    text/html bodies are kept. A body part that does not decode is skipped, with the reason in `skipped`."""
    if part.get("filename"):
        atts.append(part)
        return
    mt = str(part.get("mimeType") or "").lower()
    if part.get("parts"):
        for p in part["parts"]:
            _walk(p, plain, html, atts, skipped)
        return
    data = (part.get("body") or {}).get("data")
    if not data or mt not in ("text/plain", "text/html"):
        return
    try:
        raw = b64url(data)
    except ValueError:
        skipped.append(f"a {mt} body part is not valid base64url and was skipped")
        return
    (plain if mt == "text/plain" else html).append(_decode(raw, _charset(part)))


# ------------------------------------------------------------------ login (bay auth gmail)
def pkce() -> tuple[str, str]:
    """(code_verifier, S256 code_challenge), RFC 7636."""
    verifier = _rand.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


def auth_url(client_id: str, redirect: str, challenge: str, state: str) -> str:
    return AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": client_id, "redirect_uri": redirect, "response_type": "code", "scope": SCOPE,
        "code_challenge": challenge, "code_challenge_method": "S256", "state": state,
        "access_type": "offline", "prompt": "consent"})


def wait_for_code(server, state: str, timeout_s: float) -> str:
    """Serve the loopback redirect until Google sends the code back (or an error), at most timeout_s. A request
    whose state is not this login's is ignored (its code is never used) and waiting goes on."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        server.timeout = max(0.1, deadline - time.monotonic())
        server.handle_request()
        got = getattr(server, "got", None)
        if got is None:
            continue
        if not _rand.compare_digest(str(got.get("state") or ""), state):
            server.got = None                # not this login's redirect (a stale tab, another site): keep waiting
            continue
        if got.get("error"):
            raise ConnectorError(f"Google did not grant access ({got['error']})")
        if got.get("code"):
            return got["code"]
    raise ConnectorError(f"no answer from the browser within {int(timeout_s)}s; run `bay auth gmail` again")


def loopback_server(port: int = 0):
    """An HTTP server on 127.0.0.1 that records the first redirect's query parameters (server.got)."""
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query))
            if "code" in q or "error" in q:
                self.server.got = q
                msg = b"agentbay: Gmail login received. You can close this tab."
            else:
                msg = b"agentbay: waiting for the Google login redirect."
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

        def log_message(self, *a):            # never print the code
            pass

    srv = HTTPServer(("127.0.0.1", port), Handler)
    srv.got = None
    return srv


def login(http, client_id: str, client_secret: str, *, open_browser, timeout_s: float = 300, say=print,
          port: int = 0) -> dict:
    """Installed-app OAuth flow: PKCE, loopback redirect on 127.0.0.1, scope gmail.readonly only. Exchanges the
    code at the token endpoint (through `http`, an allowlisted connect.Http) and returns the token response.
    Refuses a grant that is broader than gmail.readonly or has no refresh token."""
    verifier, challenge = pkce()
    state = _rand.token_urlsafe(24)
    srv = loopback_server(port)
    try:
        redirect = f"http://127.0.0.1:{srv.server_address[1]}"
        url = auth_url(client_id, redirect, challenge, state)
        say("Opening your browser to sign in to Google (read-only Gmail access). If it does not open, visit:\n"
            + url)
        open_browser(url)
        code = wait_for_code(srv, state, timeout_s)
    finally:
        srv.server_close()
    r = http.request("POST", TOKEN_URL, data={"code": code, "client_id": client_id, "client_secret": client_secret,
                                              "redirect_uri": redirect, "grant_type": "authorization_code",
                                              "code_verifier": verifier})
    try:
        body = r.json() or {}
    except ValueError:
        body = {}
    if r.status != 200 or not body.get("access_token"):
        raise ConnectorError(f"the token exchange failed (HTTP {r.status}, {body.get('error', 'no error code')})")
    vault.remember(body["access_token"])
    granted = set(str(body.get("scope") or "").split())
    if granted != {SCOPE}:
        raise ConnectorError(f"Google granted {sorted(granted) or 'no scopes'}, not only {SCOPE}; nothing was stored")
    if not body.get("refresh_token"):
        raise ConnectorError("Google returned no refresh token; remove agentbay's access at "
                             "https://myaccount.google.com/permissions and run `bay auth gmail` again")
    vault.remember(body["refresh_token"])
    return body


def account_of(http, access_token: str) -> str | None:
    """The signed-in address (users.getProfile), to confirm the login works."""
    r = http.request("GET", f"{API}/profile", headers={"Authorization": f"Bearer {access_token}"})
    return (r.json() or {}).get("emailAddress") if r.status == 200 else None


def create(ctx) -> GmailApi:
    return GmailApi(ctx)
