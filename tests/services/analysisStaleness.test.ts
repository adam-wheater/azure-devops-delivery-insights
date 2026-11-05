import { describeStaleness } from "@/services/analysisStaleness";
import {
  DEFAULT_DELIVERY_SETTINGS,
  DeliverySettings,
  applyEnvironmentScope,
} from "@/models/interfaces";

function settings(overrides: Partial<DeliverySettings> = {}): DeliverySettings {
  return {
    ...DEFAULT_DELIVERY_SETTINGS,
    environmentPatterns: DEFAULT_DELIVERY_SETTINGS.environmentPatterns.map((p) => ({ ...p })),
    excludedPipelines: [],
    ...overrides,
  };
}

describe("describeStaleness", () => {
  it("says nothing when the settings still match the analysis", () => {
    expect(describeStaleness(settings(), settings())).toBeNull();
  });

  it("says nothing when nothing has been analysed yet", () => {
    expect(describeStaleness(null, settings())).toBeNull();
  });

  it("does NOT ask for a re-analysis when a pipeline is newly excluded", () => {
    // This is the whole point of keeping the previous result: excluding only ever
    // removes records, and the view filters them out immediately. Demanding a
    // multi-minute rescan to hide a pipeline would be absurd.
    const before = settings();
    const after = settings({ excludedPipelines: [{ definitionId: 7, name: "Nightly redeploy" }] });

    expect(describeStaleness(before, after)).toBeNull();
  });

  it("DOES ask for one when a pipeline is put back", () => {
    // Those builds were never fetched, so the history genuinely is not on screen.
    const before = settings({ excludedPipelines: [{ definitionId: 7, name: "Nightly redeploy" }] });
    const after = settings({ excludedPipelines: [] });

    expect(describeStaleness(before, after)).toMatch(/put back/i);
  });

  it("counts how many pipelines were put back", () => {
    const before = settings({
      excludedPipelines: [
        { definitionId: 7, name: "A" },
        { definitionId: 8, name: "B" },
      ],
    });
    expect(describeStaleness(before, settings({ excludedPipelines: [] }))).toMatch(/2 pipelines/i);
  });

  it("names the new time range", () => {
    expect(
      describeStaleness(settings({ timePeriodDays: 30 }), settings({ timePeriodDays: 90 }))
    ).toBe("the time range changed to 90 days");
  });

  it("notices a production detection change", () => {
    const before = settings();
    const after = settings({
      production: { ...DEFAULT_DELIVERY_SETTINGS.production, detectionMode: "stage-only" },
    });
    expect(describeStaleness(before, after)).toMatch(/production detection/i);
  });

  it("notices a lease owner id change, which changes what counts as production", () => {
    const before = settings();
    const after = settings({
      production: { ...DEFAULT_DELIVERY_SETTINGS.production, leaseOwnerId: "Something.Else" },
    });
    expect(describeStaleness(before, after)).toMatch(/production detection/i);
  });

  it("treats narrowing to production as instant, and widening as needing a rescan", () => {
    const all = settings();
    const productionOnly = settings({
      environmentPatterns: applyEnvironmentScope(all.environmentPatterns, "production"),
    });

    // Narrowing only removes: the records are already on screen.
    expect(describeStaleness(all, productionOnly)).toBeNull();
    // Widening cannot be served from data that was never scanned.
    expect(describeStaleness(productionOnly, all)).toMatch(/environment was added back/i);
  });

  it("notices an environment regex edit in either direction", () => {
    const before = settings();
    const after = settings({
      environmentPatterns: before.environmentPatterns.map((p, i) =>
        i === 0 ? { ...p, regex: "^totally-different$" } : p
      ),
    });
    expect(describeStaleness(before, after)).toMatch(/environment patterns changed/i);
  });

  it("asks for a rescan when the branch journey is switched ON, but not OFF", () => {
    const off = settings({
      branchFlow: { ...DEFAULT_DELIVERY_SETTINGS.branchFlow, enabled: false },
    });
    const on = settings();

    expect(describeStaleness(off, on)).toMatch(/branch journey/i);
    // Switching it off only hides a panel; the data on screen is still valid.
    expect(describeStaleness(on, off)).toBeNull();
  });

  it("notices an integration branch pattern edit only while branch flow is on", () => {
    const on = settings();
    const edited = settings({
      branchFlow: {
        ...DEFAULT_DELIVERY_SETTINGS.branchFlow,
        integrationPatterns: [{ regex: "^refs/heads/trunk$", order: 1 }],
      },
    });
    expect(describeStaleness(on, edited)).toMatch(/integration branch/i);

    const editedButOff = settings({ branchFlow: { ...edited.branchFlow, enabled: false } });
    expect(describeStaleness(on, editedButOff)).toBeNull();
  });

  it("survives a snapshot from before branch flow existed", () => {
    const legacy = settings();
    delete (legacy as Partial<DeliverySettings>).branchFlow;
    expect(describeStaleness(legacy, settings())).toBeNull();
  });
});
