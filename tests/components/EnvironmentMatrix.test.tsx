import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EnvironmentMatrix } from "@/components/EnvironmentMatrix";
import { EnvironmentStatus, EnvironmentPattern } from "@/models/interfaces";

import { makeDeploymentRecord } from "../helpers/records";

// The theme module now exposes a ticking clock and formatters rather than a
// colour object; stub the clock so relative timestamps are deterministic.
jest.mock("@/utils/theme", () => {
  const actual = jest.requireActual("@/utils/theme");
  return { ...actual, useNow: () => new Date("2024-01-16T10:00:00Z").getTime() };
});

const patterns: EnvironmentPattern[] = [
  { name: "Development", regex: "dev", order: 1, color: "#4caf50" },
  { name: "QA", regex: "qa|test", order: 2, color: "#ff9800" },
  { name: "Production", regex: "prod", order: 3, color: "#f44336" },
];

describe("EnvironmentMatrix", () => {
  it("renders empty message when no matrix data", () => {
    render(<EnvironmentMatrix matrix={[]} patterns={patterns} />);
    expect(screen.getByText(/No deployment data available/)).toBeInTheDocument();
  });

  it("renders pipeline rows and environment columns", () => {
    const matrix: EnvironmentStatus[] = [
      {
        pipelineName: "webapp-pipeline",
        definitionId: 1,
        environments: [
          {
            name: "Development",
            lastDeployment: makeDeploymentRecord({
              buildId: 100,
              buildNumber: "20240115.1",
              pipelineName: "webapp-pipeline",
              definitionId: 1,
              environment: "Development",
              status: "succeeded",
              startTime: new Date("2024-01-15T10:00:00Z"),
              finishTime: new Date("2024-01-15T10:30:00Z"),
              isProduction: false,
              prodSource: null,
              releasedToPrdAt: null,
              firstCommitTime: null,
            }),
          },
          {
            name: "QA",
            lastDeployment: makeDeploymentRecord({
              buildId: 101,
              buildNumber: "20240115.2",
              pipelineName: "webapp-pipeline",
              definitionId: 1,
              environment: "QA",
              status: "failed",
              startTime: new Date("2024-01-15T11:00:00Z"),
              finishTime: new Date("2024-01-15T11:30:00Z"),
              isProduction: false,
              prodSource: null,
              releasedToPrdAt: null,
              firstCommitTime: null,
            }),
          },
          {
            name: "Production",
            lastDeployment: null,
          },
        ],
      },
      {
        pipelineName: "api-pipeline",
        definitionId: 2,
        environments: [
          { name: "Development", lastDeployment: null },
          { name: "QA", lastDeployment: null },
          {
            name: "Production",
            lastDeployment: makeDeploymentRecord({
              buildId: 200,
              buildNumber: "20240114.3",
              pipelineName: "api-pipeline",
              definitionId: 2,
              environment: "Production",
              status: "succeeded",
              startTime: new Date("2024-01-14T09:00:00Z"),
              finishTime: new Date("2024-01-14T09:30:00Z"),
              isProduction: false,
              prodSource: null,
              releasedToPrdAt: null,
              firstCommitTime: null,
            }),
          },
        ],
      },
    ];

    render(<EnvironmentMatrix matrix={matrix} patterns={patterns} />);

    expect(screen.getByTestId("environment-matrix")).toBeInTheDocument();

    // Check pipeline names
    expect(screen.getByText("webapp-pipeline")).toBeInTheDocument();
    expect(screen.getByText("api-pipeline")).toBeInTheDocument();

    // Check environment headers
    expect(screen.getByText("Development")).toBeInTheDocument();
    expect(screen.getByText("QA")).toBeInTheDocument();
    expect(screen.getByText("Production")).toBeInTheDocument();

    // Check build numbers are displayed
    expect(screen.getByText("20240115.1")).toBeInTheDocument();
    expect(screen.getByText("20240115.2")).toBeInTheDocument();
    expect(screen.getByText("20240114.3")).toBeInTheDocument();

    // Check pipeline rows exist
    expect(screen.getByTestId("matrix-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("matrix-row-2")).toBeInTheDocument();
  });

  it("shows dash for environments with no deployment", () => {
    const matrix: EnvironmentStatus[] = [
      {
        pipelineName: "empty-pipeline",
        definitionId: 3,
        environments: [
          { name: "Development", lastDeployment: null },
          { name: "QA", lastDeployment: null },
          { name: "Production", lastDeployment: null },
        ],
      },
    ];

    render(<EnvironmentMatrix matrix={matrix} patterns={patterns} />);

    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(3);
  });

  it("renders cells with correct test IDs for each pipeline-environment combination", () => {
    const matrix: EnvironmentStatus[] = [
      {
        pipelineName: "test-pipeline",
        definitionId: 5,
        environments: [
          { name: "Development", lastDeployment: null },
          { name: "QA", lastDeployment: null },
          { name: "Production", lastDeployment: null },
        ],
      },
    ];

    render(<EnvironmentMatrix matrix={matrix} patterns={patterns} />);

    expect(screen.getByTestId("matrix-cell-5-Development")).toBeInTheDocument();
    expect(screen.getByTestId("matrix-cell-5-QA")).toBeInTheDocument();
    expect(screen.getByTestId("matrix-cell-5-Production")).toBeInTheDocument();
  });
});
