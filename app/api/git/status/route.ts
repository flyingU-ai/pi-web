import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { resolve } from "node:path";
import { canMountVirtualCode, listVirtualCodeChildren, resolveDualRootPath, virtualCodeDisplayPath } from "@/lib/dual-roots";
import { denyCrossAdminPath, getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getGitStatus, getGitStatusForest } from "@/lib/git-changes";
import type { GitStatusResponse } from "@/lib/git-types";
import { isDatePoolRoot } from "@/lib/web-bash-guard";
import { adminFromRequest, resolveCurrentAdminAsync, warehouseRoot, withWebAdmin } from "@/lib/web-admin-scope";

export async function GET(request: NextRequest) {
  return withWebAdmin(request, () => getGitStatusResponse(request));
}

async function getGitStatusResponse(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }

    const admin = (await resolveCurrentAdminAsync()) || adminFromRequest(request);
    const allowedRoots = await getAllowedFileRoots();
    if (denyCrossAdminPath(cwd, admin) || !isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const resolved = resolveDualRootPath(cwd, admin);
    if (denyCrossAdminPath(resolved, admin) || !isFilePathAllowed(resolved, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    // Opening Assistant on DatePool must stay O(1). Extra mounts (promptDet)
    // are git-scanned only after the user opens that folder.
    if (isDatePoolRoot(cwd) || isDatePoolRoot(resolved)) {
      return NextResponse.json({
        isGitRepository: false,
        repositoryRoot: null,
        files: [],
        additions: 0,
        deletions: 0,
      });
    }

    let stat: fs.Stats;
    try {
      // Virtual `$池/code/promptDet` does not exist; stat the zone symlink.
      stat = fs.statSync(resolved);
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }
    if (!isExistingFilePathAllowed(resolved, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const withDisplayPaths = (part: GitStatusResponse) => ({
      ...part,
      files: part.files.map((file) => ({
        ...file,
        filePath: virtualCodeDisplayPath(file.filePath, admin),
      })),
    });
    const sameRealPath = (left: string, right: string): boolean => {
      try {
        return fs.realpathSync(left) === fs.realpathSync(right);
      } catch {
        return resolve(left) === resolve(right);
      }
    };

    const warehouse = warehouseRoot();
    if (warehouse && canMountVirtualCode(warehouse, admin)) {
      const hit = listVirtualCodeChildren(admin).find((child) => sameRealPath(resolved, child.path));
      if (hit) {
        return NextResponse.json(withDisplayPaths(await getGitStatusForest(hit.path)));
      }
    }

    return NextResponse.json(withDisplayPaths(await getGitStatus(resolved)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
