import {
  applyEnvironmentScope,
  enabledPatterns,
  isPatternEnabled,
  isProductionOnly,
  isProductionPattern,
  DEFAULT_ENVIRONMENT_PATTERNS,
  EnvironmentPattern,
} from "@/models/interfaces";

const patterns: EnvironmentPattern[] = [
  { name: "Development", regex: "dev", order: 1, color: "#4caf50" },
  { name: "QA", regex: "qa", order: 2, color: "#ff9800" },
  { name: "Staging", regex: "stg", order: 3, color: "#2196f3" },
  { name: "Production", regex: "prod|prd", order: 4, color: "#f44336" },
];

describe("isPatternEnabled", () => {
  it("treats an absent flag as included, so stored settings keep working", () => {
    expect(isPatternEnabled(patterns[0])).toBe(true);
  });

  it("respects an explicit flag either way", () => {
    expect(isPatternEnabled({ ...patterns[0], enabled: false })).toBe(false);
    expect(isPatternEnabled({ ...patterns[0], enabled: true })).toBe(true);
  });
});

describe("applyEnvironmentScope", () => {
  it("production scope includes only production-named environments", () => {
    const scoped = applyEnvironmentScope(patterns, "production");
    expect(enabledPatterns(scoped).map((p) => p.name)).toEqual(["Production"]);
  });

  it("all scope includes everything again", () => {
    const narrowed = applyEnvironmentScope(patterns, "production");
    const widened = applyEnvironmentScope(narrowed, "all");
    expect(enabledPatterns(widened).map((p) => p.name)).toEqual([
      "Development",
      "QA",
      "Staging",
      "Production",
    ]);
  });

  it("never removes patterns, so narrowing is fully reversible", () => {
    const scoped = applyEnvironmentScope(patterns, "production");
    expect(scoped).toHaveLength(patterns.length);
    expect(scoped.map((p) => p.name)).toEqual(patterns.map((p) => p.name));
  });

  it("does not mutate the input", () => {
    const before = JSON.stringify(patterns);
    applyEnvironmentScope(patterns, "production");
    expect(JSON.stringify(patterns)).toBe(before);
  });

  it("works on the shipped defaults", () => {
    const scoped = applyEnvironmentScope(DEFAULT_ENVIRONMENT_PATTERNS, "production");
    expect(enabledPatterns(scoped).map((p) => p.name)).toEqual(["Production"]);
  });
});

describe("isProductionOnly", () => {
  it("is false when everything is included", () => {
    expect(isProductionOnly(patterns)).toBe(false);
  });

  it("is true once narrowed to production", () => {
    expect(isProductionOnly(applyEnvironmentScope(patterns, "production"))).toBe(true);
  });

  it("is false when nothing at all is included", () => {
    expect(isProductionOnly(patterns.map((p) => ({ ...p, enabled: false })))).toBe(false);
  });

  it("is false when a non-production environment is also included", () => {
    const mixed = patterns.map((p) => ({
      ...p,
      enabled: p.name === "Production" || p.name === "QA",
    }));
    expect(isProductionOnly(mixed)).toBe(false);
  });
});

describe("isProductionPattern", () => {
  it.each(["Production", "PRD", "prd", "prod", "Live"])("recognises %s", (name) =>
    expect(isProductionPattern({ name, regex: "", order: 1, color: "#000" })).toBe(true)
  );

  // "Release" is a release-candidate tier more often than production, so an
  // environment by that name is not auto-classified as production.
  it.each(["Development", "QA", "Staging", "UAT", "Release"])("does not recognise %s", (name) =>
    expect(isProductionPattern({ name, regex: "", order: 1, color: "#000" })).toBe(false)
  );
});
