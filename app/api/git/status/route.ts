import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { adminCodeRoot, canMountVirtualCode, virtualCodeDisplayPath } from "@/lib/dual-roots";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
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
    if (!isFilePathAllowed(cwd, allowedRoots)) {
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
      const codeRoot = adminCodeRoot(admin);
      const extra = await getGitStatusForest(codeRoot);
      return NextResponse.json({
        ...extra,
        files: extra.files.map((file) => ({
          ...file,
          filePath: virtualCodeDisplayPath(file.filePath, admin),
        })),
        repositoryRoot: extra.repositoryRoot
          ? path.join(cwd, "code")
          : extra.repositoryRoot,
      });
    }

    return NextResponse.json(await getGitStatus(cwd));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
