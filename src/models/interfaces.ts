export interface EnvironmentPattern {
  /** Stable identity for React keys and edits. Backfilled on load for legacy documents. */
  id?: string;
  name: string;
  regex: string;
  order: number;
  color: string;
  /**
   * Whether this environment takes part in the analysis at all.
   *
   * Undefined means enabled, so settings stored before this existed keep working.
   * A disabled environment is never matched, so its stages cost nothing to scan
   * and never appear in the matrix, the timeline or the failure list.
   */
  enabled?: boolean;
}

/** Undefined counts as enabled — legacy documents predate the flag. */
export function isPatternEnabled(pattern: EnvironmentPattern): boolean {
  return pattern.enabled !== false;
}

export function enabledPatterns(patterns: EnvironmentPattern[]): EnvironmentPattern[] {
  return patterns.filter(isPatternEnabled);
}

/** True when the pattern's name reads like production, used for prod detection and warnings. */
export function isProductionPattern(pattern: EnvironmentPattern): boolean {
  return PRODUCTION_NAME_PATTERN.test(pattern.name);
}

export type EnvironmentScope = "all" | "production";

/**
 * Flip the included set to a scope. "production" includes only production-named
 * environments; "all" includes everything. Patterns are never removed, only
 * toggled, so widening again restores exactly what was there before.
 */
export function applyEnvironmentScope(
  patterns: EnvironmentPattern[],
  scope: EnvironmentScope
): EnvironmentPattern[] {
  return patterns.map((pattern) => ({
    ...pattern,
    enabled: scope === "all" ? true : isProductionPattern(pattern),
  }));
}

/** True when the included set is production and nothing else. */
export function isProductionOnly(patterns: EnvironmentPattern[]): boolean {
  const included = enabledPatterns(patterns);
  return included.length > 0 && included.every(isProductionPattern);
}

/**
 * How a deployment was proven to have reached production.
 *
 * - `lease`       — a build retention lease with the configured ownerId exists. Authoritative.
 * - `lease+stage` — a lease exists AND a matching production stage succeeded.
 * - `stage`       — no lease; production was inferred from the stage name only (unverified).
 * - `null`        — not a production record.
 */
export type ProdSource = "lease" | "stage" | "lease+stage" | null;

export interface DeploymentRecord {
  buildId: number;
  buildNumber: string;
  pipelineName: string;
  definitionId: number;
  environment: string;
  status: "succeeded" | "failed";
  startTime: Date;
  finishTime: Date;
  firstCommitTime: Date | null;
  /**
   * When the pipeline run itself started, as opposed to when this stage started.
   * The gap between the two is real elapsed time — upstream stages, queueing and
   * approval waits — and is what makes a measured lead-time breakdown possible.
   */
  buildStartTime: Date | null;

  /** True for exactly one record per build that reached (or attempted) production. */
  isProduction: boolean;
  prodSource: ProdSource;
  /** isProduction && prodSource === "stage" — inferred from naming, not proven by a lease. */
  prodUnverified: boolean;
  /** A production stage failed on this build even though a lease proves eventual delivery. */
  hadFailedProdStage: boolean;
  /** lease.createdOn — the authoritative "released to production" timestamp. */
  releasedToPrdAt: Date | null;
  /** Every stage that contributed, so multi-region prod shows as one delivery. */
  stageNames: string[];
  /** getBuildChanges pagination was capped, so firstCommitTime may be later than the truth. */
  leadTimeApprox?: boolean;
  /** The branch journey behind this delivery. Null when branch flow is switched off. */
  branchFlow?: BranchFlow | null;

  /**
   * @deprecated Write-only dead payload — no component reads it and it is no longer persisted.
   * Retained so existing object literals (including tests) keep type-checking.
   */
  commitIds?: string[];
}

export interface EnvironmentStatus {
  pipelineName: string;
  definitionId: number;
  environments: {
    name: string;
    lastDeployment: DeploymentRecord | null;
  }[];
}

export interface DoraMetrics {
  deploymentFrequency: {
    value: number;
    unit: string;
    band: "Elite" | "High" | "Medium" | "Low";
  };
  leadTimeForChanges: {
    medianHours: number;
    band: "Elite" | "High" | "Medium" | "Low";
  };
  changeFailureRate: {
    percentage: number;
    band: "Elite" | "High" | "Medium" | "Low";
  };
  meanTimeToRecovery: {
    medianHours: number;
    band: "Elite" | "High" | "Medium" | "Low";
  };
}

