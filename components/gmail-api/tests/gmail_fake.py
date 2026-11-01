"""A fake Gmail API + Google token endpoint for tests: a transport for connect.Http built from fixture JSON.

Messages are compact specs (headers, text/HTML parts, attachments given as text, docx paragraphs, raw bytes or a
bare size); render() turns them into users.messages.get format=full payloads. Mutations (add, relabel, trash,
delete) append history records like Gmail's history.list. Every request is logged.
"""
from __future__ import annotations

import base64
import copy
import io
import json
import re
import zipfile
from datetime import timedelta
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

from bay.connect import Response

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "mailbox.json"
SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
BASE = "/gmail/v1/users/me"


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def make_docx(paragraphs: list[str]) -> bytes:
    w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    xml = f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="{w}"><w:body>{body}</w:body></w:document>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", xml)
    return buf.getvalue()


def _tokens(q: str) -> list[str]:
    """Split a Gmail query on spaces, keeping "quoted phrases" and {or groups} whole."""
    return re.findall(r'-?\{[^}]*\}|-?[\w.@+-]+:"[^"]*"|-?"[^"]*"|\S+', q or "")


def _words(phrase: str, text: str) -> bool:
    """Whole-word match: the phrase's words appear consecutively among the text's words."""
    want = re.findall(r"[a-z0-9]+", phrase.lower())
    have = re.findall(r"[a-z0-9]+", text.lower())
    return bool(want) and any(have[i:i + len(want)] == want for i in range(len(have) - len(want) + 1))


def _dash(v: str) -> str:
    return re.sub(r"[\s/]+", "-", v.strip().lower())


def jr(obj, status=200, headers=None) -> Response:
    return Response(status, headers or {}, json.dumps(obj).encode())


