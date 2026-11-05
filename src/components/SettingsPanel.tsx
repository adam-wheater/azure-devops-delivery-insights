import * as React from "react";
import {
  DeliverySettings,
  DetectionMode,
  isPatternEnabled,
  isProductionPattern,
  includePipeline,
  excludePipeline,
  isPipelineExcluded,
  DEFAULT_BRANCH_FLOW_SETTINGS,
} from "../models/interfaces";
import type { PipelineSummary } from "../services/DeploymentService";
import { EnvironmentSettings } from "./EnvironmentSettings";
import { Banner, Modal } from "./ui";

interface SettingsPanelProps {
  settings: DeliverySettings;
  onSave: (settings: DeliverySettings) => void;
  onCancel: () => void;
  /**
   * Pipelines already known from the current analysis. Shown immediately so the
   * picker is usable before — and even if — the authoritative fetch resolves.
   */
  knownPipelines?: PipelineSummary[];
  /** Every pipeline in the project, including ones that have never failed. */
  loadPipelines?: () => Promise<PipelineSummary[]>;
}

/** Long lists are truncated rather than rendered whole; the search box is the way in. */
const PIPELINE_LIST_LIMIT = 40;

const MODES: { value: DetectionMode; label: string; blurb: string }[] = [
  {
    value: "hybrid",
    label: "Hybrid",
    blurb:
      "Retention leases prove production deliveries; stage names fill the gaps and supply failures. Recommended.",
  },
  {
    value: "lease-only",
    label: "Leases only",
    blurb:
      "Only builds carrying a retention lease count as production. Strictest, but silent if a pipeline forgets to write the lease.",
  },
  {
    value: "stage-only",
    label: "Stage names only",
    blurb: "Ignore leases entirely and infer production from stage names, as earlier versions did.",
  },
];

