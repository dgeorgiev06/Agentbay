import { basename, dirname, resolve } from "node:path/posix";
import { failed, granted, listed, manifestOf, type RefusalWording } from "../answers.ts";
import { checkPath, type PathCheck, type Purpose } from "./file-access.ts";
import { isInsideOrEqual, pathIn, shownPath } from "../layout.ts";
import { listInForce } from "./list-in-force.ts";
import type { OperationName } from "./operations.ts";
import {
  allowedWith,
  answered,
  type Asking,
  askingSentence,
  type Definition,
  type Doing,
  type Entries,
  noRefusalDetail,
  refusedWith,
  removesFiles,
  type Ruling,
  type Step,
  writesFiles,
} from "./rule.ts";

type FileOperationName = Extract<OperationName, `files.${string}`>;

export const dataFolder = ".agentbay";

type CheckedFile = { readonly file: string };

type CheckedFolder = { readonly folder: string };

type FileToWrite = { readonly file: string; readonly text: string };

type ThrowawayPath = { readonly full: string; readonly shown: string };

type LinkToMake = ThrowawayPath & { readonly target: string; readonly shownTarget: string };

type ThrowawayPlace = {
  readonly path: string;
  readonly checked: "itself" | "folder";
  readonly asked: string;
};

function shownAsked(path: string, asking: Asking): string {
  return shownPath(asking.layout, resolve(asking.layout.project, path));
}

function pathRefusal(
  check: Exclude<PathCheck, { readonly status: "allowed" }>,
  purpose: Purpose,
  asking: Asking,
): Ruling<never> {
  const { layout, grants } = asking;
  const permitted = purpose === "read" ? grants.readPaths : grants.writePaths;
  const shown = permitted.map((path) => shownPath(layout, path));
  const asked = `${askingSentence(asking)} to ${purpose} ${check.path}`;
  const manifestLine = `resources.files.${purpose} in ${manifestOf(grants)}`;
  switch (check.status) {
    case "outside":
      return refusedWith({
        resource: "files",
        asked,
        declared: `the mode ${grants.mode} may ${purpose} only: ${listed(shown, "nothing")}`,
        change: `To allow it, add ${shownPath(layout, check.path)} under ${manifestLine}.`,
      });
    case "through-link":
      return refusedWith({
        resource: "files",
        asked,
        declared: `a link on that path leads to ${check.realPath}, outside the permitted paths`,
        change: "Remove the link: a mode may not reach files through a link that leaves its folders.",
      });
    case "linked-component":
      return refusedWith({
        resource: "files",
        asked,
        declared: `${basename(check.link)} on that path is a link, and the broker writes through no link`,
        change: `Replace the link ${check.link} with a real folder or file.`,
      });
  }
}

async function checkedPath(path: string, purpose: Purpose, asking: Asking): Promise<Ruling<string>> {
  const permitted = purpose === "read" ? asking.grants.readPaths : asking.grants.writePaths;
  const check = await checkPath(asking.inspector, { layout: asking.layout, path, permitted, purpose });
  return check.status === "allowed" ? allowedWith(check.path) : pathRefusal(check, purpose, asking);
}

function outsideThrowaway(asked: string, asking: Asking): RefusalWording {
  const { layout, grants } = asking;
  const shown = grants.throwawayPaths.map((folder) => shownPath(layout, folder));
  return {
    resource: "files",
    asked,
    declared:
      `the mode ${grants.mode} keeps throwaway folders only in: ${listed(shown, "nothing")}, ` +
      "and never removes one of them whole",
    change: `To allow it, name a folder that holds the path under resources.files.throwaway in ${manifestOf(grants)}.`,
  };
}

async function throwawayPlace(place: ThrowawayPlace, asking: Asking): Promise<Ruling<string>> {
  const { layout, grants } = asking;
  const full = resolve(layout.project, place.path);
  const permitted = grants.throwawayPaths;
  const asked = place.asked;
  const list = listInForce(asking);
  if (!list.inForce) {
    return refusedWith({ resource: "files", asked, ...list.refusal });
  }
  if (!permitted.some((folder) => full !== folder && isInsideOrEqual(full, folder))) {
    return refusedWith(outsideThrowaway(asked, asking));
  }
  const checked = place.checked === "itself" ? full : dirname(full);
  const check = await checkPath(asking.inspector, { layout, path: checked, permitted, purpose: "write" });
  switch (check.status) {
    case "allowed":
      return allowedWith(full);
    case "outside":
      return refusedWith(outsideThrowaway(asked, asking));
    case "through-link":
      return refusedWith({
        resource: "files",
        asked,
        declared: `a link on that path leads to ${check.realPath}, outside the throwaway folders`,
        change: "Remove the link: the broker makes and removes nothing through a link.",
      });
    case "linked-component":
      return refusedWith({
        resource: "files",
        asked,
        declared: `${basename(check.link)} on that path is a link, and the broker makes and removes nothing through a link`,
        change: `Replace the link ${check.link} with a real folder.`,
      });
  }
}

function linkTarget(target: string, asked: string, asking: Asking): Ruling<string> {
  const layout = asking.layout;
  const full = resolve(layout.project, target);
  const data = pathIn(layout, "project", dataFolder);
  if (isInsideOrEqual(full, layout.project) && !isInsideOrEqual(full, data)) {
    return allowedWith(full);
  }
  return refusedWith({
    resource: "files",
    asked,
    declared: `a link may lead only to a path of the project outside ${dataFolder}/`,
    change: "Link to a file or folder of the project instead.",
  });
}

async function isTaken(path: string, doing: Doing): Promise<boolean> {
  return (await doing.inspector.realPath(path)) !== undefined || (await doing.inspector.isLink(path));
}

