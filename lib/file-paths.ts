export function normalizeFilePathSlashes(filePath: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\")) {
    return filePath.replace(/\\/g, "/");
  }
  return filePath;
}

export function encodeFilePathForApi(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath);
  const segments = normalized.split("/").filter(Boolean);
  // A literal "//" prefix is normalized away by URL routing before it reaches
  // the catch-all handler, so a UNC root must live inside the first segment:
  // "//host" encodes as "%2F%2Fhost" and decodes back as a single segment.
  if (normalized.startsWith("//") && segments.length > 0) {
    segments[0] = `//${segments[0]}`;
  }
  return segments.map(encodeURIComponent).join("/");
}

export function getFileName(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath).replace(/\/+$/, "");
  return normalized.split("/").pop() ?? normalized;
}

export function getFileDirectory(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath).replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) return "";
  if (lastSlash === 0) return "/";
  if (lastSlash === 2 && /^[a-zA-Z]:\//.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, lastSlash);
}

export function getRelativeFilePath(filePath: string, cwd?: string): string {
  if (!cwd) return filePath;

  const normalizedFile = normalizeFilePathSlashes(filePath);
  const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
  if (normalizedFile.startsWith(normalizedCwd + "/")) {
    return normalizedFile.slice(normalizedCwd.length + 1);
  }
  return filePath;
}

export function joinFilePath(parent: string, child: string): string {
  return `${normalizeFilePathSlashes(parent).replace(/\/+$/, "")}/${child}`;
}

export function isUnderCodeZone(target: string, codeRoot?: string | null): boolean {
  const t = normalizeFilePathSlashes(target).replace(/\/+$/, "");
  const root = codeRoot ? normalizeFilePathSlashes(codeRoot).replace(/\/+$/, "") : "";
  if (root) return t === root || t.startsWith(`${root}/`);
  return /(^|\/)code(\/|$)/.test(t);
}

/**
 * Uploads only land in the code zone. Selected data/_incoming folders do not
 * become the drop target — default is code/home, never the DatePool root.
 */
export function uploadDirFromSelection(
  cwd: string,
  selectedDir?: string | null,
  codeHome?: string | null,
  codeRoot?: string | null,
): string {
  const home = codeHome ? normalizeFilePathSlashes(codeHome).replace(/\/+$/, "") : "";
  const zone = codeRoot ? normalizeFilePathSlashes(codeRoot).replace(/\/+$/, "") : "";
  const selected = selectedDir ? normalizeFilePathSlashes(selectedDir).replace(/\/+$/, "") : "";
  if (zone && selected && (selected === zone || selected.startsWith(`${zone}/`))) {
    if (selected === zone && home) return home;
    return selected;
  }
  if (home) return home;
  const root = normalizeFilePathSlashes(cwd).replace(/\/+$/, "");
  if (selected && (selected === root || selected.startsWith(`${root}/`)) && isUnderCodeZone(selected, zone)) {
    return selected;
  }
  return home || root;
}
