import {
  classifyBand,
  calculateDeploymentFrequency,
  calculateLeadTime,
  calculateChangeFailureRate,
  calculateMttr,
  calculateAllDora,
  computeWeeklyTrends,
} from "@/services/DoraCalculator";
import { matchStageToEnvironment } from "@/services/DeploymentService";
import { DeploymentRecord, DEFAULT_ENVIRONMENT_PATTERNS } from "@/models/interfaces";
import { makeDeploymentRecord } from "../helpers/records";

function makeDeployment(overrides: Partial<DeploymentRecord> = {}): DeploymentRecord {
  return makeDeploymentRecord({ commitIds: ["abc123"], ...overrides });
}

describe("classifyBand", () => {
  it("classifies Elite when value is at or below elite threshold (lower is better)", () => {
    expect(classifyBand(5, { elite: 5, high: 10, medium: 30 }, true)).toBe("Elite");
    expect(classifyBand(3, { elite: 5, high: 10, medium: 30 }, true)).toBe("Elite");
  });

  it("classifies High when value is between elite and high", () => {
    expect(classifyBand(7, { elite: 5, high: 10, medium: 30 }, true)).toBe("High");
  });

  it("classifies Medium when value is between high and medium", () => {
    expect(classifyBand(20, { elite: 5, high: 10, medium: 30 }, true)).toBe("Medium");
  });

  it("classifies Low when value exceeds medium threshold", () => {
    expect(classifyBand(50, { elite: 5, high: 10, medium: 30 }, true)).toBe("Low");
  });

  it("classifies with higher-is-better logic", () => {
    expect(classifyBand(10, { elite: 7, high: 1, medium: 0.25 }, false)).toBe("Elite");
    expect(classifyBand(3, { elite: 7, high: 1, medium: 0.25 }, false)).toBe("High");
    expect(classifyBand(0.5, { elite: 7, high: 1, medium: 0.25 }, false)).toBe("Medium");
    expect(classifyBand(0.1, { elite: 7, high: 1, medium: 0.25 }, false)).toBe("Low");
  });
});

describe("calculateDeploymentFrequency", () => {
  it("returns Low with 0 deployments", () => {
    const result = calculateDeploymentFrequency([], 90);
    expect(result.value).toBe(0);
    expect(result.band).toBe("Low");
  });

  it("returns Low with 0 period days", () => {
    const result = calculateDeploymentFrequency([makeDeployment()], 0);
    expect(result.value).toBe(0);
    expect(result.band).toBe("Low");
  });

  it("calculates daily frequency for high volume", () => {
    const deployments = Array.from({ length: 90 }, (_, i) =>
      makeDeployment({
        buildId: i,
        finishTime: new Date(Date.UTC(2024, 0, 1 + i, 12)),
      })
    );
    const result = calculateDeploymentFrequency(deployments, 90);
    expect(result.value).toBe(1);
    expect(result.unit).toBe("per day");
  });

  it("calculates weekly frequency for moderate volume", () => {
    // 14 deployments over 90 days = ~1.09/week, which is >= 1/7 per day
    const deployments = Array.from({ length: 14 }, (_, i) =>
      makeDeployment({
        buildId: i,
        finishTime: new Date(Date.UTC(2024, 0, 1 + i * 6, 12)),
      })
    );
    const result = calculateDeploymentFrequency(deployments, 90);
    expect(result.unit).toBe("per week");
    expect(result.value).toBeGreaterThan(0);
  });

  it("calculates monthly frequency for low volume", () => {
    const deployments = [
      makeDeployment({ buildId: 1, finishTime: new Date("2024-01-15T12:00:00Z") }),
      makeDeployment({ buildId: 2, finishTime: new Date("2024-02-15T12:00:00Z") }),
    ];
    const result = calculateDeploymentFrequency(deployments, 90);
    expect(result.unit).toBe("per month");
    expect(result.value).toBeGreaterThan(0);
  });

  it("classifies Elite for very high frequency", () => {
    const deployments = Array.from({ length: 700 }, (_, i) => makeDeployment({ buildId: i }));
    const result = calculateDeploymentFrequency(deployments, 90);
    expect(result.band).toBe("Elite");
  });
});

