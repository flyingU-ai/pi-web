import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-web-git-symlink-"));
const extra = join(root, "promptDet");
const zoneLink = join(root, "zone", "promptDet");
mkdirSync(extra, { recursive: true });
mkdirSync(join(root, "zone"), { recursive: true });

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

git(extra, "init", "--quiet");
writeFileSync(join(extra, "tracked.py"), "original\n");
git(extra, "add", ".");
git(extra, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "base");
writeFileSync(join(extra, "tracked.py"), "updated\n");
writeFileSync(join(extra, "new.py"), "added\n");
symlinkSync(extra, zoneLink);

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { getGitFileDiff, getGitStatus, realPathOrSelf } = await jiti.import("./git-changes.ts");

test.after(() => {
  rmSync(root, { recursive: true, force: true });
});

test("realpath of a zone extra symlink is the real repo", () => {
  assert.equal(realPathOrSelf(zoneLink), extra);
  assert.equal(realPathOrSelf(join(zoneLink, "tracked.py")), join(extra, "tracked.py"));
});

test("git status through a code-zone symlink lists real dirty files", async () => {
  const status = await getGitStatus(zoneLink);
  assert.equal(status.isGitRepository, true);
  const names = status.files.map((file) => file.filePath).sort();
  assert.deepEqual(names, [join(extra, "new.py"), join(extra, "tracked.py")]);
});

test("git diff through a code-zone symlink returns a patch", async () => {
  const diff = await getGitFileDiff(zoneLink, join(zoneLink, "tracked.py"));
  assert.equal(diff.supported, true);
  assert.equal(diff.status, "modified");
  assert.match(diff.patch, /\+updated/);
  assert.match(diff.patch, /-original/);
});
