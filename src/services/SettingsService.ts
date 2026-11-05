import { BaseDataService, PRIVATE, SHARED } from "./BaseDataService";
import {
  DeliverySettings,
  DeliveryInsightsData,
  DeploymentRecord,
  UiPreferences,
  DEFAULT_DELIVERY_SETTINGS,
  DEFAULT_PRODUCTION_SETTINGS,
  DEFAULT_BRANCH_FLOW_SETTINGS,
  EnvironmentPattern,
} from "../models/interfaces";

/**
 * A cached branch flow round-trips through JSON, so its three Dates arrive as
 * strings. Rebuilt field by field rather than spread, so a future field cannot
 * be forgotten silently.
 */
function rehydrateBranchFlow(flow: any): DeploymentRecord["branchFlow"] {
  if (!flow || typeof flow !== "object") return null;
  return {
    originTime: toDateOrNull(flow.originTime),
    originSource: flow.originSource ?? null,
    integrationTime: toDateOrNull(flow.integrationTime),
    integrationBranch: flow.integrationBranch ?? null,
    integrationStatus: flow.integrationStatus ?? "unknown",
    releaseTime: toDateOrNull(flow.releaseTime),
    releaseBranch: flow.releaseBranch ?? null,
    releaseStatus: flow.releaseStatus ?? "unknown",
    gap: flow.gap ?? null,
  };
}

const SETTINGS_COLLECTION = "delivery-insights-settings";
const CACHE_COLLECTION = "delivery-insights-cache";
const PREFS_COLLECTION = "delivery-insights-prefs";

/**
 * Legacy id from before documents were partitioned by project. Settings are
 * migrated forward once; the analysis cache deliberately is NOT, because the old
 * document is shared across every project in the organisation and would show one
 * project another project's deployments. It simply regenerates on the next run.
 */
const LEGACY_SETTINGS_ID = "settings";

const PREFS_DOC_ID = "ui";

/**
 * Extension data has no project scope and the REST route carries no project
 * segment, so the project id is encoded in the document id. Without this, two
 * projects in the same organisation silently overwrite each other's settings.
 */
const settingsDocId = (projectId: string) => `settings.${projectId}`;
const cacheDocId = (projectId: string) => `analysis.${projectId}`;

/** Conservative ceiling for the cached analysis blob. No server limit is documented. */
const MAX_CACHE_CHARS = 900_000;

export interface CachedAnalysis {
  id?: string;
  timestamp: number;
  timePeriodDays: number;
  data: DeliveryInsightsData;
  truncated?: boolean;
  /**
   * The settings this analysis was produced with. Without it, a restored cache
   * cannot be compared against the settings now in force, so the dashboard
   * cannot tell you the numbers are answering an older question. Optional
   * because snapshots written before this existed do not carry it.
   */
  settings?: DeliverySettings;
}

/**
 * How much to trust what came back from storage.
 *
 * "absent" and "unavailable" both hand back defaults, and conflating them is how
 * a saved configuration gets destroyed: a transient read failure looks exactly
 * like a fresh install, and the next save writes the empty defaults over the
 * real document. Excluded pipelines vanishing after a reload is that bug.
 */
export type SettingsLoadStatus = "stored" | "absent" | "unavailable";

export interface SettingsSnapshot {
  settings: DeliverySettings;
  status: SettingsLoadStatus;
}

function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ensurePatternIds(patterns: EnvironmentPattern[]): EnvironmentPattern[] {
  return patterns.map((pattern, index) => ({
    ...pattern,
    id: pattern.id ?? `env-${index}-${pattern.name.toLowerCase().replace(/\W+/g, "-")}`,
  }));
}

