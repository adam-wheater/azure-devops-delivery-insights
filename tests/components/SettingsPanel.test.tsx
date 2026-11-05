import * as React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { SettingsPanel } from "@/components/SettingsPanel";
import { DEFAULT_DELIVERY_SETTINGS, DeliverySettings } from "@/models/interfaces";

function renderPanel(overrides: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  const onSave = jest.fn();
  const settings: DeliverySettings = {
    ...DEFAULT_DELIVERY_SETTINGS,
    environmentPatterns: DEFAULT_DELIVERY_SETTINGS.environmentPatterns.map((p) => ({ ...p })),
    excludedPipelines: [],
  };
  render(<SettingsPanel settings={settings} onSave={onSave} onCancel={jest.fn()} {...overrides} />);
  return { onSave };
}

const DIRECTORY = [
  { definitionId: 1, name: "Payments API" },
  { definitionId: 2, name: "Nightly redeploy" },
  { definitionId: 3, name: "Checkout web" },
];

describe("SettingsPanel — excluding pipelines", () => {
  it("lists pipelines that have NEVER failed, so they can be excluded at all", async () => {
    // The bug this covers: exclusion was only reachable from a row in Failed
    // deployments, so a pipeline that never fails — a scheduled redeploy that
    // succeeds, a noisy pipeline you simply do not care about — could not be
    // excluded from Settings at all. `knownPipelines` is empty here precisely
    // because nothing of theirs reached the analysis.
    renderPanel({ knownPipelines: [], loadPipelines: () => Promise.resolve(DIRECTORY) });

    const picker = await screen.findByTestId("pipeline-picker");
    expect(within(picker).getByText("Nightly redeploy")).toBeInTheDocument();
    expect(within(picker).getByText("Payments API")).toBeInTheDocument();
  });

  it("excludes a pipeline by name and saves it", async () => {
    const { onSave } = renderPanel({ loadPipelines: () => Promise.resolve(DIRECTORY) });

    const picker = await screen.findByTestId("pipeline-picker");
    fireEvent.change(screen.getByLabelText(/search every pipeline/i), {
      target: { value: "nightly" },
    });

    const row = within(picker).getByText("Nightly redeploy").closest(".ax-member-row")!;
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /exclude/i }));

    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].excludedPipelines).toEqual([
      { definitionId: 2, name: "Nightly redeploy" },
    ]);
  });

  it("filters by name and says so when nothing matches", async () => {
    renderPanel({ loadPipelines: () => Promise.resolve(DIRECTORY) });

    await screen.findByTestId("pipeline-picker");
    fireEvent.change(screen.getByLabelText(/search every pipeline/i), {
      target: { value: "zzz" },
    });

    expect(await screen.findByText(/No pipeline matches "zzz"/i)).toBeInTheDocument();
  });

  it("moves a pipeline out of the picker once it is excluded", async () => {
    renderPanel({ loadPipelines: () => Promise.resolve(DIRECTORY) });

    const picker = await screen.findByTestId("pipeline-picker");
    const row = within(picker).getByText("Checkout web").closest(".ax-member-row")!;
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /exclude/i }));

    await waitFor(() => {
      expect(within(screen.getByTestId("pipeline-picker")).queryByText("Checkout web")).toBeNull();
    });
    // …and into the excluded list, where it can be put back.
    expect(screen.getByRole("button", { name: /include again/i })).toBeInTheDocument();
  });

  it("still works from the analysis list when the directory fetch fails", async () => {
    // A failed lookup must not leave the section empty and unusable — the
    // pipelines already on screen are still excludable.
    renderPanel({
      knownPipelines: [{ definitionId: 9, name: "Legacy batch" }],
      loadPipelines: () => Promise.reject(new Error("403")),
    });

    expect(await screen.findByText(/could not load the full pipeline list/i)).toBeInTheDocument();
    expect(screen.getByText("Legacy batch")).toBeInTheDocument();
  });

  it("shows the pipelines from the current analysis before the directory resolves", async () => {
    let resolveIt: (value: typeof DIRECTORY) => void = () => undefined;
    renderPanel({
      knownPipelines: [{ definitionId: 9, name: "Legacy batch" }],
      loadPipelines: () => new Promise((resolve) => (resolveIt = resolve)),
    });

    expect(screen.getByText("Legacy batch")).toBeInTheDocument();

    resolveIt(DIRECTORY);
    // The analysis-derived entry survives the merge rather than being replaced.
    expect(await screen.findByText("Payments API")).toBeInTheDocument();
    expect(screen.getByText("Legacy batch")).toBeInTheDocument();
  });

  it("keeps an already-excluded pipeline out of the picker", async () => {
    renderPanel({
      settings: {
        ...DEFAULT_DELIVERY_SETTINGS,
        excludedPipelines: [{ definitionId: 2, name: "Nightly redeploy" }],
      },
      loadPipelines: () => Promise.resolve(DIRECTORY),
    });

    const picker = await screen.findByTestId("pipeline-picker");
    expect(within(picker).queryByText("Nightly redeploy")).toBeNull();
    expect(screen.getByText(/currently excluded \(1\)/i)).toBeInTheDocument();
  });
});
