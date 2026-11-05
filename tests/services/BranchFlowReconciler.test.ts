import {
  resolveBranchFlow,
  isResolved,
  shortBranchName,
  PullRequestLike,
} from "@/services/BranchFlowReconciler";
import { BranchPattern, DEFAULT_INTEGRATION_PATTERNS } from "@/models/interfaces";

const MAIN = "refs/heads/main";
const DEVELOP = "refs/heads/develop";
const FEATURE = "refs/heads/feature/checkout";

const COMPLETED = 3;
const ACTIVE = 1;
const ABANDONED = 2;

function pr(overrides: Partial<PullRequestLike> = {}): PullRequestLike {
  return {
    pullRequestId: 1,
    status: COMPLETED,
    sourceRefName: FEATURE,
    targetRefName: DEVELOP,
    creationDate: new Date("2024-03-01T09:00:00Z"),
    closedDate: new Date("2024-03-02T09:00:00Z"),
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof resolveBranchFlow>[0]> = {}) {
  return resolveBranchFlow({
    repositoryType: "TfsGit",
    builtBranch: MAIN,
    originCommitId: "abc123",
    originCommitTime: new Date("2024-03-01T08:00:00Z"),
    mergedBy: [],
    producedBy: [],
    hasIntegrationBranch: true,
    integrationPatterns: DEFAULT_INTEGRATION_PATTERNS,
    ...overrides,
  });
}

describe("resolveBranchFlow", () => {
  it("reads both hops when the merge preserved the commit (no-fast-forward gitflow)", () => {
    // NoFastForward keeps the authored SHA, so the SAME commit comes back from
    // the develop pull request and from the develop→main pull request.
    const flow = input({
      mergedBy: [
        pr({ pullRequestId: 10, targetRefName: DEVELOP, closedDate: "2024-03-02T09:00:00Z" }),
        pr({
          pullRequestId: 11,
          sourceRefName: DEVELOP,
          targetRefName: MAIN,
          closedDate: "2024-03-05T09:00:00Z",
        }),
      ],
    });

    expect(flow.integrationStatus).toBe("measured");
    expect(flow.integrationBranch).toBe(DEVELOP);
    expect(flow.integrationTime?.toISOString()).toBe("2024-03-02T09:00:00.000Z");
    expect(flow.releaseStatus).toBe("measured");
    expect(flow.releaseTime?.toISOString()).toBe("2024-03-05T09:00:00.000Z");
    // The SHA survived, so the commit's own timestamp is the real origin.
    expect(flow.originSource).toBe("commit");
    expect(flow.originTime?.toISOString()).toBe("2024-03-01T08:00:00.000Z");
    expect(flow.gap).toBeNull();
    expect(isResolved(flow)).toBe(true);
  });

  it("recovers the develop hop for a SQUASHED change, where the authored SHA no longer exists", () => {
    // The commit on main is the squash artefact. Nothing "merged" it into
    // develop — the develop pull request PRODUCED it. Without the second query
    // this hop vanishes and the whole journey collapses to the main merge.
    const flow = input({
      mergedBy: [
        pr({
          pullRequestId: 21,
          sourceRefName: DEVELOP,
          targetRefName: MAIN,
          closedDate: "2024-03-05T09:00:00Z",
        }),
      ],
      producedBy: [
        pr({
          pullRequestId: 20,
          targetRefName: DEVELOP,
          creationDate: "2024-03-01T09:00:00Z",
          closedDate: "2024-03-02T09:00:00Z",
        }),
      ],
    });

    expect(flow.integrationStatus).toBe("measured");
    expect(flow.integrationTime?.toISOString()).toBe("2024-03-02T09:00:00.000Z");
    // The squash rewrote the commit, so its timestamp is the merge moment, not
    // the work. The pull request's creation is the earliest defensible origin.
    expect(flow.originSource).toBe("pull-request");
    expect(flow.originTime?.toISOString()).toBe("2024-03-01T09:00:00.000Z");
    expect(isResolved(flow)).toBe(true);
  });

  it("reports a trunk-based repository as ABSENT, never zero", () => {
    // Straight from a topic branch into main, in a repository with no develop.
    // Reported as an absent hop so the average is not dragged down by a zero
    // that would read as "merging to develop is instant".
    const flow = input({
      hasIntegrationBranch: false,
      mergedBy: [
        pr({ pullRequestId: 30, targetRefName: MAIN, closedDate: "2024-03-02T09:00:00Z" }),
      ],
    });

    expect(flow.integrationStatus).toBe("absent");
    expect(flow.integrationTime).toBeNull();
    expect(flow.gap).toBeNull();
    expect(isResolved(flow)).toBe(true);
  });

  it("distinguishes an unproven integration branch from a proven absence", () => {
    // The refs probe failed, so we do not know whether develop exists. That is
    // NOT the same as knowing it does not, and must not be counted as a sample.
    const flow = input({
      hasIntegrationBranch: null,
      mergedBy: [
        pr({ pullRequestId: 31, targetRefName: MAIN, closedDate: "2024-03-02T09:00:00Z" }),
      ],
      producedBy: [],
    });

    expect(flow.integrationStatus).toBe("unknown");
    expect(flow.gap).toBe("unknown-integration");
    expect(isResolved(flow)).toBe(false);
  });

  it("anchors on the branch the pipeline BUILT, not on main", () => {
    // A hotfix pipeline builds a release branch. Anchoring on main would report
    // this as unmeasurable, or measure a merge that has not happened yet.
    const release = "refs/heads/release/2024.03";
    const flow = input({
      builtBranch: release,
      hasIntegrationBranch: false,
      mergedBy: [
        pr({ pullRequestId: 40, targetRefName: release, closedDate: "2024-03-06T09:00:00Z" }),
        pr({ pullRequestId: 41, targetRefName: MAIN, closedDate: "2024-03-20T09:00:00Z" }),
      ],
    });

    expect(flow.releaseBranch).toBe(release);
    expect(flow.releaseTime?.toISOString()).toBe("2024-03-06T09:00:00.000Z");
    expect(isResolved(flow)).toBe(true);
  });

  it("ignores pull requests that never completed", () => {
    const flow = input({
      mergedBy: [
        pr({ pullRequestId: 50, targetRefName: MAIN, status: ACTIVE }),
        pr({ pullRequestId: 51, targetRefName: MAIN, status: ABANDONED }),
      ],
    });

    expect(flow.releaseStatus).toBe("unknown");
    expect(flow.gap).toBe("no-pull-request");
    expect(isResolved(flow)).toBe(false);
  });

  it("takes the EARLIEST completion when a commit was merged more than once", () => {
    const flow = input({
      hasIntegrationBranch: false,
      mergedBy: [
        pr({ pullRequestId: 60, targetRefName: MAIN, closedDate: "2024-03-09T09:00:00Z" }),
        pr({ pullRequestId: 61, targetRefName: MAIN, closedDate: "2024-03-04T09:00:00Z" }),
      ],
    });

    expect(flow.releaseTime?.toISOString()).toBe("2024-03-04T09:00:00.000Z");
  });

  it("names a non-Azure-Repos repository rather than blaming the team for no pull request", () => {
    const flow = input({ repositoryType: "GitHub" });
    expect(flow.gap).toBe("not-git-repo");
    expect(isResolved(flow)).toBe(false);
  });

  it("reports a direct push as no-pull-request rather than inventing a hop", () => {
    const flow = input({ hasIntegrationBranch: false, mergedBy: [], producedBy: [] });
    expect(flow.gap).toBe("no-pull-request");
    expect(isResolved(flow)).toBe(false);
  });

  it("blames a failed query on the query, not on the data", () => {
    const flow = input({ queryFailed: true });
    expect(flow.gap).toBe("query-failed");
    expect(isResolved(flow)).toBe(false);
  });

  it("honours user-configured integration patterns and survives an invalid regex", () => {
    const patterns: BranchPattern[] = [
      { regex: "([unclosed", order: 1 },
      { regex: "^refs/heads/trunk-next$", order: 2 },
    ];
    const flow = input({
      integrationPatterns: patterns,
      mergedBy: [
        pr({
          pullRequestId: 70,
          targetRefName: "refs/heads/trunk-next",
          closedDate: "2024-03-02T09:00:00Z",
        }),
        pr({
          pullRequestId: 71,
          targetRefName: MAIN,
          closedDate: "2024-03-05T09:00:00Z",
        }),
      ],
    });

    expect(flow.integrationStatus).toBe("measured");
    expect(flow.integrationBranch).toBe("refs/heads/trunk-next");
  });

  it("ignores a disabled integration pattern", () => {
    const flow = input({
      integrationPatterns: [{ regex: "^refs/heads/develop$", order: 1, enabled: false }],
      hasIntegrationBranch: false,
      mergedBy: [
        pr({ pullRequestId: 80, targetRefName: DEVELOP, closedDate: "2024-03-02T09:00:00Z" }),
        pr({ pullRequestId: 81, targetRefName: MAIN, closedDate: "2024-03-05T09:00:00Z" }),
      ],
    });

    expect(flow.integrationStatus).toBe("absent");
    expect(flow.integrationTime).toBeNull();
  });

  it("falls back to the commit timestamp when a producing pull request has no creation date", () => {
    const flow = input({
      hasIntegrationBranch: false,
      mergedBy: [
        pr({ pullRequestId: 90, targetRefName: MAIN, closedDate: "2024-03-05T09:00:00Z" }),
      ],
      producedBy: [pr({ pullRequestId: 91, targetRefName: MAIN, creationDate: null })],
    });

    expect(flow.originSource).toBe("commit");
    expect(flow.originTime?.toISOString()).toBe("2024-03-01T08:00:00.000Z");
  });

  it("has nothing to say without a commit or a built branch", () => {
    expect(input({ originCommitId: null }).gap).toBe("no-commits");
    expect(input({ builtBranch: null }).gap).toBe("no-commits");
  });
});

describe("shortBranchName", () => {
  it("strips the ref prefix for display", () => {
    expect(shortBranchName("refs/heads/release/2024.03")).toBe("release/2024.03");
    expect(shortBranchName(null)).toBeNull();
  });
});
