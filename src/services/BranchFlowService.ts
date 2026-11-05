import { BranchPattern, isIntegrationBranch } from "../models/interfaces";
import { PullRequestLike } from "./BranchFlowReconciler";

/**
 * Pull-request lookups for the branch-flow measurement.
 *
 * COST IS THE WHOLE DESIGN. The obvious implementation — one query per commit,
 * inside the existing per-build task — costs roughly one extra request per
 * commit per deployment. On a project with 120 production deliveries averaging
 * eight commits each that is ~960 extra requests, which more than doubles the
 * analysis. It would also raise in-flight requests from ~16 to ~96, which is
 * exactly what trips Azure DevOps throttling, and this codebase treats a 429 as
 * a soft failure that silently drops the build from the sample.
 *
 * So the queries are batched by REPOSITORY and issued as their own phase after
 * the timelines are in, not from inside the per-build tasks. The same 120
 * deliveries cost two requests per distinct repository — around 30 in total.
 *
 * The endpoint is a POST whose body carries the commit list (GitClient.d.ts:879),
 * so there is no URL-length ceiling to work around. No server-side batch limit
 * is documented anywhere in the installed package, so the cap here is
 * self-imposed and the code splits and retries if the server disagrees.
 */

/** GitPullRequestQueryType. Pinned as literals: the test mock does not export the enum. */
const QUERY_TYPE_LAST_MERGE_COMMIT = 1;
const QUERY_TYPE_COMMIT = 2;
/** GitPullRequestQueryIncludeOptions.NotSet — we do not want labels. */
const QUERY_INCLUDE_NONE = 0;

/** Self-imposed. Halved and retried if the server rejects the batch. */
export const COMMIT_BATCH_SIZE = 100;
/** Below this a rejection is the request, not the size, so stop splitting. */
const MIN_BATCH_SIZE = 5;

export interface PullRequestIndex {
  /** commit id → completed pull requests that merged it. */
  mergedBy: Map<string, PullRequestLike[]>;
  /** commit id → the pull request that produced it (squash or merge artefact). */
  producedBy: Map<string, PullRequestLike[]>;
  /** True when any query for this repository failed, so gaps are not blamed on the data. */
  failed: boolean;
}

export function emptyIndex(failed = false): PullRequestIndex {
  return { mergedBy: new Map(), producedBy: new Map(), failed };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Run one query type over one batch, halving on rejection.
 *
 * Only size-shaped rejections are worth splitting for, but the server's exact
 * response is not documented, so any failure on a batch above the floor is
 * retried smaller. A batch that fails at the floor is genuinely broken and its
 * absence is reported rather than retried forever.
 */
async function queryBatch(
  gitClient: any,
  projectName: string,
  repositoryId: string,
  type: number,
  commitIds: string[],
  signal?: AbortSignal
): Promise<{ results: Record<string, PullRequestLike[]>; failed: boolean }> {
  if (signal?.aborted) throw new Error("Cancelled");
  if (commitIds.length === 0) return { results: {}, failed: false };

  try {
    // Parameter order trap: the query body comes FIRST, the repository id second.
    const response = await gitClient.getPullRequestQuery(
      { queries: [{ include: QUERY_INCLUDE_NONE, items: commitIds, type }] },
      repositoryId,
      projectName
    );
    // results[n] corresponds to queries[n]; we always send exactly one.
    const map = response?.results?.[0];
    return { results: map && typeof map === "object" ? map : {}, failed: false };
  } catch (err) {
    if ((err as Error)?.message === "Cancelled") throw err;
    if (commitIds.length <= MIN_BATCH_SIZE) return { results: {}, failed: true };

    const half = Math.ceil(commitIds.length / 2);
    const [left, right] = [commitIds.slice(0, half), commitIds.slice(half)];
    const [a, b] = await Promise.all([
      queryBatch(gitClient, projectName, repositoryId, type, left, signal),
      queryBatch(gitClient, projectName, repositoryId, type, right, signal),
    ]);
    return { results: { ...a.results, ...b.results }, failed: a.failed || b.failed };
  }
}

function absorb(
  target: Map<string, PullRequestLike[]>,
  results: Record<string, PullRequestLike[]>
) {
  for (const [commitId, prs] of Object.entries(results)) {
    if (!Array.isArray(prs) || prs.length === 0) continue;
    // Commit ids come back from the server in whatever case it stores; every
    // lookup here normalises, so a case mismatch cannot silently miss.
    const key = commitId.toLowerCase();
    const existing = target.get(key);
    if (existing) existing.push(...prs);
    else target.set(key, [...prs]);
  }
}

/**
 * Both query types for one repository's commits.
 *
 * Two requests per repository (before any splitting): "which pull requests
 * merged these commits" and "which pull request produced these commits". Neither
 * alone covers all four merge strategies — see BranchFlowReconciler.
 */
export async function fetchPullRequestIndex(
  gitClient: any,
  projectName: string,
  repositoryId: string,
  commitIds: string[],
  signal?: AbortSignal
): Promise<PullRequestIndex> {
  const unique = [...new Set(commitIds.filter(Boolean).map((id) => id.toLowerCase()))];
  if (unique.length === 0) return emptyIndex();

  const index = emptyIndex();
  const batches = chunk(unique, COMMIT_BATCH_SIZE);

  for (const batch of batches) {
    const [merged, produced] = await Promise.all([
      queryBatch(gitClient, projectName, repositoryId, QUERY_TYPE_COMMIT, batch, signal),
      queryBatch(gitClient, projectName, repositoryId, QUERY_TYPE_LAST_MERGE_COMMIT, batch, signal),
    ]);
    absorb(index.mergedBy, merged.results);
    absorb(index.producedBy, produced.results);
    if (merged.failed || produced.failed) index.failed = true;
  }

  return index;
}

/**
 * Does this repository have an integration branch?
 *
 * This is the ONLY way to tell "the change never went through develop" from
 * "this repository has no develop". Without it a missing pull request and a
 * missing branch look identical, and the middle hop would be reported as zero
 * for trunk-based repositories — which reads as "merging to develop is instant"
 * rather than "there is no develop".
 *
 * Returns null when the probe itself failed: unknown, never absence.
 */
export async function probeIntegrationBranch(
  gitClient: any,
  projectName: string,
  repositoryId: string,
  patterns: BranchPattern[],
  signal?: AbortSignal
): Promise<boolean | null> {
  if (signal?.aborted) throw new Error("Cancelled");
  try {
    // getRefs(repositoryId, project, filter) — repository first, filter third.
    const refs: any[] = await gitClient.getRefs(repositoryId, projectName, "heads/");
    if (!Array.isArray(refs)) return null;
    return refs.some(
      (ref) => typeof ref?.name === "string" && isIntegrationBranch(ref.name, patterns)
    );
  } catch (err) {
    if ((err as Error)?.message === "Cancelled") throw err;
    return null;
  }
}