export interface DoraWeeklyTrend {
  week: string;
  deploymentFrequency: number;
  leadTimeHours: number;
  changeFailureRate: number;
  mttrHours: number;
}

export type DetectionMode = "hybrid" | "lease-only" | "stage-only";

/**
 * A pipeline removed from the analysis entirely.
 *
 * The motivating case: a scheduled redeploy pipeline that fails constantly for
 * reasons unrelated to delivery quality. Left in, it dominates change failure
 * rate and MTTR and makes every other number meaningless.
 *
 * The name is stored alongside the id purely so the exclusion list is readable
 * without a round trip; the id is what actually matches.
 */
export interface ExcludedPipeline {
  definitionId: number;
  name: string;
}

export function isPipelineExcluded(
  excluded: ExcludedPipeline[] | undefined,
  definitionId: number
): boolean {
  return (excluded ?? []).some((entry) => entry.definitionId === definitionId);
}

export function excludePipeline(
  excluded: ExcludedPipeline[] | undefined,
  pipeline: ExcludedPipeline
): ExcludedPipeline[] {
  const current = excluded ?? [];
  if (current.some((e) => e.definitionId === pipeline.definitionId)) return current;
  return [...current, pipeline].sort((a, b) => a.name.localeCompare(b.name));
}

export function includePipeline(
  excluded: ExcludedPipeline[] | undefined,
  definitionId: number
): ExcludedPipeline[] {
  return (excluded ?? []).filter((entry) => entry.definitionId !== definitionId);
}

export interface ProductionSettings {
  /**
   * hybrid     — leases prove successes, stage names fill the gaps (recommended)
   * lease-only — only builds carrying a lease count as production
   * stage-only — ignore leases entirely (legacy behaviour)
   */
  detectionMode: DetectionMode;
  /** Must match the pipeline's retention-lease ownerId EXACTLY (server match is case-sensitive). */
  leaseOwnerId: string;
  /** Environment label applied to lease-proven records with no matching stage. */
  productionEnvironmentLabel: string;
}

export interface AnalysisDiagnostics {
  buildsScanned: number;
  definitionsScanned: number;
  leasesFound: number;
  leaseOwnerId: string;
  leaseQueryFailed: boolean;
  oldestLeaseCreatedOn: Date | null;
  /** Leases whose runId was not in the analysed build window — never emitted as records. */
  orphanLeases: number;
  prodFromLease: number;
  prodFromStageOnly: number;
  prodFailuresFromTimeline: number;
  /** Stage-named prod deployments discarded because detectionMode is lease-only. */
  suppressedStageProd: number;
  /** Repeated stage attempts collapsed to their latest attempt. */
  retriesCollapsed: number;
  timelineFetchFailures: number;
  /** Pipelines skipped entirely because they are on the exclusion list. */
  pipelinesExcluded: number;
  /**
   * Stages that finished without attempting a deployment — skipped, cancelled, a
   * timed-out approval gate, or parked awaiting a human. Neither successes nor
   * failures; reported so the absence is visible.
   */
  stagesNotAttempted: number;
  detectionMode: DetectionMode;
  /** Repositories the branch-flow phase queried — two requests each, not one per commit. */
  branchFlowRepositories?: number;
  /** Repositories whose refs were read to prove whether an integration branch exists. */
  branchFlowProbes?: number;
  /** Repositories whose pull-request query failed, so their hops read as unknown. */
  branchFlowQueryFailures?: number;
  /** Wall-clock of the analysis, milliseconds. */
  durationMs: number;
}

/* ── branch flow ─────────────────────────────────────────────────────────────
   How long a change spends on each branch on its way to production, e.g.
   feature -> develop -> main -> deployed. */

/**
 * Whether a hop happened, did not exist, or could not be determined.
 *
 * "absent" is a POSITIVE finding: the repository was asked for its refs and has
 * no integration branch, so there is genuinely no hop to measure. It must never
 * be conflated with "unknown", and neither may be recorded as zero hours —
 * a zero would drag the mean down and read as "this hop is instant".
 */
export type HopStatus = "measured" | "absent" | "unknown";

/** Why a delivery contributed no branch-flow sample. Never collapsed into one count. */
export type BranchFlowGap =
  | "not-git-repo"
  | "no-commits"
  | "no-pull-request"
  | "query-failed"
  | "unknown-integration";

