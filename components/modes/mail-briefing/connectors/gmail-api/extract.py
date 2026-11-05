"""Extract text from one untrusted attachment; stdlib only, run in a limited process by gmail_api.extract_text."""
from __future__ import annotations

import io
import json
import re
import sys
import zipfile
from xml.parsers import expat

MAX_XML = 16 * 1024 * 1024
CHUNK = 64 * 1024
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
BOMS = (b"\xff\xfe", b"\xfe\xff", b"\x00\x00\xfe\xff")
XML_DECL = re.compile(rb"^\s*<\?xml[^>]*?\bencoding\s*=\s*[\"']([A-Za-z0-9._-]+)[\"']")


class Refused(Exception):
    pass


def _utf8_only(raw: bytes) -> None:
    """Refuse a part that is not UTF-8: another byte order mark, NUL bytes up front or another XML encoding."""
    if raw.startswith(BOMS) or b"\x00" in raw[:4]:
        raise Refused("encoding")
    m = XML_DECL.match(raw.removeprefix(b"\xef\xbb\xbf")[:512])
    if m and m.group(1).lower() not in (b"utf-8", b"utf8"):
        raise Refused("encoding")


def _refuse_dtd(*_args):
    raise Refused("dtd")


def docx_text(data: bytes, max_chars: int) -> str:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        info = z.getinfo("word/document.xml")
    except (zipfile.BadZipFile, KeyError, ValueError, OSError):
        raise Refused("not-docx") from None
    if info.file_size > MAX_XML:
        raise Refused("too-large")
    raw = z.read(info)
    if len(raw) > MAX_XML:
        raise Refused("too-large")
    _utf8_only(raw)
    parts: list[str] = []
    state = {"n": 0, "in_t": False}

    class Done(Exception):
        pass

    def start(name, _attrs):
        if name == f"{W} t":
            state["in_t"] = True
        elif name == f"{W} tab":
            parts.append("\t")
        elif name in (f"{W} br", f"{W} cr"):
            parts.append("\n")

    def end(name):
        if name == f"{W} t":
            state["in_t"] = False
        elif name == f"{W} p":
            parts.append("\n")
        if state["n"] > max_chars:
            raise Done()

    def text(data):
        if state["in_t"]:
            parts.append(data)
            state["n"] += len(data)

    p = expat.ParserCreate(encoding="UTF-8", namespace_separator=" ")
    p.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_NEVER)
    p.StartDoctypeDeclHandler = _refuse_dtd
    p.EntityDeclHandler = _refuse_dtd
    p.UnparsedEntityDeclHandler = _refuse_dtd
    p.ExternalEntityRefHandler = _refuse_dtd
    p.SkippedEntityHandler = _refuse_dtd
    p.StartElementHandler, p.EndElementHandler, p.CharacterDataHandler = start, end, text
    try:
        for i in range(0, len(raw), CHUNK):
            p.Parse(raw[i:i + CHUNK], False)
        p.Parse(b"", True)
    except Done:
        pass
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
    except Exception:
        print(json.dumps({"error": "parse"}))
        return 0
    print(json.dumps({"text": text[: max_chars + 1]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
