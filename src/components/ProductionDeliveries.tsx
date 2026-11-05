import * as React from "react";
import { DeploymentRecord } from "../models/interfaces";
import { formatDuration, formatTimeAgo, useNow } from "../utils/theme";
import { Card, EmptyState, HostLink, IconCheck, IconRocket } from "./ui";
import { buildResultsUrl, getCollectionUri, pipelineUrl } from "../services/navigation";

/**
 * "What actually shipped to production."
 *
 * A delivery is one row per build, never one per stage — a build that deploys to
 * several production regions is one delivery, and its stage names are listed
 * together. The provenance column is deliberately prominent: a lease-verified row
 * is evidence, a stage-inferred row is a guess from a name.
 */

const PAGE_SIZE = 25;

type Filter = "all" | "verified" | "inferred";

function leadTimeHours(record: DeploymentRecord): number | null {
  if (!record.firstCommitTime) return null;
  const ms = record.finishTime.getTime() - record.firstCommitTime.getTime();
  return ms >= 0 ? ms / 3_600_000 : null;
}

// Stage-only mode also yields "stage" records, with prodUnverified false: they
// are still inferred, never lease-verified.
const isInferred = (record: DeploymentRecord): boolean => record.prodSource === "stage";

export const ProvenanceChip: React.FC<{ record: DeploymentRecord }> = ({ record }) => {
  if (record.status === "failed") {
    return <span className="ax-chip ax-chip--failed">Failed</span>;
  }
  if (isInferred(record)) {
    return (
      <span
        className="ax-chip ax-chip--unverified"
        title="Inferred from the stage name. No retention lease was found for this build."
      >
        Stage-inferred
      </span>
    );
  }
  return (
    <span className="ax-chip ax-chip--verified" title="Proven by a build retention lease.">
      <IconCheck size={11} /> Lease-verified
    </span>
  );
};

const ProductionDeliveriesInner: React.FC<{
  deployments: DeploymentRecord[];
  leaseOwnerId: string;
  projectName: string;
}> = ({ deployments, leaseOwnerId, projectName }) => {
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
  const [filter, setFilter] = React.useState<Filter>("all");
  const [limit, setLimit] = React.useState(PAGE_SIZE);

  const deliveries = React.useMemo(
    () =>
      deployments
        .filter((d) => d.isProduction && d.status === "succeeded")
        .sort((a, b) => {
          const at = (a.releasedToPrdAt ?? a.finishTime).getTime();
          const bt = (b.releasedToPrdAt ?? b.finishTime).getTime();
          return bt - at;
        }),
    [deployments]
  );

  const counts = React.useMemo(
    () => ({
      all: deliveries.length,
      verified: deliveries.filter((d) => !isInferred(d)).length,
      inferred: deliveries.filter(isInferred).length,
    }),
    [deliveries]
  );

  const visible = React.useMemo(() => {
    const filtered =
      filter === "all"
        ? deliveries
        : deliveries.filter((d) => (filter === "verified") !== isInferred(d));
    return filtered.slice(0, limit);
  }, [deliveries, filter, limit]);

  const filteredTotal =
    filter === "all" ? counts.all : filter === "verified" ? counts.verified : counts.inferred;

  return (
    <Card
      testId="production-deliveries"
      title={
        <>
          <IconRocket /> Delivered to production
        </>
      }
      hint={
        <>
          {counts.all} {counts.all === 1 ? "delivery" : "deliveries"} · {counts.verified} proven by
          a <span className="ax-mono">{leaseOwnerId}</span> retention lease
          {counts.inferred > 0 && <> · {counts.inferred} inferred from stage names</>}
        </>
      }
      actions={
        <div className="ax-segmented" role="group" aria-label="Filter deliveries">
          {(
            [
              ["all", "All"],
              ["verified", "Lease-verified"],
              ["inferred", "Inferred"],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => {
                setFilter(key);
                setLimit(PAGE_SIZE);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      }
      flush
    >
      {filteredTotal === 0 ? (
        <EmptyState title="No production deliveries in this window">
          Nothing matched. Check the retention-lease owner id in Settings, which must match the{" "}
          <span className="ax-mono">ownerId</span> your pipeline writes, or widen the time period.
        </EmptyState>
      ) : (
        <>
          <div className="ax-table-wrap">
            <table className="ax-table">
              <caption className="ax-sr-only">Builds delivered to production, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Pipeline</th>
                  <th scope="col">Build</th>
                  <th scope="col">Released</th>
                  <th scope="col" className="ax-num">
                    Lead time
                  </th>
                  <th scope="col">Stages</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((record) => {
                  const released = record.releasedToPrdAt ?? record.finishTime;
                  const lead = leadTimeHours(record);
                  return (
                    <tr key={`${record.buildId}-${record.environment}`}>
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
                      <td title={released.toLocaleString()}>
                        {formatTimeAgo(released.getTime(), now)}
                      </td>
                      <td className="ax-num">
                        {lead === null ? (
                          <span className="ax-muted">—</span>
                        ) : (
                          <>
                            {formatDuration(lead)}
                            {record.leadTimeApprox && (
                              <span
                                className="ax-muted"
                                title="Commit history was truncated; this is a lower bound."
                              >
                                {" "}
                                ≈
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td>
                        <div className="ax-truncate ax-fine" title={record.stageNames.join(", ")}>
                          {record.stageNames.length > 0 ? record.stageNames.join(", ") : "—"}
                        </div>
                      </td>
                      <td>
                        <div className="ax-row" style={{ gap: 4 }}>
                          <ProvenanceChip record={record} />
                          {record.hadFailedProdStage && (
                            <span
                              className="ax-chip ax-chip--failed"
                              title="A production stage failed on this build before it was delivered."
                            >
                              Retried
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredTotal > visible.length && (
            <div style={{ padding: "12px 20px", textAlign: "center" }}>
              <button
                type="button"
                className="ax-btn ax-btn--sm"
                onClick={() => setLimit((l) => l + PAGE_SIZE)}
              >
                Show more ({filteredTotal - visible.length} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
};

export const ProductionDeliveries = React.memo(ProductionDeliveriesInner);
