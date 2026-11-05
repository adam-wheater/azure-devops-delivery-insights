import * as React from "react";
import { DoraMetrics, DoraWeeklyTrend } from "../models/interfaces";
import { BandName, BandPill, Sparkline } from "./ui";

interface DoraScorecardProps {
  metrics: DoraMetrics;
  previousMetrics?: DoraMetrics | null;
  trends?: DoraWeeklyTrend[];
}

const BAND_VAR: Record<string, string> = {
  Elite: "var(--ax-band-elite)",
  High: "var(--ax-band-high)",
  Medium: "var(--ax-band-medium)",
  Low: "var(--ax-band-low)",
};

function delta(
  current: number,
  previous: number | undefined,
  lowerIsBetter: boolean
): { className: string; glyph: string; label: string } | null {
  if (previous === undefined || previous === current) return null;
  const improved = lowerIsBetter ? current < previous : current > previous;
  const change =
    previous === 0 ? 100 : Math.round(((current - previous) / Math.abs(previous)) * 100);
  return {
    className: improved ? "ax-delta--up" : "ax-delta--down",
    glyph: current > previous ? "▲" : "▼",
    label: `${change > 0 ? "+" : ""}${change}%`,
  };
}

const MetricCard: React.FC<{
  title: string;
  value: string;
  unit: string;
  band: BandName;
  spark?: number[];
  trend: ReturnType<typeof delta>;
}> = ({ title, value, unit, band, spark, trend }) => {
  const slug = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <article
      className="ax-metric"
      data-testid={`dora-card-${slug}`}
      style={{ ["--ax-metric-accent" as string]: BAND_VAR[band] ?? "var(--ax-accent)" }}
      aria-label={`${title}, ${value} ${unit}, ${band}`}
    >
      <div className="ax-metric__label">{title}</div>
      <div className="ax-metric__value" aria-live="polite">
        {value}
        <span className="ax-metric__unit">{unit}</span>
      </div>
      {spark && spark.length > 1 && (
        <div style={{ color: BAND_VAR[band] ?? "var(--ax-accent)" }}>
          <Sparkline values={spark} label={`${title} trend over recent weeks`} />
        </div>
      )}
      <div className="ax-metric__foot">
        <BandPill band={band} testId={`dora-band-${slug}`} />
        {trend && (
          <span className={`ax-delta ${trend.className}`}>
            <span aria-hidden="true">{trend.glyph}</span> {trend.label}
          </span>
        )}
      </div>
    </article>
  );
};

const DoraScorecardInner: React.FC<DoraScorecardProps> = ({ metrics, previousMetrics, trends }) => {
  const df = metrics.deploymentFrequency;
  const lt = metrics.leadTimeForChanges;
  const cfr = metrics.changeFailureRate;
  const mttr = metrics.meanTimeToRecovery;

  const series = React.useMemo(() => {
    const list = trends ?? [];
    return {
      df: list.map((t) => t.deploymentFrequency),
      lt: list.map((t) => t.leadTimeHours),
      cfr: list.map((t) => t.changeFailureRate),
      mttr: list.map((t) => t.mttrHours),
    };
  }, [trends]);

  return (
    <div className="ax-metrics" data-testid="dora-scorecard">
      <MetricCard
        title="Deployment Frequency"
        value={String(df.value)}
        unit={df.unit}
        band={df.band}
        spark={series.df}
        trend={delta(df.value, previousMetrics?.deploymentFrequency?.value, false)}
      />
      <MetricCard
        title="Lead Time for Changes"
        value={String(lt.medianHours)}
        unit="hours (median)"
        band={lt.band}
        spark={series.lt}
        trend={delta(lt.medianHours, previousMetrics?.leadTimeForChanges?.medianHours, true)}
      />
      <MetricCard
        title="Change Failure Rate"
        value={`${cfr.percentage}%`}
        unit="of deployments"
        band={cfr.band}
        spark={series.cfr}
        trend={delta(cfr.percentage, previousMetrics?.changeFailureRate?.percentage, true)}
      />
      <MetricCard
        title="Mean Time to Recovery"
        value={String(mttr.medianHours)}
        unit="hours (median)"
        band={mttr.band}
        spark={series.mttr}
        trend={delta(mttr.medianHours, previousMetrics?.meanTimeToRecovery?.medianHours, true)}
      />
    </div>
  );
};

export const DoraScorecard = React.memo(DoraScorecardInner);
