import * as React from "react";
import {
  DeliverySettings,
  DeliveryInsightsData,
  DEFAULT_DELIVERY_SETTINGS,
  enabledPatterns,
  isProductionPattern,
  isProductionOnly,
  applyEnvironmentScope,
  EnvironmentScope,
  excludePipeline,
  isPipelineExcluded,
} from "../models/interfaces";
import {
  fetchDeployments,
  buildEnvironmentMatrix,
  fetchPipelineDirectory,
  PipelineSummary,
} from "../services/DeploymentService";
import { calculateAllDora, computeWeeklyTrends } from "../services/DoraCalculator";
import { computeLeadTimeBreakdown } from "../services/LeadTimeBreakdown";
import { SettingsService, SettingsLoadStatus } from "../services/SettingsService";
import { describeStaleness } from "../services/analysisStaleness";
import { formatTimeAgo, useNow } from "../utils/theme";
import { BRAND, BrandGlyph } from "../brand";
import { useAccess } from "./AccessGate";
import { AdminPanel } from "./AdminPanel";
import { DiagnosticsStrip } from "./DiagnosticsStrip";
import { DoraScorecard } from "./DoraScorecard";
import { DoraTrendChart } from "./DoraTrendChart";
import { DeploymentTimeline } from "./DeploymentTimeline";
import { EnvironmentMatrix } from "./EnvironmentMatrix";
import { FailedDeployments } from "./FailedDeployments";
import { LeadTimeBreakdown } from "./LeadTimeBreakdown";
import { ProductionDeliveries } from "./ProductionDeliveries";
import { SettingsPanel } from "./SettingsPanel";
import {
  AppShell,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorBoundary,
  IconRefresh,
  IconSettings,
  IconUsers,
  Progress,
  Skeleton,
} from "./ui";

const settingsService = new SettingsService();

const TIME_RANGES = [
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 180, label: "180d" },
  { days: 365, label: "1y" },
];

const MetricSkeletons: React.FC = () => (
  <div className="ax-metrics" aria-hidden="true">
    {[0, 1, 2, 3].map((i) => (
      <div className="ax-metric" key={i}>
        <Skeleton style={{ width: "55%" }} />
        <Skeleton variant="value" />
        <Skeleton variant="pill" />
      </div>
    ))}
  </div>
);

