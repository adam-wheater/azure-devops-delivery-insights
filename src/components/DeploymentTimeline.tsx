import * as React from "react";
import { DeploymentRecord, EnvironmentPattern } from "../models/interfaces";
import { Card, EmptyState } from "./ui";

interface DeploymentTimelineProps {
  deployments: DeploymentRecord[];
  patterns: EnvironmentPattern[];
}

const WIDTH = 900;
const ROW_HEIGHT = 46;
const LEFT_PAD = 132;
const RIGHT_PAD = 24;
const TOP_PAD = 28;
const BOTTOM_PAD = 34;
/** Markers are 10px across, so this is roughly the point at which a lane saturates. */
const BIN_PX = 9;

interface Bin {
  key: string;
  x: number;
  count: number;
  anyFailed: boolean;
  anyUnverified: boolean;
  representative: DeploymentRecord;
}

function formatTick(time: number, spanDays: number): string {
  const date = new Date(time);
  if (spanDays > 200)
    return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const DeploymentTimelineInner: React.FC<DeploymentTimelineProps> = ({ deployments, patterns }) => {
  const model = React.useMemo(() => {
    const sortedPatterns = [...patterns].sort((a, b) => a.order - b.order);
    const envNames = sortedPatterns.map((p) => p.name);
    const envIndex = new Map(envNames.map((name, i) => [name, i]));

    // reduce() rather than Math.min(...times) — spreading a large array both
    // allocates an intermediate and blows the call stack past ~125k elements.
    let minTime = Infinity;
    let maxTime = -Infinity;
    for (const dep of deployments) {
      const t = dep.finishTime.getTime();
      if (!Number.isFinite(t)) continue;
      if (t < minTime) minTime = t;
      if (t > maxTime) maxTime = t;
    }
    if (!Number.isFinite(minTime)) {
      minTime = Date.now();
      maxTime = minTime;
    }
    const range = maxTime - minTime || 1;
    const plotWidth = WIDTH - LEFT_PAD - RIGHT_PAD;
    const xPos = (time: number) => LEFT_PAD + ((time - minTime) / range) * plotWidth;

    // Bin by lane and rounded x so a busy lane stays readable and the DOM stays
    // bounded regardless of how many deployments there are.
    const bins = new Map<string, Bin>();
    for (const dep of deployments) {
      const lane = envIndex.get(dep.environment);
      if (lane === undefined) continue;
      const x = xPos(dep.finishTime.getTime());
      const key = `${lane}:${Math.round(x / BIN_PX)}`;
      const existing = bins.get(key);
      if (existing) {
        existing.count++;
        existing.anyFailed = existing.anyFailed || dep.status === "failed";
        existing.anyUnverified = existing.anyUnverified || dep.prodUnverified;
        if (dep.finishTime.getTime() > existing.representative.finishTime.getTime()) {
          existing.representative = dep;
        }
      } else {
        bins.set(key, {
          key,
          x: Math.round(x / BIN_PX) * BIN_PX,
          count: 1,
          anyFailed: dep.status === "failed",
          anyUnverified: dep.prodUnverified,
          representative: dep,
        });
      }
    }

    const laneBins = new Map<number, Bin[]>();
    for (const bin of bins.values()) {
      const lane = Number(bin.key.split(":")[0]);
      const list = laneBins.get(lane);
      if (list) list.push(bin);
      else laneBins.set(lane, [bin]);
    }

    const spanDays = range / 86_400_000;
    const tickCount = 5;
    const ticks = Array.from({ length: tickCount }, (_, i) => {
      const time = minTime + (range * i) / (tickCount - 1);
      return { x: xPos(time), label: formatTick(time, spanDays) };
    });

    return {
      sortedPatterns,
      envNames,
      laneBins,
      ticks,
      height: TOP_PAD + envNames.length * ROW_HEIGHT + BOTTOM_PAD,
    };
  }, [deployments, patterns]);

  if (deployments.length === 0) {
    return (
      <Card title="Deployment timeline" testId="deployment-timeline">
        <EmptyState title="No deployments to plot" />
      </Card>
    );
  }

  return (
    <Card
      title="Deployment timeline"
      hint="Every deployment across the analysis window. Dense periods are grouped, and the badge shows how many."
      testId="deployment-timeline"
    >
      <div className="ax-table-wrap">
        <svg
          className="ax-chart"
          viewBox={`0 0 ${WIDTH} ${model.height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ minWidth: 620, height: "auto" }}
          role="img"
          aria-label={`Timeline of ${deployments.length} deployments across ${model.envNames.length} environments`}
        >
          {model.ticks.map((tick, i) => (
            <g key={`tick-${i}`}>
              <line
                className="ax-grid"
                x1={tick.x}
                x2={tick.x}
                y1={TOP_PAD - 8}
                y2={model.height - BOTTOM_PAD + 6}
              />
              <text x={tick.x} y={model.height - BOTTOM_PAD + 22} fontSize={11} textAnchor="middle">
                {tick.label}
              </text>
            </g>
          ))}

          {model.envNames.map((name, laneIndex) => {
            const y = TOP_PAD + laneIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
            const pattern = model.sortedPatterns[laneIndex];
            return (
              <g key={name} className="ax-timeline-lane">
                <rect
                  className="ax-timeline-lane__bg"
                  x={LEFT_PAD - 8}
                  y={y - ROW_HEIGHT / 2 + 4}
                  width={WIDTH - LEFT_PAD - RIGHT_PAD + 16}
                  height={ROW_HEIGHT - 8}
                  rx={8}
                  fill="transparent"
                />
                <rect
                  x={LEFT_PAD - 118}
                  y={y - 5}
                  width={10}
                  height={10}
                  rx={3}
                  fill={pattern.color}
                />
                <text x={LEFT_PAD - 100} y={y + 4} fontSize={12} fill="var(--ax-text-2)">
                  {name}
                </text>
                <line
                  className="ax-grid"
                  x1={LEFT_PAD}
                  x2={WIDTH - RIGHT_PAD}
                  y1={y}
                  y2={y}
                  strokeDasharray="3,5"
                />

                {(model.laneBins.get(laneIndex) ?? []).map((bin) => {
                  const record = bin.representative;
                  const color = bin.anyFailed
                    ? "var(--ax-prod-failed)"
                    : bin.anyUnverified
                      ? "var(--ax-prod-unverified)"
                      : pattern.color;
                  const label = `${record.pipelineName} build ${record.buildNumber}, ${
                    name
                  }, ${record.status}${bin.count > 1 ? `, ${bin.count} deployments in this period` : ""}`;
                  return (
                    <g
                      key={bin.key}
                      className="ax-marker"
                      tabIndex={0}
                      role="img"
                      aria-label={label}
                    >
                      <title>{label}</title>
                      <circle className="ax-marker__ring" cx={bin.x} cy={y} r={9} />
                      {bin.anyFailed ? (
                        <path
                          d={`M${bin.x - 4},${y - 4} L${bin.x + 4},${y + 4} M${bin.x + 4},${y - 4} L${bin.x - 4},${y + 4}`}
                          stroke={color}
                          strokeWidth={2.4}
                          strokeLinecap="round"
                        />
                      ) : (
                        <circle
                          cx={bin.x}
                          cy={y}
                          r={5}
                          fill={bin.anyUnverified ? "transparent" : color}
                          stroke={color}
                          strokeWidth={bin.anyUnverified ? 2 : 0}
                          strokeDasharray={bin.anyUnverified ? "2.5,2" : undefined}
                        />
                      )}
                      {bin.count > 1 && (
                        <text
                          x={bin.x}
                          y={y - 10}
                          fontSize={9}
                          textAnchor="middle"
                          fill="var(--ax-text-3)"
                        >
                          {bin.count}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="ax-row" style={{ marginTop: 12, gap: 16 }}>
        <span className="ax-fine">
          <span className="ax-chip ax-chip--verified">●</span> succeeded
        </span>
        <span className="ax-fine">
          <span className="ax-chip ax-chip--unverified">○</span> stage-inferred production
        </span>
        <span className="ax-fine">
          <span className="ax-chip ax-chip--failed">✕</span> failed
        </span>
      </div>
    </Card>
  );
};

export const DeploymentTimeline = React.memo(DeploymentTimelineInner);
