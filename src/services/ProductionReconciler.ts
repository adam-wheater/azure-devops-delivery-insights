/**
 * Hybrid production detection — pure functions, no API access, fully unit-testable.
 *
 * PRECEDENCE, stated once and enforced by the ordering below:
 *   the LEASE is authoritative for "did this reach production";
 *   the TIMELINE is authoritative for "did a production attempt fail".
 *
 * Why the hybrid is unavoidable: the pipeline step that writes the retention lease
 * only runs after a successful deployment, so a build whose production stage FAILED
 * has no lease. Leases can therefore only ever prove successes — production failures
 * can only come from timeline stage results.
 *
 * Three structural guards against double counting:
 *   1. Retry collapse — a re-run stage reappears with the same `identifier` at a
 *      higher `attempt`. Grouping by identifier and keeping the max attempt stops a
 *      failed attempt 1 plus a succeeded attempt 2 counting as two deployments.
 *   2. At most ONE production record per build, accumulated into a single slot, so
 *      a build with several prod-named stages (multi-region) is one delivery.
 *   3. Orphan leases (runId not in the analysed build set) are counted and reported
 *      but never emitted as records — they have no build, times or definition.
 */
import { DeploymentRecord, DetectionMode, ProdSource } from "../models/interfaces";
import { PrdRelease } from "./ProductionSignalService";

/*
 * Runtime enum values. The REST client requests `enumsAsNumbers=true`, so timeline
 * `state` and `result` arrive as NUMBERS — string comparisons never match.
 *
 * !!! TaskResult.Succeeded === 0, which is FALSY. Strict `===` is mandatory here.
 * Any refactor to `if (record.result)` or `result ?? fallback` silently
 * misclassifies every successful stage as a failure.
 */
export const TIMELINE_STATE_COMPLETED = 2;
export const TASK_RESULT_SUCCEEDED = 0;
export const TASK_RESULT_SUCCEEDED_WITH_ISSUES = 1;
export const TASK_RESULT_FAILED = 2;
export const TASK_RESULT_CANCELED = 3;
export const TASK_RESULT_SKIPPED = 4;
export const TASK_RESULT_ABANDONED = 5;
export const TASK_RESULT_MANUALLY_QUEUED = 6;
export const TASK_RESULT_DEPENDENT_ON_MANUAL_QUEUE = 7;

export const isCompleted = (state: unknown): boolean => state === TIMELINE_STATE_COMPLETED;

export const isSucceeded = (result: unknown): boolean =>
  result === TASK_RESULT_SUCCEEDED || result === TASK_RESULT_SUCCEEDED_WITH_ISSUES;

/**
 * The stage never actually attempted a deployment, so it is neither a success
 * nor a failure — it is an absence, and counting it as a failure would be wrong.
 *
 * Covers two situations that look different but mean the same thing here:
 *   - skipped / cancelled / abandoned — the stage was bypassed, or an approval or
 *     gate timed out before the deployment was ever tried;
 *   - manually queued / dependent on a manual queue — the stage is parked waiting
 *     for a human, which is what an RFC approval looks like.
 *
 * Stages still Pending or InProgress are filtered separately by isCompleted, so
 * an approval currently being waited on never reaches this check at all.
 */
export const isNotAttempted = (result: unknown): boolean =>
  result === TASK_RESULT_SKIPPED ||
  result === TASK_RESULT_CANCELED ||
  result === TASK_RESULT_ABANDONED ||
  result === TASK_RESULT_MANUALLY_QUEUED ||
  result === TASK_RESULT_DEPENDENT_ON_MANUAL_QUEUE;

export interface StageObservation {
  /** `identifier` if present, else the record id. Groups retries of the same stage. */
  stageKey: string;
  stageName: string;
  attempt: number;
  /** Environment pattern this stage matched, or null if it matched nothing. */
  envName: string | null;
  isProdPattern: boolean;
  result: unknown;
  state: unknown;
  startTime: Date | null;
  finishTime: Date | null;
}

export interface BuildObservation {
  buildId: number;
  definitionId: number;
  pipelineName: string;
  buildNumber: string;
  buildStartTime: Date | null;
  buildFinishTime: Date | null;
  stages: StageObservation[];
  lease: PrdRelease | null;
}

export interface ReconcileOptions {
  mode: DetectionMode;
  productionEnvironmentLabel: string;
}

export interface ReconcileCounters {
  prodFromLease: number;
  prodFromStageOnly: number;
  prodFailuresFromTimeline: number;
  suppressedStageProd: number;
  retriesCollapsed: number;
}

