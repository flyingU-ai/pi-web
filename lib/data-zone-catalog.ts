import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compareDataZoneEntries, dataZoneBand, type DataZoneBand } from "./data-zone-bands";

function readJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function readDatasetPurpose(datasetDir: string): string {
  const doc = readJson(join(datasetDir, "cache", "manifest.json"));
  if (!doc) return "";
  const source = doc.source;
  const fromSource = source && typeof source === "object" && !Array.isArray(source)
    ? (source as Record<string, unknown>).purpose
    : "";
  const purpose = typeof fromSource === "string" && fromSource.trim()
    ? fromSource
    : doc.purpose;
  return typeof purpose === "string" ? purpose.trim().toLowerCase() : "";
}

export function readBenchmarkSlugs(poolRoot: string): Set<string> {
  const doc = readJson(join(poolRoot, "cache", "benchmark_datasets.json"));
  const slugs = new Set<string>();
  const listed = doc?.slugs;
  if (!Array.isArray(listed)) return slugs;
  for (const item of listed) {
    if (typeof item === "string" && item.trim()) slugs.add(item.trim());
  }
  return slugs;
}

export function annotateDataZoneBands<T extends { name: string; isDir?: boolean }>(
  poolRoot: string,
  entries: T[],
): Array<T & { dataBand: DataZoneBand }> {
  const slugs = readBenchmarkSlugs(poolRoot);
  return entries
    .map((entry) => ({
      ...entry,
      dataBand: dataZoneBand(entry.name, readDatasetPurpose(join(poolRoot, entry.name)), slugs),
    }))
    .sort(compareDataZoneEntries);
}
