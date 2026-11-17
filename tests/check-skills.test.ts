import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertClean,
  check,
  cleanFiles,
  findFinding,
  notesSkillFile,
  skillSections,
  skillText,
  withoutFinding,
} from "./check-fixture.ts";
import { notesMode, paths, yamlText } from "./system-fixture.ts";

const sections = skillSections;

async function checkSkill(text: string, extra: Readonly<Record<string, string>> = {}): ReturnType<typeof check> {
  return check({ ...cleanFiles(), [notesSkillFile]: text, ...extra });
}

test("a skill whose front matter fails its schema is reported", async () => {
  const text = ["---", "name: write-note", "---", "", ...Object.values(sections).flat()].join("\n");
  const report = await checkSkill(text);
  const finding = findFinding(report, notesSkillFile, "This file is missing the required field description.");
  assert.equal(finding.severity, "error");
});

test("a skill whose name differs from its folder is reported with both names", async () => {
  const report = await checkSkill(skillText(Object.values(sections), "write-memo"));
  const finding = findFinding(
    report,
    notesSkillFile,
    "The skill in components/modes/notes/skills/write-note is named write-memo, but its folder is write-note.",
  );
  assert.equal(finding.line, 2);
  assert.equal(finding.fix, "Set name: write-note, or rename the folder to write-memo.");
});

test("a missing section is reported by name with the full order", async () => {
  const withoutTools = Object.values(sections).filter((section) => section !== sections.tools);
  const report = await checkSkill(skillText(withoutTools));
  const finding = findFinding(report, notesSkillFile, 'Skill write-note of mode notes has no "## Tools" section');
  assert.match(
    finding.message,
    /Input, Output, Definition of done, Instructions, Tools, Resources, Rules and constraints/,
  );
});

test("a section out of order is reported with the section it follows", async () => {
  const order = [sections.input, sections.output, sections.done, sections.tools, sections.instructions];
  const report = await checkSkill(skillText([...order, sections.resources, sections.rules]));
  const finding = findFinding(report, notesSkillFile, 'has "## Instructions" after "## Tools"');
  assert.equal(finding.fix, 'Move "## Instructions" before "## Tools".');
  assert.equal(report.findings.filter((entry) => entry.message.includes("after")).length, 1);
});

test("an unknown level-2 section is reported, and a level-3 heading inside a section is not", async () => {
  const notes = ["## Notes", "", "Extra text.", ""];
  const withSubheading = [...sections.instructions, "### Edge cases", "", "Say so.", ""];
  const order = [sections.input, sections.output, sections.done, withSubheading, sections.tools];
  const report = await checkSkill(skillText([...order, sections.resources, sections.rules, notes]));
  findFinding(report, notesSkillFile, 'has the section "## Notes", which is not one of Input, Output');
  withoutFinding(report, "Edge cases");
});

test("a section given twice is reported", async () => {
  const report = await checkSkill(skillText([...Object.values(sections), sections.rules]));
  findFinding(report, notesSkillFile, 'has the section "## Rules and constraints" more than once');
});

test("an empty Rules and constraints section is reported", async () => {
  const empty = ["## Rules and constraints", "", ""];
  const report = await checkSkill(skillText([...Object.values(sections).slice(0, 6), empty]));
  findFinding(report, notesSkillFile, 'has an empty "## Rules and constraints" section');
});

test("a Definition of done item in the wrong form is reported with its line", async () => {
  const done = [
    "## Definition of done",
    "",
    "- [DOD-1] (must) Fine.",
    "- [DOD-2] (maybe) Not a level.",
    "- Plain.",
    "",
  ];
  const report = await checkSkill(
    skillText([sections.input, sections.output, done, ...Object.values(sections).slice(3)]),
  );
  const wrong = report.findings.filter((finding) => finding.message.includes("is not in the form"));
  assert.deepEqual(
    wrong.map((finding) => finding.line),
    [17, 18],
  );
  assert.match(wrong[0]?.message ?? "", /"- \[DOD-n\] \(must\|should\|must_not\) text"/);
});

test("a Definition of done id used twice is reported with the line of its first use", async () => {
  const done = ["## Definition of done", "", "- [DOD-1] (must) One.", "- [DOD-1] (should) Two.", ""];
  const report = await checkSkill(
    skillText([sections.input, sections.output, done, ...Object.values(sections).slice(3)]),
  );
  findFinding(report, notesSkillFile, "uses the id DOD-1 twice; it is first used on line 16.");
});

test("a Definition of done with no items is reported", async () => {
  const done = ["## Definition of done", "", "Done when it is good.", ""];
  const report = await checkSkill(
    skillText([sections.input, sections.output, done, ...Object.values(sections).slice(3)]),
  );
  findFinding(report, notesSkillFile, 'lists no items under "## Definition of done"');
});