export interface ReconcileResult {
  records: DeploymentRecord[];
  counters: ReconcileCounters;
}

export function emptyCounters(): ReconcileCounters {
  return {
    prodFromLease: 0,
    prodFromStageOnly: 0,
    prodFailuresFromTimeline: 0,
    suppressedStageProd: 0,
    retriesCollapsed: 0,
  };
}

export function addCounters(into: ReconcileCounters, from: ReconcileCounters): void {
  into.prodFromLease += from.prodFromLease;
  into.prodFromStageOnly += from.prodFromStageOnly;
  into.prodFailuresFromTimeline += from.prodFailuresFromTimeline;
  into.suppressedStageProd += from.suppressedStageProd;
  into.retriesCollapsed += from.retriesCollapsed;
}

/** Keep only the highest attempt per stage key. Returns the survivors and how many were dropped. */
export function collapseRetries(stages: StageObservation[]): {
  stages: StageObservation[];
  collapsed: number;
} {
  const best = new Map<string, StageObservation>();
  let collapsed = 0;

  for (const stage of stages) {
    const existing = best.get(stage.stageKey);
    if (!existing) {
      best.set(stage.stageKey, stage);
      continue;
    }
    collapsed++;
    if (stage.attempt > existing.attempt) best.set(stage.stageKey, stage);
  }

  return { stages: [...best.values()], collapsed };
}

function latestBy(stages: StageObservation[], fallback: Date | null): StageObservation | null {
  if (stages.length === 0) return null;
  return stages.reduce((latest, stage) => {
    const a = (stage.finishTime ?? fallback)?.getTime() ?? 0;
    const b = (latest.finishTime ?? fallback)?.getTime() ?? 0;
    return a > b ? stage : latest;
  });
}

function makeRecord(
  obs: BuildObservation,
  fields: {
    environment: string;
    status: "succeeded" | "failed";
    startTime: Date;
    finishTime: Date;
    isProduction: boolean;
    prodSource: ProdSource;
    prodUnverified: boolean;
    hadFailedProdStage: boolean;
    releasedToPrdAt: Date | null;
    stageNames: string[];
  }
): DeploymentRecord {
  return {
    buildId: obs.buildId,
    buildNumber: obs.buildNumber,
    pipelineName: obs.pipelineName,
    definitionId: obs.definitionId,
    firstCommitTime: null,
    buildStartTime: obs.buildStartTime,
    ...fields,
  };
}

/** Resolve a usable timestamp pair for a stage, falling back to the build's own times. */
function stageTimes(
  stage: StageObservation | null,
  obs: BuildObservation,
  fallback: Date
): { startTime: Date; finishTime: Date } {
  const start = stage?.startTime ?? obs.buildStartTime ?? fallback;
  const finish = stage?.finishTime ?? obs.buildFinishTime ?? start;
  return { startTime: start, finishTime: finish };
}

