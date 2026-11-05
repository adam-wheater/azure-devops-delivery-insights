import { getClient } from "azure-devops-extension-api";
import { ConcurrencyLimiter } from "../utils/ConcurrencyLimiter";
import {
  AnalysisDiagnostics,
  DeploymentRecord,
  EnvironmentPattern,
  EnvironmentStatus,
  ProductionSettings,
  PRODUCTION_NAME_PATTERN,
  enabledPatterns,
  ExcludedPipeline,
  isPipelineExcluded,
  BranchFlowSettings,
  DEFAULT_BRANCH_FLOW_SETTINGS,
} from "../models/interfaces";
import { resolveBranchFlow } from "./BranchFlowReconciler";
import {
  emptyIndex,
  fetchPullRequestIndex,
  probeIntegrationBranch,
  PullRequestIndex,
} from "./BranchFlowService";
import { fetchPrdReleases, PrdLeaseResult } from "./ProductionSignalService";
import {
  addCounters,
  BuildObservation,
  emptyCounters,
  isCompleted,
  isNotAttempted,
  reconcileBuild,
  reconcileOrphanLeases,
  StageObservation,
} from "./ProductionReconciler";

/** BuildStatus.Completed */
const BUILD_STATUS_COMPLETED = 2;

/**
 * BuildQueryOrder.FinishTimeDescending. Pinned explicitly so minTime/maxTime
 * filter on FINISH time — deployments that finished inside the window, which is
 * the question this dashboard answers.
 */
const BUILD_QUERY_ORDER_FINISH_DESC = 3;

const BUILDS_PAGE_SIZE = 1000;
/** Halvings allowed before a window is accepted as-is: 365d / 2^10 is about 8 hours. */
const MAX_WINDOW_SPLITS = 10;
/**
 * DefinitionQueryOrder.DefinitionNameAscending. Pinned so the definitions
 * continuation token is anchored to a NAME rather than a timestamp — the same
 * class of ambiguity that broke the build query cannot then arise here.
 */
const DEFINITION_QUERY_ORDER_NAME_ASC = 3;

const DEFINITIONS_PAGE_SIZE = 500;
const DEFINITION_BATCH_SIZE = 100;
const DEFINITION_BATCH_CONCURRENCY = 4;
const TIMELINE_CONCURRENCY = 12;
/**
 * Kept well below the timeline limit: this phase issues at most a few requests
 * per repository, and a project rarely has enough distinct repositories for more
 * parallelism to help. Staying low also keeps the burst small enough not to
 * trip throttling right after the timeline phase has finished hammering the API.
 */
const BRANCH_FLOW_CONCURRENCY = 4;
const CHANGES_PAGE_SIZE = 200;
const CHANGES_MAX_PAGES = 2;
const PROGRESS_INTERVAL_MS = 250;

const DEFINITIONS_MEMO_TTL_MS = 60_000;
const definitionsMemo = new Map<string, { expires: number; value: BuildDefinitionLike[] }>();

/** Test hook — clears the session memo. */
export function __clearDefinitionsMemo(): void {
  definitionsMemo.clear();
}

interface BuildDefinitionLike {
  id: number;
  name?: string;
}

interface PagedResult<T> extends Array<T> {
  continuationToken?: string | null;
}