describe("calculateLeadTime", () => {
  it("returns 0 hours and Low band with no deployments", () => {
    const result = calculateLeadTime([]);
    expect(result.medianHours).toBe(0);
    expect(result.band).toBe("Low");
  });

  it("returns 0 hours and Low band when all deployments lack commit time", () => {
    const deps = [
      makeDeployment({ firstCommitTime: null }),
      makeDeployment({ firstCommitTime: null }),
    ];
    const result = calculateLeadTime(deps);
    expect(result.medianHours).toBe(0);
    expect(result.band).toBe("Low");
  });

  it("returns 0 when all deployments are failed", () => {
    const deps = [
      makeDeployment({
        status: "failed",
        firstCommitTime: new Date("2024-01-15T08:00:00Z"),
        finishTime: new Date("2024-01-15T10:00:00Z"),
      }),
    ];
    const result = calculateLeadTime(deps);
    expect(result.medianHours).toBe(0);
    expect(result.band).toBe("Low");
  });

  it("calculates median lead time for a single deployment", () => {
    const deps = [
      makeDeployment({
        firstCommitTime: new Date("2024-01-15T08:00:00Z"),
        finishTime: new Date("2024-01-15T10:00:00Z"),
      }),
    ];
    const result = calculateLeadTime(deps);
    expect(result.medianHours).toBe(2);
    expect(result.band).toBe("Elite");
  });

  it("calculates median of multiple lead times", () => {
    const deps = [
      makeDeployment({
        buildId: 1,
        firstCommitTime: new Date("2024-01-15T00:00:00Z"),
        finishTime: new Date("2024-01-15T06:00:00Z"), // 6h
      }),
      makeDeployment({
        buildId: 2,
        firstCommitTime: new Date("2024-01-16T00:00:00Z"),
        finishTime: new Date("2024-01-16T12:00:00Z"), // 12h
      }),
      makeDeployment({
        buildId: 3,
        firstCommitTime: new Date("2024-01-17T00:00:00Z"),
        finishTime: new Date("2024-01-17T02:00:00Z"), // 2h
      }),
    ];
    const result = calculateLeadTime(deps);
    // Median of [2, 6, 12] = 6
    expect(result.medianHours).toBe(6);
    expect(result.band).toBe("Elite");
  });

  it("classifies High band for moderate lead time", () => {
    const deps = [
      makeDeployment({
        firstCommitTime: new Date("2024-01-10T00:00:00Z"),
        finishTime: new Date("2024-01-13T00:00:00Z"), // 72h
      }),
    ];
    const result = calculateLeadTime(deps);
    expect(result.medianHours).toBe(72);
    expect(result.band).toBe("High");
  });
});

describe("calculateChangeFailureRate", () => {
  it("returns 0% and Elite with no deployments", () => {
    const result = calculateChangeFailureRate([]);
    expect(result.percentage).toBe(0);
    expect(result.band).toBe("Elite");
  });

  it("returns 100% and Low when no successes exist", () => {
    const deps = [
      makeDeployment({ status: "failed", buildId: 1 }),
      makeDeployment({ status: "failed", buildId: 2 }),
    ];
    const result = calculateChangeFailureRate(deps);
    expect(result.percentage).toBe(100);
    expect(result.band).toBe("Low");
  });

  it("returns 0% when all deployments succeed with no failures", () => {
    const deps = [
      makeDeployment({ buildId: 1, finishTime: new Date("2024-01-15T10:00:00Z") }),
      makeDeployment({ buildId: 2, finishTime: new Date("2024-01-15T14:00:00Z") }),
      makeDeployment({ buildId: 3, finishTime: new Date("2024-01-16T10:00:00Z") }),
    ];
    const result = calculateChangeFailureRate(deps);
    expect(result.percentage).toBe(0);
    expect(result.band).toBe("Elite");
  });

  it("correctly calculates CFR when failure follows a success within 24h", () => {
    const deps = [
      makeDeployment({
        buildId: 1,
        status: "succeeded",
        finishTime: new Date("2024-01-15T10:00:00Z"),
      }),
      makeDeployment({
        buildId: 2,
        status: "failed",
        finishTime: new Date("2024-01-15T12:00:00Z"), // 2h later
      }),
    ];
    const result = calculateChangeFailureRate(deps);
    expect(result.percentage).toBe(100); // 1/1 succeeded followed by failure
  });

  it("does not count failure more than 24h later", () => {
    const deps = [
      makeDeployment({
        buildId: 1,
        status: "succeeded",
        finishTime: new Date("2024-01-15T10:00:00Z"),
      }),
      makeDeployment({
        buildId: 2,
        status: "failed",
        finishTime: new Date("2024-01-17T10:00:00Z"), // 48h later
      }),
    ];
    const result = calculateChangeFailureRate(deps);
    expect(result.percentage).toBe(0);
  });

  it("calculates mixed success/failure scenario", () => {
    const deps = [
      makeDeployment({
        buildId: 1,
        status: "succeeded",
        finishTime: new Date("2024-01-15T10:00:00Z"),
      }),
      makeDeployment({
        buildId: 2,
        status: "failed",
        finishTime: new Date("2024-01-15T11:00:00Z"),
      }),
      makeDeployment({
        buildId: 3,
        status: "succeeded",
        finishTime: new Date("2024-01-16T10:00:00Z"),
      }),
      makeDeployment({
        buildId: 4,
        status: "succeeded",
        finishTime: new Date("2024-01-17T10:00:00Z"),
      }),
    ];
    const result = calculateChangeFailureRate(deps);
    // 3 successes, only first is followed by failure within 24h
    // 1/3 = 33.3%
    expect(result.percentage).toBe(33.3);
    expect(result.band).toBe("Low");
  });
});

