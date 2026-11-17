import { testWorktrees } from "../../interfaces/worktrees/tests/shared.ts";
import { startGitRepository } from "./repository.ts";

testWorktrees({ mode: "git-worktrees", ownData: [".git"], start: startGitRepository });
