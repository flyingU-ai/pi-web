import assert from "node:assert/strict";
import test from "node:test";
import { compareDataZoneEntries, dataZoneBand, dataZoneVisualGroup } from "./data-zone-bands.ts";

test("benchmark follows purpose and the slug list, not the folder name", () => {
  const slugs = new Set(["smt_benchmark"]);
  assert.equal(dataZoneBand("_incoming"), "incoming");
  assert.equal(dataZoneBand("cache"), "infra");
  assert.equal(dataZoneBand(".agent"), "infra");
  assert.equal(dataZoneBand("smt_benchmark", "benchmark", slugs), "benchmark");
  assert.equal(dataZoneBand("zsx_dip_benchmark_0815", "benchmark"), "benchmark");
  assert.equal(dataZoneBand("benchmark", ""), "benchmark");
  assert.equal(dataZoneBand("hyf_envole_bench10", ""), "train");
  assert.equal(dataZoneBand("hyf_envole_bench_1111", "", slugs), "train");
  assert.equal(dataZoneBand("dy_axi_seg", ""), "train");
  assert.equal(dataZoneVisualGroup("infra"), "incoming");
  assert.equal(dataZoneVisualGroup("benchmark"), "benchmark");
});

test("the pool root lists incoming, training, then benchmark", () => {
  const slugs = new Set(["smt_benchmark"]);
  const names = [
    "zsx_dip_benchmark_0815",
    "cache",
    "hyf_envole_bench10",
    "_incoming",
    "benchmark",
    "smt_benchmark",
    "dy_axi_seg",
  ];
  const sorted = names
    .map((name) => ({
      name,
      isDir: true,
      dataBand: dataZoneBand(
        name,
        name === "smt_benchmark" || name === "zsx_dip_benchmark_0815" ? "benchmark" : "",
        slugs,
      ),
    }))
    .sort(compareDataZoneEntries)
    .map((entry) => entry.name);
  assert.deepEqual(sorted, [
    "_incoming",
    "cache",
    "dy_axi_seg",
    "hyf_envole_bench10",
    "benchmark",
    "smt_benchmark",
    "zsx_dip_benchmark_0815",
  ]);
});
