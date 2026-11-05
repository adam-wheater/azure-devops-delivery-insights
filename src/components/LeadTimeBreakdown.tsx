import * as React from "react";
import { BranchFlowGap, BranchFlowSegments, LeadTimeSegments } from "../models/interfaces";
import { formatDuration } from "../utils/theme";
import { Card, EmptyState } from "./ui";

interface LeadTimeBreakdownProps {
  breakdown: LeadTimeSegments;
}

/** Labels sit outside the bar, so segment colour never has to carry text contrast. */
const SEGMENTS = [
  {
    key: "preBuildHours",
    label: "Commit → build",
    color: "var(--ax-band-high)",
    detail: "Oldest commit in the build waiting until the pipeline run started.",
  },
  {
    key: "pipelineHours",
    label: "Build & approvals",
    color: "var(--ax-band-medium)",
    detail:
      "Pipeline start until the production stage began: build, upstream stages, approval waits.",
  },
  {
    key: "deployHours",
    label: "Deploy",
    color: "var(--ax-band-elite)",
    detail: "The production stage itself, start to finish.",
  },
] as const;

/**
 * The same waiting time as `preBuildHours`, split by which branch the change was
 * sitting on. This is the panel that answers "is it slow because we take a week
 * to review, or because develop only reaches main on Fridays?".
 */
const BRANCH_SEGMENTS = [
  {
    key: "codeHours",
    label: "Writing & review",
    color: "var(--ax-band-low)",
    detail:
      "From the change starting until it merged onto a shared branch: coding plus pull request review.",
  },
  {
    key: "integrationHours",
    label: "On the integration branch",
    color: "var(--ax-band-medium)",
    detail:
      "Merged into develop, then waiting there until it merged into the branch the pipeline builds. Zero for repositories that go straight to the build branch.",
  },
  {
    key: "releaseHours",
    label: "Waiting to build",
    color: "var(--ax-band-high)",
    detail: "On the branch the pipeline builds, waiting for a run to pick it up.",
  },
] as const;

const GAP_COPY: Record<BranchFlowGap, string> = {
  "not-git-repo": "not hosted in Azure Repos, so there are no pull requests to read",
  "no-commits": "no commit history could be resolved",
  "no-pull-request": "pushed straight to the build branch with no pull request",
  "query-failed": "the pull request lookup failed",
  "unknown-integration": "the branch it came through could not be determined",
};

interface Bar {
  key: string;
  label: string;
  color: string;
  detail: string;
  hours: number;
  pct: number;
}

function toBars(
  source: Record<string, number>,
  definitions: readonly { key: string; label: string; color: string; detail: string }[],
  total: number
): Bar[] {
  return definitions
    .map((definition) => {
      const hours = source[definition.key] ?? 0;
      return { ...definition, hours, pct: total > 0 ? (hours / total) * 100 : 0 };
    })
    .filter((bar) => bar.hours > 0);
}

const StackedBar: React.FC<{ bars: Bar[] }> = ({ bars }) => (
  <>
    <div
      style={{
        display: "flex",
        height: 30,
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--ax-surface-3)",
      }}
      role="img"
      aria-label={bars
        .map((bar) => `${bar.label} ${bar.hours.toFixed(1)} hours, ${Math.round(bar.pct)} percent`)
        .join("; ")}
    >
      {bars.map((bar) => (
        <div
          key={bar.key}
          style={{ width: `${bar.pct}%`, background: bar.color }}
          title={`${bar.label}: ${bar.hours.toFixed(1)}h (${bar.pct.toFixed(0)}%). ${bar.detail}`}
        />
      ))}
    </div>

    <div className="ax-row" style={{ gap: 18, marginTop: 12 }}>
      {bars.map((bar) => (
        <div key={bar.key} className="ax-row" style={{ gap: 6, fontSize: 12.5 }}>
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: bar.color,
              display: "inline-block",
            }}
          />
          <span style={{ color: "var(--ax-text-2)" }} title={bar.detail}>
            {bar.label} <strong style={{ color: "var(--ax-text)" }}>{bar.hours.toFixed(1)}h</strong>{" "}
            <span className="ax-muted">({bar.pct.toFixed(0)}%)</span>
          </span>
        </div>
      ))}
    </div>
  </>
);

/**
 * The branch journey.
 *
 * Kept visually separate from the bar above because it has a DIFFERENT
 * denominator, and pretending otherwise would be the lie this whole panel exists
 * to avoid. A delivery that was pushed straight to main, or whose repository is
 * not Azure Repos, has no journey to measure — it is counted under "not
 * measured" and contributes nothing, rather than being averaged in as a zero.
 */
