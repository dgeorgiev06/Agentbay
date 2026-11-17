export type CommandCheck = { readonly kind: "listed" } | { readonly kind: "refused"; readonly why: string };

const plainArguments = /^[A-Za-z0-9 _./=:,@%+-]*$/;

const outerSpacesAndTabs = /^[ \t]+|[ \t]+$/g;

function argumentsAfter(command: string, words: string): string | undefined {
  if (command === words) {
    return "";
  }
  return command.startsWith(`${words} `) ? command.slice(words.length + 1) : undefined;
}

export function checkCommand(command: string, listedWords: readonly string[]): CommandCheck {
  const trimmed = command.replace(outerSpacesAndTabs, "");
  if (trimmed === "") {
    return { kind: "refused", why: "the command is empty" };
  }
  const tails = listedWords.flatMap((words) => {
    const tail = argumentsAfter(trimmed, words);
    return tail === undefined ? [] : [tail];
  });
  if (tails.length === 0) {
    return {
      kind: "refused",
      why: "it is not the words of a command the step may run, alone or followed by a space and arguments",
    };
  }
  if (!tails.some((tail) => plainArguments.test(tail))) {
    return {
      kind: "refused",
      why:
        "the text after the command's words holds a character other than letters, digits, spaces " +
        "and _ . / = : , @ % + -",
    };
  }
  return { kind: "listed" };
}
