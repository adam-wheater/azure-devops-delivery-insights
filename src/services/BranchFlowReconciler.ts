import {
  BranchFlow,
  BranchFlowGap,
  BranchPattern,
  isIntegrationBranch,
} from "../models/interfaces";

/**
 * Resolve the branch journey of one delivery: feature → develop → main → built.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT "look up the commit and read its pull requests"
 *
 * Azure DevOps offers four merge strategies and THREE of them destroy commit
 * identity (Git.d.ts:1954-1971): Squash rewrites the change into a brand-new
 * single-parent commit, and Rebase and RebaseMerge both rewrite the source
 * branch. Only NoFastForward preserves the SHA the developer authored. So for
 * most repositories the commit that reaches production is NOT the commit anyone
 * wrote, and asking "which pull requests merged this SHA" answers only the last
 * hop of the journey.
 *
 * That failure is silent and biased in the flattering direction: the authoring
 * span collapses toward zero, and it collapses hardest for the teams with the
 * strictest merge policies. So the chain is walked using TWO different queries
 * rather than assumed from one:
 *
 *   Commit (type 2)          which pull requests MERGED this commit
 *   LastMergeCommit (type 1) which pull request PRODUCED this commit
 *
 * A squashed change is invisible to the first and found by the second. Between
 * them every strategy is covered without needing to know which one was used —
 * which matters, because completionOptions.mergeStrategy is unset whenever the
 * strategy came from a branch policy (Git.d.ts:1834), so it cannot be read.
 *
 * WHY NOT the repository default branch: the terminal hop is whatever the
 * pipeline actually built (build.sourceBranch). Release-branch and hotfix
 * pipelines never touch main, and anchoring on main would report them as
 * unmeasurable or, worse, measure a merge that had not happened yet.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Only the fields we read. The real object is much larger. */
export interface PullRequestLike {
  pullRequestId?: number;
  status?: number;
  targetRefName?: string;
  sourceRefName?: string;
  closedDate?: Date | string | null;
  creationDate?: Date | string | null;
}

/** PullRequestStatus.Completed — pinned, because enumsAsNumbers makes these numbers on the wire. */
export const PULL_REQUEST_COMPLETED = 3;