const AppInner: React.FC = () => {
  const { projectId, projectName, isAdmin } = useAccess();
  const now = useNow();

  const [settings, setSettings] = React.useState<DeliverySettings>(DEFAULT_DELIVERY_SETTINGS);
  const [settingsLoading, setSettingsLoading] = React.useState(true);
  const [showSettings, setShowSettings] = React.useState(false);
  const [showAccess, setShowAccess] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<DeliveryInsightsData | null>(null);
  const [cacheTimestamp, setCacheTimestamp] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  /**
   * Whether the stored settings were actually read. "unavailable" means the read
   * failed, NOT that none exist — and saving over them in that state is what
   * destroyed people's excluded pipelines.
   */
  const [settingsStatus, setSettingsStatus] = React.useState<SettingsLoadStatus>("stored");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  /** The settings the data on screen was produced with, for the staleness check. */
  const [analysedSettings, setAnalysedSettings] = React.useState<DeliverySettings | null>(null);
  const [progress, setProgress] = React.useState<{
    phase: string;
    current: number;
    total: number;
  } | null>(null);

  const abortRef = React.useRef<AbortController | null>(null);
  // Guards against a slow first run landing after a second run has started.
  const runIdRef = React.useRef(0);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      settingsService
        .loadSettings(projectId)
        .catch(() => ({ settings: DEFAULT_DELIVERY_SETTINGS, status: "unavailable" as const })),
      settingsService.loadCache(projectId).catch(() => null),
    ]).then(([snapshot, cached]) => {
      if (cancelled) return;
      setSettings(snapshot.settings);
      setSettingsStatus(snapshot.status);
      // The cache is restored whatever window it covers. Discarding it on a
      // period mismatch threw away a finished analysis and left an empty
      // dashboard; it is shown with the mismatch stated instead.
      if (cached?.data) {
        setData(cached.data);
        setCacheTimestamp(cached.timestamp);
        setAnalysedSettings(
          cached.settings ?? { ...snapshot.settings, timePeriodDays: cached.timePeriodDays }
        );
      }
      setSettingsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const runAnalysis = React.useCallback(
    async (activeSettings: DeliverySettings) => {
      if (abortRef.current) abortRef.current.abort();

      const runId = ++runIdRef.current;
      const abort = new AbortController();
      abortRef.current = abort;

      setLoading(true);
      setError(null);
      setNotice(null);
      setProgress({ phase: "Starting…", current: 0, total: 0 });

      try {
        const { deployments, diagnostics } = await fetchDeployments(
          projectName,
          activeSettings,
          (phase, current, total) => {
            if (runIdRef.current === runId) setProgress({ phase, current, total });
          },
          abort.signal
        );

        if (runIdRef.current !== runId) return;

        if (deployments.length === 0) {
          setError(
            `No deployments found in the last ${activeSettings.timePeriodDays} days. Check that the retention lease owner id matches what your pipelines write, or that your stage names match the environment patterns. Both are in Settings.`
          );
          setProgress(null);
          return;
        }

        const prodDeployments = deployments.filter((d) => d.isProduction);
        const insights: DeliveryInsightsData = {
          dora: calculateAllDora(
            deployments,
            prodDeployments,
            activeSettings.timePeriodDays,
            activeSettings.doraBands
          ),
          trends: computeWeeklyTrends(prodDeployments),
          environmentMatrix: buildEnvironmentMatrix(
            deployments,
            activeSettings.environmentPatterns
          ),
          deployments,
          // Commit-to-PRODUCTION: only production deliveries are samples of it.
          leadTimeBreakdown: computeLeadTimeBreakdown(prodDeployments),
          diagnostics,
        };

        setData(insights);
        setCacheTimestamp(Date.now());
        setAnalysedSettings(activeSettings);

        const cacheResult = await settingsService.saveCache(
          projectId,
          insights,
          activeSettings.timePeriodDays,
          activeSettings
        );
        if (runIdRef.current === runId && cacheResult.truncated) {
          setNotice(
            "The saved snapshot was trimmed to fit the storage limit. The dashboard above is complete; only the cached copy is shortened."
          );
        }
      } catch (err) {
        if (runIdRef.current !== runId) return;
        const message = (err as Error)?.message ?? String(err);
        if (message === "Cancelled") {
          setNotice("Analysis stopped. Requests already in flight will finish in the background.");
        } else {
          setError(`Analysis failed: ${message}`);
          console.error("Delivery Insights analysis failed:", err);
        }
      } finally {
        if (runIdRef.current === runId) {
          setLoading(false);
          setProgress(null);
          abortRef.current = null;
        }
      }
    },
    [projectId, projectName]
  );

  /**
   * The only way settings are written.
   *
   * Two things every previous call site got wrong. It refuses to write when the
   * stored document could not be READ — otherwise a transient failure loads the
   * defaults and the next save persists them over a real configuration, which is
   * exactly how excluded pipelines disappeared. And it surfaces a failed write
   * instead of console.warn-ing it, because a silent failure means the exclusion
   * you just made is gone the moment you reload and nothing said so.
   */
  const persistSettings = React.useCallback(
    async (next: DeliverySettings) => {
      if (settingsStatus === "unavailable") {
        setSaveError(
          "Your saved settings could not be read, so nothing will be written over them. Reload the page and try again."
        );
        return false;
      }
      setSettings(next);
      setSaveError(null);
      try {
        await settingsService.saveSettings(projectId, next);
        // A successful write proves the document exists and is reachable.
        setSettingsStatus("stored");
        return true;
      } catch (err) {
        setSaveError(
          `Your settings could not be saved (${(err as Error)?.message ?? "unknown error"}). They apply to this page but will be lost when you reload.`
        );
        return false;
      }
    },
    [projectId, settingsStatus]
  );

  const handleAnalyse = React.useCallback(() => {
    if (loading) return;
    void runAnalysis(settings);
  }, [loading, runAnalysis, settings]);

  const handleCancel = React.useCallback(() => abortRef.current?.abort(), []);

  // Saving settings no longer starts an analysis. A full scan is minutes of API
  // calls, and throwing away a finished one every time a setting moves is both
  // slow and disorienting. The previous result stays on screen, labelled with
  // what has changed since, until Re-analyse is pressed.
  const handleSaveSettings = React.useCallback(
    async (next: DeliverySettings) => {
      setShowSettings(false);
      await persistSettings(next);
    },
    [persistSettings]
  );

  const handleRangeChange = React.useCallback(
    (days: number) => {
      if (days === settings.timePeriodDays) return;
      void persistSettings({ ...settings, timePeriodDays: days });
    },
    [persistSettings, settings]
  );

  /**
   * Why the numbers on screen no longer match the settings, if they do not.
   * Named rather than a bare "stale" flag: "the time range changed to 90 days"
   * tells you what to do, "out of date" does not.
   */
  const staleReason = React.useMemo(
    () => (data ? describeStaleness(analysedSettings, settings) : null),
    [data, analysedSettings, settings]
  );

  const busy = loading || settingsLoading;
  const showSkeletons = busy && !data;

  const visiblePatterns = React.useMemo(
    () => enabledPatterns(settings.environmentPatterns),
    [settings.environmentPatterns]
  );

  const hasProductionPattern = settings.environmentPatterns.some(isProductionPattern);
  const productionOnly = isProductionOnly(settings.environmentPatterns);

  /**
   * Narrowing to production filters the data already on screen instantly, because
   * production records are always retained. Widening needs a fresh analysis: the
   * excluded environments were never scanned, so their records are simply not in
   * the current result set — describeStaleness detects that and asks for one,
   * rather than starting a multi-minute scan the moment a filter is touched.
   */
  const handleEnvironmentScope = React.useCallback(
    (scope: EnvironmentScope) => {
      void persistSettings({
        ...settings,
        environmentPatterns: applyEnvironmentScope(settings.environmentPatterns, scope),
      });
    },
    [persistSettings, settings]
  );

  // A cached analysis predates the current filter, so drop records for
  // environments that are no longer included. Production records are always kept
  // — they are the point of the dashboard, and a lease-proven delivery can carry
  // a label that is not itself one of the configured patterns.
  const visibleDeployments = React.useMemo(() => {
    if (!data) return [];
    const included = new Set(visiblePatterns.map((p) => p.name));
    return data.deployments.filter(
      (d) =>
        !isPipelineExcluded(settings.excludedPipelines, d.definitionId) &&
        (d.isProduction || included.has(d.environment))
    );
  }, [data, visiblePatterns, settings.excludedPipelines]);

  const visibleMatrix = React.useMemo(
    () =>
      (data?.environmentMatrix ?? []).filter(
        (row) => !isPipelineExcluded(settings.excludedPipelines, row.definitionId)
      ),
    [data, settings.excludedPipelines]
  );

  /**
   * Excluding only ever removes, so the dashboard can update immediately from the
   * data already loaded; the next analysis then skips the pipeline entirely.
   * Re-including is done from Settings, which does trigger a re-analysis.
   */
  /**
   * Pipelines visible in the current analysis, so the exclusion picker in
   * Settings has something to show on its first frame. Not sufficient on its
   * own: a pipeline that has never produced a deployment record is absent here,
   * and that is precisely the pipeline someone wants to exclude.
   */
  const knownPipelines = React.useMemo<PipelineSummary[]>(() => {
    const byId = new Map<number, string>();
    for (const deployment of data?.deployments ?? []) {
      byId.set(deployment.definitionId, deployment.pipelineName);
    }
    for (const excluded of settings.excludedPipelines) {
      byId.set(excluded.definitionId, excluded.name);
    }
    return [...byId.entries()]
      .map(([definitionId, name]) => ({ definitionId, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data?.deployments, settings.excludedPipelines]);

  const loadPipelines = React.useCallback(
    () => fetchPipelineDirectory(projectName, settings.timePeriodDays),
    [projectName, settings.timePeriodDays]
  );

  const handleExcludePipeline = React.useCallback(
    (definitionId: number, pipelineName: string) => {
      const next: DeliverySettings = {
        ...settings,
        excludedPipelines: excludePipeline(settings.excludedPipelines, {
          definitionId,
          name: pipelineName,
        }),
      };
      void persistSettings(next);
      setNotice(`${pipelineName} is excluded from the metrics. Manage exclusions in Settings.`);
    },
    [persistSettings, settings]
  );

  return (
    <AppShell
      title={BRAND.name}
      mark={<BrandGlyph />}
      subtitle={
        <>
          What reached production in {projectName}
          {cacheTimestamp && !loading && <> · updated {formatTimeAgo(cacheTimestamp, now)}</>}
        </>
      }
      actions={
        <>
          <div className="ax-segmented" role="group" aria-label="Environments shown">
            <button
              type="button"
              aria-pressed={!productionOnly}
              disabled={busy}
              onClick={() => handleEnvironmentScope("all")}
              title="Show every included environment"
            >
              All envs
            </button>
            <button
              type="button"
              aria-pressed={productionOnly}
              disabled={busy || !hasProductionPattern}
              onClick={() => handleEnvironmentScope("production")}
              title={
                hasProductionPattern
                  ? "Show only production (everything else is excluded from the analysis too)"
                  : "No environment is named like production. Add one in Settings."
              }
            >
              Production
            </button>
          </div>

          <div className="ax-segmented" role="group" aria-label="Analysis window">
            {TIME_RANGES.map((range) => (
              <button
                key={range.days}
                type="button"
                aria-pressed={settings.timePeriodDays === range.days}
                disabled={busy}
                onClick={() => handleRangeChange(range.days)}
              >
                {range.label}
              </button>
            ))}
          </div>

          {isAdmin && (
            <Button icon={<IconUsers />} onClick={() => setShowAccess(true)}>
              Access
            </Button>
          )}
          <Button
            icon={<IconSettings />}
            onClick={() => setShowSettings(true)}
            disabled={settingsLoading}
          >
            Settings
          </Button>

          {loading ? (
            <Button variant="danger" onClick={handleCancel}>
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={<IconRefresh />}
              onClick={handleAnalyse}
              disabled={busy}
            >
              {staleReason ? "Re-analyse" : data ? "Refresh" : "Analyse"}
            </Button>
          )}
        </>
      }
    >
      {progress && (
        <Progress
          label={progress.phase}
          current={progress.current}
          total={progress.total}
          indeterminate={progress.total === 0}
        />
      )}

      {saveError && (
        <Banner tone="error" title="Settings not saved" onDismiss={() => setSaveError(null)}>
          {saveError}
        </Banner>
      )}
      {staleReason && !loading && (
        <Banner tone="warn" title="Showing the previous analysis">
          These numbers are from the analysis{" "}
          {cacheTimestamp ? formatTimeAgo(cacheTimestamp, now) : "already on screen"}, and{" "}
          {staleReason} since. Nothing has been re-scanned. Press <strong>Re-analyse</strong> when
          you want to apply it.
        </Banner>
      )}
      {error && (
        <Banner tone="error" title="Analysis problem" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {notice && (
        <Banner tone="info" onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSave={handleSaveSettings}
          onCancel={() => setShowSettings(false)}
          knownPipelines={knownPipelines}
          loadPipelines={loadPipelines}
        />
      )}
      {showAccess && <AdminPanel onClose={() => setShowAccess(false)} />}

      {showSkeletons && <MetricSkeletons />}

      {data && (
        // Stale-while-revalidate: the previous result stays on screen, dimmed,
        // instead of blanking the dashboard for the whole run.
        <div
          aria-busy={loading}
          style={{
            opacity: loading ? 0.55 : 1,
            transition: "opacity var(--ax-base) var(--ax-ease)",
          }}
        >
          {data.diagnostics && (
            <div className="ax-enter ax-enter-1">
              <DiagnosticsStrip diagnostics={data.diagnostics} />
            </div>
          )}
          <div className="ax-enter ax-enter-1">
            <DoraScorecard metrics={data.dora} trends={data.trends} />
          </div>
          <div className="ax-enter ax-enter-2">
            <ProductionDeliveries
              deployments={visibleDeployments}
              leaseOwnerId={settings.production.leaseOwnerId}
              projectName={projectName}
            />
          </div>
          <div className="ax-enter ax-enter-2">
            <FailedDeployments
              deployments={visibleDeployments}
              projectName={projectName}
              onExcludePipeline={handleExcludePipeline}
            />
          </div>
          <div className="ax-enter ax-enter-3">
            <DoraTrendChart trends={data.trends} />
          </div>
          <div className="ax-enter ax-enter-3">
            <EnvironmentMatrix matrix={visibleMatrix} patterns={visiblePatterns} />
          </div>
          <div className="ax-enter ax-enter-4">
            <DeploymentTimeline deployments={visibleDeployments} patterns={visiblePatterns} />
          </div>
          <div className="ax-enter ax-enter-5">
            <LeadTimeBreakdown breakdown={data.leadTimeBreakdown} />
          </div>
        </div>
      )}

      {!data && !busy && !error && (
        <Card>
          <EmptyState
            title="Ready when you are"
            action={
              <Button variant="primary" icon={<IconRefresh />} onClick={handleAnalyse}>
                Analyse deployments
              </Button>
            }
          >
            <p>
              Analyse this project to see what has been delivered to production, what failed on the
              way, and how the four DORA metrics are trending.
            </p>
            <p style={{ marginTop: 12 }}>
              Production deliveries are identified from build retention leases tagged{" "}
              <span className="ax-mono">{settings.production.leaseOwnerId}</span>, with pipeline
              stage names as a fallback.
            </p>
          </EmptyState>
        </Card>
      )}
    </AppShell>
  );
};

export const App: React.FC = () => (
  <ErrorBoundary>
    <AppInner />
  </ErrorBoundary>
);
