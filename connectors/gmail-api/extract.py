"""Extract text from ONE untrusted attachment. Stdlib only; run only by gmail_api.extract_text as

    python3 -I extract.py <kind> <maxChars>        (kind: docx | text; the file's bytes on stdin)

in its own process with a timeout and memory/CPU/file-size limits, so a hostile file can at worst kill this
process. It writes nothing to disk and prints one JSON object on stdout:
    {"text": "..."}                   extracted text (at most maxChars + 1 characters, so the caller sees overflow)
    {"error": "<category>"}           not-docx | dtd | too-large | parse | kind
Error categories are fixed strings, never text from the file.
"""
from __future__ import annotations

import io
import json
import sys
import zipfile
import xml.etree.ElementTree as ET

MAX_XML = 50 * 1024 * 1024          # uncompressed word/document.xml (zip bomb guard)
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class Refused(Exception):
    pass


def docx_text(data: bytes, max_chars: int) -> str:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        info = z.getinfo("word/document.xml")
    except (zipfile.BadZipFile, KeyError, ValueError, OSError):
        raise Refused("not-docx") from None
    if info.file_size > MAX_XML:
        raise Refused("too-large")
    raw = z.read(info)                     # ZipExtFile stops at the declared size and checks the CRC
    head = raw.upper()
    if b"<!DOCTYPE" in head or b"<!ENTITY" in head:
        raise Refused("dtd")               # no DTDs: no entity expansion of any kind
    parts: list[str] = []
    n = 0
    for _ev, el in ET.iterparse(io.BytesIO(raw), events=("end",)):
        tag = el.tag
        if tag == W + "t":
            parts.append(el.text or "")
            n += len(el.text or "")
        elif tag == W + "tab":
            parts.append("\t")
        elif tag in (W + "br", W + "cr"):
            parts.append("\n")
        elif tag == W + "p":
            parts.append("\n")
            el.clear()
        if n > max_chars:
            break
    return "".join(parts).strip()


def plain_text(data: bytes) -> str:
    return data.decode("utf-8-sig", errors="replace").replace("\x00", "")


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[1] not in ("docx", "text"):
        print(json.dumps({"error": "kind"}))
        return 2
    max_chars = int(argv[2])
    data = sys.stdin.buffer.read()
    try:
        text = docx_text(data, max_chars) if argv[1] == "docx" else plain_text(data)
    except Refused as e:
        print(json.dumps({"error": str(e)}))
        return 0
    except Exception:                      # ParseError, BadZipFile, zlib.error, ...: never the file's text
        print(json.dumps({"error": "parse"}))
        return 0
    print(json.dumps({"text": text[: max_chars + 1]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
