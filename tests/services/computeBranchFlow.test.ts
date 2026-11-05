import { computeBranchFlow } from "@/services/LeadTimeBreakdown";
import { BranchFlow } from "@/models/interfaces";
import { makeDeploymentRecord } from "../helpers/records";

const HOUR = 3600_000;
const T0 = Date.parse("2024-03-01T00:00:00Z");
const at = (hours: number) => new Date(T0 + hours * HOUR);

function flow(overrides: Partial<BranchFlow> = {}): BranchFlow {
  return {
    originTime: at(0),
    originSource: "commit",
    integrationTime: at(10),
    integrationBranch: "refs/heads/develop",
    integrationStatus: "measured",
    releaseTime: at(30),
    releaseBranch: "refs/heads/main",
    releaseStatus: "measured",
    gap: null,
    ...overrides,
  };
}

/** A record whose buildStartTime is 40h after the origin, so the spans are 10/20/10. */
function delivery(branchFlow: BranchFlow | null, buildStartHours = 40) {
  return makeDeploymentRecord({
    branchFlow,
    buildStartTime: at(buildStartHours),
    startTime: at(buildStartHours + 1),
    finishTime: at(buildStartHours + 2),
  });
}

describe("computeBranchFlow", () => {
  it("splits the wait into the three branch hops", () => {
    const result = computeBranchFlow([delivery(flow())]);

    expect(result.codeHours).toBe(10); // origin → develop
    expect(result.integrationHours).toBe(20); // develop → main
    expect(result.releaseHours).toBe(10); // main → build start
    expect(result.totalHours).toBe(40);
    expect(result.sampleSize).toBe(1);
    expect(result.viaIntegration).toBe(1);
  });

  it("keeps the parts summing to the total after rounding", () => {
    // Same reason the main breakdown sums rounded parts: a stacked bar whose
    // segments do not add up to its own label is a lie.
    const result = computeBranchFlow([
      delivery(flow({ integrationTime: at(1 / 3), releaseTime: at(2 / 3) }), 1),
      delivery(flow({ integrationTime: at(0.7), releaseTime: at(1.1) }), 1.9),
    ]);

    expect(result.codeHours + result.integrationHours + result.releaseHours).toBeCloseTo(
      result.totalHours,
      5
    );
  });

  it("counts a trunk-based delivery as a sample with an EMPTY middle hop", () => {
    // The hop is absent, not instant. The code span therefore runs all the way
    // to the merge onto the built branch rather than stopping at a develop that
    // does not exist.
    const result = computeBranchFlow([
      delivery(
        flow({ integrationTime: null, integrationBranch: null, integrationStatus: "absent" })
      ),
    ]);

    expect(result.sampleSize).toBe(1);
    expect(result.noIntegrationBranch).toBe(1);
    expect(result.viaIntegration).toBe(0);
    expect(result.integrationHours).toBe(0);
    expect(result.codeHours).toBe(30);
    expect(result.releaseHours).toBe(10);
  });

  it("excludes unresolved deliveries from the denominator instead of averaging them as zero", () => {
    // One good sample of 40h and one untraceable delivery. Folding the second in
    // as zeros would report 20h and understate every hop by half.
    const result = computeBranchFlow([
      delivery(flow()),
      delivery(
        flow({
          releaseTime: null,
          releaseStatus: "unknown",
          gap: "no-pull-request",
        })
      ),
    ]);

    expect(result.sampleSize).toBe(1);
    expect(result.totalHours).toBe(40);
    expect(result.gaps["no-pull-request"]).toBe(1);
  });

  it("keeps every reason for not measuring apart", () => {
    const result = computeBranchFlow([
      delivery(flow({ gap: "not-git-repo", releaseStatus: "unknown", releaseTime: null })),
      delivery(flow({ gap: "query-failed", releaseStatus: "unknown", releaseTime: null })),
      delivery(flow({ gap: "unknown-integration", integrationStatus: "unknown" })),
    ]);

    expect(result.gaps["not-git-repo"]).toBe(1);
    expect(result.gaps["query-failed"]).toBe(1);
    expect(result.gaps["unknown-integration"]).toBe(1);
    expect(result.sampleSize).toBe(0);
  });

  it("ignores records with no branch flow at all, rather than counting them as failures", () => {
    // Null means the feature was off or the record predates it. Reporting those
    // as gaps would invent a problem that does not exist.
    const result = computeBranchFlow([delivery(null), delivery(undefined as never)]);

    expect(result.sampleSize).toBe(0);
    expect(Object.values(result.gaps).every((count) => count === 0)).toBe(true);
  });

  it("only samples succeeded production deliveries", () => {
    const result = computeBranchFlow([
      makeDeploymentRecord({ branchFlow: flow(), isProduction: false }),
      makeDeploymentRecord({ branchFlow: flow(), status: "failed" }),
    ]);

    expect(result.sampleSize).toBe(0);
  });

  it("clamps a hop whose timestamps are out of order rather than cancelling another", () => {
    // A rebase can order the merge before the origin. A negative span would
    // silently subtract from a real one.
    const result = computeBranchFlow([
      delivery(flow({ originTime: at(20), integrationTime: at(10), releaseTime: at(30) })),
    ]);

    expect(result.codeHours).toBe(0);
    expect(result.integrationHours).toBe(20);
    expect(result.totalHours).toBe(30);
  });

  it("reports how many samples had to measure from the pull request instead of the commit", () => {
    const result = computeBranchFlow([
      delivery(flow({ originSource: "pull-request" })),
      delivery(flow({ originSource: "commit" })),
    ]);

    expect(result.originFromPullRequest).toBe(1);
    expect(result.sampleSize).toBe(2);
  });

  it("falls back to the stage start when a lease-proven delivery has no run start", () => {
    const record = makeDeploymentRecord({
      branchFlow: flow(),
      buildStartTime: null,
      startTime: at(40),
      finishTime: at(41),
    });

    expect(computeBranchFlow([record]).releaseHours).toBe(10);
  });
});
