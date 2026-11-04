import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../../file-index/route.ts", import.meta.url), "utf8");
const filesSource = readFileSync(new URL("../../files/[...path]/route.ts", import.meta.url), "utf8");

test("DatePool git status stays empty and does not forest extra mounts", () => {
  assert.match(source, /Opening Assistant on DatePool must stay O\(1\)/);
  assert.match(source, /isDatePoolRoot\(cwd\) \|\| isDatePoolRoot\(resolved\)/);
  assert.doesNotMatch(source, /children\.map\(\(child\) => getGitStatusForest\(child\.path\)\)/);
  assert.match(source, /getGitStatusForest\(hit\.path\)/);
});

test("DatePool file-index only injects code\/ names", () => {
  assert.match(indexSource, /`\$\{VIRTUAL_CODE_DIR\}\/\$\{child\.name\}\/`/);
  assert.doesNotMatch(indexSource, /listWithGit\(child\.path\)/);
  assert.doesNotMatch(indexSource, /listWithWalk\(child\.path\)/);
});

test("DatePool file list reports why virtual code is missing", () => {
  assert.match(filesSource, /codeMount = \{ ok: false, reason: "admin_required" \}/);
  assert.match(filesSource, /blocked_by_real_code_dir/);
});
