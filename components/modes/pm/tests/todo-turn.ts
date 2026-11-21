import type { Json } from "../../../../bay/sdk.ts";

type Kind = "decision" | "fact" | "prototype";

type Question = {
  readonly id: string;
  readonly title: string;
  readonly asks: string;
  readonly after: readonly string[];
  readonly kind: Kind;
  readonly settled: boolean;
};

type Written = Pick<Question, "id" | "title" | "asks"> & Partial<Question>;

function question(written: Written): Question {
  return { after: [], kind: "decision", settled: false, ...written };
}

export const todoQuestions: readonly Question[] = [
  question({
    id: "Q1",
    title: "Adding and listing",
    asks: "What does a person see after adding a todo?",
    settled: true,
  }),
  question({ id: "Q2", title: "Ids", asks: "Is the id of a removed todo given to a new one?", settled: true }),
  question({ id: "Q3", title: "Where a mode lives", asks: "Where does a mode of the kit live?", kind: "fact" }),
  question({
    id: "Q4",
    title: "Due dates in the past",
    asks: "May a todo be added with a due date that has already passed?",
    after: ["Q1"],
  }),
  question({
    id: "Q5",
    title: "Done twice",
    asks: "What happens when a todo already done is marked done again?",
    after: ["Q2"],
  }),
  question({
    id: "Q6",
    title: "Order with due dates",
    asks: "In what order are open todos with due dates listed?",
    after: ["Q3", "Q4"],
  }),
  question({ id: "Q7", title: "How the list reads", asks: "How should the list look on a phone?", kind: "prototype" }),
];

export const todoTree: Json = { questions: todoQuestions };

export const askedQ4 = {
  question: "Q4",
  choices: ["Yes, and it is listed as overdue", "No, it is refused"],
  recommended: "a",
  why: "A person often writes down a task after its date has gone.",
};

export const askedQ5 = {
  question: "Q5",
  choices: ["It is refused, and says it is already done", "Nothing changes, and nothing is said"],
  recommended: "a",
  why: "A person who is told nothing cannot tell it was done before.",
};

export const factQ3 = {
  question: "Q3",
  says: "A mode is a folder with a mode.yaml.",
  source: "CONTEXT.md",
  quote: "A folder with a `mode.yaml`.",
};

export const todoTurn: Json = { asked: [askedQ4, askedQ5], facts: [factQ3] };

export const glossary = [
  "# The words we use",
  "",
  "| Term | Meaning | Do not say |",
  "|---|---|---|",
  "| **Mode** | A folder with a `mode.yaml`. The unit that is installed. | plugin |",
  "| **Round** | One pass of a slice through the test writer and the builder. | iteration |",
  "",
].join("\n");
