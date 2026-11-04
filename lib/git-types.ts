export type GitFileStatusKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflict";

export interface GitFileStatus {
  filePath: string;
  status: GitFileStatusKind;
  code: "M" | "A" | "D" | "R" | "U" | "C";
  indexStatus: string;
  worktreeStatus: string;
}

export type GitScanReason = "nested_repos";

export interface GitStatusResponse {
  isGitRepository: boolean;
  repositoryRoot: string | null;
  files: GitFileStatus[];
  additions: number;
  deletions: number;
  /** Extra mount is a folder of repos; the client should open a child instead of unioning them. */
  scanReason?: GitScanReason;
}

export interface GitFileDiffResponse {
  supported: boolean;
  status?: GitFileStatusKind;
  patch?: string;
}
