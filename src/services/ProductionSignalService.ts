/**
 * "Released to PRD" build retention leases — the authoritative production signal.
 *
 * Pipelines tag a production release by POSTing a retention lease with a well-known
 * ownerId (the snippet is in the README). One client call retrieves every
 * such lease for the project:
 *
 *   getRetentionLeasesByOwnerId(project, ownerId?, definitionId?, runId?): Promise<RetentionLease[]>
 *
 * RetentionLease is FLAT — { createdOn, definitionId, leaseId, ownerId, protectPipeline,
 * runId, validUntil } — and `runId` IS the build id, so it joins directly to Build.id.
 * createdOn / validUntil arrive as real Date objects.
 *
 * TWO LIMITATIONS, both surfaced in the UI rather than buried:
 *  1. Leases expire. The sample YAML retains for 1000 days, so releases older than
 *     roughly 2.7 years have been garbage-collected and are invisible here.
 *  2. This endpoint exposes no continuation token (unlike getBuilds it never reads
 *     x-ms-continuationtoken), so server-side truncation cannot be detected. We
 *     return the raw count so the diagnostics strip can be sanity-checked against
 *     expectations. If truncation is ever observed, definitionId is the only paging
 *     axis this endpoint offers.
 */
import { getClient } from "azure-devops-extension-api";

export interface PrdRelease {
  buildId: number;
  definitionId: number;
  releasedOn: Date;
  validUntil: Date | null;
  leaseId: number;
}

export interface PrdLeaseResult {
  byBuildId: Map<number, PrdRelease>;
  /** Raw lease count returned by the server, before de-duplication by runId. */
  total: number;
  oldestReleasedOn: Date | null;
  failed: boolean;
}

const EMPTY: PrdLeaseResult = {
  byBuildId: new Map(),
  total: 0,
  oldestReleasedOn: null,
  failed: false,
};

const MEMO_TTL_MS = 30_000;
const memo = new Map<string, { expires: number; value: PrdLeaseResult }>();

/** Test hook — clears the session memo. */
export function __clearLeaseMemo(): void {
  memo.clear();
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Collapse to one release per build, keeping the EARLIEST createdOn — a build
 * re-leased later (for example by a retention sweep) was still delivered the first time.
 */
export function indexLeases(leases: unknown[]): PrdLeaseResult {
  const byBuildId = new Map<number, PrdRelease>();
  let oldest: Date | null = null;

  for (const raw of leases) {
    const lease = raw as {
      runId?: number;
      definitionId?: number;
      createdOn?: unknown;
      validUntil?: unknown;
      leaseId?: number;
    };
    const buildId = lease?.runId;
    const releasedOn = toDate(lease?.createdOn);
    if (typeof buildId !== "number" || !releasedOn) continue;

    const release: PrdRelease = {
      buildId,
      definitionId: typeof lease.definitionId === "number" ? lease.definitionId : -1,
      releasedOn,
      validUntil: toDate(lease?.validUntil),
      leaseId: typeof lease.leaseId === "number" ? lease.leaseId : -1,
    };

    const existing = byBuildId.get(buildId);
    if (!existing || release.releasedOn.getTime() < existing.releasedOn.getTime()) {
      byBuildId.set(buildId, release);
    }
    if (!oldest || release.releasedOn.getTime() < oldest.getTime()) oldest = release.releasedOn;
  }

  return { byBuildId, total: leases.length, oldestReleasedOn: oldest, failed: false };
}

export async function fetchPrdReleases(
  project: string,
  ownerId: string,
  signal?: AbortSignal
): Promise<PrdLeaseResult> {
  if (!ownerId.trim()) return { ...EMPTY, byBuildId: new Map() };

  const key = `${project}|${ownerId}`;
  const cached = memo.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    const buildModule = await import(
      /* webpackChunkName: "ado-build" */ "azure-devops-extension-api/Build"
    );
    if (signal?.aborted) throw new Error("Cancelled");

    const client = getClient(buildModule.BuildRestClient) as unknown as {
      getRetentionLeasesByOwnerId(
        project: string,
        ownerId?: string,
        definitionId?: number,
        runId?: number
      ): Promise<unknown[]>;
    };

    const leases = (await client.getRetentionLeasesByOwnerId(project, ownerId)) ?? [];
    const result = indexLeases(leases);
    memo.set(key, { expires: Date.now() + MEMO_TTL_MS, value: result });
    return result;
  } catch (err) {
    if ((err as Error)?.message === "Cancelled") throw err;
    // Degrade rather than fail the whole analysis — the caller falls back to stage names.
    return { byBuildId: new Map(), total: 0, oldestReleasedOn: null, failed: true };
  }
}