describe("calculateMttr", () => {
  it("returns 0 hours and Elite with no deployments", () => {
    const result = calculateMttr([]);
    expect(result.medianHours).toBe(0);
    expect(result.band).toBe("Elite");
  });

  it("returns 0 when all deployments succeed (no failures)", () => {
    const deps = [
      makeDeployment({ buildId: 1, status: "succeeded" }),
      makeDeployment({ buildId: 2, status: "succeeded" }),
    ];
    const result = calculateMttr(deps);
    expect(result.medianHours).toBe(0);
    expect(result.band).toBe("Elite");
  });

  it("returns 0 when all deployments fail (no recovery)", () => {
    const deps = [
      makeDeployment({
        buildId: 1,
        status: "failed",
        finishTime: new Date("2024-01-15T10:00:00Z"),
      }),
      makeDeployment({
        buildId: 2,
        status: "failed",
        finishTime: new Date("2024-01-15T12:00:00Z"),
      }),
    ];
    const result = calculateMttr(deps);
    expect(result.medianHours).toBe(0);
    expect(result.band).toBe("Elite");
  });

  it("calculates recovery time from a single failure", () => {
    const deps = [
      makeDeployment({
        buildId: 1,
        status: "failed",
        finishTime: new Date("2024-01-15T10:00:00Z"),
      }),
      makeDeployment({
        buildId: 2,
        status: "succeeded",
        finishTime: new Date("2024-01-15T14:00:00Z"),
      }),
    ];
    const result = calculateMttr(deps);
    expect(result.medianHours).toBe(4);
    expect(result.band).toBe("High"); // 4h > 1h elite threshold, but <= 24h high threshold
  });

  it("calculates median of multiple recovery times", () => {
    const deps = [
      makeDeployment({
        buildId: 1,
        status: "failed",
        finishTime: new Date("2024-01-15T10:00:00Z"),
      }),
      makeDeployment({
        buildId: 2,
        status: "succeeded",
        finishTime: new Date("2024-01-15T12:00:00Z"), // 2h recovery
      }),
      makeDeployment({
        buildId: 3,
        status: "failed",
        finishTime: new Date("2024-01-16T10:00:00Z"),
      }),
      makeDeployment({
        buildId: 4,
        status: "succeeded",
        finishTime: new Date("2024-01-16T20:00:00Z"), // 10h recovery
      }),
      makeDeployment({
        buildId: 5,
        status: "failed",
        finishTime: new Date("2024-01-17T10:00:00Z"),
      }),
      makeDeployment({
        buildId: 6,
        status: "succeeded",
        finishTime: new Date("2024-01-17T16:00:00Z"), // 6h recovery
      }),
    ];
    const result = calculateMttr(deps);
    // Median of [2, 6, 10] = 6
    expect(result.medianHours).toBe(6);
    expect(result.band).toBe("High");
  });

  it("classifies Low band for very long recovery time", () => {
    const deps = [
      makeDeployment({
        buildId: 1,
        status: "failed",
        finishTime: new Date("2024-01-01T10:00:00Z"),
      }),
      makeDeployment({
        buildId: 2,
        status: "succeeded",
        finishTime: new Date("2024-01-15T10:00:00Z"), // 336h
      }),
    ];
    const result = calculateMttr(deps);
    expect(result.medianHours).toBe(336);
    expect(result.band).toBe("Low");
  });
});

describe("calculateAllDora", () => {
  it("calculates all four metrics together", () => {
    const deps = [
      makeDeployment({
        buildId: 1,
        status: "succeeded",
        finishTime: new Date("2024-01-15T10:00:00Z"),
        firstCommitTime: new Date("2024-01-15T08:00:00Z"),
      }),
    ];
    const result = calculateAllDora(deps, deps, 90);
    expect(result.deploymentFrequency).toBeDefined();
    expect(result.leadTimeForChanges).toBeDefined();
    expect(result.changeFailureRate).toBeDefined();
    expect(result.meanTimeToRecovery).toBeDefined();
  });
});

