import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { resolve } from "node:path";
import { canMountVirtualCode, listVirtualCodeChildren, resolveDualRootPath, virtualCodeDisplayPath } from "@/lib/dual-roots";
import { denyCrossAdminPath, getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getGitStatus, getGitStatusForest } from "@/lib/git-changes";
import { isDatePoolRoot } from "@/lib/web-bash-guard";
import { adminFromRequest, resolveCurrentAdminAsync, warehouseRoot } from "@/lib/web-admin-scope";

export async function GET(request: NextRequest) {
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

    let stat: fs.Stats;
    try {
      stat = fs.statSync(cwd);
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const resolved = resolveDualRootPath(cwd, admin);
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

    const warehouse = warehouseRoot();
    if (warehouse && canMountVirtualCode(warehouse, admin)) {
      const hit = listVirtualCodeChildren(admin).find((child) => resolve(resolved) === resolve(child.path));
      if (hit) {
        const part = await getGitStatusForest(hit.path);
        return NextResponse.json({
          ...part,
          files: part.files.map((file) => ({
            ...file,
            filePath: virtualCodeDisplayPath(file.filePath, admin),
          })),
        });
      }
    }

    return NextResponse.json(await getGitStatus(resolved));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
