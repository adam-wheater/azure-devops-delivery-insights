import {
  matchStageToEnvironment,
  buildEnvironmentMatrix,
} from "../../src/services/DeploymentService";
import {
  DEFAULT_ENVIRONMENT_PATTERNS,
  DeploymentRecord,
  EnvironmentPattern,
} from "../../src/models/interfaces";
import { makeDeploymentRecord } from "../helpers/records";

describe("matchStageToEnvironment", () => {
  const patterns = DEFAULT_ENVIRONMENT_PATTERNS;

  describe("Development matches", () => {
    it.each(["dev", "Dev", "DEV", "Development", "Deploy_Dev", "deploy-development"])(
      "matches %s → Development",
      (name) => expect(matchStageToEnvironment(name, patterns)).toBe("Development")
    );
  });

  describe("QA matches", () => {
    it.each(["qa", "QA", "Deploy_QA", "test", "Test", "testing", "Testing"])(
      "matches %s → QA",
      (name) => expect(matchStageToEnvironment(name, patterns)).toBe("QA")
    );
  });

  describe("Staging matches", () => {
    it.each(["staging", "Staging", "stg", "STG", "uat", "UAT", "pre-prod", "preprod"])(
      "matches %s → Staging",
      (name) => expect(matchStageToEnvironment(name, patterns)).toBe("Staging")
    );
  });

  describe("Production matches", () => {
    it.each([
      "prod",
      "Prod",
      "PROD",
      "production",
      "Production",
      "live",
      "Live",
      "release",
      "Release",
    ])("matches %s → Production", (name) =>
      expect(matchStageToEnvironment(name, patterns)).toBe("Production")
    );
  });

  describe("should NOT match (returns null)", () => {
    it.each(["Build", "Compile", "Validate", "Approval", "Notify", "Cleanup"])(
      "does not match %s",
      (name) => expect(matchStageToEnvironment(name, patterns)).toBeNull()
    );
  });

  describe("word-boundary prevents false positives", () => {
    it.each([
      ["Reproduce", null],
      ["Product_Validation", null],
      ["DevOps_Infra", null],
      ["attest", null],
    ])("'%s' should return %s", (name, expected) => {
      expect(matchStageToEnvironment(name, patterns)).toBe(expected);
    });
  });

  it("returns first match when multiple patterns could match", () => {
    // "dev-test" matches Development first (order 1) before QA (order 2)
    expect(matchStageToEnvironment("dev-test", patterns)).toBe("Development");
  });

  it("returns null for empty string", () => {
    expect(matchStageToEnvironment("", patterns)).toBeNull();
  });

  it("returns null for empty patterns array", () => {
    expect(matchStageToEnvironment("prod", [])).toBeNull();
  });

  it("skips invalid regex patterns gracefully", () => {
    const badPatterns: EnvironmentPattern[] = [
      { name: "Bad", regex: "[invalid", order: 1, color: "#000" },
      { name: "Production", regex: "\\bprod\\b", order: 2, color: "#f00" },
    ];
    expect(matchStageToEnvironment("prod", badPatterns)).toBe("Production");
  });
});

describe("buildEnvironmentMatrix", () => {
  const patterns = DEFAULT_ENVIRONMENT_PATTERNS;

  function makeRecord(overrides: Partial<DeploymentRecord>): DeploymentRecord {
    return makeDeploymentRecord({
      buildNumber: "1.0.0",
      pipelineName: "TestPipeline",
      definitionId: 100,
      environment: "Development",
      startTime: new Date("2026-03-01T10:00:00Z"),
      finishTime: new Date("2026-03-01T10:05:00Z"),
      commitIds: [],
      firstCommitTime: null,
      isProduction: false,
      prodSource: null,
      releasedToPrdAt: null,
      stageNames: [],
      ...overrides,
    });
  }

  it("builds a matrix with one deployment per environment", () => {
    const deployments = [
      makeRecord({ environment: "Development" }),
      makeRecord({ environment: "QA", finishTime: new Date("2026-03-01T11:00:00Z") }),
    ];
    const matrix = buildEnvironmentMatrix(deployments, patterns);
    expect(matrix).toHaveLength(1);
    expect(
      matrix[0].environments.find((e) => e.name === "Development")?.lastDeployment
    ).toBeTruthy();
    expect(matrix[0].environments.find((e) => e.name === "QA")?.lastDeployment).toBeTruthy();
    expect(matrix[0].environments.find((e) => e.name === "Production")?.lastDeployment).toBeNull();
  });

  it("keeps only the latest deployment per environment", () => {
    const deployments = [
      makeRecord({ buildNumber: "1.0.0", finishTime: new Date("2026-03-01T10:00:00Z") }),
      makeRecord({ buildNumber: "2.0.0", finishTime: new Date("2026-03-02T10:00:00Z") }),
    ];
    const matrix = buildEnvironmentMatrix(deployments, patterns);
    const devEnv = matrix[0].environments.find((e) => e.name === "Development");
    expect(devEnv?.lastDeployment?.buildNumber).toBe("2.0.0");
  });

  it("groups pipelines separately by definitionId", () => {
    const deployments = [
      makeRecord({ definitionId: 100, pipelineName: "A" }),
      makeRecord({ definitionId: 200, pipelineName: "B" }),
    ];
    const matrix = buildEnvironmentMatrix(deployments, patterns);
    expect(matrix).toHaveLength(2);
  });

  it("returns empty array for no deployments", () => {
    expect(buildEnvironmentMatrix([], patterns)).toEqual([]);
  });
});

