"""Feature playbooks: lintable markdown.

Required H2 sections, in this order:
  Purpose, Inputs, Steps, Definition of Done, Outputs, Failure handling

`Steps` is a numbered list. `Definition of Done` is a checklist whose items each
carry a stable id and level:  - [DOD-1] (must) Every theme cites ...
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

SECTIONS = ["Purpose", "Inputs", "Steps", "Definition of Done", "Outputs", "Failure handling"]
H2 = re.compile(r"^##\s+(.+?)\s*#*\s*$")
DOD = re.compile(r"^\s*[-*]\s+\[(DOD-[0-9]+)\]\s+\((must|should|must_not)\)\s+(\S.*)$")
LIST_ITEM = re.compile(r"^\s*([-*]|[0-9]+[.)])\s+")
NUMBERED = re.compile(r"^\s*([0-9]+)[.)]\s+\S")
# review configuration belongs in mode.yaml only
REVIEW_SETTING = re.compile(r"^\s*(?:[-*]\s*)?(?:review|reviewer|review[._-](?:role|when|model|effort))\s*:", re.I)
REVIEW_HEADING = re.compile(r"^#{1,6}\s+review(?:er)?\b(?!\s+of\b)", re.I)


@dataclass
class DodItem:
    id: str
    level: str
    text: str
    line: int


@dataclass
class Playbook:
    path: Path
    text: str
    sections: dict[str, tuple[int, list[tuple[int, str]]]] = field(default_factory=dict)  # name -> (line, body lines)
    order: list[tuple[str, int]] = field(default_factory=list)
    dod: list[DodItem] = field(default_factory=list)
    problems: list[tuple[int, str]] = field(default_factory=list)  # (line, message)

    @property
    def dod_ids(self) -> list[str]:
        return [d.id for d in self.dod]


def parse(path: Path) -> Playbook:
    text = path.read_text(encoding="utf-8")
    pb = Playbook(path=path, text=text)
    lines = text.splitlines()
    current = None
    in_fence = False
    for i, raw in enumerate(lines, 1):
        if raw.strip().startswith("```"):
            in_fence = not in_fence
        if in_fence:
            continue
        if i == 1 and raw.strip() == "---":
            pb.problems.append((i, "front matter is not allowed in a playbook (review settings belong in mode.yaml)"))
        if REVIEW_SETTING.match(raw) or REVIEW_HEADING.match(raw):
            pb.problems.append((i, "review settings found in playbook; configure review only in mode.yaml "
                                   "endpoints.<feature>.review"))
        m = H2.match(raw)
        if m:
            current = m.group(1).strip()
            pb.order.append((current, i))
            if current in pb.sections:
                pb.problems.append((i, f"duplicate section '## {current}'"))
            pb.sections[current] = (i, [])
            continue
        if current is not None:
            pb.sections[current][1].append((i, raw))

    names = [n for n, _ in pb.order]
    for s in SECTIONS:
        if s not in names:
            pb.problems.append((1, f"missing required section '## {s}'"))
    present = [n for n in names if n in SECTIONS]
    expected = [s for s in SECTIONS if s in present]
    if present != expected:
        line = next(ln for n, ln in pb.order if n in SECTIONS and present.index(n) != expected.index(n))
        pb.problems.append((line, "sections out of order: expected " + ", ".join(SECTIONS)
                            + "; found " + ", ".join(present)))

    if "Steps" in pb.sections:
        hline, body = pb.sections["Steps"]
        items = [(ln, t) for ln, t in body if LIST_ITEM.match(t) and not t.startswith((" ", "\t"))]
        if not items:
            pb.problems.append((hline, "'## Steps' must be a numbered list (1. ..., 2. ...)"))
        expect = 1
        for ln, t in items:
            n = NUMBERED.match(t)
            if not n:
                pb.problems.append((ln, "Steps item is not numbered (use '1. ...')"))
                continue
            if int(n.group(1)) != expect:
                pb.problems.append((ln, f"Steps numbering: expected {expect}, found {n.group(1)}"))
            expect = int(n.group(1)) + 1

    if "Definition of Done" in pb.sections:
        hline, body = pb.sections["Definition of Done"]
        seen: dict[str, int] = {}
        for ln, t in body:
            if not LIST_ITEM.match(t):
                continue
            m = DOD.match(t)
            if not m:
                pb.problems.append((ln, "Definition of Done item must look like "
                                        "'- [DOD-1] (must|should|must_not) <checkable statement>'"))
                continue
            did, level, txt = m.groups()
            if did in seen:
                pb.problems.append((ln, f"duplicate DoD id {did} (first on line {seen[did]})"))
                continue
            seen[did] = ln
            pb.dod.append(DodItem(did, level, txt.strip(), ln))
        if not pb.dod and not any("DoD item" in p[1] for p in pb.problems):
            pb.problems.append((hline, "Definition of Done has no checklist items"))
    return pb
