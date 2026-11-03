import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { canMountVirtualCode, listVirtualCodeChildren, virtualCodeDisplayPath } from "@/lib/dual-roots";
import { denyCrossAdminPath, getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getGitStatus, getGitStatusForest } from "@/lib/git-changes";
import { isDatePoolRoot } from "@/lib/web-bash-guard";
import { adminFromRequest, resolveCurrentAdminAsync } from "@/lib/web-admin-scope";

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

    if (isDatePoolRoot(cwd) && canMountVirtualCode(cwd, admin)) {
      const children = listVirtualCodeChildren(admin);
      const parts = await Promise.all(children.map((child) => getGitStatusForest(child.path)));
      return NextResponse.json({
        isGitRepository: parts.some((part) => part.isGitRepository),
        repositoryRoot: children.length ? path.join(cwd, "code") : null,
        files: parts.flatMap((part) => part.files.map((file) => ({
          ...file,
          filePath: virtualCodeDisplayPath(file.filePath, admin),
        }))),
        additions: parts.reduce((sum, part) => sum + part.additions, 0),
        deletions: parts.reduce((sum, part) => sum + part.deletions, 0),
      });
    }

    return NextResponse.json(await getGitStatus(cwd));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
