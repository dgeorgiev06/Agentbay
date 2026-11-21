export type ItemName = { readonly id: string; readonly title?: string };

function ordinal(position: number): string {
  const tens = position % 100;
  const suffixes = ["th", "st", "nd", "rd"];
  const suffix = tens >= 11 && tens <= 13 ? "th" : (suffixes[position % 10] ?? "th");
  return `${String(position)}${suffix}`;
}

export function itemPlaceWords(item: number, count: number | undefined): string {
  const of = count === undefined ? "item" : `of ${String(count)} ${count === 1 ? "item" : "items"}`;
  return `the ${ordinal(item + 1)} ${of}`;
}

export function itemNameWords(name: ItemName): string {
  return name.title === undefined ? name.id : `${name.id} (${name.title})`;
}

export function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

export function joinedWith(names: readonly string[], last: "and" | "or"): string {
  if (names.length < 2) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} ${last} ${names.at(-1) ?? ""}`;
}
