import * as React from "react";
import { DeploymentRecord } from "../models/interfaces";
import { formatDuration, formatTimeAgo, useNow } from "../utils/theme";
import { Card, EmptyState, HostLink, IconAlert } from "./ui";
import { buildResultsUrl, getCollectionUri, pipelineUrl } from "../services/navigation";

/**
 * "What broke."
 *
 * Two kinds of failure appear here, and the difference matters:
 *  - a deployment that failed outright (no retention lease was ever written,
 *    because the pipeline step that writes it only runs on success); and
 *  - a delivery that eventually succeeded but failed at least one production
 *    attempt on the way. Those are invisible in a success/failure count yet are
 *    exactly the events that drive change failure rate and MTTR.
 */

const PAGE_SIZE = 25;

interface FailureRow {
  key: string;
  record: DeploymentRecord;
  kind: "failed" | "recovered";
  /** Hours from this failure to the next success on the same pipeline+environment. */
  recoveryHours: number | null;
}

function buildRows(deployments: DeploymentRecord[]): FailureRow[] {
  const byLane = new Map<string, DeploymentRecord[]>();
  for (const record of deployments) {
    const lane = `${record.definitionId}|${record.environment}`;
    const list = byLane.get(lane);
    if (list) list.push(record);
    else byLane.set(lane, [record]);
  }

  const rows: FailureRow[] = [];

  for (const lane of byLane.values()) {
    lane.sort((a, b) => a.finishTime.getTime() - b.finishTime.getTime());

    // Single reverse pass so recovery lookup stays linear.
    const nextSuccessAt = new Array<number>(lane.length).fill(-1);
    let upcoming = -1;
    for (let i = lane.length - 1; i >= 0; i--) {
      nextSuccessAt[i] = upcoming;
      if (lane[i].status === "succeeded") upcoming = lane[i].finishTime.getTime();
    }

    for (let i = 0; i < lane.length; i++) {
      const record = lane[i];
      const failedOutright = record.status === "failed";
      const recoveredAfterFailure = record.status === "succeeded" && record.hadFailedProdStage;
      if (!failedOutright && !recoveredAfterFailure) continue;

      const recoveredAt = failedOutright ? nextSuccessAt[i] : -1;
      rows.push({
        key: `${record.buildId}-${record.environment}-${i}`,
        record,
        kind: failedOutright ? "failed" : "recovered",
        recoveryHours:
          recoveredAt > 0 ? (recoveredAt - record.finishTime.getTime()) / 3_600_000 : null,
      });
    }
  }

  return rows.sort((a, b) => b.record.finishTime.getTime() - a.record.finishTime.getTime());
}

type Scope = "all" | "production";

const FailedDeploymentsInner: React.FC<{
  deployments: DeploymentRecord[];
  projectName: string;
  onExcludePipeline?: (definitionId: number, pipelineName: string) => void;
}> = ({ deployments, projectName, onExcludePipeline }) => {
  const now = useNow();
  const [collectionUri, setCollectionUri] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void getCollectionUri().then((uri) => {
      if (!cancelled) setCollectionUri(uri);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [scope, setScope] = React.useState<Scope>("production");
  const [limit, setLimit] = React.useState(PAGE_SIZE);

  const allRows = React.useMemo(() => buildRows(deployments), [deployments]);
  const prodRows = React.useMemo(() => allRows.filter((r) => r.record.isProduction), [allRows]);

  const rows = scope === "production" ? prodRows : allRows;
  const visible = rows.slice(0, limit);

  const unresolved = rows.filter((r) => r.kind === "failed" && r.recoveryHours === null).length;

  return (
    <Card
      testId="failed-deployments"
      title={
        <>
          <IconAlert /> Failed deployments
        </>
      }
      hint={
        rows.length === 0
          ? "No failures detected in this window."
          : `${rows.length} ${rows.length === 1 ? "failure" : "failures"}${
              unresolved > 0 ? ` · ${unresolved} with no recovery yet` : ""
            }`
      }
      actions={
        <div className="ax-segmented" role="group" aria-label="Failure scope">
          <button
            type="button"
            aria-pressed={scope === "production"}
            onClick={() => {
              setScope("production");
              setLimit(PAGE_SIZE);
            }}
          >
            Production ({prodRows.length})
          </button>
          <button
            type="button"
            aria-pressed={scope === "all"}
            onClick={() => {
              setScope("all");
              setLimit(PAGE_SIZE);
            }}
          >
            All environments ({allRows.length})
          </button>
        </div>
      }
      flush
    >
      {rows.length === 0 ? (
        <EmptyState title="Nothing failed">
          No failed deployment stages were found in this window.
        </EmptyState>
      ) : (
        <>
          <div className="ax-table-wrap">
            <table className="ax-table">
              <caption className="ax-sr-only">Failed deployments, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Pipeline</th>
                  <th scope="col">Build</th>
                  <th scope="col">Environment</th>
                  <th scope="col">Stage</th>
                  <th scope="col">When</th>
                  <th scope="col" className="ax-num">
                    Recovered in
                  </th>
                  {onExcludePipeline && (
                    <th scope="col">
                      <span className="ax-sr-only">Exclude pipeline</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {visible.map(({ key, record, kind, recoveryHours }) => (
                  <tr key={key}>
                    <th
                      scope="row"
                      style={{ fontWeight: 600, textTransform: "none", fontSize: 13 }}
                    >
                      <div className="ax-truncate">
                        <HostLink
                          href={pipelineUrl(collectionUri, projectName, record.definitionId)}
                          title={`Open ${record.pipelineName} in Azure DevOps`}
                        >
                          {record.pipelineName}
                        </HostLink>
                      </div>
                    </th>
                    <td className="ax-mono">
                      <HostLink
                        href={buildResultsUrl(collectionUri, projectName, record.buildId)}
                        title={`Open build ${record.buildNumber} in Azure DevOps`}
                      >
                        {record.buildNumber}
                      </HostLink>
                    </td>
                    <td>
                      <div className="ax-row" style={{ gap: 5 }}>
                        {record.environment}
                        {record.isProduction && (
                          <span className="ax-pill ax-pill--danger">Prod</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="ax-truncate ax-fine" title={record.stageNames.join(", ")}>
                        {record.stageNames.length > 0 ? record.stageNames.join(", ") : "—"}
                      </div>
                    </td>
                    <td title={record.finishTime.toLocaleString()}>
                      {formatTimeAgo(record.finishTime.getTime(), now)}
                    </td>
                    <td className="ax-num">
                      {kind === "recovered" ? (
                        <span
                          className="ax-chip ax-chip--verified"
                          title="A production stage failed, but a retention lease proves the build was delivered."
                        >
                          Retried &amp; delivered
                        </span>
                      ) : recoveryHours === null ? (
                        <span className="ax-pill ax-pill--danger">Not yet</span>
                      ) : (
                        formatDuration(recoveryHours)
                      )}
                    </td>
                    {onExcludePipeline && (
                      <td>
                        <button
                          type="button"
                          className="ax-btn ax-btn--sm ax-btn--ghost"
                          title={`Remove ${record.pipelineName} from the metrics entirely`}
                          onClick={() =>
                            onExcludePipeline(record.definitionId, record.pipelineName)
                          }
                        >
                          Exclude
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > visible.length && (
            <div style={{ padding: "12px 20px", textAlign: "center" }}>
              <button
                type="button"
                className="ax-btn ax-btn--sm"
                onClick={() => setLimit((l) => l + PAGE_SIZE)}
              >
                Show more ({rows.length - visible.length} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
};

export const FailedDeployments = React.memo(FailedDeploymentsInner);