describe("environment filtering (enabled flag)", () => {
  const patterns: EnvironmentPattern[] = [
    { name: "Development", regex: "dev", order: 1, color: "#4caf50" },
    { name: "QA", regex: "qa|test", order: 2, color: "#ff9800" },
    { name: "Production", regex: "prod", order: 3, color: "#f44336" },
  ];

  it("treats a pattern with no enabled flag as included (legacy settings)", () => {
    expect(matchStageToEnvironment("Deploy_Dev", patterns)).toBe("Development");
  });

  it("does not match a stage whose only environment is filtered off", () => {
    const filtered = patterns.map((p) => (p.name === "Development" ? { ...p, enabled: false } : p));
    expect(matchStageToEnvironment("Deploy_Dev", filtered)).toBeNull();
  });

  it("keeps matching the environments that are still included", () => {
    const prodOnly = patterns.map((p) => ({ ...p, enabled: p.name === "Production" }));
    expect(matchStageToEnvironment("Deploy_Prod", prodOnly)).toBe("Production");
    expect(matchStageToEnvironment("Deploy_Dev", prodOnly)).toBeNull();
    expect(matchStageToEnvironment("Deploy_QA", prodOnly)).toBeNull();
  });

  it("falls through to a later pattern when an earlier one is filtered off", () => {
    // "test" matches QA; with QA excluded the stage must match nothing rather
    // than silently falling into a different environment.
    const noQa = patterns.map((p) => (p.name === "QA" ? { ...p, enabled: false } : p));
    expect(matchStageToEnvironment("test", noQa)).toBeNull();
  });

  it("returns null when every environment is filtered off", () => {
    const none = patterns.map((p) => ({ ...p, enabled: false }));
    expect(matchStageToEnvironment("Deploy_Prod", none)).toBeNull();
  });

  it("omits filtered-off environments from the matrix columns", () => {
    const prodOnly = patterns.map((p) => ({ ...p, enabled: p.name === "Production" }));
    const matrix = buildEnvironmentMatrix(
      [
        makeDeploymentRecord({
          buildId: 1,
          definitionId: 10,
          pipelineName: "api",
          environment: "Production",
        }),
        makeDeploymentRecord({
          buildId: 2,
          definitionId: 10,
          pipelineName: "api",
          environment: "Development",
          isProduction: false,
          prodSource: null,
        }),
      ],
      prodOnly
    );

    expect(matrix).toHaveLength(1);
    expect(matrix[0].environments.map((e) => e.name)).toEqual(["Production"]);
  });

  it("keeps every column when nothing is filtered off", () => {
    const matrix = buildEnvironmentMatrix(
      [makeDeploymentRecord({ definitionId: 10, environment: "Production" })],
      patterns
    );
    expect(matrix[0].environments.map((e) => e.name)).toEqual(["Development", "QA", "Production"]);
  });
});

describe("default Production pattern covers common abbreviations", () => {
  const patterns = DEFAULT_ENVIRONMENT_PATTERNS;

  it.each(["Deploy_PRD", "Deploy PRD", "PRD", "deploy-prd", "Deploy_Prod", "Deploy_Production"])(
    "matches %s → Production",
    (name) => expect(matchStageToEnvironment(name, patterns)).toBe("Production")
  );

  it.each(["Reproduce", "Product_Validation", "Predeploy", "Sprder"])(
    "still does not match %s",
    (name) => expect(matchStageToEnvironment(name, patterns)).not.toBe("Production")
  );
});
