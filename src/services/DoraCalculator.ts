import {
  DeploymentRecord,
  DoraMetrics,
  DoraWeeklyTrend,
  DEFAULT_DORA_BANDS,
} from "../models/interfaces";

type Band = "Elite" | "High" | "Medium" | "Low";

/**
 * A deployment counts as a failure event if it failed outright, OR if a lease
 * proves it eventually reached production but a production stage failed on the way.
 *
 * This is how a "succeeded with a failed attempt" build contributes to change
 * failure rate and MTTR without emitting a second record, which would inflate
 * deployment frequency.
 */
export const isFailureEvent = (d: DeploymentRecord): boolean =>
  d.status === "failed" || d.hadFailedProdStage === true;

export function classifyBand(
  value: number,
  thresholds: { elite: number; high: number; medium: number },
  isLowerBetter = true
): Band {
  if (isLowerBetter) {
    if (value <= thresholds.elite) return "Elite";
    if (value <= thresholds.high) return "High";
    if (value <= thresholds.medium) return "Medium";
    return "Low";
  } else {
    if (value >= thresholds.elite) return "Elite";
    if (value >= thresholds.high) return "High";
    if (value >= thresholds.medium) return "Medium";
    return "Low";
  }
}

export function calculateDeploymentFrequency(
  prodDeployments: DeploymentRecord[],
  periodDays: number,
  bands = DEFAULT_DORA_BANDS.deploymentFrequency
): { value: number; unit: string; band: Band } {
  if (periodDays <= 0 || prodDeployments.length === 0) {
    return { value: 0, unit: "per day", band: "Low" };
  }
  const perDay = prodDeployments.length / periodDays;
  let value: number;
  let unit: string;

  if (perDay >= 1) {
    value = Math.round(perDay * 10) / 10;
    unit = "per day";
  } else if (perDay >= 1 / 7) {
    value = Math.round(perDay * 7 * 10) / 10;
    unit = "per week";
  } else {
    value = Math.round(perDay * 30 * 10) / 10;
    unit = "per month";
  }

  const band = classifyBand(perDay, bands, false);
  return { value, unit, band };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function calculateLeadTime(
  deployments: DeploymentRecord[],
  bands = DEFAULT_DORA_BANDS.leadTime
): { medianHours: number; band: Band } {
  const successfulWithCommitTime = deployments.filter(
    (d) => d.status === "succeeded" && d.firstCommitTime !== null
  );

  if (successfulWithCommitTime.length === 0) {
    return { medianHours: 0, band: "Low" };
  }

  const leadTimes = successfulWithCommitTime.map((d) => {
    const commitTime = d.firstCommitTime!.getTime();
    const finishTime = d.finishTime.getTime();
    return Math.max(0, (finishTime - commitTime) / (1000 * 60 * 60));
  });

  const medianHours = Math.round(median(leadTimes) * 10) / 10;
  const band = classifyBand(medianHours, bands, true);
  return { medianHours, band };
}

export function calculateChangeFailureRate(
  prodDeployments: DeploymentRecord[],
  bands = DEFAULT_DORA_BANDS.changeFailureRate
): { percentage: number; band: Band } {
  if (prodDeployments.length === 0) {
    return { percentage: 0, band: "Elite" };
  }

  const sorted = [...prodDeployments].sort(
    (a, b) => a.finishTime.getTime() - b.finishTime.getTime()
  );

  let failureFollowed = 0;

  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].status !== "succeeded") continue;

    // A lease-verified success that had a failed production stage is itself a
    // failure event — no need to look ahead.
    if (sorted[i].hadFailedProdStage) {
      failureFollowed++;
      continue;
    }

    // Check if there's a failure within 24 hours after this deployment
    const deployTime = sorted[i].finishTime.getTime();
    const window24h = deployTime + 24 * 60 * 60 * 1000;

    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].finishTime.getTime() > window24h) break;
      if (isFailureEvent(sorted[j])) {
        failureFollowed++;
        break;
      }
    }
  }

  const successCount = sorted.filter((d) => d.status === "succeeded").length;
  if (successCount === 0) {
    return { percentage: 100, band: "Low" };
  }

  const percentage = Math.round((failureFollowed / successCount) * 1000) / 10;
  const band = classifyBand(percentage, bands, true);
  return { percentage, band };
}

