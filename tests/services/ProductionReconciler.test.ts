import {
  collapseRetries,
  isSucceeded,
  isCompleted,
  isNotAttempted,
  reconcileBuild,
  reconcileOrphanLeases,
  BuildObservation,
  StageObservation,
  ReconcileOptions,
} from "@/services/ProductionReconciler";
import { PrdRelease } from "@/services/ProductionSignalService";

const TASK_RESULT_SUCCEEDED = 0;
const TASK_RESULT_SUCCEEDED_WITH_ISSUES = 1;
const TASK_RESULT_FAILED = 2;
const TIMELINE_COMPLETED = 2;

const HYBRID: ReconcileOptions = { mode: "hybrid", productionEnvironmentLabel: "Production" };

function stage(overrides: Partial<StageObservation> = {}): StageObservation {
  return {
    stageKey: "deploy_prd",
    stageName: "Deploy_PRD",
    attempt: 1,
    envName: "Production",
    isProdPattern: true,
    result: TASK_RESULT_SUCCEEDED,
    state: TIMELINE_COMPLETED,
    startTime: new Date("2024-05-01T10:00:00Z"),
    finishTime: new Date("2024-05-01T10:30:00Z"),
    ...overrides,
  };
}

function build(overrides: Partial<BuildObservation> = {}): BuildObservation {
  return {
    buildId: 500,
    definitionId: 7,
    pipelineName: "payments-api",
    buildNumber: "20240501.3",
    buildStartTime: new Date("2024-05-01T09:50:00Z"),
    buildFinishTime: new Date("2024-05-01T10:35:00Z"),
    stages: [stage()],
    lease: null,
    ...overrides,
  };
}

function lease(overrides: Partial<PrdRelease> = {}): PrdRelease {
  return {
    buildId: 500,
    definitionId: 7,
    releasedOn: new Date("2024-05-01T10:31:00Z"),
    validUntil: new Date("2027-01-01T00:00:00Z"),
    leaseId: 42,
    ...overrides,
  };
}

describe("enum predicates", () => {
  it("treats TaskResult.Succeeded (0) as success despite being falsy", () => {
    expect(isSucceeded(TASK_RESULT_SUCCEEDED)).toBe(true);
    expect(isSucceeded(TASK_RESULT_SUCCEEDED_WITH_ISSUES)).toBe(true);
  });

  it("does not treat failure, skip, cancel or abandon as success", () => {
    for (const result of [2, 3, 4, 5, 6, 7]) {
      expect(isSucceeded(result)).toBe(false);
    }
  });

  it("never matches the string forms that the REST client does not emit", () => {
    expect(isSucceeded("succeeded")).toBe(false);
    expect(isCompleted("completed")).toBe(false);
  });

  it("treats skipped, cancelled and abandoned stages as never attempted", () => {
    expect(isNotAttempted(3)).toBe(true); // Canceled — includes a timed-out approval gate
    expect(isNotAttempted(4)).toBe(true); // Skipped
    expect(isNotAttempted(5)).toBe(true); // Abandoned
  });

  it("treats stages parked awaiting a human as never attempted, not as failures", () => {
    // An RFC approval that has not been actioned. Counting these as deployment
    // failures is what made change failure rate meaningless.
    expect(isNotAttempted(6)).toBe(true); // ManuallyQueued
    expect(isNotAttempted(7)).toBe(true); // DependentOnManualQueue
  });

  it("does not swallow a genuine failure", () => {
    expect(isNotAttempted(TASK_RESULT_FAILED)).toBe(false);
    expect(isNotAttempted(0)).toBe(false);
    expect(isNotAttempted(1)).toBe(false);
  });

  it("only accepts the numeric completed state", () => {
    expect(isCompleted(TIMELINE_COMPLETED)).toBe(true);
    expect(isCompleted(1)).toBe(false);
  });
});

describe("collapseRetries", () => {
  it("keeps the highest attempt per stage key", () => {
    const { stages, collapsed } = collapseRetries([
      stage({ attempt: 1, result: TASK_RESULT_FAILED }),
      stage({ attempt: 2, result: TASK_RESULT_SUCCEEDED }),
    ]);
    expect(stages).toHaveLength(1);
    expect(stages[0].attempt).toBe(2);
    expect(collapsed).toBe(1);
  });

  it("keeps distinct stages separate", () => {
    const { stages, collapsed } = collapseRetries([
      stage({ stageKey: "a" }),
      stage({ stageKey: "b" }),
    ]);
    expect(stages).toHaveLength(2);
    expect(collapsed).toBe(0);
  });
});

