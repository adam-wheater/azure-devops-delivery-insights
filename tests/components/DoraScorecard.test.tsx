import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DoraScorecard } from "@/components/DoraScorecard";
import { DoraMetrics } from "@/models/interfaces";

// Mock theme to avoid DOM dependencies
jest.mock("@/utils/theme", () => ({
  useTheme: () => ({
    textPrimary: "#333",
    textSecondary: "#666",
    textMuted: "#888",
    textVeryMuted: "#999",
    bgSurface: "#fafafa",
    bgSurfaceAlt: "#f5f5f5",
    bgProgressTrack: "#e0e0e0",
    borderDefault: "#e0e0e0",
    borderInput: "#ccc",
    borderRow: "#eee",
    errorBg: "#ffebee",
    errorText: "#c62828",
    successBg: "#e8f5e9",
    successText: "#2e7d32",
    warningBg: "#fff3e0",
    warningBorder: "#ffe0b2",
    warningText: "#e65100",
    cleanBg: "#e8f5e9",
    cleanBorder: "#c8e6c9",
    statGreen: "#388e3c",
    keyVaultBg: "#e3f2fd",
    keyVaultText: "#1565c0",
    disabledBg: "#ccc",
    btnDefaultBg: "#f5f5f5",
    btnCancelBg: "#eee",
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe("DoraScorecard", () => {
  const metrics: DoraMetrics = {
    deploymentFrequency: { value: 3.5, unit: "per day", band: "Elite" },
    leadTimeForChanges: { medianHours: 4.2, band: "Elite" },
    changeFailureRate: { percentage: 8.5, band: "High" },
    meanTimeToRecovery: { medianHours: 2.1, band: "High" },
  };

  it("renders all four DORA metric cards", () => {
    render(<DoraScorecard metrics={metrics} />);

    expect(screen.getByTestId("dora-scorecard")).toBeInTheDocument();
    expect(screen.getByTestId("dora-card-deployment-frequency")).toBeInTheDocument();
    expect(screen.getByTestId("dora-card-lead-time-for-changes")).toBeInTheDocument();
    expect(screen.getByTestId("dora-card-change-failure-rate")).toBeInTheDocument();
    expect(screen.getByTestId("dora-card-mean-time-to-recovery")).toBeInTheDocument();
  });

  it("displays correct metric values", () => {
    render(<DoraScorecard metrics={metrics} />);

    expect(screen.getByText("3.5")).toBeInTheDocument();
    expect(screen.getByText("per day")).toBeInTheDocument();
    expect(screen.getByText("4.2")).toBeInTheDocument();
    expect(screen.getByText("8.5%")).toBeInTheDocument();
    expect(screen.getByText("2.1")).toBeInTheDocument();
  });

  it("displays correct band badges", () => {
    render(<DoraScorecard metrics={metrics} />);

    const dfBand = screen.getByTestId("dora-band-deployment-frequency");
    expect(dfBand).toHaveTextContent("Elite");

    const ltBand = screen.getByTestId("dora-band-lead-time-for-changes");
    expect(ltBand).toHaveTextContent("Elite");

    const cfrBand = screen.getByTestId("dora-band-change-failure-rate");
    expect(cfrBand).toHaveTextContent("High");

    const mttrBand = screen.getByTestId("dora-band-mean-time-to-recovery");
    expect(mttrBand).toHaveTextContent("High");
  });

  it("renders with Low band metrics", () => {
    const lowMetrics: DoraMetrics = {
      deploymentFrequency: { value: 0.1, unit: "per month", band: "Low" },
      leadTimeForChanges: { medianHours: 800, band: "Low" },
      changeFailureRate: { percentage: 45, band: "Low" },
      meanTimeToRecovery: { medianHours: 200, band: "Low" },
    };

    render(<DoraScorecard metrics={lowMetrics} />);

    const bands = screen.getAllByText("Low");
    expect(bands.length).toBe(4);
  });

  it("renders with Medium band metrics", () => {
    const medMetrics: DoraMetrics = {
      deploymentFrequency: { value: 1.5, unit: "per week", band: "Medium" },
      leadTimeForChanges: { medianHours: 200, band: "Medium" },
      changeFailureRate: { percentage: 20, band: "Medium" },
      meanTimeToRecovery: { medianHours: 100, band: "Medium" },
    };

    render(<DoraScorecard metrics={medMetrics} />);

    const bands = screen.getAllByText("Medium");
    expect(bands.length).toBe(4);
  });
});