const BAND_ROWS = [
  { key: "deploymentFrequency", label: "Deploy frequency (per day)", step: 0.1 },
  { key: "leadTime", label: "Lead time (hours)", step: 1 },
  { key: "changeFailureRate", label: "Change failure rate (%)", step: 1 },
  { key: "mttr", label: "MTTR (hours)", step: 1 },
] as const;

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onSave,
  onCancel,
  knownPipelines = [],
  loadPipelines,
}) => {
  const [draft, setDraft] = React.useState<DeliverySettings>(() => ({
    ...settings,
    environmentPatterns: settings.environmentPatterns.map((p) => ({ ...p })),
    production: { ...settings.production },
    doraBands: {
      deploymentFrequency: { ...settings.doraBands.deploymentFrequency },
      leadTime: { ...settings.doraBands.leadTime },
      changeFailureRate: { ...settings.doraBands.changeFailureRate },
      mttr: { ...settings.doraBands.mttr },
    },
    branchFlow: {
      ...(settings.branchFlow ?? DEFAULT_BRANCH_FLOW_SETTINGS),
      integrationPatterns: (
        settings.branchFlow ?? DEFAULT_BRANCH_FLOW_SETTINGS
      ).integrationPatterns.map((p) => ({ ...p })),
    },
  }));
  // Kept as a string so clearing the field does not silently snap back to 90.
  const [periodText, setPeriodText] = React.useState(String(settings.timePeriodDays));
  // Edited as free text: a half-typed regular expression must not be rejected or
  // reordered mid-keystroke, which is what editing a list of objects would do.
  const [integrationText, setIntegrationText] = React.useState(() =>
    (settings.branchFlow ?? DEFAULT_BRANCH_FLOW_SETTINGS).integrationPatterns
      .map((p) => p.regex)
      .join("\n")
  );
  const [error, setError] = React.useState<string | null>(null);

  // ── pipeline exclusion picker ───────────────────────────────────────────────
  // Seeded from the current analysis so the list is usable on the first frame,
  // then replaced by the full project list. A pipeline that has never failed
  // appears in neither the failure table nor the analysis-derived list, which is
  // exactly the case that had no way to be excluded at all.
  const [pipelines, setPipelines] = React.useState<PipelineSummary[]>(knownPipelines);
  const [pipelinesLoading, setPipelinesLoading] = React.useState(Boolean(loadPipelines));
  const [pipelineError, setPipelineError] = React.useState<string | null>(null);
  const [pipelineQuery, setPipelineQuery] = React.useState("");

  // Read through a ref inside the effect: the caller hands us a fresh array each
  // render, so depending on it directly would refetch the whole directory on
  // every parent render.
  const knownRef = React.useRef(knownPipelines);
  knownRef.current = knownPipelines;

  React.useEffect(() => {
    if (!loadPipelines) return;
    let cancelled = false;
    setPipelinesLoading(true);
    loadPipelines()
      .then((result) => {
        if (cancelled) return;
        // Merge rather than replace: a pipeline present in the analysis but
        // missing from the directory (renamed, deleted, outside the window)
        // must not disappear from the picker.
        const byId = new Map<number, string>();
        for (const pipeline of [...knownRef.current, ...result]) {
          byId.set(pipeline.definitionId, pipeline.name);
        }
        setPipelines(
          [...byId.entries()]
            .map(([definitionId, name]) => ({ definitionId, name }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
        setPipelineError(null);
      })
      .catch(() => {
        if (!cancelled) setPipelineError("Could not load the full pipeline list.");
      })
      .finally(() => {
        if (!cancelled) setPipelinesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadPipelines]);

  const matchingPipelines = React.useMemo(() => {
    const needle = pipelineQuery.trim().toLowerCase();
    return pipelines.filter(
      (pipeline) =>
        !isPipelineExcluded(draft.excludedPipelines, pipeline.definitionId) &&
        (!needle || pipeline.name.toLowerCase().includes(needle))
    );
  }, [pipelines, pipelineQuery, draft.excludedPipelines]);

  const selectablePipelines = matchingPipelines.slice(0, PIPELINE_LIST_LIMIT);
  const hiddenPipelineCount = matchingPipelines.length - selectablePipelines.length;

  const integrationLines = integrationText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const invalidIntegrationPatterns = integrationLines.filter((line) => {
    try {
      new RegExp(line, "i");
      return false;
    } catch {
      return true;
    }
  });

  const periodValue = Number.parseInt(periodText, 10);
  const periodInvalid = !Number.isFinite(periodValue) || periodValue < 1 || periodValue > 365;

  // Excluding every production-named environment is legal — the highest-ordered
  // included environment becomes the production proxy — but it is surprising
  // enough to say out loud rather than let someone discover in the numbers.
  const included = draft.environmentPatterns.filter(isPatternEnabled);
  const productionProxy =
    included.length > 0 && !included.some(isProductionPattern)
      ? [...included].sort((a, b) => b.order - a.order)[0]
      : null;

  const handleBandChange = (
    metric: (typeof BAND_ROWS)[number]["key"],
    level: "elite" | "high" | "medium",
    raw: string
  ) => {
    const value = Number.parseFloat(raw);
    setDraft((prev) => ({
      ...prev,
      doraBands: {
        ...prev.doraBands,
        [metric]: { ...prev.doraBands[metric], [level]: Number.isFinite(value) ? value : 0 },
      },
    }));
  };

  const handleSave = () => {
    if (periodInvalid) {
      setError("Time period must be a whole number of days between 1 and 365.");
      return;
    }
    if (!draft.production.leaseOwnerId.trim() && draft.production.detectionMode !== "stage-only") {
      setError(
        "A retention lease owner id is required unless detection is set to stage names only."
      );
      return;
    }
    const included = draft.environmentPatterns.filter(isPatternEnabled);
    if (included.length === 0) {
      setError("Include at least one environment. Otherwise there is nothing to analyse.");
      return;
    }

    const badPattern = included.find((pattern) => {
      try {
        new RegExp(pattern.regex, "i");
        return !pattern.regex;
      } catch {
        return true;
      }
    });
    if (badPattern) {
      setError(`The pattern for "${badPattern.name}" is not a valid regular expression.`);
      return;
    }
    if (invalidIntegrationPatterns.length > 0) {
      setError(
        `"${invalidIntegrationPatterns[0]}" is not a valid regular expression for an integration branch.`
      );
      return;
    }

    onSave({
      ...draft,
      timePeriodDays: periodValue,
      branchFlow: {
        ...draft.branchFlow,
        integrationPatterns: integrationLines.map((regex, index) => ({
          id: `integration-${index}`,
          regex,
          order: index + 1,
        })),
      },
    });
  };

  return (
    <Modal
      title="Settings"
      onClose={onCancel}
      wide
      footer={
        <>
          <button type="button" className="ax-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ax-btn ax-btn--primary" onClick={handleSave}>
            Save settings
          </button>
        </>
      }
    >
      <div data-testid="settings-panel">
        {error && (
          <Banner tone="error" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        )}

        <section style={{ marginBottom: 28 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 650 }}>Production detection</h3>
          <p className="ax-fine" style={{ marginTop: 0, marginBottom: 12 }}>
            How the extension decides that a build actually reached production.
          </p>

          <div className="ax-segmented" role="group" aria-label="Detection mode">
            {MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                aria-pressed={draft.production.detectionMode === mode.value}
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    production: { ...prev.production, detectionMode: mode.value },
                  }))
                }
              >
                {mode.label}
              </button>
            ))}
          </div>
          <p className="ax-fine" style={{ marginTop: 8 }}>
            {MODES.find((m) => m.value === draft.production.detectionMode)?.blurb}
          </p>

          <div className="ax-grid-2" style={{ marginTop: 16 }}>
            <div>
              <label htmlFor="ax-lease-owner" style={{ fontSize: 12.5, color: "var(--ax-text-2)" }}>
                Retention lease owner id
              </label>
              <input
                id="ax-lease-owner"
                className="ax-input ax-mono"
                style={{ width: "100%", marginTop: 6 }}
                value={draft.production.leaseOwnerId}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    production: { ...prev.production, leaseOwnerId: e.target.value },
                  }))
                }
              />
              <p className="ax-fine" style={{ marginTop: 6 }}>
                Must match the <span className="ax-mono">ownerId</span> your pipeline writes when it
                posts a build retention lease. The match is exact, since the server is
                case-sensitive.
              </p>
            </div>

            <div>
              <label htmlFor="ax-prod-label" style={{ fontSize: 12.5, color: "var(--ax-text-2)" }}>
                Production label
              </label>
              <input
                id="ax-prod-label"
                className="ax-input"
                style={{ width: "100%", marginTop: 6 }}
                value={draft.production.productionEnvironmentLabel}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    production: { ...prev.production, productionEnvironmentLabel: e.target.value },
                  }))
                }
              />
              <p className="ax-fine" style={{ marginTop: 6 }}>
                Used when a lease proves a delivery but no stage name matched a pattern.
              </p>
            </div>
          </div>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 650 }}>Time period</h3>
          <div className="ax-row">
            <label className="ax-sr-only" htmlFor="ax-period">
              Analysis window in days
            </label>
            <input
              id="ax-period"
              className={`ax-input${periodInvalid ? " ax-input--invalid" : ""}`}
              style={{ width: 90 }}
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              value={periodText}
              aria-invalid={periodInvalid}
              onChange={(e) => setPeriodText(e.target.value)}
            />
            <span style={{ fontSize: 13, color: "var(--ax-text-2)" }}>days</span>
          </div>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 650 }}>DORA band thresholds</h3>
          <div className="ax-table-wrap">
            <table className="ax-table">
              <caption className="ax-sr-only">Thresholds for each DORA performance band</caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col" className="ax-center">
                    Elite
                  </th>
                  <th scope="col" className="ax-center">
                    High
                  </th>
                  <th scope="col" className="ax-center">
                    Medium
                  </th>
                </tr>
              </thead>
              <tbody>
                {BAND_ROWS.map(({ key, label, step }) => (
                  <tr key={key}>
                    <th
                      scope="row"
                      style={{ fontWeight: 500, textTransform: "none", fontSize: 13 }}
                    >
                      {label}
                    </th>
                    {(["elite", "high", "medium"] as const).map((level) => (
                      <td key={level} className="ax-center">
                        <label className="ax-sr-only" htmlFor={`band-${key}-${level}`}>
                          {label} {level} threshold
                        </label>
                        <input
                          id={`band-${key}-${level}`}
                          className="ax-input"
                          style={{ width: 76, textAlign: "center" }}
                          type="number"
                          step={step}
                          value={draft.doraBands[key][level]}
                          onChange={(e) => handleBandChange(key, level, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {productionProxy && (
          <Banner tone="warn" title="No production environment is included">
            DORA metrics need something to treat as production, so{" "}
            <strong>{productionProxy.name}</strong> is being used instead. It has the highest order
            of the included environments. Include a production-named environment if that is not what
            you want.
          </Banner>
        )}

        <section style={{ marginBottom: 28 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 650 }}>Excluded pipelines</h3>
          <p className="ax-fine" style={{ marginTop: 0, marginBottom: 12 }}>
            Pipelines here are left out of the analysis entirely: never scanned, and absent from
            every metric and panel. Use it for pipelines whose runs say nothing about delivery
            quality, such as a scheduled redeploy. You can also exclude one straight from a row in{" "}
            <strong>Failed deployments</strong>.
          </p>

          <label className="ax-fine" htmlFor="ax-pipeline-search" style={{ display: "block" }}>
            Search every pipeline that has built in the last {periodText || "—"} days
          </label>
          <input
            id="ax-pipeline-search"
            className="ax-input"
            style={{ width: "100%", marginBottom: 8 }}
            type="search"
            placeholder="Pipeline name…"
            value={pipelineQuery}
            onChange={(e) => setPipelineQuery(e.target.value)}
          />

          {pipelineError && (
            <p className="ax-fine" style={{ color: "var(--ax-danger)" }}>
              {pipelineError} You can still exclude a pipeline from a row in Failed deployments.
            </p>
          )}

          {pipelinesLoading && <p className="ax-fine">Loading the full pipeline list…</p>}

          {/* Rendered whether or not the directory fetch is still running or
              failed. Hiding it in those states threw away the pipelines already
              known from the analysis, which is the fallback that makes the
              section usable at all when the lookup does not come back. */}
          <div
            className="ax-picker"
            role="group"
            aria-label="Pipelines available to exclude"
            data-testid="pipeline-picker"
          >
            {selectablePipelines.length === 0 ? (
              <p className="ax-fine" style={{ margin: 0 }}>
                {pipelinesLoading
                  ? "Loading…"
                  : pipelineQuery
                    ? `No pipeline matches "${pipelineQuery}".`
                    : "Every pipeline is already excluded."}
              </p>
            ) : (
              selectablePipelines.map((pipeline) => (
                <div className="ax-member-row" key={pipeline.definitionId}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ax-truncate">{pipeline.name}</div>
                    <div className="ax-fine">Definition {pipeline.definitionId}</div>
                  </div>
                  <button
                    type="button"
                    className="ax-btn ax-btn--sm"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        excludedPipelines: excludePipeline(prev.excludedPipelines, {
                          definitionId: pipeline.definitionId,
                          name: pipeline.name,
                        }),
                      }))
                    }
                  >
                    Exclude
                  </button>
                </div>
              ))
            )}
            {hiddenPipelineCount > 0 && (
              <p className="ax-fine" style={{ margin: "8px 0 0" }}>
                {hiddenPipelineCount} more. Narrow the search to see{" "}
                {hiddenPipelineCount === 1 ? "it" : "them"}.
              </p>
            )}
          </div>

          <h4 style={{ margin: "18px 0 8px", fontSize: 13, fontWeight: 650 }}>
            Currently excluded ({draft.excludedPipelines.length})
          </h4>

          {draft.excludedPipelines.length === 0 ? (
            <p className="ax-fine">Nothing is excluded. Every pipeline counts.</p>
          ) : (
            <div>
              {draft.excludedPipelines.map((pipeline) => (
                <div className="ax-member-row" key={pipeline.definitionId}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ax-truncate">{pipeline.name}</div>
                    <div className="ax-fine">Definition {pipeline.definitionId}</div>
                  </div>
                  <button
                    type="button"
                    className="ax-btn ax-btn--sm"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        excludedPipelines: includePipeline(
                          prev.excludedPipelines,
                          pipeline.definitionId
                        ),
                      }))
                    }
                  >
                    Include again
                  </button>
                </div>
              ))}
              <p className="ax-fine" style={{ marginTop: 8 }}>
                Re-including a pipeline needs a fresh analysis. Its builds were never scanned, so
                its history is not in the current results.
              </p>
            </div>
          )}
        </section>

        <section style={{ marginBottom: 28 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 650 }}>Branch journey</h3>
          <p className="ax-fine" style={{ marginTop: 0, marginBottom: 12 }}>
            Splits the wait before a build into the branches a change travelled through: written,
            merged to an integration branch such as <span className="ax-mono">develop</span>, then
            merged to the branch the pipeline builds. Reads completed pull requests; costs two
            requests per repository, not one per commit.
          </p>

          <label className="ax-row" style={{ gap: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={draft.branchFlow.enabled}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  branchFlow: { ...prev.branchFlow, enabled: e.target.checked },
                }))
              }
            />
            <span style={{ fontSize: 13 }}>Trace the branch journey</span>
          </label>

          <label
            className="ax-fine"
            htmlFor="ax-integration-branches"
            style={{ display: "block", marginBottom: 6 }}
          >
            Integration branches: one regular expression per line, matched against the full ref
            name. A repository with none of these is reported as having no integration branch, so
            that hop shows as absent rather than instant.
          </label>
          <textarea
            id="ax-integration-branches"
            className="ax-input"
            style={{ width: "100%", minHeight: 66, fontFamily: "var(--ax-mono)", fontSize: 12 }}
            spellCheck={false}
            value={integrationText}
            onChange={(e) => setIntegrationText(e.target.value)}
          />
          {invalidIntegrationPatterns.length > 0 && (
            <p className="ax-fine" style={{ color: "var(--ax-danger)" }}>
              Not a valid regular expression, so it is ignored:{" "}
              <span className="ax-mono">{invalidIntegrationPatterns.join(", ")}</span>
            </p>
          )}
          <p className="ax-fine">
            Example: <span className="ax-mono">^refs/heads/(develop|dev)$</span>
          </p>
        </section>

        <EnvironmentSettings
          patterns={draft.environmentPatterns}
          onChange={(environmentPatterns) => setDraft((prev) => ({ ...prev, environmentPatterns }))}
        />
      </div>
    </Modal>
  );
};