export function matchStageToEnvironment(
  stageName: string,
  patterns: EnvironmentPattern[]
): string | null {
  // Disabled environments are skipped outright, so a stage that only matches a
  // filtered-off environment is treated as if it matched nothing at all.
  const sorted = enabledPatterns(patterns).sort((a, b) => a.order - b.order);
  for (const pattern of sorted) {
    try {
      const regex = new RegExp(pattern.regex, "i");
      if (regex.test(stageName)) {
        return pattern.name;
      }
    } catch {
      // Invalid regex, skip
    }
  }
  return null;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** Drain a paged endpoint until the server stops handing back a continuation token. */
async function drainPages<T>(
  fetchPage: (continuationToken: string | undefined) => Promise<PagedResult<T>>,
  signal?: AbortSignal
): Promise<T[]> {
  const all: T[] = [];
  let token: string | undefined;
  // Hard stop so a server that keeps echoing a token cannot spin forever.
  for (let page = 0; page < 50; page++) {
    if (signal?.aborted) throw new Error("Cancelled");
    const result = await fetchPage(token);
    if (!result?.length) break;
    all.push(...result);
    const next = result.continuationToken;
    if (!next) break;
    token = next;
  }
  return all;
}

export interface FetchDeploymentsResult {
  deployments: DeploymentRecord[];
  diagnostics: AnalysisDiagnostics;
}

export interface PipelineSummary {
  definitionId: number;
  name: string;
}

/**
 * Every pipeline that has built inside the window, for the exclusion picker.
 *
 * The analysis alone is not a good enough source for that list: it only knows
 * about pipelines that produced a deployment record, so a pipeline you want gone
 * would have to first appear in the reports before you could remove it — and if
 * it never fails, it never appears anywhere with an exclude control on it. That
 * was the actual gap. This asks the server instead.
 *
 * Same `builtAfter` window as the analysis, so the list is exactly the set of
 * pipelines that can affect the numbers. Nothing dormant to scroll past.
 */
export async function fetchPipelineDirectory(
  projectName: string,
  timePeriodDays: number,
  signal?: AbortSignal
): Promise<PipelineSummary[]> {
  const buildModule = await import(
    /* webpackChunkName: "ado-build" */ "azure-devops-extension-api/Build"
  );
  const buildClient: any = getClient(buildModule.BuildRestClient);

  const minDate = new Date();
  minDate.setDate(minDate.getDate() - timePeriodDays);

  const definitions = await drainPages<BuildDefinitionLike>(
    (continuationToken) =>
      buildClient.getDefinitions(
        projectName,
        undefined, // name
        undefined, // repositoryId
        undefined, // repositoryType
        DEFINITION_QUERY_ORDER_NAME_ASC, // queryOrder
        DEFINITIONS_PAGE_SIZE, // top
        continuationToken, // continuationToken
        undefined, // minMetricsTime
        undefined, // definitionIds
        undefined, // path
        minDate // builtAfter
      ),
    signal
  );

  const byId = new Map<number, string>();
  for (const def of definitions) {
    if (typeof def?.id === "number") byId.set(def.id, def.name ?? `Pipeline ${def.id}`);
  }

  return [...byId.entries()]
    .map(([definitionId, name]) => ({ definitionId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface FetchDeploymentsSettings {
  environmentPatterns: EnvironmentPattern[];
  timePeriodDays: number;
  production: ProductionSettings;
  excludedPipelines?: ExcludedPipeline[];
  branchFlow?: BranchFlowSettings;
}

/** One production build's inputs for the branch-flow phase, collected during the timeline scan. */
interface BranchFlowWork {
  repositoryId: string | null;
  repositoryType: string | null;
  builtBranch: string | null;
  originCommitId: string;
  originCommitTime: Date | null;
  records: DeploymentRecord[];
}

/**
 * Analyse a project's completed builds and produce one reconciled deployment set.
 *
 * Call budget: 1..n definition pages + ceil(D/100) build-page batches (run in
 * parallel) + 1 lease query + one timeline per build + commit lookups ONLY for
 * builds that produced a successful production record. The commit gating matters:
 * every consumer of firstCommitTime filters on succeeded production records, so
 * fetching changes for anything else was pure waste.
 */
export async function fetchDeployments(
  projectName: string,
  settings: FetchDeploymentsSettings,
  onProgress: (phase: string, current: number, total: number) => void,
  signal?: AbortSignal
): Promise<FetchDeploymentsResult> {
  const startedAt = Date.now();
  const production = settings.production;
  let stagesNotAttempted = 0;

  const buildModule = await import(
    /* webpackChunkName: "ado-build" */ "azure-devops-extension-api/Build"
  );
  const buildClient: any = getClient(buildModule.BuildRestClient);

  let gitClient: any = null;
  const loadGitClient = async () => {
    if (gitClient) return gitClient;
    try {
      const gitModule = await import(
        /* webpackChunkName: "ado-git" */ "azure-devops-extension-api/Git"
      );
      gitClient = getClient(gitModule.GitRestClient);
    } catch {
      gitClient = null;
    }
    return gitClient;
  };

  const minDate = new Date();
  minDate.setDate(minDate.getDate() - settings.timePeriodDays);

  if (signal?.aborted) throw new Error("Cancelled");

  // ── Phase 1: definitions ────────────────────────────────────────────────────
  // builtAfter drops definitions with no builds in the window before we ever
  // enumerate builds for them.
  onProgress("Fetching pipelines…", 0, 0);

  // Keyed on the window LENGTH, not on minDate: minDate carries the current
  // time of day down to the millisecond, so a key built from it was different on
  // every call and the memo never hit. The 60s TTL bounds how stale the
  // definition list can be.
  const defMemoKey = `${projectName}|${settings.timePeriodDays}`;
  const memoized = definitionsMemo.get(defMemoKey);
  let definitions: BuildDefinitionLike[];

  if (memoized && memoized.expires > Date.now()) {
    definitions = memoized.value;
  } else {
    definitions = await drainPages<BuildDefinitionLike>(
      (continuationToken) =>
        buildClient.getDefinitions(
          projectName,
          undefined, // name
          undefined, // repositoryId
          undefined, // repositoryType
          DEFINITION_QUERY_ORDER_NAME_ASC, // queryOrder
          DEFINITIONS_PAGE_SIZE, // top
          continuationToken, // continuationToken
          undefined, // minMetricsTime
          undefined, // definitionIds
          undefined, // path
          minDate // builtAfter
        ),
      signal
    );
    definitionsMemo.set(defMemoKey, {
      expires: Date.now() + DEFINITIONS_MEMO_TTL_MS,
      value: definitions,
    });
  }

  // Excluded pipelines are dropped here, before any build or timeline is fetched
  // for them. They cost nothing to ignore and cannot reach any metric.
  const definitionsBeforeExclusion = definitions.length;
  definitions = definitions.filter(
    (def) => !isPipelineExcluded(settings.excludedPipelines, def.id)
  );
  const pipelinesExcluded = definitionsBeforeExclusion - definitions.length;

  const defNameMap = new Map<number, string>();
  for (const def of definitions) {
    if (def?.name) defNameMap.set(def.id, def.name);
  }

  if (signal?.aborted) throw new Error("Cancelled");

  // ── Phase 2 + 3 in parallel: builds and production leases ───────────────────
  onProgress("Fetching builds…", 0, definitions.length);

  const defIds = definitions.map((d) => d.id);
  const batches: number[][] = [];
  for (let i = 0; i < defIds.length; i += DEFINITION_BATCH_SIZE) {
    batches.push(defIds.slice(i, i + DEFINITION_BATCH_SIZE));
  }

  let batchesDone = 0;
  const batchLimiter = new ConcurrencyLimiter(DEFINITION_BATCH_CONCURRENCY);

  let buildQueryTruncated = false;

  /**
   * Fetch one definition batch over a time window, WITHOUT continuation tokens.
   *
   * Azure DevOps rejects a timestamp continuation token unless a query order is
   * supplied, and pairing the two correctly is fiddly enough that it broke every
   * window except 30 days (which fit in a single page, so no token was issued).
   * Slicing by time sidesteps the whole question: each request is a self-contained
   * page, so no token is ever created and the ambiguity cannot arise.
   *
   * A response that comes back completely full may have been cut off, so the
   * window is halved and both halves re-queried until it fits or the split limit
   * is reached.
   */
  const fetchWindow = async (
    batch: number[],
    from: Date,
    to: Date,
    depth: number
  ): Promise<any[]> => {
    if (signal?.aborted) throw new Error("Cancelled");

    const builds: any[] =
      (await buildClient.getBuilds(
        projectName,
        batch, // definitions
        undefined, // queues
        undefined, // buildNumber
        from, // minTime
        to, // maxTime
        undefined, // requestedFor
        undefined, // reasonFilter
        BUILD_STATUS_COMPLETED, // statusFilter
        undefined, // resultFilter
        undefined, // tagFilters
        undefined, // properties
        BUILDS_PAGE_SIZE, // top
        undefined, // continuationToken — never used, see above
        undefined, // maxBuildsPerDefinition
        undefined, // deletedFilter
        BUILD_QUERY_ORDER_FINISH_DESC // queryOrder
      )) ?? [];

    if (builds.length < BUILDS_PAGE_SIZE) return builds;

    const midpoint = new Date((from.getTime() + to.getTime()) / 2);
    if (depth >= MAX_WINDOW_SPLITS || midpoint <= from || midpoint >= to) {
      // Cannot subdivide further; report rather than silently under-count.
      buildQueryTruncated = true;
      return builds;
    }

    const [older, newer] = await Promise.all([
      fetchWindow(batch, from, midpoint, depth + 1),
      fetchWindow(batch, midpoint, to, depth + 1),
    ]);
    return older.concat(newer);
  };

  const maxDate = new Date();
  const buildsPromise = Promise.all(
    batches.map((batch) =>
      batchLimiter.run(async () => {
        const builds = await fetchWindow(batch, minDate, maxDate, 0);
        batchesDone++;
        onProgress(
          "Fetching builds…",
          Math.min(batchesDone * DEFINITION_BATCH_SIZE, defIds.length),
          defIds.length
        );
        return builds;
      })
    )
  );

  const leasesPromise: Promise<PrdLeaseResult> =
    production.detectionMode === "stage-only"
      ? Promise.resolve({ byBuildId: new Map(), total: 0, oldestReleasedOn: null, failed: false })
      : fetchPrdReleases(projectName, production.leaseOwnerId, signal);

  const [buildBatches, leases] = await Promise.all([buildsPromise, leasesPromise]);
  // Window boundaries are inclusive at both ends, so a build sitting exactly on a
  // split point can come back twice. Deduplicate by build id.
  const buildsById = new Map<number, any>();
  for (const build of buildBatches.flat()) {
    if (build?.id !== undefined) buildsById.set(build.id, build);
  }
  const allBuilds: any[] = [...buildsById.values()];
  if (buildQueryTruncated) {
    console.warn(
      "Delivery Insights: a build query filled its page even at the smallest time slice; some builds may be missing."
    );
  }

  if (signal?.aborted) throw new Error("Cancelled");

  // A failed lease query must not fail the analysis — degrade to stage names.
  const effectiveMode =
    production.detectionMode !== "stage-only" && leases.failed
      ? "stage-only"
      : production.detectionMode;

  const activePatterns = enabledPatterns(settings.environmentPatterns);
  const prodEnvNames = new Set(
    activePatterns.filter((p) => PRODUCTION_NAME_PATTERN.test(p.name)).map((p) => p.name)
  );
  // If no enabled environment is named like production, treat the highest-ordered
  // enabled one as prod. Copy before sorting — sorting settings in place would
  // reorder the user's own rows.
  if (prodEnvNames.size === 0 && activePatterns.length > 0) {
    const highest = [...activePatterns].sort((a, b) => b.order - a.order)[0];
    prodEnvNames.add(highest.name);
  }

  // Lease-proven records that matched no stage get this label. It must be a real
  // environment name, otherwise those deliveries vanish from the matrix and the
  // timeline (both key off configured pattern names).
  const configuredLabel = production.productionEnvironmentLabel?.trim();
  const productionEnvironmentLabel =
    configuredLabel && prodEnvNames.has(configuredLabel)
      ? configuredLabel
      : ([...prodEnvNames][0] ?? configuredLabel ?? "Production");

  // ── Phase 4: timelines ──────────────────────────────────────────────────────
  const totalBuilds = allBuilds.length;
  onProgress("Scanning build timelines…", 0, totalBuilds);

  const limiter = new ConcurrencyLimiter(TIMELINE_CONCURRENCY);
  const counters = emptyCounters();
  const deployments: DeploymentRecord[] = [];
  const seenBuildIds = new Set<number>();

  const branchFlowSettings = settings.branchFlow ?? DEFAULT_BRANCH_FLOW_SETTINGS;
  const branchFlowEnabled = branchFlowSettings.enabled !== false;
  const branchFlowWork: BranchFlowWork[] = [];

  let processed = 0;
  let lastEmit = 0;
  let timelineFetchFailures = 0;

  const emitProgress = (force = false) => {
    const now = Date.now();
    if (force || processed === totalBuilds || now - lastEmit > PROGRESS_INTERVAL_MS) {
      lastEmit = now;
      onProgress("Scanning build timelines…", processed, totalBuilds);
    }
  };

  const onAbort = () => limiter.drain("Cancelled");
  signal?.addEventListener("abort", onAbort);

  try {
    const tasks = allBuilds.map((build) =>
      limiter.run(async () => {
        if (signal?.aborted) throw new Error("Cancelled");

        try {
          // A timeline fetch can fail transiently, or the timeline can have been
          // pruned on an old build. Do NOT bail here: if this build carries a
          // production lease, the lease alone plus the build's own timestamps are
          // sufficient evidence of the release. Bailing dropped the delivery from
          // the metrics AND reported its lease as an orphan, which reads as
          // "outside the analysed window" when it was nothing of the sort.
          let timeline: any = null;
          try {
            timeline = await buildClient.getBuildTimeline(projectName, build.id);
          } catch {
            timelineFetchFailures++;
          }
          if (signal?.aborted) throw new Error("Cancelled");

          const stages: StageObservation[] = [];
          for (const record of timeline?.records ?? []) {
            if (record?.type !== "Stage") continue;
            // Not finished yet — an approval still being waited on lands here.
            if (!isCompleted(record.state)) continue;
            // Finished, but never actually attempted a deployment: skipped,
            // cancelled, a timed-out approval gate, or parked awaiting a human.
            // Counted so the total is visible rather than silently vanishing.
            if (isNotAttempted(record.result)) {
              stagesNotAttempted++;
              continue;
            }

            const stageName = record.name ?? "";
            const envName = matchStageToEnvironment(stageName, settings.environmentPatterns);
            stages.push({
              stageKey: record.identifier ?? record.id ?? stageName,
              stageName,
              attempt: typeof record.attempt === "number" ? record.attempt : 1,
              envName,
              isProdPattern: envName !== null && prodEnvNames.has(envName),
              result: record.result,
              state: record.state,
              startTime: toDate(record.startTime),
              finishTime: toDate(record.finishTime),
            });
          }

          const lease = leases.byBuildId.get(build.id) ?? null;
          if (stages.length === 0 && !lease) return;

          const definitionId = build.definition?.id ?? -1;
          const observation: BuildObservation = {
            buildId: build.id,
            definitionId,
            pipelineName:
              defNameMap.get(definitionId) ?? build.definition?.name ?? `Pipeline ${definitionId}`,
            buildNumber: build.buildNumber ?? String(build.id),
            buildStartTime: toDate(build.startTime),
            buildFinishTime: toDate(build.finishTime),
            stages,
            lease: effectiveMode === "stage-only" ? null : lease,
          };

          const { records, counters: taskCounters } = reconcileBuild(observation, {
            mode: effectiveMode,
            productionEnvironmentLabel,
          });

          if (records.length === 0) return;

          // Commit data only matters for succeeded production records — those are
          // the only ones any lead-time calculation ever reads.
          const needsCommitTime = records.some((r) => r.isProduction && r.status === "succeeded");
          if (needsCommitTime) {
            const probe = await fetchFirstCommitTime(
              buildClient,
              loadGitClient,
              projectName,
              build,
              signal
            );
            if (probe) {
              for (const record of records) {
                if (record.isProduction && record.status === "succeeded") {
                  if (probe.time) record.firstCommitTime = probe.time;
                  if (probe.approx) record.leadTimeApprox = true;
                }
              }
              // The pull-request queries are NOT issued here. Fanning them out
              // inside the per-build tasks would multiply in-flight requests by
              // the commit count and trip throttling; they are batched per
              // repository in the phase below instead.
              if (branchFlowEnabled && probe.commitIds.length > 0) {
                branchFlowWork.push({
                  repositoryId: build.repository?.id ?? null,
                  repositoryType: build.repository?.type ?? null,
                  builtBranch: build.sourceBranch ?? null,
                  // Changes come back newest-first, so the last entry is the
                  // oldest — the same commit firstCommitTime is measured from.
                  originCommitId: probe.commitIds[probe.commitIds.length - 1],
                  originCommitTime: probe.time,
                  records: records.filter((r) => r.isProduction && r.status === "succeeded"),
                });
              }
            }
          }

          seenBuildIds.add(build.id);
          deployments.push(...records);
          addCounters(counters, taskCounters);
        } finally {
          processed++;
          emitProgress();
        }
      })
    );

    const settled = await Promise.allSettled(tasks);

    // A user cancellation must propagate; a single bad timeline must not discard
    // every build we successfully scanned.
    for (const outcome of settled) {
      if (outcome.status === "rejected" && (outcome.reason as Error)?.message === "Cancelled") {
        throw new Error("Cancelled");
      }
    }
    timelineFetchFailures += settled.filter((o) => o.status === "rejected").length;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  emitProgress(true);

  // ── Phase 5: branch flow ────────────────────────────────────────────────────
  const branchFlowStats = await resolveBranchFlows(
    loadGitClient,
    projectName,
    branchFlowWork,
    branchFlowSettings,
    onProgress,
    signal
  );

  const orphans = reconcileOrphanLeases(leases.byBuildId, seenBuildIds);

  const diagnostics: AnalysisDiagnostics = {
    buildsScanned: totalBuilds,
    definitionsScanned: definitions.length,
    leasesFound: leases.byBuildId.size,
    leaseOwnerId: production.leaseOwnerId,
    leaseQueryFailed: leases.failed,
    oldestLeaseCreatedOn: leases.oldestReleasedOn,
    orphanLeases: orphans.orphanLeases,
    prodFromLease: counters.prodFromLease,
    prodFromStageOnly: counters.prodFromStageOnly,
    prodFailuresFromTimeline: counters.prodFailuresFromTimeline,
    suppressedStageProd: counters.suppressedStageProd,
    retriesCollapsed: counters.retriesCollapsed,
    timelineFetchFailures,
    pipelinesExcluded,
    stagesNotAttempted,
    detectionMode: effectiveMode,
    branchFlowRepositories: branchFlowStats.repositoriesQueried,
    branchFlowProbes: branchFlowStats.integrationProbes,
    branchFlowQueryFailures: branchFlowStats.queryFailures,
    durationMs: Date.now() - startedAt,
  };

  deployments.sort((a, b) => a.finishTime.getTime() - b.finishTime.getTime());
  return { deployments, diagnostics };
}

export interface BranchFlowStats {
  /** Distinct Azure Repos repositories queried. Two requests each, before any splitting. */
  repositoriesQueried: number;
  /** Repositories whose refs were read to prove whether an integration branch exists. */
  integrationProbes: number;
  /** Repositories where a pull-request query failed, so their deliveries read as unknown. */
  queryFailures: number;
}

/**
 * Attach the branch journey to every production delivery.
 *
 * Grouped by repository and issued as one phase, deliberately. The per-commit
 * alternative costs roughly one request per commit per delivery — on a busy
 * project that more than doubles the whole analysis and pushes concurrent
 * requests high enough to trip throttling, which this codebase absorbs by
 * silently dropping builds from the sample. Two batched requests per repository
 * answer the same question.
 *
 * Every failure here degrades to "unknown" on the affected records. Branch flow
 * is an extra lens on data that has already been gathered; it must never be able
 * to fail the analysis that produced it.
 */
async function resolveBranchFlows(
  loadGitClient: () => Promise<any>,
  projectName: string,
  work: BranchFlowWork[],
  settings: BranchFlowSettings,
  onProgress: (phase: string, current: number, total: number) => void,
  signal?: AbortSignal
): Promise<BranchFlowStats> {
  const stats: BranchFlowStats = {
    repositoriesQueried: 0,
    integrationProbes: 0,
    queryFailures: 0,
  };
  if (work.length === 0) return stats;

  // A repository that is not Azure Repos Git has no pull requests to read. Mark
  // its deliveries as such immediately rather than querying and blaming the team
  // for an empty result.
  const byRepository = new Map<string, BranchFlowWork[]>();
  for (const item of work) {
    if (!item.repositoryId || (item.repositoryType && item.repositoryType !== "TfsGit")) {
      applyFlow(item, emptyIndex(), null, settings);
      continue;
    }
    const bucket = byRepository.get(item.repositoryId);
    if (bucket) bucket.push(item);
    else byRepository.set(item.repositoryId, [item]);
  }

  if (byRepository.size === 0) return stats;

  const git = await loadGitClient();
  if (!git) {
    // No git client at all: everything is unknown, and saying so is the point.
    for (const items of byRepository.values()) {
      for (const item of items) applyFlow(item, emptyIndex(true), null, settings);
    }
    stats.queryFailures = byRepository.size;
    return stats;
  }

  const repositories = [...byRepository.entries()];
  onProgress("Tracing branch history…", 0, repositories.length);

  const limiter = new ConcurrencyLimiter(BRANCH_FLOW_CONCURRENCY);
  let done = 0;

  const tasks = repositories.map(([repositoryId, items]) =>
    limiter.run(async () => {
      if (signal?.aborted) throw new Error("Cancelled");
      try {
        const commitIds = items.map((item) => item.originCommitId);
        const [index, hasIntegration] = await Promise.all([
          fetchPullRequestIndex(git, projectName, repositoryId, commitIds, signal),
          probeIntegrationBranch(
            git,
            projectName,
            repositoryId,
            settings.integrationPatterns,
            signal
          ),
        ]);

        stats.repositoriesQueried++;
        if (hasIntegration !== null) stats.integrationProbes++;
        if (index.failed) stats.queryFailures++;

        for (const item of items) applyFlow(item, index, hasIntegration, settings);
      } catch (err) {
        if ((err as Error)?.message === "Cancelled") throw err;
        stats.queryFailures++;
        for (const item of items) applyFlow(item, emptyIndex(true), null, settings);
      } finally {
        done++;
        onProgress("Tracing branch history…", done, repositories.length);
      }
    })
  );

  const settled = await Promise.allSettled(tasks);
  for (const outcome of settled) {
    if (outcome.status === "rejected" && (outcome.reason as Error)?.message === "Cancelled") {
      throw new Error("Cancelled");
    }
  }

  return stats;
}

function applyFlow(
  item: BranchFlowWork,
  index: PullRequestIndex,
  hasIntegrationBranch: boolean | null,
  settings: BranchFlowSettings
): void {
  const key = item.originCommitId.toLowerCase();
  const flow = resolveBranchFlow({
    repositoryType: item.repositoryType,
    builtBranch: item.builtBranch,
    originCommitId: item.originCommitId,
    originCommitTime: item.originCommitTime,
    mergedBy: index.mergedBy.get(key) ?? [],
    producedBy: index.producedBy.get(key) ?? [],
    hasIntegrationBranch,
    integrationPatterns: settings.integrationPatterns,
    queryFailed: index.failed,
  });
  for (const record of item.records) record.branchFlow = flow;
}

interface CommitProbe {
  /** Oldest commit in the build — the lead-time origin. Null when it could not be read. */
  time: Date | null;
  approx: boolean;
  /** Every commit id the build reported, newest first, as the API returns them. */
  commitIds: string[];
}

/**
 * Oldest commit in the build, used as the lead-time origin.
 *
 * Deliberately does NOT pass top:1 — changes come back newest-first, so the last
 * element of a full page is the oldest. Asking for one row would return the NEWEST
 * commit and silently understate lead time.
 *
 * The commit ids are returned rather than discarded: the branch-flow phase needs
 * exactly the same list, and re-fetching it would double the cost of the changes
 * endpoint for no benefit.
 */
async function fetchFirstCommitTime(
  buildClient: any,
  loadGitClient: () => Promise<any>,
  projectName: string,
  build: any,
  signal?: AbortSignal
): Promise<CommitProbe | null> {
  try {
    const commitIds: string[] = [];
    let token: string | undefined;
    let approx = false;

    for (let page = 0; page < CHANGES_MAX_PAGES; page++) {
      if (signal?.aborted) throw new Error("Cancelled");
      const changes: PagedResult<any> = await buildClient.getBuildChanges(
        projectName,
        build.id,
        token,
        CHANGES_PAGE_SIZE
      );
      if (!changes?.length) break;
      for (const change of changes) {
        if (change?.id) commitIds.push(change.id);
      }
      token = changes.continuationToken ?? undefined;
      if (!token) break;
      if (page === CHANGES_MAX_PAGES - 1) approx = true;
    }

    if (commitIds.length === 0 || !build.repository?.id) return null;

    const git = await loadGitClient();
    if (!git) return { time: null, approx, commitIds };

    const commit = await git.getCommit(
      commitIds[commitIds.length - 1],
      build.repository.id,
      projectName
    );
    const committed = commit?.committer?.date ?? commit?.author?.date;
    return { time: toDate(committed), approx, commitIds };
  } catch (err) {
    if ((err as Error)?.message === "Cancelled") throw err;
    return null;
  }
}

export function buildEnvironmentMatrix(
  deployments: DeploymentRecord[],
  patterns: EnvironmentPattern[]
): EnvironmentStatus[] {
  const pipelineMap = new Map<
    number,
    { pipelineName: string; envMap: Map<string, DeploymentRecord> }
  >();

  for (const dep of deployments) {
    let entry = pipelineMap.get(dep.definitionId);
    if (!entry) {
      entry = { pipelineName: dep.pipelineName, envMap: new Map() };
      pipelineMap.set(dep.definitionId, entry);
    }
    const existing = entry.envMap.get(dep.environment);
    if (!existing || dep.finishTime.getTime() > existing.finishTime.getTime()) {
      entry.envMap.set(dep.environment, dep);
    }
  }

  const sortedPatterns = enabledPatterns(patterns).sort((a, b) => a.order - b.order);
  const envNames = sortedPatterns.map((p) => p.name);

  const result: EnvironmentStatus[] = [];
  for (const [defId, entry] of pipelineMap) {
    result.push({
      pipelineName: entry.pipelineName,
      definitionId: defId,
      environments: envNames.map((name) => ({
        name,
        lastDeployment: entry.envMap.get(name) ?? null,
      })),
    });
  }

  result.sort((a, b) => a.pipelineName.localeCompare(b.pipelineName));
  return result;
}