export function reconcileBuild(obs: BuildObservation, opts: ReconcileOptions): ReconcileResult {
  const counters = emptyCounters();
  const records: DeploymentRecord[] = [];

  const { stages, collapsed } = collapseRetries(obs.stages);
  counters.retriesCollapsed = collapsed;

  const useLease = opts.mode !== "stage-only" && obs.lease !== null;
  const lease = useLease ? obs.lease : null;

  const prodStages = stages.filter((s) => s.isProdPattern);
  const otherStages = stages.filter((s) => !s.isProdPattern);

  const succeededProd = prodStages.filter((s) => isSucceeded(s.result));
  const failedProd = prodStages.filter((s) => !isSucceeded(s.result));

  // A last-resort timestamp so a record can never carry an Invalid Date.
  const anchor = obs.buildFinishTime ?? obs.buildStartTime ?? lease?.releasedOn ?? new Date(0);

  // ── Non-production stages: one record each, unchanged semantics ──────────────
  const nonProd = [...otherStages];

  // ── Production: at most ONE record for this build ────────────────────────────
  let prodRecord: DeploymentRecord | null = null;

  if (lease && succeededProd.length > 0) {
    const latest = latestBy(succeededProd, obs.buildFinishTime);
    const times = stageTimes(latest, obs, anchor);
    prodRecord = makeRecord(obs, {
      environment: latest?.envName ?? opts.productionEnvironmentLabel,
      status: "succeeded",
      ...times,
      isProduction: true,
      prodSource: "lease+stage",
      prodUnverified: false,
      hadFailedProdStage: failedProd.length > 0,
      releasedToPrdAt: lease.releasedOn,
      stageNames: succeededProd.map((s) => s.stageName),
    });
    counters.prodFromLease++;
  } else if (lease) {
    // Lease proves delivery even when no stage matched the production pattern, and
    // even when every matching stage failed (a retry or manual step outside this
    // build's timeline completed the release).
    prodRecord = makeRecord(obs, {
      environment: opts.productionEnvironmentLabel,
      status: "succeeded",
      startTime: obs.buildStartTime ?? lease.releasedOn,
      finishTime: lease.releasedOn,
      isProduction: true,
      prodSource: "lease",
      prodUnverified: false,
      hadFailedProdStage: failedProd.length > 0,
      releasedToPrdAt: lease.releasedOn,
      stageNames: prodStages.map((s) => s.stageName),
    });
    counters.prodFromLease++;
  } else if (failedProd.length > 0 && opts.mode !== "lease-only") {
    // THE FAILED-DEPLOYMENT PATH. No lease was written because the deployment did
    // not succeed — the timeline is the only evidence this happened at all.
    const latest = latestBy(failedProd, obs.buildFinishTime);
    const times = stageTimes(latest, obs, anchor);
    prodRecord = makeRecord(obs, {
      environment: latest?.envName ?? opts.productionEnvironmentLabel,
      status: "failed",
      ...times,
      isProduction: true,
      prodSource: "stage",
      prodUnverified: true,
      hadFailedProdStage: true,
      releasedToPrdAt: null,
      stageNames: failedProd.map((s) => s.stageName),
    });
    counters.prodFailuresFromTimeline++;
  } else if (succeededProd.length > 0 && opts.mode !== "lease-only") {
    // Stage name says production but no lease backs it up. In hybrid mode that is
    // worth flagging, because a lease was expected and did not appear. In
    // stage-only mode the operator has deliberately chosen stage names as the
    // source of truth, so there is nothing to be unverified against.
    const latest = latestBy(succeededProd, obs.buildFinishTime);
    const times = stageTimes(latest, obs, anchor);
    prodRecord = makeRecord(obs, {
      environment: latest?.envName ?? opts.productionEnvironmentLabel,
      status: "succeeded",
      ...times,
      isProduction: true,
      prodSource: "stage",
      prodUnverified: opts.mode === "hybrid",
      hadFailedProdStage: false,
      releasedToPrdAt: null,
      stageNames: succeededProd.map((s) => s.stageName),
    });
    counters.prodFromStageOnly++;
  } else if (succeededProd.length > 0 && opts.mode === "lease-only") {
    // Not treated as production, but the activity is real — keep it as non-prod.
    counters.suppressedStageProd += succeededProd.length;
    nonProd.push(...succeededProd);
  }

  if (opts.mode === "lease-only" && !prodRecord && failedProd.length > 0) {
    // Failures cannot be lease-proven by definition, so lease-only mode keeps them
    // as non-production activity rather than discarding them entirely.
    //
    // The `!prodRecord` guard is load-bearing. Without it, a lease-proven delivery
    // that also had a failed production stage emitted a SECOND record for the same
    // build and environment — a non-production failure that outranked the real
    // record in the environment matrix (later finishTime wins), so a successful
    // release displayed as failed. When a lease already produced the record,
    // `hadFailedProdStage` carries the failed attempt, which is exactly what
    // DoraCalculator.isFailureEvent consumes.
    nonProd.push(...failedProd);
  }

  for (const stage of nonProd) {
    if (!stage.envName) continue;
    const times = stageTimes(stage, obs, anchor);
    records.push(
      makeRecord(obs, {
        environment: stage.envName,
        status: isSucceeded(stage.result) ? "succeeded" : "failed",
        ...times,
        isProduction: false,
        prodSource: null,
        prodUnverified: false,
        hadFailedProdStage: false,
        releasedToPrdAt: null,
        stageNames: [stage.stageName],
      })
    );
  }

  if (prodRecord) records.push(prodRecord);

  return { records, counters };
}

/**
 * Leases whose build was not in the analysed window. Never emitted as records — the
 * production map is keyed by build id and these have no build, so they can never
 * collide with an emitted record either.
 */
export function reconcileOrphanLeases(
  leases: Map<number, PrdRelease>,
  seenBuildIds: Set<number>
): { orphanLeases: number; oldestOrphan: Date | null } {
  let orphanLeases = 0;
  let oldestOrphan: Date | null = null;

  for (const [buildId, release] of leases) {
    if (seenBuildIds.has(buildId)) continue;
    orphanLeases++;
    if (!oldestOrphan || release.releasedOn.getTime() < oldestOrphan.getTime()) {
      oldestOrphan = release.releasedOn;
    }
  }

  return { orphanLeases, oldestOrphan };
}
