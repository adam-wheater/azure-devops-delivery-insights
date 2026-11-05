import * as React from "react";
import { AnalysisDiagnostics } from "../models/interfaces";

/**
 * Where the honesty about the detection method lives in the dashboard.
 *
 * Two limitations of the retention-lease approach are surfaced here rather than
 * buried: leases expire (so old releases become invisible), and the lease endpoint
 * exposes no continuation token, so server-side truncation cannot be detected — the
 * raw lease count is shown so it can be sanity-checked against expectations.
 */

const MODE_LABEL: Record<string, string> = {
  hybrid: "Hybrid (leases + stage names)",
  "lease-only": "Leases only",
  "stage-only": "Stage names only",
};

const Item: React.FC<{ label: string; value: React.ReactNode; title?: string }> = ({
  label,
  value,
  title,
}) => (
  <div className="ax-diagnostics__item" title={title}>
    <span className="ax-diagnostics__label">{label}</span>
    <span className="ax-diagnostics__value">{value}</span>
  </div>
);

const DiagnosticsStripInner: React.FC<{ diagnostics: AnalysisDiagnostics }> = ({ diagnostics }) => {
  const d = diagnostics;
  return (
    <div className="ax-diagnostics" data-testid="diagnostics-strip">
      <Item label="Detection" value={MODE_LABEL[d.detectionMode] ?? d.detectionMode} />
      <Item
        label="Leases"
        value={d.leasesFound}
        title={`Retention leases with ownerId "${d.leaseOwnerId}". This endpoint has no pagination, so a very large project may be truncated server-side.`}
      />
      <Item label="Verified prod" value={d.prodFromLease} />
      {d.prodFromStageOnly > 0 && (
        <Item
          label="Inferred prod"
          value={d.prodFromStageOnly}
          title="Matched a production stage name but had no retention lease."
        />
      )}
      <Item label="Prod failures" value={d.prodFailuresFromTimeline} />
      <Item label="Builds scanned" value={d.buildsScanned} />
      <Item label="Pipelines" value={d.definitionsScanned} />
      {d.retriesCollapsed > 0 && (
        <Item
          label="Retries collapsed"
          value={d.retriesCollapsed}
          title="Repeated stage attempts folded into their latest attempt so a retry is not counted twice."
        />
      )}
      {d.orphanLeases > 0 && (
        <Item
          label="Leases outside window"
          value={d.orphanLeases}
          title="Leases whose build is older than the analysis window. Counted, never charted."
        />
      )}
      {d.oldestLeaseCreatedOn && (
        <Item
          label="Oldest lease"
          value={d.oldestLeaseCreatedOn.toLocaleDateString()}
          title="Leases expire. Releases older than this may have been garbage-collected and are invisible."
        />
      )}
      {d.pipelinesExcluded > 0 && (
        <Item
          label="Pipelines excluded"
          value={d.pipelinesExcluded}
          title="Removed from the analysis in Settings. Never scanned, never counted."
        />
      )}
      {d.stagesNotAttempted > 0 && (
        <Item
          label="Stages not attempted"
          value={d.stagesNotAttempted}
          title="Finished without attempting a deployment: skipped, cancelled, a timed-out approval gate, or parked awaiting a human. Counted as neither success nor failure."
        />
      )}
      {d.timelineFetchFailures > 0 && (
        <Item label="Timeline errors" value={d.timelineFetchFailures} />
      )}
      {(d.branchFlowRepositories ?? 0) > 0 && (
        <Item
          label="Repos traced"
          value={d.branchFlowRepositories!}
          title="Repositories queried for the branch journey: two requests each, batched, rather than one per commit."
        />
      )}
      {(d.branchFlowQueryFailures ?? 0) > 0 && (
        <Item
          label="Branch trace errors"
          value={d.branchFlowQueryFailures!}
          title="Repositories whose pull request lookup failed. Their deliveries report an unknown route rather than a wrong one."
        />
      )}
      <Item label="Took" value={`${(d.durationMs / 1000).toFixed(1)}s`} />
      {d.leaseQueryFailed && (
        <div className="ax-diagnostics__item">
          <span className="ax-pill ax-pill--warn">
            Lease query failed, fell back to stage names
          </span>
        </div>
      )}
    </div>
  );
};

export const DiagnosticsStrip = React.memo(DiagnosticsStripInner);