test("Instructions over 150 lines are reported with the cap, and 150 lines pass", async () => {
  const instructions = (count: number): readonly string[] => [
    "## Instructions",
    "",
    ...Array.from({ length: count }, (_, index) => `${String(index + 1)}. Step.`),
    "",
  ];
  const around = (count: number): readonly (readonly string[])[] => [
    sections.input,
    sections.output,
    sections.done,
    instructions(count),
    sections.tools,
    sections.resources,
    sections.rules,
  ];
  const over = await checkSkill(skillText(around(151)));
  findFinding(over, notesSkillFile, 'has 151 lines under "## Instructions", over the cap of 150 lines');
  const atCap = await checkSkill(skillText(around(150)));
  withoutFinding(atCap, "Instructions");
});

test("a tool that is neither an action, a required interface action nor a declared resource is reported", async () => {
  const tools = ["## Tools", "", "- items-store.put", "- notes.add", "- items-store.drop", "- db", "- http", ""];
  const order = [sections.input, sections.output, sections.done, sections.instructions, tools];
  const report = await checkSkill(skillText([...order, sections.resources, sections.rules]));
  findFinding(report, notesSkillFile, "lists notes.add under Tools, which is neither an action of mode notes");
  findFinding(report, notesSkillFile, "lists items-store.drop under Tools");
  findFinding(
    report,
    notesSkillFile,
    "lists the broker resource db under Tools, but mode notes does not declare resources.db",
  );
  findFinding(report, notesSkillFile, "does not declare resources.network (its hosts)");
  withoutFinding(report, "items-store.put");
});

test("declared broker resources are allowed as tools", async () => {
  const resources = { db: { migrations: "migrations/" }, files: { read: ["notes/"] }, network: ["api.example.com"] };
  const manifest = yamlText({ ...notesMode, resources, implements: [] });
  const tools = ["## Tools", "", "- db", "- files", "- http", "- events", "- secrets", ""];
  const order = [sections.input, sections.output, sections.done, sections.instructions, tools];
  const report = await checkSkill(skillText([...order, sections.resources, sections.rules]), {
    [paths.notes]: manifest,
  });
  const toolFindings = report.findings.filter((finding) => finding.message.includes("Tools"));
  assert.deepEqual(
    toolFindings.map((finding) => finding.message),
    [
      "Skill write-note of mode notes lists the broker resource secrets under Tools, " +
        "but mode notes does not declare resources.secrets.",
    ],
  );
});

test("a resource outside the mode folder and its declared paths is reported", async () => {
  const resources = { files: { read: ["notes/"], write: ["out/notes/"] } };
  const manifest = yamlText({ ...notesMode, resources });
  const entries = [
    "- workflows/daily.yaml",
    "- components/modes/notes/workflows/daily.yaml",
    "- notes/today.md",
    "- out/notes/",
    "- ../store/mode.yaml",
    "- /etc/passwd",
    "- out/other/x.md",
    "- schemas/missing.json",
  ];
  const resourceSection = ["## Resources", "", ...entries, ""];
  const order = [sections.input, sections.output, sections.done, sections.instructions, sections.tools];
  const report = await checkSkill(skillText([...order, resourceSection, sections.rules]), { [paths.notes]: manifest });
  const outside = report.findings.filter((finding) => finding.message.includes("lists the resource"));
  assert.deepEqual(
    outside.map((finding) => finding.message.split(",")[0]),
    [
      "Skill write-note of mode notes lists the resource ../store/mode.yaml",
      "Skill write-note of mode notes lists the resource /etc/passwd",
      "Skill write-note of mode notes lists the resource out/other/x.md",
      "Skill write-note of mode notes lists the resource schemas/missing.json",
    ],
  );
  assert.match(outside[0]?.message ?? "", /declares in resources\.files \(notes, out\/notes\)/);
});

test("a skill folder that no step names is checked too", async () => {
  const stray = "components/modes/notes/skills/spare/SKILL.md";
  const report = await check({ ...cleanFiles(), [stray]: skillText([sections.input], "spare") });
  findFinding(report, stray, 'Skill spare of mode notes has no "## Output" section');
});

test("two modes may each have a skill of the same name", async () => {
  const sameName = "components/base/store/skills/write-note/SKILL.md";
  const storeTools = ["## Tools", "", "- put", ""];
  const storeResources = ["## Resources", "", "- schemas/put-output.json", ""];
  const order = [sections.input, sections.output, sections.done, sections.instructions, storeTools];
  const report = await check({ ...cleanFiles(), [sameName]: skillText([...order, storeResources, sections.rules]) });
  assertClean(report);
});
