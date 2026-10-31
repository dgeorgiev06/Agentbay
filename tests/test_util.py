"""bay/util.py helpers that connectors share (proposal 0008, stage 5 part B): short_hash, in_window, warn."""
import hashlib
import json
from datetime import datetime, timezone

from helpers import KIT  # noqa: F401  (puts the kit on sys.path)

from bay import util

T = datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc)


def test_short_hash_is_the_sha256_prefix_of_a_string_or_of_sorted_json():
    assert util.short_hash("abc") == hashlib.sha256(b"abc").hexdigest()[:12]
    assert util.short_hash("abc", 16) == hashlib.sha256(b"abc").hexdigest()[:16]
    raw = json.dumps({"a": 1, "b": [2]}, sort_keys=True, ensure_ascii=False)
    assert util.short_hash({"b": [2], "a": 1}) == util.short_hash({"a": 1, "b": [2]}) == hashlib.sha256(raw.encode()).hexdigest()[:12]


def test_in_window_bounds_missing_and_bad_timestamps():
    assert util.in_window("2026-10-27T12:00:00Z", T, T)                     # both bounds are inclusive
    assert not util.in_window("2026-10-27T11:59:59Z", T, None)
    assert not util.in_window("2026-10-27T12:00:01Z", None, T)
    assert util.in_window("2026-10-27T12:00:01+00:00", T, None)
    assert util.in_window(None, None, T) and not util.in_window(None, T, None) and not util.in_window("", T, None)
    assert not util.in_window("yesterday", None, None)


def test_warn_appends_up_to_the_cap_and_accepts_no_list():
    util.warn(None, "ignored")
    out: list = []
    for n in range(util.MAX_WARNINGS + 5):
        util.warn(out, f"w{n}")
    assert len(out) == util.MAX_WARNINGS and out[-1] == f"w{util.MAX_WARNINGS - 1}"
