export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word !== "").length;
}
