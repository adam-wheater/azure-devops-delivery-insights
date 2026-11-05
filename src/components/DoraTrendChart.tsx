import * as React from "react";
import { DoraWeeklyTrend } from "../models/interfaces";
import { Card, EmptyState } from "./ui";

interface DoraTrendChartProps {
  trends: DoraWeeklyTrend[];
}

const WIDTH = 220;
const HEIGHT = 74;
const PAD = 6;

interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
  points: { x: number; y: number; value: number; week: string }[];
  line: string;
  area: string;
  min: number;
  max: number;
}

function buildSeries(
  key: string,
  label: string,
  color: string,
  values: number[],
  weeks: string[]
): Series {
  // Safe to spread: one entry per ISO week, capped at ~52 by the 365-day settings limit.
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const points = values.map((value, i) => ({
    x: PAD + (i / Math.max(1, values.length - 1)) * (WIDTH - 2 * PAD),
    y: PAD + (1 - (value - min) / range) * (HEIGHT - 2 * PAD),
    value,
    week: weeks[i],
  }));

  const line = points
    .map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`)
    .join(" ");
  const area = `${PAD},${HEIGHT - PAD} ${line} ${WIDTH - PAD},${HEIGHT - PAD}`;

  return { key, label, color, values, points, line, area, min, max };
}

const MiniChart: React.FC<{ series: Series; unit: string }> = ({ series, unit }) => {
  const first = series.values[0];
  const last = series.values[series.values.length - 1];
  const summary = `${series.label}: ${first}${unit} to ${last}${unit} over ${series.values.length} weeks, ranging ${series.min}${unit} to ${series.max}${unit}`;

  return (
    <div style={{ flex: "1 1 200px", minWidth: 180 }}>
      <div className="ax-fine" style={{ marginBottom: 6, color: "var(--ax-text-2)", fontSize: 12 }}>
        {series.label}
      </div>
      <svg
        className="ax-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        style={{ height: HEIGHT, color: series.color }}
        role="img"
        aria-label={summary}
      >
        <polygon points={series.area} fill="currentColor" opacity={0.12} />
        <polyline
          points={series.line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {series.points.map((point, i) => (
          <circle
            key={i}
            className="ax-point"
            cx={point.x}
            cy={point.y}
            r={2.5}
            fill="currentColor"
            opacity={i === series.points.length - 1 ? 1 : 0.6}
          >
            <title>{`${point.week}: ${point.value}${unit}`}</title>
          </circle>
        ))}
      </svg>
      <table className="ax-sr-only">
        <caption>{series.label} by week</caption>
        <tbody>
          {series.points.map((point) => (
            <tr key={point.week}>
              <th scope="row">{point.week}</th>
              <td>
                {point.value}
                {unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const DoraTrendChartInner: React.FC<DoraTrendChartProps> = ({ trends }) => {
  const model = React.useMemo(() => {
    if (trends.length < 2) return null;
    const weeks = trends.map((t) => t.week);
    return [
      {
        series: buildSeries(
          "df",
          "Deployment frequency",
          "var(--ax-band-elite)",
          trends.map((t) => t.deploymentFrequency),
          weeks
        ),
        unit: "/day",
      },
      {
        series: buildSeries(
          "lt",
          "Lead time",
          "var(--ax-band-high)",
          trends.map((t) => t.leadTimeHours),
          weeks
        ),
        unit: "h",
      },
      {
        series: buildSeries(
          "cfr",
          "Change failure rate",
          "var(--ax-band-medium)",
          trends.map((t) => t.changeFailureRate),
          weeks
        ),
        unit: "%",
      },
      {
        series: buildSeries(
          "mttr",
          "Mean time to recovery",
          "var(--ax-band-low)",
          trends.map((t) => t.mttrHours),
          weeks
        ),
        unit: "h",
      },
    ];
  }, [trends]);

  return (
    <Card title="Weekly trends" testId="dora-trend-chart">
      {!model ? (
        <EmptyState title="Not enough history yet">
          At least two weeks of production deployments are needed to draw a trend.
        </EmptyState>
      ) : (
        <div className="ax-row" style={{ gap: 16, alignItems: "flex-start" }}>
          {model.map(({ series, unit }) => (
            <MiniChart key={series.key} series={series} unit={unit} />
          ))}
        </div>
      )}
    </Card>
  );
};

export const DoraTrendChart = React.memo(DoraTrendChartInner);