class FakeGmail:
    def __init__(self, now, fixture: Path = FIXTURE):
        fx = json.loads(Path(fixture).read_text())
        self.now = now
        self.account = fx["account"]
        self.history_id = int(fx["historyId"])
        self.min_history = 1
        self.labels = fx["labels"]
        self.messages = {m["id"]: copy.deepcopy(m) for m in fx["messages"]}
        self.history: list[dict] = []
        self.log: list[dict] = []
        self.token_error: str | None = None
        self.scope = SCOPE
        self.tokens = 0
        self.queue: list[tuple[str, int, dict]] = []      # (path regex, status, headers): served first, once each

    # ------------------------------------------------------------ mutations (each one is a history record)
    def _record(self, **kw) -> None:
        self.history_id += 1
        self.history.append({"id": str(self.history_id), **kw})

    def _ref(self, mid: str) -> dict:
        m = self.messages[mid]
        return {"id": mid, "threadId": m["threadId"], "labelIds": list(m["labelIds"])}

    def add(self, m: dict) -> None:
        self.messages[m["id"]] = copy.deepcopy(m)
        self._record(messagesAdded=[{"message": self._ref(m["id"])}])

    def relabel(self, mid: str, add=(), remove=()) -> None:
        m = self.messages[mid]
        m["labelIds"] = [x for x in m["labelIds"] if x not in remove] + [x for x in add if x not in m["labelIds"]]
        if add:
            self._record(labelsAdded=[{"message": self._ref(mid), "labelIds": list(add)}])
        if remove:
            self._record(labelsRemoved=[{"message": self._ref(mid), "labelIds": list(remove)}])

    def delete(self, mid: str) -> None:
        self.messages.pop(mid)
        self._record(messagesDeleted=[{"message": {"id": mid}}])

    def expire_history(self) -> None:
        self.min_history = self.history_id + 1

    # ------------------------------------------------------------ rendering
    def _created_ms(self, m: dict) -> int:
        return int((self.now - timedelta(hours=float(m["ageHours"]))).timestamp() * 1000)

    def _att_bytes(self, p: dict) -> bytes | None:
        if "docx" in p:
            return make_docx(p["docx"])
        if "text" in p:
            return p["text"].encode(p.get("charset", "utf-8"))
        if "raw" in p:
            return p["raw"].encode()
        return None

    def render(self, m: dict) -> dict:
        headers = [{"name": k, "value": v} for k, v in m["headers"].items()]
        texts, atts = [], []
        for i, p in enumerate(m.get("parts") or []):
            if p.get("filename"):
                data = self._att_bytes(p)
                body = {"size": p.get("size", len(data or b""))}
                if data is not None and p.get("inline"):
                    body["data"] = b64(data)
                elif data is not None or p.get("size"):
                    body["attachmentId"] = f"ATT{m['id']}x{i}"
                atts.append({"partId": str(i), "mimeType": p["mimeType"], "filename": p["filename"], "body": body,
                             "headers": []})
            else:
                cs = p.get("charset", "utf-8")
                data = p["text"].encode(cs)
                texts.append({"partId": str(i), "mimeType": p["mimeType"], "filename": "",
                              "headers": [{"name": "Content-Type", "value": f'{p["mimeType"]}; charset="{cs}"'}],
                              "body": {"size": len(data), "data": b64(data)}})
        if len(texts) == 1 and not atts:
            payload = {**texts[0], "headers": headers + texts[0]["headers"]}
        else:
            alt = {"mimeType": "multipart/alternative", "filename": "", "body": {"size": 0}, "parts": texts}
            payload = {"mimeType": "multipart/mixed", "filename": "", "headers": headers, "body": {"size": 0},
                       "parts": ([alt] if len(texts) > 1 else texts) + atts}
        return {"id": m["id"], "threadId": m["threadId"], "labelIds": list(m["labelIds"]),
                "snippet": "", "historyId": str(self.history_id), "internalDate": str(self._created_ms(m)),
                "payload": payload, "sizeEstimate": 1000}

    # ------------------------------------------------------------ transport
    def __call__(self, method, url, headers, body):
        u = urlsplit(url)
        params = dict(parse_qsl(u.query))
        form = dict(parse_qsl(body.decode())) if body else {}
        self.log.append({"method": method, "host": u.hostname, "path": u.path, "params": params, "form": form,
                         "headers": headers})
        for i, (rx, status, hdrs) in enumerate(self.queue):
            if re.search(rx, u.path):
                self.queue.pop(i)
                return jr({"error": {"code": status, "errors": [{"reason": "rateLimitExceeded"}]}}, status, hdrs)
        if u.hostname == "oauth2.googleapis.com" and method == "POST" and u.path == "/token":
            return self._token(form)
        if u.hostname != "gmail.googleapis.com" or method != "GET":
            return jr({"error": "unexpected request"}, 405)
        if headers.get("Authorization") != f"Bearer ya29.ACCESS-{self.tokens}":
            return jr({"error": {"code": 401}}, 401)
        path = u.path[len(BASE):] if u.path.startswith(BASE) else None
        if path == "/profile":
            return jr({"emailAddress": self.account, "messagesTotal": len(self.messages),
                       "historyId": str(self.history_id)})
        if path == "/labels":
            return jr({"labels": self.labels})
        if path == "/messages":
            return self._list(params)
        if path == "/history":
            return self._history(params)
        m = re.fullmatch(r"/messages/([^/]+)/attachments/([^/]+)", path or "")
        if m:
            return self._attachment(m.group(1), m.group(2))
        m = re.fullmatch(r"/messages/([^/]+)", path or "")
        if m:
            msg = self.messages.get(m.group(1))
            return jr(self.render(msg)) if msg else jr({"error": {"code": 404}}, 404)
        return jr({"error": "no route"}, 404)

    def _token(self, form: dict) -> Response:
        if form.get("grant_type") != "refresh_token":
            return jr({"error": "unsupported_grant_type"}, 400)
        if self.token_error:
            return jr({"error": self.token_error, "error_description": "Token has been expired or revoked."}, 400)
        self.tokens += 1
        return jr({"access_token": f"ya29.ACCESS-{self.tokens}", "expires_in": 3599, "scope": self.scope,
                   "token_type": "Bearer"})

    def matches(self, q: str, m: dict) -> bool:
        """Gmail search semantics, on the narrow side: from:/to: match the address, its domain or whole words of
        the header (display name included), subject: and free terms match whole words, - negates, {a b} ORs,
        label:/in: match label names (spaces and slashes as dashes), after:/before: are epoch seconds."""
        return all(self._term(t, m) for t in _tokens(q))

    def _term(self, t: str, m: dict) -> bool:
        if t.startswith("-"):
            return not self._term(t[1:], m)
        if t.startswith("{") and t.endswith("}"):
            return any(self._term(x, m) for x in _tokens(t[1:-1]))
        key, sep, val = t.partition(":")
        val = val.strip('"').lower()
        h = {k.lower(): v for k, v in m["headers"].items()}
        if sep and key in ("from", "to"):
            hv = h.get("from", "") if key == "from" else h.get("to", "") + "," + h.get("cc", "")
            addrs = [a.lower() for a in re.findall(r"[\w.+-]+@[\w.-]+", hv)]
            return any(val in (a, a.split("@")[1]) for a in addrs) or _words(val, hv)
        if sep and key == "subject":
            return _words(val, h.get("subject", ""))
        if sep and key in ("label", "in"):
            if key == "in" and val == "anywhere":
                return True
            if key == "in" and val == "drafts":
                return "DRAFT" in m["labelIds"]
            names = {_dash(self._label_name(x)) for x in m["labelIds"]} | {x.lower() for x in m["labelIds"]}
            return _dash(val) in names
        if sep and key == "has":
            return val == "attachment" and any(p.get("filename") for p in m.get("parts") or [])
        if sep and key in ("after", "before"):
            ms = self._created_ms(m)
            return ms >= int(val) * 1000 if key == "after" else ms < int(val) * 1000
        text = " ".join([h.get("from", ""), h.get("to", ""), h.get("subject", "")]
                        + [p.get("text", "") for p in m.get("parts") or [] if not p.get("filename")])
        return _words(t.strip('"').lower(), text)

    def _label_name(self, lid: str) -> str:
        return next((x.get("name") or lid for x in self.labels if x["id"] == lid), lid)

    def _list(self, params: dict) -> Response:
        q = params.get("q") or ""
        rows = [m for m in self.messages.values()
                if not ({"TRASH", "SPAM"} & set(m["labelIds"])) and self.matches(q, m)]
        rows.sort(key=lambda m: -self._created_ms(m))
        start = int(params.get("pageToken") or 0)
        n = int(params.get("maxResults") or 100)
        page = rows[start:start + n]
        out = {"messages": [{"id": m["id"], "threadId": m["threadId"]} for m in page], "resultSizeEstimate": len(rows)}
        if start + n < len(rows):
            out["nextPageToken"] = str(start + n)
        return jr(out)

    def _history(self, params: dict) -> Response:
        start = int(params["startHistoryId"])
        if start < self.min_history:
            return jr({"error": {"code": 404, "message": "Requested entity was not found."}}, 404)
        recs = [h for h in self.history if int(h["id"]) > start]
        off = int(params.get("pageToken") or 0)
        n = int(params.get("maxResults") or 100)
        out = {"history": recs[off:off + n], "historyId": str(self.history_id)}
        if off + n < len(recs):
            out["nextPageToken"] = str(off + n)
        return jr(out)

    def _attachment(self, mid: str, aid: str) -> Response:
        msg = self.messages.get(mid)
        if not msg:
            return jr({"error": {"code": 404}}, 404)
        i = int(aid.split("x")[-1])
        data = self._att_bytes(msg["parts"][i]) or b""
        return jr({"size": len(data), "data": b64(data)})