async function recordThrowaway(
  doing: Doing,
  detail: { readonly did: string; readonly path: string; readonly target?: string },
): Promise<void> {
  await doing.record("throwaway", { step: doing.stepKey, ...detail });
}

const filesRead: Definition<"files.read", CheckedFile> = {
  operation: "files.read",
  needs: () => [],
  described: (request, asking) => `read ${shownAsked(request.path, asking)}`,
  rule: async (request, asking) => {
    const checked = await checkedPath(request.path, "read", asking);
    return checked.allowed ? allowedWith({ file: checked.value }) : checked;
  },
  handler: async (readable, doing) => {
    const text = await doing.files.readText(readable.file);
    return text === undefined ? failed(`The file ${readable.file} does not exist.`) : granted(text);
  },
  refusalDetail: noRefusalDetail,
};

const filesList: Definition<"files.list", CheckedFolder> = {
  operation: "files.list",
  needs: () => [],
  described: (request, asking) => `list ${shownAsked(request.path, asking)}`,
  rule: async (request, asking) => {
    const checked = await checkedPath(request.path, "read", asking);
    return checked.allowed ? allowedWith({ folder: checked.value }) : checked;
  },
  handler: async (listable, doing) => granted(await doing.files.list(listable.folder)),
  refusalDetail: noRefusalDetail,
};

const filesWrite: Definition<"files.write", FileToWrite> = {
  operation: "files.write",
  needs: () => [writesFiles],
  described: (request, asking) => `write ${shownAsked(request.path, asking)}`,
  rule: async (request, asking) => {
    const checked = await checkedPath(request.path, "write", asking);
    return checked.allowed ? allowedWith({ file: checked.value, text: request.text }) : checked;
  },
  handler: async (writable, doing) => {
    const redacted = doing.scrubber.redactKnownValues(writable.text);
    if (redacted !== writable.text) {
      await doing.record("redacted", {
        step: doing.stepKey,
        file: writable.file,
        message: "A secret's value was removed from the text before the file was written.",
      });
    }
    await doing.files.writeAtomic(writable.file, redacted);
    return granted(null);
  },
  refusalDetail: noRefusalDetail,
};

const filesMakeFolder: Definition<"files.makeFolder", ThrowawayPath> = {
  operation: "files.makeFolder",
  needs: () => [writesFiles],
  described: (request, asking) => `make the folder ${shownAsked(request.path, asking)}`,
  rule: async (request, asking) => {
    const asked = `${askingSentence(asking)} to ${filesMakeFolder.described(request, asking)}`;
    const placed = await throwawayPlace({ path: request.path, checked: "itself", asked }, asking);
    return placed.allowed ? allowedWith({ full: placed.value, shown: shownAsked(request.path, asking) }) : placed;
  },
  handler: async (folder, doing) => {
    if (await isTaken(folder.full, doing)) {
      return failed(`The folder ${folder.shown} already exists.`);
    }
    await doing.throwawayFolders.makeFolder(folder.full);
    await recordThrowaway(doing, { did: "made the folder", path: folder.shown });
    return granted(null);
  },
  refusalDetail: noRefusalDetail,
};

const filesLink: Definition<"files.link", LinkToMake> = {
  operation: "files.link",
  needs: () => [writesFiles],
  described: (request, asking) => `link ${shownAsked(request.path, asking)} to ${shownAsked(request.target, asking)}`,
  rule: async (request, asking) => {
    const asked = `${askingSentence(asking)} to ${filesLink.described(request, asking)}`;
    const placed = await throwawayPlace({ path: request.path, checked: "folder", asked }, asking);
    if (!placed.allowed) {
      return placed;
    }
    const leadsTo = linkTarget(request.target, asked, asking);
    if (!leadsTo.allowed) {
      return leadsTo;
    }
    const shown = { shown: shownAsked(request.path, asking), shownTarget: shownAsked(request.target, asking) };
    return allowedWith({ full: placed.value, target: leadsTo.value, ...shown });
  },
  handler: async (link, doing) => {
    if (await isTaken(link.full, doing)) {
      return failed(`The path ${link.shown} already exists.`);
    }
    await doing.throwawayFolders.link(link.full, link.target);
    await recordThrowaway(doing, { did: "made a link", path: link.shown, target: link.shownTarget });
    return granted(null);
  },
  refusalDetail: noRefusalDetail,
};

const filesRemove: Definition<"files.remove", ThrowawayPath> = {
  operation: "files.remove",
  needs: () => [writesFiles, removesFiles],
  described: (request, asking) => `remove ${shownAsked(request.path, asking)}`,
  rule: async (request, asking) => {
    const asked = `${askingSentence(asking)} to ${filesRemove.described(request, asking)}`;
    const placed = await throwawayPlace({ path: request.path, checked: "folder", asked }, asking);
    return placed.allowed ? allowedWith({ full: placed.value, shown: shownAsked(request.path, asking) }) : placed;
  },
  handler: async (removable, doing) => {
    await doing.throwawayFolders.removeAll(removable.full);
    await recordThrowaway(doing, { did: "removed", path: removable.shown });
    return granted(null);
  },
  refusalDetail: noRefusalDetail,
};

export function fileEntries(step: Step): Entries<FileOperationName> {
  return {
    "files.read": (request) => answered(filesRead, request, step),
    "files.list": (request) => answered(filesList, request, step),
    "files.write": (request) => answered(filesWrite, request, step),
    "files.makeFolder": (request) => answered(filesMakeFolder, request, step),
    "files.link": (request) => answered(filesLink, request, step),
    "files.remove": (request) => answered(filesRemove, request, step),
  };
}