describe("reconcileBuild — production precedence", () => {
  it("emits one lease+stage success when both signals agree", () => {
    const { records, counters } = reconcileBuild(build({ lease: lease() }), HYBRID);
    const prod = records.filter((r) => r.isProduction);
    expect(prod).toHaveLength(1);
    expect(prod[0].prodSource).toBe("lease+stage");
    expect(prod[0].status).toBe("succeeded");
    expect(prod[0].prodUnverified).toBe(false);
    expect(prod[0].releasedToPrdAt).toEqual(lease().releasedOn);
    expect(counters.prodFromLease).toBe(1);
  });

  it("trusts the lease even when no stage matched a production pattern", () => {
    const { records, counters } = reconcileBuild(
      build({
        stages: [stage({ envName: "QA", isProdPattern: false, stageKey: "qa" })],
        lease: lease(),
      }),
      HYBRID
    );
    const prod = records.filter((r) => r.isProduction);
    expect(prod).toHaveLength(1);
    expect(prod[0].prodSource).toBe("lease");
    expect(prod[0].environment).toBe("Production");
    expect(prod[0].finishTime).toEqual(lease().releasedOn);
    expect(counters.prodFromLease).toBe(1);
    // The QA stage is still reported as non-production activity.
    expect(records.filter((r) => !r.isProduction)).toHaveLength(1);
  });

  it("still counts a delivery when the prod stage failed but a lease exists, and flags the failed attempt", () => {
    const { records } = reconcileBuild(
      build({ stages: [stage({ result: TASK_RESULT_FAILED })], lease: lease() }),
      HYBRID
    );
    const prod = records.filter((r) => r.isProduction);
    expect(prod).toHaveLength(1);
    expect(prod[0].status).toBe("succeeded");
    expect(prod[0].prodSource).toBe("lease");
    expect(prod[0].hadFailedProdStage).toBe(true);
  });

  it("reports a production FAILURE from the timeline when no lease exists", () => {
    const { records, counters } = reconcileBuild(
      build({ stages: [stage({ result: TASK_RESULT_FAILED })] }),
      HYBRID
    );
    const prod = records.filter((r) => r.isProduction);
    expect(prod).toHaveLength(1);
    expect(prod[0].status).toBe("failed");
    expect(prod[0].prodSource).toBe("stage");
    expect(counters.prodFailuresFromTimeline).toBe(1);
  });

  it("marks a stage-only production success as unverified", () => {
    const { records, counters } = reconcileBuild(build(), HYBRID);
    const prod = records.filter((r) => r.isProduction);
    expect(prod[0].prodSource).toBe("stage");
    expect(prod[0].prodUnverified).toBe(true);
    expect(counters.prodFromStageOnly).toBe(1);
  });

  it("never emits more than one production record for a multi-region build", () => {
    const { records } = reconcileBuild(
      build({
        stages: [
          stage({ stageKey: "prd_eu", stageName: "Deploy_PRD_EU" }),
          stage({ stageKey: "prd_us", stageName: "Deploy_PRD_US" }),
        ],
        lease: lease(),
      }),
      HYBRID
    );
    const prod = records.filter((r) => r.isProduction);
    expect(prod).toHaveLength(1);
    expect(prod[0].stageNames).toEqual(["Deploy_PRD_EU", "Deploy_PRD_US"]);
  });

  it("does not count a retried stage twice", () => {
    const { records, counters } = reconcileBuild(
      build({
        stages: [
          stage({ attempt: 1, result: TASK_RESULT_FAILED }),
          stage({ attempt: 2, result: TASK_RESULT_SUCCEEDED }),
        ],
      }),
      HYBRID
    );
    expect(records.filter((r) => r.isProduction)).toHaveLength(1);
    expect(counters.retriesCollapsed).toBe(1);
  });

  it("emits nothing for a build with no stages and no lease", () => {
    const { records } = reconcileBuild(build({ stages: [], lease: null }), HYBRID);
    expect(records).toHaveLength(0);
  });

  it("still records a delivery when the timeline is unavailable but a lease exists", () => {
    // This is the shape DeploymentService produces when getBuildTimeline fails or
    // the timeline has been pruned: no stages at all, but the lease still proves
    // the release happened.
    const { records, counters } = reconcileBuild(build({ stages: [], lease: lease() }), HYBRID);
    expect(records).toHaveLength(1);
    expect(records[0].isProduction).toBe(true);
    expect(records[0].prodSource).toBe("lease");
    expect(records[0].releasedToPrdAt).toEqual(lease().releasedOn);
    expect(counters.prodFromLease).toBe(1);
  });
});

