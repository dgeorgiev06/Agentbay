export type SkillFrontMatter = {
  readonly name: string;
  readonly description: string;
  readonly metadata?: { readonly input?: string; readonly output?: string };
};