export class SettingsService extends BaseDataService {
  /**
   * Read the stored settings, saying whether they were actually read.
   *
   * getDocumentOrNull, NOT getDocumentOrDefault: the latter swallows every
   * failure and returns the fallback, so an expired token or a throttled request
   * came back as "no settings exist". The caller then saved the defaults over a
   * real document and the user's excluded pipelines were gone for good.
   */
  async loadSettings(projectId: string): Promise<SettingsSnapshot> {
    let doc: any;
    try {
      doc = await this.getDocumentOrNull<any>(
        SETTINGS_COLLECTION,
        settingsDocId(projectId),
        SHARED
      );
    } catch {
      return { settings: { ...DEFAULT_DELIVERY_SETTINGS }, status: "unavailable" };
    }

    // One-time migration from the unpartitioned document.
    if (!doc) {
      let legacy: any = null;
      try {
        legacy = await this.getDocumentOrNull<any>(SETTINGS_COLLECTION, LEGACY_SETTINGS_ID, SHARED);
      } catch {
        // The per-project document genuinely did not exist, but we cannot see
        // whether a legacy one does. Migrating on the next successful load is
        // fine; overwriting either document right now is not.
        return { settings: { ...DEFAULT_DELIVERY_SETTINGS }, status: "unavailable" };
      }
      if (legacy) {
        doc = { ...legacy, migratedFrom: LEGACY_SETTINGS_ID };
        try {
          await this.setDocument(
            SETTINGS_COLLECTION,
            { ...doc, id: settingsDocId(projectId) },
            SHARED
          );
        } catch {
          /* migration is best effort */
        }
      }
    }

    if (!doc) return { settings: { ...DEFAULT_DELIVERY_SETTINGS }, status: "absent" };

    const settings: DeliverySettings = {
      environmentPatterns: ensurePatternIds(
        doc.environmentPatterns ?? DEFAULT_DELIVERY_SETTINGS.environmentPatterns
      ),
      timePeriodDays: doc.timePeriodDays ?? DEFAULT_DELIVERY_SETTINGS.timePeriodDays,
      doraBands: doc.doraBands ?? DEFAULT_DELIVERY_SETTINGS.doraBands,
      production: { ...DEFAULT_PRODUCTION_SETTINGS, ...(doc.production ?? {}) },
      excludedPipelines: doc.excludedPipelines ?? [],
      // Merged rather than replaced so a settings document written before branch
      // flow existed still gets the default patterns instead of an empty list,
      // which would silently report every repository as having no develop branch.
      branchFlow: {
        ...DEFAULT_BRANCH_FLOW_SETTINGS,
        ...(doc.branchFlow ?? {}),
        integrationPatterns:
          doc.branchFlow?.integrationPatterns ?? DEFAULT_BRANCH_FLOW_SETTINGS.integrationPatterns,
      },
    };

    return { settings, status: "stored" };
  }

  async saveSettings(projectId: string, settings: DeliverySettings): Promise<void> {
    await this.setDocument(
      SETTINGS_COLLECTION,
      { id: settingsDocId(projectId), ...settings },
      SHARED
    );
  }

  /** Theme choice is genuinely per-user — the one place the private scope is correct. */
  async loadUiPrefs(): Promise<UiPreferences> {
    const doc = await this.getDocumentOrDefault<any>(PREFS_COLLECTION, PREFS_DOC_ID, null, PRIVATE);
    const mode = doc?.themeMode;
    // "system" is the legacy value for following the host; it now reads as "ado".
    return { themeMode: mode === "light" || mode === "dark" ? mode : "ado" };
  }

  async saveUiPrefs(prefs: UiPreferences): Promise<void> {
    try {
      await this.setDocument(PREFS_COLLECTION, { id: PREFS_DOC_ID, ...prefs }, PRIVATE);
    } catch {
      /* a theme preference is not worth surfacing an error for */
    }
  }

