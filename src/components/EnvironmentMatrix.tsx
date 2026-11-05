import * as React from "react";
import { EnvironmentStatus, EnvironmentPattern } from "../models/interfaces";
import { formatTimeAgo, useNow } from "../utils/theme";
import { Card, EmptyState } from "./ui";

interface EnvironmentMatrixProps {
  matrix: EnvironmentStatus[];
  patterns: EnvironmentPattern[];
}

const EnvironmentMatrixInner: React.FC<EnvironmentMatrixProps> = ({ matrix, patterns }) => {
  const now = useNow();

  const { sortedPatterns, envNames } = React.useMemo(() => {
    const sorted = [...patterns].sort((a, b) => a.order - b.order);
    return { sortedPatterns: sorted, envNames: sorted.map((p) => p.name) };
  }, [patterns]);

  if (matrix.length === 0) {
    return (
      <Card title="Environment matrix" testId="environment-matrix">
        <EmptyState title="No deployment data available">
          Nothing has deployed to a recognised environment in this window.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card
      title="Environment matrix"
      hint="The most recent deployment per pipeline in each environment."
      testId="environment-matrix"
      flush
    >
      <div className="ax-table-wrap">
        <table className="ax-table">
          <caption className="ax-sr-only">
            Latest deployment per pipeline across each environment
          </caption>
          <thead>
            <tr>
              <th scope="col">Pipeline</th>
              {sortedPatterns.map((pattern) => (
                <th key={pattern.name} scope="col" className="ax-center">
                  <span className="ax-row" style={{ justifyContent: "center", gap: 6 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: pattern.color,
                        display: "inline-block",
                      }}
                    />
                    {pattern.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.definitionId} data-testid={`matrix-row-${row.definitionId}`}>
                <th scope="row" style={{ fontWeight: 600, textTransform: "none", fontSize: 13 }}>
                  <div className="ax-truncate" title={row.pipelineName}>
                    {row.pipelineName}
                  </div>
                </th>
                {envNames.map((envName) => {
                  const dep =
                    row.environments.find((e) => e.name === envName)?.lastDeployment ?? null;
                  return (
                    <td
                      key={envName}
                      className="ax-center"
                      data-testid={`matrix-cell-${row.definitionId}-${envName}`}
                    >
                      {dep ? (
                        <div>
                          <div className="ax-row" style={{ justifyContent: "center", gap: 5 }}>
                            {/* Never colour alone — the glyph and the hidden text carry the state. */}
                            <span
                              aria-hidden="true"
                              style={{
                                color:
                                  dep.status === "succeeded"
                                    ? "var(--ax-success)"
                                    : "var(--ax-danger)",
                                fontWeight: 700,
                                fontSize: 12,
                              }}
                            >
                              {dep.status === "succeeded" ? "✓" : "✗"}
                            </span>
                            <span className="ax-sr-only">
                              {dep.status === "succeeded" ? "Succeeded" : "Failed"}
                            </span>
                            <span className="ax-mono">{dep.buildNumber}</span>
                          </div>
                          <div className="ax-fine" title={dep.finishTime.toLocaleString()}>
                            {formatTimeAgo(dep.finishTime.getTime(), now)}
                          </div>
                          {dep.isProduction && dep.prodUnverified && (
                            <span
                              className="ax-chip ax-chip--unverified"
                              title="Inferred from the stage name. No retention lease was found."
                            >
                              inferred
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="ax-muted" aria-label="No deployment">
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

export const EnvironmentMatrix = React.memo(EnvironmentMatrixInner);
