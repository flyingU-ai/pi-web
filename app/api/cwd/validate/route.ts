import { NextResponse } from "next/server";
import { type Stats } from "fs";
import { stat as statAsync } from "fs/promises";
import { homedir } from "os";
import { isAbsolute, resolve } from "path";
import { allowFileRoot } from "@/lib/file-access";
import { projectIdentityKey } from "@/lib/project-identity";
import { resolveProject } from "@/lib/worktree";

const VALIDATE_STAT_MS = 2_500;
const VALIDATE_PROJECT_MS = 3_000;

function normalizeCwd(cwd: string): string {
  if (cwd === "~") return homedir();
  if (cwd.startsWith("~/")) return resolve(homedir(), cwd.slice(2));
  return isAbsolute(cwd) ? cwd : resolve(cwd);
}

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => resolvePromise(undefined), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// POST /api/cwd/validate  body: { cwd: string }
// Validates a candidate workspace before the UI selects it.
// NFS / DatePool stat+git can hang; return the cwd as a non-git project instead of blocking Chat.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";

    if (!cwd) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const normalizedCwd = normalizeCwd(cwd);
    let stat: Stats | undefined;
    try {
      stat = await raceTimeout(statAsync(normalizedCwd), VALIDATE_STAT_MS);
    } catch {
      return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    }

    if (!stat) {
      allowFileRoot(normalizedCwd);
      return NextResponse.json({
        success: true,
        cwd: normalizedCwd,
        projectRoot: normalizedCwd,
        projectKey: projectIdentityKey(normalizedCwd),
        slowFs: true,
      });
    }

    if (!stat.isDirectory()) {
      return NextResponse.json({ error: `Path is not a directory: ${cwd}` }, { status: 400 });
    }

    allowFileRoot(normalizedCwd);
    let projectRoot = normalizedCwd;
    try {
      const project = await raceTimeout(resolveProject(normalizedCwd), VALIDATE_PROJECT_MS);
      if (project) projectRoot = project.projectRoot;
    } catch {
      projectRoot = normalizedCwd;
    }
    return NextResponse.json({
      success: true,
      cwd: normalizedCwd,
      projectRoot,
      projectKey: projectIdentityKey(projectRoot),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
