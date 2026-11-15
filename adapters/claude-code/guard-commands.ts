export type CommandCheck = { readonly kind: "listed" } | { readonly kind: "refused"; readonly why: string };

const plainArguments = /^[A-Za-z0-9 _./=:,@%+-]*$/;

const outerSpacesAndTabs = /^[ \t]+|[ \t]+$/g;

function argumentsAfter(command: string, prefix: string): string | undefined {
  if (command === prefix) {
    return "";
  }
  return command.startsWith(`${prefix} `) ? command.slice(prefix.length + 1) : undefined;
}

export function checkCommand(command: string, prefixes: readonly string[]): CommandCheck {
  const trimmed = command.replace(outerSpacesAndTabs, "");
  if (trimmed === "") {
    return { kind: "refused", why: "the command is empty" };
  }
  const tails = prefixes.flatMap((prefix) => {
    const tail = argumentsAfter(trimmed, prefix);
    return tail === undefined ? [] : [tail];
  });
  if (tails.length === 0) {
    return { kind: "refused", why: "it does not start with a listed command prefix followed by a space" };
  }
  if (!tails.some((tail) => plainArguments.test(tail))) {
    return {
      kind: "refused",
      why: "the text after the prefix holds a character other than letters, digits, spaces and _ . / = : , @ % + -",
    };
  }
  return { kind: "listed" };
}