/** Ordered regex over a full ref name (`refs/heads/develop`), same idiom as EnvironmentPattern. */
export interface BranchPattern {
  id?: string;
  regex: string;
  order: number;
  /** Undefined counts as enabled — settings stored before the flag keep working. */
  enabled?: boolean;
}

export const DEFAULT_INTEGRATION_PATTERNS: BranchPattern[] = [
  { id: "develop", regex: "^refs/heads/(develop|development|dev)$", order: 1 },
  { id: "integration", regex: "^refs/heads/(integration|next|staging)$", order: 2 },
];

export interface BranchFlowSettings {
  enabled: boolean;
  /** Which branches count as the integration hop. Empty means "no integration branch". */
  integrationPatterns: BranchPattern[];
}

export const DEFAULT_BRANCH_FLOW_SETTINGS: BranchFlowSettings = {
  enabled: true,
  integrationPatterns: DEFAULT_INTEGRATION_PATTERNS,
};

export function enabledBranchPatterns(patterns: BranchPattern[]): BranchPattern[] {
  return patterns.filter((p) => p.enabled !== false).sort((a, b) => a.order - b.order);
}

/** True when a full ref name matches any enabled pattern. */
export function isIntegrationBranch(refName: string, patterns: BranchPattern[]): boolean {
  for (const pattern of enabledBranchPatterns(patterns)) {
    try {
      if (new RegExp(pattern.regex, "i").test(refName)) return true;
    } catch {
      // An invalid user regex must not take the analysis down with it.
    }
  }
  return false;
}

/** The resolved journey for one production delivery. */
export interface BranchFlow {
  /**
   * When the change started. Either the commit's own timestamp, or — when the
   * commit that reached production is a squash/merge artefact whose original
   * SHA no longer exists — the moment its pull request was opened.
   */
  originTime: Date | null;
  originSource: "commit" | "pull-request" | null;
  /** Merged into the integration branch. */
  integrationTime: Date | null;
  integrationBranch: string | null;
  integrationStatus: HopStatus;
  /** Merged into the branch the pipeline actually built (main, a release branch, …). */
  releaseTime: Date | null;
  releaseBranch: string | null;
  releaseStatus: HopStatus;
  /** Set when the chain is incomplete, naming which link failed. */
  gap: BranchFlowGap | null;
}

/**
 * The branch journey, averaged over the deliveries whose chain fully resolved.
 *
 * Its own cohort and its own denominator, deliberately. Most projects have some
 * deliveries that came from a direct push or a repository with no pull requests,
 * and folding those in as zeros would understate every hop.
 */
export interface BranchFlowSegments {
  /** Change started → merged into the integration branch (or straight to the built branch). */
  codeHours: number;
  /** Sat on the integration branch → merged into the branch the pipeline built. */
  integrationHours: number;
  /** On the built branch → the pipeline run starting. */
  releaseHours: number;
  /** Sum of the three. */
  totalHours: number;
  /** Deliveries with a fully resolved chain. The denominator for the three spans. */
  sampleSize: number;
  /** How many of those actually travelled through an integration branch. */
  viaIntegration: number;
  /** Proven to have no integration branch, so the middle hop is genuinely absent. */
  noIntegrationBranch: number;
  /** How many samples measured from a pull request because the original commit was squashed away. */
  originFromPullRequest: number;
  /** Everything that could not be measured, kept apart so the dominant cause is visible. */
  gaps: Record<BranchFlowGap, number>;
}

/**
 * Commit-to-production, split into three MEASURED spans. Every number is a
 * difference between two real timestamps — there are no estimated ratios here.
 *
 *   firstCommit ──preBuild──> buildStart ──pipeline──> deployStart ──deploy──> deployFinish
 */
export interface LeadTimeSegments {
  /** Oldest commit in the build → the pipeline run starting. Code written and waiting. */
  preBuildHours: number;
  /** Pipeline start → the production stage starting. Build, upstream stages, approval waits. */
  pipelineHours: number;
  /** The production stage itself, start → finish. */
  deployHours: number;
  /** Sum of the three, i.e. mean commit-to-production. */
  totalHours: number;
  /** How many production deployments carried enough timestamps to be measured. */
  sampleSize: number;
  /** Production deployments excluded because no commit could be resolved. */
  excluded: number;
  /** The same pre-build span, decomposed by branch. Its own cohort — see BranchFlowSegments. */
  branchFlow: BranchFlowSegments;
}

