import { computeLeadTimeBreakdown } from "@/services/LeadTimeBreakdown";
import { buildResultsUrl, pipelineUrl } from "@/services/navigation";
import { makeDeploymentRecord } from "../helpers/records";

const h = (hours: number) => new Date(Date.parse("2024-05-01T00:00:00Z") + hours * 3_600_000);

/** commit at 0h, pipeline starts at 10h, prod stage runs 12h -> 14h. */
function delivery(overrides = {}) {
  return makeDeploymentRecord({
    isProduction: true,
    status: "succeeded",
    firstCommitTime: h(0),
    buildStartTime: h(10),
    startTime: h(12),
    finishTime: h(14),
    ...overrides,
  });
}

describe("computeLeadTimeBreakdown", () => {
  it("measures each span from real timestamps", () => {
    const result = computeLeadTimeBreakdown([delivery()]);
    expect(result.preBuildHours).toBe(10);
    expect(result.pipelineHours).toBe(2);
    expect(result.deployHours).toBe(2);
    expect(result.sampleSize).toBe(1);
  });

  it("segments always sum to the reported total", () => {
    const result = computeLeadTimeBreakdown([
      delivery(),
      delivery({ buildId: 2, buildStartTime: h(3), startTime: h(5), finishTime: h(9) }),
      delivery({ buildId: 3, buildStartTime: h(1), startTime: h(7), finishTime: h(8) }),
    ]);
    expect(result.preBuildHours + result.pipelineHours + result.deployHours).toBeCloseTo(
      result.totalHours,
      5
    );
  });

  it("counts only successful production deliveries", () => {
    const result = computeLeadTimeBreakdown([
      delivery(),
      delivery({ buildId: 2, status: "failed" }),
      delivery({ buildId: 3, isProduction: false }),
    ]);
    expect(result.sampleSize).toBe(1);
  });

  it("excludes and reports deliveries with no commit rather than inventing one", () => {
    const result = computeLeadTimeBreakdown([
      delivery(),
      delivery({ buildId: 2, firstCommitTime: null }),
    ]);
    expect(result.sampleSize).toBe(1);
    expect(result.excluded).toBe(1);
  });

  it("collapses the pipeline span when a lease-only delivery has no pipeline start", () => {
    const result = computeLeadTimeBreakdown([delivery({ buildStartTime: null })]);
    expect(result.pipelineHours).toBe(0);
    expect(result.preBuildHours).toBe(12);
    expect(result.deployHours).toBe(2);
  });

  it("clamps negative spans caused by clock skew instead of cancelling other spans", () => {
    // Commit timestamped slightly after the run started — agent clock skew.
    const result = computeLeadTimeBreakdown([delivery({ firstCommitTime: h(11) })]);
    expect(result.preBuildHours).toBe(0);
    expect(result.pipelineHours).toBe(2);
    expect(result.deployHours).toBe(2);
  });

  it("returns an empty, non-NaN result for no deployments", () => {
    const result = computeLeadTimeBreakdown([]);
    expect(result).toEqual({
      preBuildHours: 0,
      pipelineHours: 0,
      deployHours: 0,
      totalHours: 0,
      sampleSize: 0,
      excluded: 0,
      branchFlow: {
        codeHours: 0,
        integrationHours: 0,
        releaseHours: 0,
        totalHours: 0,
        sampleSize: 0,
        viaIntegration: 0,
        noIntegrationBranch: 0,
        originFromPullRequest: 0,
        gaps: {
          "not-git-repo": 0,
          "no-commits": 0,
          "no-pull-request": 0,
          "query-failed": 0,
          "unknown-integration": 0,
        },
      },
    });
  });

  it("does not share the empty branch-flow gap counters between calls", () => {
    // EMPTY_LEAD_TIME is a module-level constant and its `gaps` object is a
    // reference. Handing the same object out twice and then incrementing it
    // would make one analysis report another analysis's failures.
    const withGap = computeLeadTimeBreakdown([
      makeDeploymentRecord({
        branchFlow: {
          originTime: null,
          originSource: null,
          integrationTime: null,
          integrationBranch: null,
          integrationStatus: "unknown",
          releaseTime: null,
          releaseBranch: null,
          releaseStatus: "unknown",
          gap: "no-pull-request",
        },
      }),
    ]);
    expect(withGap.branchFlow.gaps["no-pull-request"]).toBe(1);
    expect(computeLeadTimeBreakdown([]).branchFlow.gaps["no-pull-request"]).toBe(0);
  });
});

describe("Azure DevOps deep links", () => {
  const base = "https://dev.azure.com/contoso";

  it("builds a run URL", () => {
    expect(buildResultsUrl(base, "Payments", 4321)).toBe(
      "https://dev.azure.com/contoso/Payments/_build/results?buildId=4321&view=results"
    );
  });

  it("builds a pipeline URL", () => {
    expect(pipelineUrl(base, "Payments", 12)).toBe(
      "https://dev.azure.com/contoso/Payments/_build?definitionId=12"
    );
  });

  it("tolerates a collection URI that already ends in a slash", () => {
    expect(buildResultsUrl(`${base}/`, "Payments", 1)).toBe(
      "https://dev.azure.com/contoso/Payments/_build/results?buildId=1&view=results"
    );
  });

  it("encodes project names containing spaces", () => {
    expect(pipelineUrl(base, "My Project", 3)).toContain("My%20Project");
  });

  it("returns null when the collection URI could not be resolved, so links render as text", () => {
    expect(buildResultsUrl(null, "Payments", 1)).toBeNull();
    expect(pipelineUrl(null, "Payments", 1)).toBeNull();
  });

  it("returns null for a synthetic definition id", () => {
    expect(pipelineUrl(base, "Payments", -1)).toBeNull();
  });
});
