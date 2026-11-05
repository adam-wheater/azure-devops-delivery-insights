import * as React from "react";
import { EnvironmentPattern, isPatternEnabled, isProductionPattern } from "../models/interfaces";
import { matchStageToEnvironment } from "../services/DeploymentService";
import { IconX } from "./ui";

interface EnvironmentSettingsProps {
  patterns: EnvironmentPattern[];
  onChange: (patterns: EnvironmentPattern[]) => void;
}

let idCounter = 0;
const nextId = () => `env-${Date.now().toString(36)}-${idCounter++}`;

function regexError(source: string): string | null {
  try {
    new RegExp(source, "i");
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

export const EnvironmentSettings: React.FC<EnvironmentSettingsProps> = ({ patterns, onChange }) => {
  const [probe, setProbe] = React.useState("");

  // Keys must be stable: keying on the array index makes React reuse DOM nodes
  // against shifted data after a delete, landing focus on the wrong row.
  const rows = React.useMemo(
    () => patterns.map((pattern) => ({ ...pattern, id: pattern.id ?? nextId() })),
    [patterns]
  );

  const probeResult = React.useMemo(
    () => (probe.trim() ? matchStageToEnvironment(probe, rows) : null),
    [probe, rows]
  );

  const update = (id: string, changes: Partial<EnvironmentPattern>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...changes } : row)));

  const setAllEnabled = (predicate: (row: EnvironmentPattern) => boolean) =>
    onChange(rows.map((row) => ({ ...row, enabled: predicate(row) })));

  const includedCount = rows.filter(isPatternEnabled).length;
  const hasProductionPattern = rows.some(isProductionPattern);

  const remove = (id: string) => onChange(rows.filter((row) => row.id !== id));

  const add = () =>
    onChange([
      ...rows,
      {
        id: nextId(),
        name: "New environment",
        regex: "",
        order: rows.length + 1,
        color: "#7c8aa5",
        enabled: true,
      },
    ]);

  return (
    <section>
      <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 650 }}>Environment patterns</h3>
      <p className="ax-fine" style={{ marginTop: 0, marginBottom: 12 }}>
        Pipeline stage names are matched against these regular expressions in order. The first match
        wins. Case is ignored. Clear <strong>Include</strong> to filter an environment out entirely:
        its stages are then never matched, so they cost nothing to scan and appear nowhere in the
        dashboard.
      </p>

      <div className="ax-row" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="ax-btn ax-btn--sm"
          onClick={() => setAllEnabled(isProductionPattern)}
          disabled={!hasProductionPattern}
          title={
            hasProductionPattern
              ? undefined
              : "No environment is named like production, so there is nothing to narrow to"
          }
        >
          Production only
        </button>
        <button
          type="button"
          className="ax-btn ax-btn--sm"
          onClick={() => setAllEnabled(() => true)}
        >
          Include all
        </button>
        <span className="ax-fine">
          {includedCount} of {rows.length} included
        </span>
      </div>

      <div className="ax-table-wrap">
        <table className="ax-table">
          <caption className="ax-sr-only">Environment pattern definitions</caption>
          <thead>
            <tr>
              <th scope="col" className="ax-center" style={{ width: 72 }}>
                Include
              </th>
              <th scope="col" style={{ width: 70 }}>
                Order
              </th>
              <th scope="col">Name</th>
              <th scope="col">Stage name pattern</th>
              <th scope="col" style={{ width: 70 }}>
                Colour
              </th>
              <th scope="col" style={{ width: 44 }}>
                <span className="ax-sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const error = row.regex ? regexError(row.regex) : "Pattern is empty";
              const included = isPatternEnabled(row);
              return (
                <tr key={row.id} style={included ? undefined : { opacity: 0.55 }}>
                  <td className="ax-center">
                    <input
                      type="checkbox"
                      id={`enabled-${row.id}`}
                      checked={included}
                      onChange={(e) => update(row.id!, { enabled: e.target.checked })}
                    />
                    <label className="ax-sr-only" htmlFor={`enabled-${row.id}`}>
                      Include {row.name} in the analysis
                    </label>
                  </td>
                  <td>
                    <label className="ax-sr-only" htmlFor={`order-${row.id}`}>
                      Match order for {row.name}
                    </label>
                    <input
                      id={`order-${row.id}`}
                      className="ax-input"
                      type="number"
                      style={{ width: 60 }}
                      value={row.order}
                      onChange={(e) =>
                        update(row.id!, { order: parseInt(e.target.value, 10) || row.order })
                      }
                    />
                  </td>
                  <td>
                    <label className="ax-sr-only" htmlFor={`name-${row.id}`}>
                      Environment name
                    </label>
                    <input
                      id={`name-${row.id}`}
                      className="ax-input"
                      style={{ width: "100%" }}
                      value={row.name}
                      onChange={(e) => update(row.id!, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <label className="ax-sr-only" htmlFor={`regex-${row.id}`}>
                      Regular expression for {row.name}
                    </label>
                    <input
                      id={`regex-${row.id}`}
                      className={`ax-input ax-mono${error ? " ax-input--invalid" : ""}`}
                      style={{ width: "100%" }}
                      value={row.regex}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `regex-err-${row.id}` : undefined}
                      onChange={(e) => update(row.id!, { regex: e.target.value })}
                    />
                    {error && (
                      <div
                        id={`regex-err-${row.id}`}
                        className="ax-fine"
                        style={{ color: "var(--ax-danger)" }}
                      >
                        {error}
                      </div>
                    )}
                  </td>
                  <td>
                    <label className="ax-sr-only" htmlFor={`color-${row.id}`}>
                      Colour for {row.name}
                    </label>
                    <input
                      id={`color-${row.id}`}
                      type="color"
                      className="ax-input"
                      style={{ width: 44, padding: 2, height: 30 }}
                      value={row.color}
                      onChange={(e) => update(row.id!, { color: e.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ax-btn ax-btn--icon ax-btn--ghost"
                      onClick={() => remove(row.id!)}
                      aria-label={`Remove ${row.name}`}
                    >
                      <IconX size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="ax-row" style={{ marginTop: 12 }}>
        <button type="button" className="ax-btn ax-btn--sm" onClick={add}>
          Add environment
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <label htmlFor="ax-pattern-probe" style={{ fontSize: 12.5, color: "var(--ax-text-2)" }}>
          Test a stage name
        </label>
        <div className="ax-row" style={{ marginTop: 6 }}>
          <input
            id="ax-pattern-probe"
            className="ax-input ax-mono"
            style={{ flex: "1 1 260px" }}
            placeholder="e.g. Deploy_PRD_EU"
            value={probe}
            onChange={(e) => setProbe(e.target.value)}
          />
          {probe.trim() &&
            (probeResult ? (
              <span className="ax-pill ax-pill--success">matches {probeResult}</span>
            ) : (
              <span className="ax-pill ax-pill--warn">no match</span>
            ))}
        </div>
        <p className="ax-fine" style={{ marginTop: 6 }}>
          A stage that matches nothing is ignored entirely. This is the usual cause of an empty
          dashboard.
        </p>
      </div>
    </section>
  );
};