export interface DeliveryInsightsData {
  dora: DoraMetrics;
  trends: DoraWeeklyTrend[];
  environmentMatrix: EnvironmentStatus[];
  deployments: DeploymentRecord[];
  leadTimeBreakdown: LeadTimeSegments;
  diagnostics?: AnalysisDiagnostics;
}

export interface DeliverySettings {
  environmentPatterns: EnvironmentPattern[];
  timePeriodDays: number;
  doraBands: {
    deploymentFrequency: { elite: number; high: number; medium: number };
    leadTime: { elite: number; high: number; medium: number };
    changeFailureRate: { elite: number; high: number; medium: number };
    mttr: { elite: number; high: number; medium: number };
  };
  production: ProductionSettings;
  /** Pipelines removed from the analysis entirely — never scanned, never counted. */
  excludedPipelines: ExcludedPipeline[];
  /** How a change's branch journey is traced. */
  branchFlow: BranchFlowSettings;
}

/** Defined once in the shared theme module; re-exported here so existing imports keep working. */
export type { ThemeMode } from "../utils/theme";
import type { ThemeMode } from "../utils/theme";

export interface UiPreferences {
  themeMode: ThemeMode;
}

/**
 * Default swatches. These are rendered as small colour chips next to a
 * token-coloured label — never as text on a page background, which is why they
 * can stay vivid without failing contrast.
 */
export const DEFAULT_ENVIRONMENT_PATTERNS: EnvironmentPattern[] = [
  {
    id: "env-development",
    name: "Development",
    regex: "(?<![a-zA-Z])dev(?:elop(?:ment)?)?(?![a-zA-Z])",
    order: 1,
    color: "#4caf50",
  },
  {
    id: "env-qa",
    name: "QA",
    regex: "(?<![a-zA-Z])(?:qa|test(?:ing)?)(?![a-zA-Z])",
    order: 2,
    color: "#ff9800",
  },
  {
    id: "env-staging",
    name: "Staging",
    regex: "(?<![a-zA-Z])(?:stag(?:ing|e)|stg|uat|pre-?prod)(?![a-zA-Z])",
    order: 3,
    color: "#2196f3",
  },
  {
    id: "env-production",
    name: "Production",
    // `prd` is included deliberately: it is a very common stage-name abbreviation
    // (Deploy_PRD) and without it a production stage matches nothing, so
    // stage-name detection silently sees no production at all. The surrounding
    // letter guards keep it from firing inside longer words.
    regex:
      "(?<![a-zA-Z])(?:deploy(?:\\s+to)?\\s+)?(?:prod(?:uction)?|prd(?:01)?|live|release)(?![a-zA-Z])",
    order: 4,
    color: "#f44336",
  },
];

export const DEFAULT_DORA_BANDS = {
  deploymentFrequency: { elite: 7, high: 1, medium: 0.25 },
  leadTime: { elite: 24, high: 168, medium: 720 },
  changeFailureRate: { elite: 5, high: 10, medium: 30 },
  mttr: { elite: 1, high: 24, medium: 168 },
};

export const DEFAULT_PRODUCTION_SETTINGS: ProductionSettings = {
  detectionMode: "hybrid",
  leaseOwnerId: "Released to PRD",
  productionEnvironmentLabel: "Production",
};

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  environmentPatterns: DEFAULT_ENVIRONMENT_PATTERNS,
  timePeriodDays: 90,
  doraBands: DEFAULT_DORA_BANDS,
  production: DEFAULT_PRODUCTION_SETTINGS,
  excludedPipelines: [],
  branchFlow: DEFAULT_BRANCH_FLOW_SETTINGS,
};

/**
 * Matches the ENVIRONMENT NAMES the app treats as production.
 *
 * Distinct from an environment's stage-matching regex: this decides which
 * configured environments count as production for DORA, for the production-only
 * scope, and for the lease-proven fallback label. `prd` is included for the same
 * reason it is in the default stage pattern — it is a very common abbreviation,
 * and an environment renamed to "PRD" would otherwise stop counting as
 * production with no visible sign.
 *
 * `release` is deliberately NOT here even though it is in the default stage
 * pattern: a STAGE called "Release" usually means deploying, but an ENVIRONMENT
 * called "Release" is more often a release-candidate tier, not production.
 */
export const PRODUCTION_NAME_PATTERN = /prod|production|prd|live/i;
