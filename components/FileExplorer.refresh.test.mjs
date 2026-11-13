import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const explorer = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/files/[...path]/route.ts", import.meta.url), "utf8");
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("folder expand does not watch every open directory", () => {
  assert.doesNotMatch(explorer, /watch-dir/);
  assert.doesNotMatch(explorer, /new EventSource\(`\/api\/files\//);
  assert.doesNotMatch(explorer, /visibilitychange/);
  assert.doesNotMatch(explorer, /addEventListener\("focus"/);
  assert.doesNotMatch(route, /watch-dir/);
  assert.match(route, /readFileTreeListing\(/);
  assert.doesNotMatch(route, /getGitIgnoredListedNames|getFileTreeVisibility/);
});

test("a tool end reloads only the selected directory", () => {
  assert.match(explorer, /if \(!directoryTouchToken \|\| !open \|\| !loaded \|\| pendingLinkTarget\) return/);
  assert.match(explorer, /if \(here !== selected\) return/);
  assert.match(explorer, /selectedTouchKey/);
  assert.match(shell, /onFilesystemMaybeChanged=\{handleExplorerTouchSelected\}/);
  assert.doesNotMatch(shell, /onFilesystemMaybeChanged=\{handleExplorerRefresh\}/);
});