export interface BranchFlowInput {
  /** build.repository.type. Only "TfsGit" has pull requests we can read. */
  repositoryType: string | null;
  /** build.sourceBranch — the branch the pipeline actually built. */
  builtBranch: string | null;
  /** The commit the lead time is measured from (the oldest change in the build). */
  originCommitId: string | null;
  /** That commit's own timestamp, when its SHA survived into the built branch. */
  originCommitTime: Date | null;
  /** Pull requests that merged the origin commit (query type 2). */
  mergedBy: PullRequestLike[];
  /** The pull request that produced the origin commit, if it is a merge/squash artefact (query type 1). */
  producedBy: PullRequestLike[];
  /**
   * Whether the repository has an integration branch at all.
   * true/false are findings from the repository's refs; null means the probe did
   * not run or failed, which is "unknown" and must not be reported as absence.
   */
  hasIntegrationBranch: boolean | null;
  integrationPatterns: BranchPattern[];
  /** Set when the pull request query itself failed, so a gap is not blamed on the data. */
  queryFailed?: boolean;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function isCompleted(pr: PullRequestLike): boolean {
  // An abandoned or still-active pull request never delivered anything. Strict
  // equality: PullRequestStatus.NotSet is 0 and would be falsy under a truthy test.
  return pr.status === PULL_REQUEST_COMPLETED;
}

/** Earliest completion wins: a commit can be re-merged, and the first arrival is the delivery. */
function earliestClosed(candidates: PullRequestLike[]): { pr: PullRequestLike; at: Date } | null {
  let best: { pr: PullRequestLike; at: Date } | null = null;
  for (const pr of candidates) {
    if (!isCompleted(pr)) continue;
    const at = toDate(pr.closedDate);
    if (!at) continue;
    if (!best || at.getTime() < best.at.getTime()) best = { pr, at };
  }
  return best;
}

const emptyFlow = (gap: BranchFlowGap | null): BranchFlow => ({
  originTime: null,
  originSource: null,
  integrationTime: null,
  integrationBranch: null,
  integrationStatus: "unknown",
  releaseTime: null,
  releaseBranch: null,
  releaseStatus: "unknown",
  gap,
});

export function resolveBranchFlow(input: BranchFlowInput): BranchFlow {
  // Azure Repos Git only. A GitHub-backed or TFVC pipeline has no pull requests
  // this API can see, and reporting that as "no pull request found" would blame
  // the team for a limitation of the integration.
  if (input.repositoryType && input.repositoryType !== "TfsGit") {
    return emptyFlow("not-git-repo");
  }
  if (!input.originCommitId || !input.builtBranch) {
    return emptyFlow("no-commits");
  }
  if (input.queryFailed) {
    return emptyFlow("query-failed");
  }

  const patterns = input.integrationPatterns;

  // ── terminal hop: onto the branch the pipeline built ────────────────────────
  const ontoBuilt = earliestClosed(
    input.mergedBy.filter((pr) => pr.targetRefName === input.builtBranch)
  );

  // ── the commit's own provenance ─────────────────────────────────────────────
  // If a pull request PRODUCED this commit, the commit is a squash or merge
  // artefact: the original authored SHA no longer exists anywhere, and the
  // commit's timestamp is the moment of the merge, not of the work. The pull
  // request's creation date is then the earliest defensible origin — it is when
  // the branch was offered for merge. Time spent coding before opening the pull
  // request is genuinely unrecoverable without a per-pull-request commit fetch,
  // so it is excluded rather than guessed at, and the UI says which was used.
  const producer = earliestClosed(input.producedBy);

  // ── middle hop: onto an integration branch ──────────────────────────────────
  // Two shapes, because the strategies differ:
  //   NoFastForward — the SHA survives, so BOTH the develop pull request and the
  //                   main pull request come back from the "merged this commit"
  //                   query, and the develop one is picked out by its target.
  //   Squash/rebase — the SHA on the built branch was produced by the develop
  //                   pull request, which the "produced this commit" query finds.
  let integrationTime: Date | null = null;
  let integrationBranch: string | null = null;

  const viaMerged = earliestClosed(
    input.mergedBy.filter(
      (pr) =>
        pr.targetRefName !== input.builtBranch &&
        pr.targetRefName != null &&
        isIntegrationBranch(pr.targetRefName, patterns)
    )
  );
  if (viaMerged) {
    integrationTime = viaMerged.at;
    integrationBranch = viaMerged.pr.targetRefName ?? null;
  } else if (
    producer &&
    producer.pr.targetRefName &&
    producer.pr.targetRefName !== input.builtBranch &&
    isIntegrationBranch(producer.pr.targetRefName, patterns)
  ) {
    integrationTime = producer.at;
    integrationBranch = producer.pr.targetRefName;
  }

  let integrationStatus: BranchFlow["integrationStatus"];
  if (integrationTime) {
    integrationStatus = "measured";
  } else if (input.hasIntegrationBranch === false) {
    // Proven from the repository's own refs: there is no such branch, so the
    // change could not have passed through one. A real absence, not a gap.
    integrationStatus = "absent";
  } else if (
    producer &&
    producer.pr.targetRefName === input.builtBranch &&
    input.hasIntegrationBranch !== true
  ) {
    // Straight from a topic branch into the built branch, in a repository with
    // no integration branch to speak of.
    integrationStatus = "absent";
  } else {
    integrationStatus = "unknown";
  }

  // ── origin ──────────────────────────────────────────────────────────────────
  let originTime: Date | null;
  let originSource: BranchFlow["originSource"];
  if (producer) {
    originTime = toDate(producer.pr.creationDate);
    originSource = originTime ? "pull-request" : null;
    if (!originTime) {
      // Fall back rather than lose the sample; the commit timestamp is at worst
      // the merge moment, which is the same bound the pull request would give.
      originTime = input.originCommitTime;
      originSource = originTime ? "commit" : null;
    }
  } else {
    originTime = input.originCommitTime;
    originSource = originTime ? "commit" : null;
  }

  const releaseTime = ontoBuilt?.at ?? null;
  const releaseStatus: BranchFlow["releaseStatus"] = releaseTime ? "measured" : "unknown";

  let gap: BranchFlowGap | null = null;
  if (!releaseTime) {
    // Nothing completed merged this commit onto the built branch — a direct push,
    // or a merge older than the pull request history we can see.
    gap = "no-pull-request";
  } else if (integrationStatus === "unknown") {
    gap = "unknown-integration";
  } else if (!originTime) {
    gap = "no-commits";
  }

  return {
    originTime,
    originSource,
    integrationTime,
    integrationBranch,
    integrationStatus,
    releaseTime,
    releaseBranch: releaseTime ? (input.builtBranch ?? null) : null,
    releaseStatus,
    gap,
  };
}

/** A chain complete enough to contribute a sample to the averages. */
export function isResolved(flow: BranchFlow | null | undefined): boolean {
  return Boolean(
    flow &&
    flow.gap === null &&
    flow.originTime &&
    flow.releaseTime &&
    flow.releaseStatus === "measured" &&
    (flow.integrationStatus === "measured" || flow.integrationStatus === "absent")
  );
}

/** `refs/heads/main` → `main`. Display only. */
export function shortBranchName(refName: string | null): string | null {
  if (!refName) return null;
  return refName.replace(/^refs\/heads\//, "");
}