describe("matchStageToEnvironment", () => {
  it("matches default patterns case-insensitively", () => {
    expect(matchStageToEnvironment("Deploy to DEV", DEFAULT_ENVIRONMENT_PATTERNS)).toBe(
      "Development"
    );
    expect(matchStageToEnvironment("deploy-to-qa", DEFAULT_ENVIRONMENT_PATTERNS)).toBe("QA");
    expect(matchStageToEnvironment("STAGING_DEPLOY", DEFAULT_ENVIRONMENT_PATTERNS)).toBe("Staging");
    expect(matchStageToEnvironment("production-release", DEFAULT_ENVIRONMENT_PATTERNS)).toBe(
      "Production"
    );
  });

  it("returns null for no match", () => {
    expect(matchStageToEnvironment("build", DEFAULT_ENVIRONMENT_PATTERNS)).toBeNull();
    expect(matchStageToEnvironment("compile", DEFAULT_ENVIRONMENT_PATTERNS)).toBeNull();
  });

  it("matches in order, first match wins", () => {
    // "test" matches QA pattern which has order=2
    expect(matchStageToEnvironment("testing-environment", DEFAULT_ENVIRONMENT_PATTERNS)).toBe("QA");
  });

  it("matches custom regex patterns", () => {
    const customPatterns = [
      { name: "Sandbox", regex: "sandbox|sbx", order: 1, color: "#999" },
      { name: "Canary", regex: "canary|cny", order: 2, color: "#ff0" },
    ];
    expect(matchStageToEnvironment("Deploy-Sandbox", customPatterns)).toBe("Sandbox");
    expect(matchStageToEnvironment("canary-release", customPatterns)).toBe("Canary");
    expect(matchStageToEnvironment("production", customPatterns)).toBeNull();
  });

  it("handles invalid regex gracefully", () => {
    const badPatterns = [
      { name: "Bad", regex: "[invalid", order: 1, color: "#999" },
      { name: "Good", regex: "good", order: 2, color: "#0f0" },
    ];
    // Invalid regex is skipped, falls through to next pattern
    expect(matchStageToEnvironment("good-stage", badPatterns)).toBe("Good");
    expect(matchStageToEnvironment("anything", badPatterns)).toBeNull();
  });

  it("matches UAT via staging pattern", () => {
    expect(matchStageToEnvironment("UAT-Deploy", DEFAULT_ENVIRONMENT_PATTERNS)).toBe("Staging");
  });

  it("matches 'live' via production pattern", () => {
    expect(matchStageToEnvironment("Deploy to Live", DEFAULT_ENVIRONMENT_PATTERNS)).toBe(
      "Production"
    );
  });

  it("matches PRD deployment stage names with optional deploy prefix", () => {
    expect(matchStageToEnvironment("Deploy to PRD01", DEFAULT_ENVIRONMENT_PATTERNS)).toBe(
      "Production"
    );
    expect(matchStageToEnvironment("Deploy PRD", DEFAULT_ENVIRONMENT_PATTERNS)).toBe("Production");
  });

  it("respects order when multiple patterns could match", () => {
    const patterns = [
      { name: "Env-A", regex: "deploy", order: 1, color: "#f00" },
      { name: "Env-B", regex: "deploy-prod", order: 2, color: "#0f0" },
    ];
    // "deploy" in order 1 matches first
    expect(matchStageToEnvironment("deploy-prod", patterns)).toBe("Env-A");
  });

  it("handles empty stage name", () => {
    expect(matchStageToEnvironment("", DEFAULT_ENVIRONMENT_PATTERNS)).toBeNull();
  });
});

describe("computeWeeklyTrends", () => {
  it("returns empty array for no deployments", () => {
    expect(computeWeeklyTrends([])).toEqual([]);
  });

  it("computes trends for deployments across multiple weeks", () => {
    const deps = [
      makeDeployment({
        buildId: 1,
        finishTime: new Date("2024-01-08T10:00:00Z"),
        firstCommitTime: new Date("2024-01-08T06:00:00Z"),
      }),
      makeDeployment({
        buildId: 2,
        finishTime: new Date("2024-01-09T10:00:00Z"),
        firstCommitTime: new Date("2024-01-09T06:00:00Z"),
      }),
      makeDeployment({
        buildId: 3,
        finishTime: new Date("2024-01-15T10:00:00Z"),
        firstCommitTime: new Date("2024-01-15T06:00:00Z"),
      }),
    ];
    const trends = computeWeeklyTrends(deps);
    expect(trends.length).toBeGreaterThanOrEqual(2);
    expect(trends[0].deploymentFrequency).toBeGreaterThan(0);
  });

  it("includes changeFailureRate in weekly trends", () => {
    const deps = [
      makeDeployment({
        buildId: 1,
        status: "succeeded",
        finishTime: new Date("2024-01-08T10:00:00Z"),
      }),
      makeDeployment({
        buildId: 2,
        status: "failed",
        finishTime: new Date("2024-01-08T11:00:00Z"),
      }),
    ];
    const trends = computeWeeklyTrends(deps);
    expect(trends.length).toBeGreaterThanOrEqual(1);
    expect(trends[0].changeFailureRate).toBeGreaterThan(0);
  });
});