export function calculateMttr(
  prodDeployments: DeploymentRecord[],
  bands = DEFAULT_DORA_BANDS.mttr
): { medianHours: number; band: Band } {
  if (prodDeployments.length === 0) {
    return { medianHours: 0, band: "Elite" };
  }

  const sorted = [...prodDeployments].sort(
    (a, b) => a.finishTime.getTime() - b.finishTime.getTime()
  );

  // Single reverse pass: nextSuccessAt[i] is the finish time of the first
  // succeeded deployment at or after index i. The previous nested scan was O(n^2)
  // because a trailing run of failures rescanned to the end each time.
  const nextSuccessAt = new Array<number>(sorted.length).fill(-1);
  let upcomingSuccess = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    nextSuccessAt[i] = upcomingSuccess;
    if (sorted[i].status === "succeeded") upcomingSuccess = sorted[i].finishTime.getTime();
  }

  const recoveryTimes: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].status !== "failed") continue;
    const recoveredAt = nextSuccessAt[i];
    if (recoveredAt < 0) continue;
    recoveryTimes.push((recoveredAt - sorted[i].finishTime.getTime()) / (1000 * 60 * 60));
  }

  if (recoveryTimes.length === 0) {
    return { medianHours: 0, band: "Elite" };
  }

  const medianHours = Math.round(median(recoveryTimes) * 10) / 10;
  const band = classifyBand(medianHours, bands, true);
  return { medianHours, band };
}

export function calculateAllDora(
  deployments: DeploymentRecord[],
  prodDeployments: DeploymentRecord[],
  periodDays: number,
  bands = DEFAULT_DORA_BANDS
): DoraMetrics {
  return {
    deploymentFrequency: calculateDeploymentFrequency(
      prodDeployments,
      periodDays,
      bands.deploymentFrequency
    ),
    leadTimeForChanges: calculateLeadTime(prodDeployments, bands.leadTime),
    changeFailureRate: calculateChangeFailureRate(prodDeployments, bands.changeFailureRate),
    meanTimeToRecovery: calculateMttr(prodDeployments, bands.mttr),
  };
}

function getISOWeek(date: Date): string {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function computeWeeklyTrends(deployments: DeploymentRecord[]): DoraWeeklyTrend[] {
  if (deployments.length === 0) return [];

  const weekMap = new Map<string, DeploymentRecord[]>();

  for (const dep of deployments) {
    const week = getISOWeek(dep.finishTime);
    const existing = weekMap.get(week);
    if (existing) {
      existing.push(dep);
    } else {
      weekMap.set(week, [dep]);
    }
  }

  const weeks = [...weekMap.keys()].sort();
  const trends: DoraWeeklyTrend[] = [];

  for (const week of weeks) {
    const weekDeps = weekMap.get(week)!;
    const succeeded = weekDeps.filter((d) => d.status === "succeeded");

    // Deployment frequency (per day in this week, assuming 7-day week)
    const deploymentFrequency = Math.round((weekDeps.length / 7) * 10) / 10;

    // Lead time
    const leadTimes = succeeded
      .filter((d) => d.firstCommitTime !== null)
      .map((d) => (d.finishTime.getTime() - d.firstCommitTime!.getTime()) / (1000 * 60 * 60));
    const leadTimeHours = leadTimes.length > 0 ? Math.round(median(leadTimes) * 10) / 10 : 0;

    // Change failure rate
    let failureFollowed = 0;
    const sortedWeek = [...weekDeps].sort(
      (a, b) => a.finishTime.getTime() - b.finishTime.getTime()
    );
    for (let i = 0; i < sortedWeek.length; i++) {
      if (sortedWeek[i].status !== "succeeded") continue;
      const deployTime = sortedWeek[i].finishTime.getTime();
      const window24h = deployTime + 24 * 60 * 60 * 1000;
      if (sortedWeek[i].hadFailedProdStage) {
        failureFollowed++;
        continue;
      }
      for (let j = i + 1; j < sortedWeek.length; j++) {
        if (sortedWeek[j].finishTime.getTime() > window24h) break;
        if (isFailureEvent(sortedWeek[j])) {
          failureFollowed++;
          break;
        }
      }
    }
    const changeFailureRate =
      succeeded.length > 0 ? Math.round((failureFollowed / succeeded.length) * 1000) / 10 : 0;

    // MTTR
    const recoveryTimes: number[] = [];
    for (let i = 0; i < sortedWeek.length; i++) {
      if (sortedWeek[i].status !== "failed") continue;
      for (let j = i + 1; j < sortedWeek.length; j++) {
        if (sortedWeek[j].status === "succeeded") {
          recoveryTimes.push(
            (sortedWeek[j].finishTime.getTime() - sortedWeek[i].finishTime.getTime()) /
              (1000 * 60 * 60)
          );
          break;
        }
      }
    }
    const mttrHours = recoveryTimes.length > 0 ? Math.round(median(recoveryTimes) * 10) / 10 : 0;

    trends.push({
      week,
      deploymentFrequency,
      leadTimeHours,
      changeFailureRate,
      mttrHours,
    });
  }

  return trends;
}
