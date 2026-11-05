import {
  excludePipeline,
  includePipeline,
  isPipelineExcluded,
  ExcludedPipeline,
} from "@/models/interfaces";

const daily: ExcludedPipeline = { definitionId: 42, name: "daily-redeploy" };
const api: ExcludedPipeline = { definitionId: 7, name: "payments-api" };

describe("pipeline exclusion", () => {
  it("treats an absent list as nothing excluded, so stored settings keep working", () => {
    expect(isPipelineExcluded(undefined, 42)).toBe(false);
    expect(excludePipeline(undefined, daily)).toEqual([daily]);
    expect(includePipeline(undefined, 42)).toEqual([]);
  });

  it("matches on definition id, not name", () => {
    expect(isPipelineExcluded([daily], 42)).toBe(true);
    expect(isPipelineExcluded([daily], 43)).toBe(false);
    expect(isPipelineExcluded([{ ...daily, name: "renamed" }], 42)).toBe(true);
  });

  it("is idempotent — excluding twice does not duplicate", () => {
    const once = excludePipeline([], daily);
    const twice = excludePipeline(once, daily);
    expect(twice).toHaveLength(1);
    expect(twice).toBe(once);
  });

  it("keeps the list sorted by name so it stays readable", () => {
    const list = excludePipeline(excludePipeline([], daily), api);
    expect(list.map((p) => p.name)).toEqual(["daily-redeploy", "payments-api"]);
  });

  it("re-including removes only the requested pipeline", () => {
    const both = excludePipeline(excludePipeline([], daily), api);
    const left = includePipeline(both, daily.definitionId);
    expect(left).toEqual([api]);
  });

  it("re-including something absent is a no-op", () => {
    expect(includePipeline([daily], 999)).toEqual([daily]);
  });

  it("does not mutate the input", () => {
    const original = [daily];
    const snapshot = JSON.stringify(original);
    excludePipeline(original, api);
    includePipeline(original, 42);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});
