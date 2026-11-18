/**
 * Top-level DatePool rows stay in one list. Bands only change order and color.
 * A name containing "bench" is not enough: the manifest purpose or the
 * benchmark slug list decides.
 */

export type DataZoneBand = "incoming" | "infra" | "train" | "benchmark";

const BENCH_PURPOSE = new Set(["benchmark", "val"]);
const INFRA_NAMES = new Set(["cache", "_agent", "pi-attachments"]);

export function dataZoneBand(
  name: string,
  purpose = "",
  slugs?: ReadonlySet<string>,
): DataZoneBand {
  if (name === "_incoming") return "incoming";
  if (name.startsWith(".") || INFRA_NAMES.has(name)) return "infra";
  const normalized = purpose.trim().toLowerCase();
  if (BENCH_PURPOSE.has(normalized) || name === "benchmark" || slugs?.has(name)) return "benchmark";
  return "train";
}

/** Incoming and platform dirs share the first band. No extra heading. */
export function dataZoneVisualGroup(band: DataZoneBand): "incoming" | "train" | "benchmark" {
  if (band === "benchmark") return "benchmark";
  if (band === "train") return "train";
  return "incoming";
}

const BAND_ORDER: Record<DataZoneBand, number> = {
  incoming: 0,
  infra: 1,
  train: 2,
  benchmark: 3,
};

export function compareDataZoneEntries(
  a: { name: string; isDir?: boolean; dataBand: DataZoneBand },
  b: { name: string; isDir?: boolean; dataBand: DataZoneBand },
): number {
  const band = BAND_ORDER[a.dataBand] - BAND_ORDER[b.dataBand];
  if (band !== 0) return band;
  if (Boolean(a.isDir) !== Boolean(b.isDir)) return a.isDir ? -1 : 1;
  return a.name.localeCompare(b.name);
}
