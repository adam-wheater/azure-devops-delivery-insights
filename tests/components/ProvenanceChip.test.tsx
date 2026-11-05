import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ProvenanceChip } from "@/components/ProductionDeliveries";

import { makeDeploymentRecord } from "../helpers/records";

describe("ProvenanceChip", () => {
  it("never calls a stage-only record lease-verified", () => {
    const record = makeDeploymentRecord({
      isProduction: true,
      prodSource: "stage",
      prodUnverified: false,
    });
    render(<ProvenanceChip record={record} />);
    expect(screen.getByText("Stage-inferred")).toBeInTheDocument();
    expect(screen.queryByText(/Lease-verified/)).not.toBeInTheDocument();
  });

  it("calls a lease-backed record lease-verified", () => {
    const record = makeDeploymentRecord({ isProduction: true, prodSource: "lease" });
    render(<ProvenanceChip record={record} />);
    expect(screen.getByText(/Lease-verified/)).toBeInTheDocument();
  });
});