  /**
   * Rehydrate the cached analysis.
   *
   * Records whose start or finish time cannot be parsed are DROPPED rather than
   * kept as Invalid Dates — a NaN timestamp propagates silently into every chart
   * axis and renders "NaNd ago" without ever throwing.
   */
  async loadCache(projectId: string): Promise<CachedAnalysis | null> {
    let cached: CachedAnalysis | null = null;
    try {
      cached = await this.getDocumentOrNull<CachedAnalysis>(
        CACHE_COLLECTION,
        cacheDocId(projectId),
        SHARED
      );
    } catch {
      return null;
    }

    if (!cached?.data) return null;

    try {
      const rehydrated: DeploymentRecord[] = [];
      let dropped = 0;

      for (const record of cached.data.deployments ?? []) {
        const startTime = toDateOrNull(record.startTime);
        const finishTime = toDateOrNull(record.finishTime);
        if (!startTime || !finishTime) {
          dropped++;
          continue;
        }
        rehydrated.push({
          ...record,
          startTime,
          finishTime,
          firstCommitTime: toDateOrNull(record.firstCommitTime),
          buildStartTime: toDateOrNull(record.buildStartTime),
          releasedToPrdAt: toDateOrNull(record.releasedToPrdAt),
          // Every Date on the record has to be named here. A field left out
          // comes back from storage as a STRING, and .getTime() on a string
          // throws — which is why this list is not a spread.
          branchFlow: rehydrateBranchFlow(record.branchFlow),
          isProduction: Boolean(record.isProduction),
          prodSource: record.prodSource ?? null,
          prodUnverified: Boolean(record.prodUnverified),
          hadFailedProdStage: Boolean(record.hadFailedProdStage),
          stageNames: record.stageNames ?? [],
        });
      }

      if (dropped > 0) {
        console.warn(`Delivery Insights: dropped ${dropped} cached records with unusable dates.`);
      }

      cached.data.deployments = rehydrated;

      // Re-point the matrix at the rehydrated records so object identity matches the
      // live path (the cache round trip otherwise produces detached duplicates).
      const byKey = new Map(rehydrated.map((r) => [`${r.buildId}|${r.environment}`, r]));
      for (const row of cached.data.environmentMatrix ?? []) {
        for (const env of row.environments ?? []) {
          const last = env.lastDeployment;
          if (!last) continue;
          env.lastDeployment = byKey.get(`${last.buildId}|${last.environment}`) ?? null;
        }
      }

      const diagnostics = cached.data.diagnostics;
      if (diagnostics) {
        diagnostics.oldestLeaseCreatedOn = toDateOrNull(diagnostics.oldestLeaseCreatedOn);
      }

      return cached;
    } catch (err) {
      console.warn("Delivery Insights: cached analysis could not be rehydrated.", err);
      return null;
    }
  }

  /**
   * Persist the analysis. Failures are non-fatal but no longer silent — the caller
   * gets `truncated` so the UI can say the cache was capped.
   */
  async saveCache(
    projectId: string,
    data: DeliveryInsightsData,
    timePeriodDays: number,
    settings?: DeliverySettings
  ): Promise<{ saved: boolean; truncated: boolean }> {
    let payload: DeliveryInsightsData = {
      ...data,
      // commitIds is write-only dead payload — never persist it.
      deployments: data.deployments.map(({ commitIds: _commitIds, ...rest }) => rest),
    };
    let truncated = false;

    if (JSON.stringify(payload).length > MAX_CACHE_CHARS) {
      truncated = true;
      const keep = Math.max(200, Math.floor(payload.deployments.length / 2));
      payload = {
        ...payload,
        deployments: payload.deployments.slice(-keep),
      };
    }

    try {
      await this.setDocument(
        CACHE_COLLECTION,
        {
          id: cacheDocId(projectId),
          timestamp: Date.now(),
          timePeriodDays,
          truncated,
          settings,
          data: payload,
        },
        SHARED
      );
      return { saved: true, truncated };
    } catch (err) {
      console.warn("Delivery Insights: analysis cache could not be saved.", err);
      return { saved: false, truncated };
    }
  }
}
