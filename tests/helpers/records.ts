import { DeploymentRecord } from "../../src/models/interfaces";

/**
 * Shared factory for DeploymentRecord fixtures, so adding a field to the model
 * touches one place instead of every test that happens to build a record.
 */
export function makeDeploymentRecord(overrides: Partial<DeploymentRecord> = {}): DeploymentRecord {
  return {
    buildId: 1,
    buildNumber: "20240101.1",
    pipelineName: "test-pipeline",
    definitionId: 1,
    environment: "Production",
    status: "succeeded",
    startTime: new Date("2024-01-15T10:00:00Z"),
    finishTime: new Date("2024-01-15T10:30:00Z"),
    firstCommitTime: new Date("2024-01-15T08:00:00Z"),
    buildStartTime: new Date("2024-01-15T09:30:00Z"),
    isProduction: true,
    prodSource: "lease",
    prodUnverified: false,
    hadFailedProdStage: false,
    releasedToPrdAt: new Date("2024-01-15T10:30:00Z"),
    stageNames: ["Deploy_PRD"],
    ...overrides,
  };
}
