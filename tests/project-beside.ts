export function projectBesideTheKit(projectRoot: string, kitRoot: string): string | undefined {
  return projectRoot === kitRoot ? undefined : projectRoot;
}