describe("reconcileBuild — detection modes", () => {
  it("lease-only demotes a stage-named production success to non-production", () => {
    const { records, counters } = reconcileBuild(build(), {
      mode: "lease-only",
      productionEnvironmentLabel: "Production",
    });
    expect(records.filter((r) => r.isProduction)).toHaveLength(0);
    expect(records.filter((r) => !r.isProduction)).toHaveLength(1);
    expect(counters.suppressedStageProd).toBe(1);
  });

  it("stage-only ignores the lease entirely", () => {
    const { records, counters } = reconcileBuild(build({ lease: lease() }), {
      mode: "stage-only",
      productionEnvironmentLabel: "Production",
    });
    const prod = records.filter((r) => r.isProduction);
    expect(prod).toHaveLength(1);
    expect(prod[0].prodSource).toBe("stage");
    expect(prod[0].releasedToPrdAt).toBeNull();
    expect(counters.prodFromLease).toBe(0);
    expect(counters.prodFromStageOnly).toBe(1);
  });

  it("does not flag stage-only records as unverified — there is no lease to be missing", () => {
    const { records } = reconcileBuild(build(), {
      mode: "stage-only",
      productionEnvironmentLabel: "Production",
    });
    expect(records.filter((r) => r.isProduction)[0].prodUnverified).toBe(false);
  });

  it("still reports production failures in stage-only mode", () => {
    const { records, counters } = reconcileBuild(
      build({ stages: [stage({ result: TASK_RESULT_FAILED })], lease: lease() }),
      { mode: "stage-only", productionEnvironmentLabel: "Production" }
    );
    const prod = records.filter((r) => r.isProduction);
    expect(prod).toHaveLength(1);
    expect(prod[0].status).toBe("failed");
    expect(counters.prodFailuresFromTimeline).toBe(1);
  });

  it("lease-only never emits a contradictory second record when a lease and a failed stage coexist", () => {
    // Regression: the failed-stage fallback used to run unconditionally, so a
    // lease-proven delivery that also had a failed prod stage produced TWO records
    // for the same build and environment. The failed one had the later finishTime,
    // so buildEnvironmentMatrix showed a successful release as failed.
    const { records } = reconcileBuild(
      build({
        stages: [
          stage({ stageKey: "prd_eu", stageName: "Deploy_PRD_EU", result: TASK_RESULT_SUCCEEDED }),
          stage({
            stageKey: "prd_us",
            stageName: "Deploy_PRD_US",
            result: TASK_RESULT_FAILED,
            finishTime: new Date("2024-05-01T11:30:00Z"),
          }),
        ],
        lease: lease(),
      }),
      { mode: "lease-only", productionEnvironmentLabel: "Production" }
    );

    expect(records).toHaveLength(1);
    expect(records[0].isProduction).toBe(true);
    expect(records[0].status).toBe("succeeded");
    expect(records[0].prodSource).toBe("lease+stage");
    // The failed attempt is not lost — it is carried on the record itself, which is
    // what DoraCalculator.isFailureEvent consumes for change failure rate and MTTR.
    expect(records[0].hadFailedProdStage).toBe(true);

    const keys = records.map((r) => `${r.buildId}|${r.environment}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("lease-only emits no duplicate when the lease exists and every prod stage failed", () => {
    const { records } = reconcileBuild(
      build({ stages: [stage({ result: TASK_RESULT_FAILED })], lease: lease() }),
      { mode: "lease-only", productionEnvironmentLabel: "Production" }
    );
    expect(records).toHaveLength(1);
    expect(records[0].isProduction).toBe(true);
    expect(records[0].prodSource).toBe("lease");
    expect(records[0].hadFailedProdStage).toBe(true);
  });

  it("lease-only still surfaces a failed production stage as activity", () => {
    const { records } = reconcileBuild(build({ stages: [stage({ result: TASK_RESULT_FAILED })] }), {
      mode: "lease-only",
      productionEnvironmentLabel: "Production",
    });
    expect(records.filter((r) => r.isProduction)).toHaveLength(0);
    expect(records.filter((r) => r.status === "failed")).toHaveLength(1);
  });
});

describe("reconcileBuild — non-production stages", () => {
  it("emits one record per non-production stage", () => {
    const { records } = reconcileBuild(
      build({
        stages: [
          stage({
            stageKey: "dev",
            stageName: "Deploy_Dev",
            envName: "Development",
            isProdPattern: false,
          }),
          stage({ stageKey: "qa", stageName: "Deploy_QA", envName: "QA", isProdPattern: false }),
        ],
      }),
      HYBRID
    );
    expect(records).toHaveLength(2);
    expect(records.every((r) => !r.isProduction)).toBe(true);
  });

  it("drops stages that matched no environment pattern", () => {
    const { records } = reconcileBuild(
      build({ stages: [stage({ stageKey: "build", envName: null, isProdPattern: false })] }),
      HYBRID
    );
    expect(records).toHaveLength(0);
  });

  it("falls back to build times when a stage has none", () => {
    const { records } = reconcileBuild(
      build({ stages: [stage({ startTime: null, finishTime: null })] }),
      HYBRID
    );
    expect(records[0].startTime).toEqual(new Date("2024-05-01T09:50:00Z"));
    expect(records[0].finishTime).toEqual(new Date("2024-05-01T10:35:00Z"));
  });
});

describe("reconcileOrphanLeases", () => {
  it("counts leases whose build was not analysed and never emits them", () => {
    const leases = new Map<number, PrdRelease>([
      [500, lease({ buildId: 500 })],
      [900, lease({ buildId: 900, releasedOn: new Date("2023-02-01T00:00:00Z") })],
    ]);
    const result = reconcileOrphanLeases(leases, new Set([500]));
    expect(result.orphanLeases).toBe(1);
    expect(result.oldestOrphan).toEqual(new Date("2023-02-01T00:00:00Z"));
  });

  it("reports nothing when every lease has a matching build", () => {
    const leases = new Map<number, PrdRelease>([[500, lease()]]);
    expect(reconcileOrphanLeases(leases, new Set([500]))).toEqual({
      orphanLeases: 0,
      oldestOrphan: null,
    });
  });
});