const BranchJourney: React.FC<{ flow: BranchFlowSegments; totalDeliveries: number }> = ({
  flow,
  totalDeliveries,
}) => {
  const bars = React.useMemo(
    () => toBars(flow as unknown as Record<string, number>, BRANCH_SEGMENTS, flow.totalHours),
    [flow]
  );

  const gaps = React.useMemo(
    () =>
      (Object.entries(flow.gaps) as [BranchFlowGap, number][])
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1]),
    [flow.gaps]
  );

  const unmeasured = gaps.reduce((sum, [, count]) => sum + count, 0);

  if (flow.sampleSize === 0) {
    // Silence here would read as "we didn't build this". Say what was tried.
    return (
      <div
        style={{ marginTop: 22, borderTop: "1px solid var(--ax-border-subtle)", paddingTop: 18 }}
      >
        <h3 style={{ fontSize: 13.5, margin: "0 0 6px" }}>Branch journey</h3>
        <p className="ax-fine" style={{ margin: 0 }}>
          {unmeasured === 0
            ? "No delivery in this window carried enough pull request history to trace its route to production."
            : `None of the ${unmeasured} ${unmeasured === 1 ? "delivery" : "deliveries"} in this window could be traced: ` +
              gaps.map(([gap, count]) => `${count} ${GAP_COPY[gap]}`).join("; ") +
              "."}
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 22, borderTop: "1px solid var(--ax-border-subtle)", paddingTop: 18 }}>
      <div
        className="ax-row"
        style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}
      >
        <h3 style={{ fontSize: 13.5, margin: 0 }}>Branch journey</h3>
        <span className="ax-fine">
          Mean {formatDuration(flow.totalHours)} across {flow.sampleSize} of {totalDeliveries}{" "}
          {totalDeliveries === 1 ? "delivery" : "deliveries"}
        </span>
      </div>

      <StackedBar bars={bars} />

      <p className="ax-fine" style={{ marginTop: 12 }}>
        {flow.viaIntegration > 0 ? (
          <>
            {flow.viaIntegration} of {flow.sampleSize} travelled through an integration branch
            {flow.noIntegrationBranch > 0 && (
              <>
                {" "}
                · {flow.noIntegrationBranch} came from a repository with no integration branch, so
                that hop is genuinely absent rather than zero
              </>
            )}
            .
          </>
        ) : (
          <>
            None of these travelled through an integration branch
            {flow.noIntegrationBranch > 0 ? " (those repositories do not have one)" : ""}, so the
            middle segment is empty rather than instant.
          </>
        )}
        {flow.originFromPullRequest > 0 && (
          <>
            {" "}
            {flow.originFromPullRequest} started from when the pull request was opened rather than
            the first commit: those changes were squashed on merge, which destroys the original
            commits, so the time spent coding before the pull request existed is not recoverable and
            is not guessed at.
          </>
        )}
        {unmeasured > 0 && (
          <> Not measured: {gaps.map(([gap, count]) => `${count} ${GAP_COPY[gap]}`).join("; ")}.</>
        )}
      </p>
    </div>
  );
};

const LeadTimeBreakdownInner: React.FC<LeadTimeBreakdownProps> = ({ breakdown }) => {
  const model = React.useMemo(() => {
    const total = breakdown?.totalHours ?? 0;
    if (!total || !breakdown?.sampleSize) return null;
    return {
      total,
      segments: toBars(breakdown as unknown as Record<string, number>, SEGMENTS, total),
    };
  }, [breakdown]);

  const flow = breakdown?.branchFlow;

  if (!model) {
    return (
      <Card title="Commit to production" testId="lead-time-breakdown">
        <EmptyState title="Nothing measurable yet">
          This needs at least one successful production deployment whose commit history could be
          resolved.
          {breakdown?.excluded ? (
            <>
              {" "}
              {breakdown.excluded}{" "}
              {breakdown.excluded === 1 ? "deployment was" : "deployments were"} skipped because no
              commit could be found for them.
            </>
          ) : null}
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card
      title="Commit to production"
      hint={
        <>
          Mean {formatDuration(model.total)} across {breakdown.sampleSize}{" "}
          {breakdown.sampleSize === 1 ? "delivery" : "deliveries"}
          {breakdown.excluded > 0 && <> · {breakdown.excluded} without commit history excluded</>}
        </>
      }
      testId="lead-time-breakdown"
    >
      <StackedBar bars={model.segments} />

      <p className="ax-fine" style={{ marginTop: 14 }}>
        Every segment is the gap between two timestamps Azure DevOps reported: the oldest commit in
        the build, the pipeline start, and the production stage&apos;s own start and finish. Nothing
        here is estimated. The mean is shown rather than the median so the parts sum to the whole;
        the scorecard above reports median lead time.
      </p>

      {flow && <BranchJourney flow={flow} totalDeliveries={breakdown.sampleSize} />}
    </Card>
  );
};

export const LeadTimeBreakdown = React.memo(LeadTimeBreakdownInner);
