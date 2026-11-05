import { BranchFlowSegments, DeploymentRecord, LeadTimeSegments } from "../models/interfaces";
import { isResolved } from "./BranchFlowReconciler";

/**
 * Commit-to-production, measured.
 *
 * Every segment is the difference between two timestamps that Azure DevOps
 * actually reported. Nothing is inferred from a ratio:
 *
 *   firstCommit ──preBuild──> buildStart ──pipeline──> deployStart ──deploy──> deployFinish
 *
 *   preBuild  the oldest commit in the build sitting unreleased until the run started
 *   pipeline  the run reaching its production stage: build, upstream stages, approval waits
 *   deploy    the production stage itself
 *
 * Only SUCCEEDED PRODUCTION deployments are counted — the question is how long a
 * change took to reach production, so a failed attempt or a QA deploy is not a
 * sample of it.
 *
 * The mean is used rather than the median precisely so the segments sum to the
 * total: three medians would not add up to the median total, and a stacked bar
 * whose parts do not sum is a lie. The DORA scorecard reports the median lead
 * time separately, which is the headline number.
 */

const HOUR_MS = 1000 * 60 * 60;
const round1 = (value: number) => Math.round(value * 10) / 10;

export const EMPTY_BRANCH_FLOW: BranchFlowSegments = {
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
};

const emptyBranchFlow = (): BranchFlowSegments => ({
  ...EMPTY_BRANCH_FLOW,
  gaps: { ...EMPTY_BRANCH_FLOW.gaps },
});

export const EMPTY_LEAD_TIME: LeadTimeSegments = {
  preBuildHours: 0,
  pipelineHours: 0,
  deployHours: 0,
  totalHours: 0,
  sampleSize: 0,
  excluded: 0,
  branchFlow: EMPTY_BRANCH_FLOW,
};

const emptyLeadTime = (): LeadTimeSegments => ({
  ...EMPTY_LEAD_TIME,
  branchFlow: emptyBranchFlow(),
});

/**
 * The pre-build span, decomposed by branch: how long the change spent being
 * written, then sitting on the integration branch, then sitting on the branch
 * the pipeline builds.
 *
 * Its own cohort, deliberately. A delivery whose chain could not be resolved —
 * a direct push, a repository that is not Azure Repos, a throttled query — is
 * counted under `gaps` and contributes nothing. Folding those in as zeros would
 * understate every hop, and the whole point of this panel is that the hop you
 * are looking at is real.
 */
export function computeBranchFlow(deployments: DeploymentRecord[]): BranchFlowSegments {
  const result = emptyBranchFlow();

  let code = 0;
  let integration = 0;
  let release = 0;

  for (const dep of deployments) {
    if (!dep.isProduction || dep.status !== "succeeded") continue;

    const flow = dep.branchFlow;
    // Null means branch flow was never computed — the feature is off, or this is
    // a cached record from before it existed. Not a gap; there is nothing to
    // report about it either way.
    if (!flow) continue;

    if (!isResolved(flow)) {
      result.gaps[flow.gap ?? "unknown-integration"]++;
      continue;
    }

    const origin = flow.originTime!.getTime();
    const releaseAt = flow.releaseTime!.getTime();
    const integrationAt = flow.integrationTime ? flow.integrationTime.getTime() : null;
    // A lease-proven delivery can lack a separate run start; the stage start is
    // then the closest real timestamp, never an invented one.
    const buildStart = (dep.buildStartTime ?? dep.startTime).getTime();

    if (!Number.isFinite(origin) || !Number.isFinite(releaseAt) || !Number.isFinite(buildStart)) {
      result.gaps["no-commits"]++;
      continue;
    }

    // Clamped at zero for the same reason as the main breakdown: a rebase or a
    // clock difference can order two timestamps the wrong way round, and a
    // negative span would silently cancel out a real one.
    code += Math.max(0, ((integrationAt ?? releaseAt) - origin) / HOUR_MS);
    integration += integrationAt ? Math.max(0, (releaseAt - integrationAt) / HOUR_MS) : 0;
    release += Math.max(0, (buildStart - releaseAt) / HOUR_MS);

    result.sampleSize++;
    if (integrationAt) result.viaIntegration++;
    if (flow.integrationStatus === "absent") result.noIntegrationBranch++;
    if (flow.originSource === "pull-request") result.originFromPullRequest++;
  }

  if (result.sampleSize === 0) return result;

  result.codeHours = round1(code / result.sampleSize);
  result.integrationHours = round1(integration / result.sampleSize);
  result.releaseHours = round1(release / result.sampleSize);
  // Summed from the rounded parts so the stacked bar and the total agree exactly.
  result.totalHours = round1(result.codeHours + result.integrationHours + result.releaseHours);
  return result;
}

export function computeLeadTimeBreakdown(deployments: DeploymentRecord[]): LeadTimeSegments {
  const branchFlow = computeBranchFlow(deployments);
  const candidates = deployments.filter((d) => d.isProduction && d.status === "succeeded");
  if (candidates.length === 0) return { ...emptyLeadTime(), branchFlow };

  let preBuild = 0;
  let pipeline = 0;
  let deploy = 0;
  let sampleSize = 0;
  let excluded = 0;

  for (const dep of candidates) {
    // Without a commit there is no "commit to production" to measure. Counted and
    // reported rather than quietly dropped.
    if (!dep.firstCommitTime) {
      excluded++;
      continue;
    }

    const commit = dep.firstCommitTime.getTime();
    const deployStart = dep.startTime.getTime();
    const deployFinish = dep.finishTime.getTime();
    // A lease-proven delivery with no matching stage has no separate pipeline
    // start; falling back to the stage start collapses the pipeline segment to
    // zero, which is still a measurement rather than an invention.
    const buildStart = dep.buildStartTime ? dep.buildStartTime.getTime() : deployStart;

    if (
      !Number.isFinite(commit) ||
      !Number.isFinite(deployStart) ||
      !Number.isFinite(deployFinish)
    ) {
      excluded++;
      continue;
    }

    // Clamped at zero: clock skew between the commit and the build agent can put
    // a commit fractionally after the run started, and a negative segment would
    // silently cancel out another one.
    preBuild += Math.max(0, (buildStart - commit) / HOUR_MS);
    pipeline += Math.max(0, (deployStart - buildStart) / HOUR_MS);
    deploy += Math.max(0, (deployFinish - deployStart) / HOUR_MS);
    sampleSize++;
  }

  if (sampleSize === 0) return { ...emptyLeadTime(), excluded, branchFlow };

  const preBuildHours = round1(preBuild / sampleSize);
  const pipelineHours = round1(pipeline / sampleSize);
  const deployHours = round1(deploy / sampleSize);

  return {
    preBuildHours,
    pipelineHours,
    deployHours,
    // Summed from the rounded parts so the stacked bar and the total agree exactly.
    totalHours: round1(preBuildHours + pipelineHours + deployHours),
    sampleSize,
    excluded,
    branchFlow,
  };
}
