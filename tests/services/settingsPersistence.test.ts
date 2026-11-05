import { SettingsService } from "@/services/SettingsService";
import { ExtensionDataError } from "@/services/extensionDataErrors";
import { __setMockService, __resetMockServices } from "../__mocks__/azure-devops-extension-sdk";
import { CommonServiceIds } from "../__mocks__/azure-devops-extension-api";

const getDocument = jest.fn();
const setDocument = jest.fn();

beforeEach(() => {
  __resetMockServices();
  getDocument.mockReset();
  setDocument.mockReset().mockImplementation((_c, doc) => Promise.resolve(doc));
  __setMockService(CommonServiceIds.ExtensionDataService, {
    getExtensionDataManager: () => Promise.resolve({ getDocument, setDocument }),
  });
});

const STORED = {
  id: "settings.p1",
  timePeriodDays: 90,
  excludedPipelines: [{ definitionId: 7, name: "Nightly redeploy" }],
};

describe("loadSettings tells a missing document apart from an unreadable one", () => {
  it("reports stored settings as stored", async () => {
    getDocument.mockResolvedValue(STORED);

    const snapshot = await new SettingsService().loadSettings("p1");

    expect(snapshot.status).toBe("stored");
    expect(snapshot.settings.excludedPipelines).toEqual([
      { definitionId: 7, name: "Nightly redeploy" },
    ]);
  });

  it("reports a genuinely absent document as absent", async () => {
    // 404 on both the per-project and the legacy document.
    getDocument.mockRejectedValue(new ExtensionDataError("not-found", "gone", {}, 404));

    const snapshot = await new SettingsService().loadSettings("p1");

    expect(snapshot.status).toBe("absent");
    expect(snapshot.settings.excludedPipelines).toEqual([]);
  });

  it("reports a FAILED read as unavailable, not as a fresh install", async () => {
    // The bug this covers: getDocumentOrDefault swallowed every failure and
    // returned the fallback, so an expired token looked exactly like "no
    // settings exist". The caller then saved those empty defaults over a real
    // document and the user's excluded pipelines were gone permanently.
    getDocument.mockRejectedValue(new ExtensionDataError("transient", "session expired", {}, 401));

    const snapshot = await new SettingsService().loadSettings("p1");

    expect(snapshot.status).toBe("unavailable");
    // Defaults are still returned so the page renders — but the status is what
    // stops the caller writing them back.
    expect(snapshot.settings.excludedPipelines).toEqual([]);
  });

  it("reports unavailable when the per-project document is absent but the legacy read fails", async () => {
    getDocument
      .mockRejectedValueOnce(new ExtensionDataError("not-found", "gone", {}, 404))
      .mockRejectedValueOnce(new ExtensionDataError("transient", "throttled", {}, 429));

    expect((await new SettingsService().loadSettings("p1")).status).toBe("unavailable");
  });

  it("never writes anything while reading", async () => {
    getDocument.mockRejectedValue(new ExtensionDataError("transient", "boom", {}, 500));
    await new SettingsService().loadSettings("p1");
    expect(setDocument).not.toHaveBeenCalled();
  });
});

describe("saveSettings surfaces failure instead of swallowing it", () => {
  it("rejects when the write fails, so the caller can say so", async () => {
    // Previously the caller console.warn-ed this and carried on, so an exclusion
    // made against an expired session was silently lost on the next reload.
    getDocument.mockResolvedValue(STORED);
    const service = new SettingsService();
    const { settings } = await service.loadSettings("p1");

    setDocument.mockRejectedValue(new ExtensionDataError("transient", "no network", {}, undefined));

    await expect(service.saveSettings("p1", settings)).rejects.toBeDefined();
  });
});

describe("saveCache records the settings that produced the analysis", () => {
  it("stores them so a restored snapshot can be compared against current settings", async () => {
    const service = new SettingsService();
    getDocument.mockResolvedValue(STORED);
    const { settings } = await service.loadSettings("p1");

    const empty = {
      dora: {} as never,
      trends: [],
      environmentMatrix: [],
      deployments: [],
      leadTimeBreakdown: {} as never,
    };
    await service.saveCache("p1", empty, 90, settings);

    const calls = setDocument.mock.calls;
    const written = calls[calls.length - 1][1];
    expect(written.settings.excludedPipelines).toEqual([
      { definitionId: 7, name: "Nightly redeploy" },
    ]);
    expect(written.timePeriodDays).toBe(90);
  });
});

describe("loadUiPrefs maps the stored theme mode", () => {
  it('treats the legacy "system" value as following the host theme', async () => {
    getDocument.mockResolvedValue({ id: "ui-prefs", themeMode: "system" });

    const prefs = await new SettingsService().loadUiPrefs();

    expect(prefs.themeMode).toBe("ado");
  });

  it("keeps an explicit light or dark choice", async () => {
    getDocument.mockResolvedValue({ id: "ui-prefs", themeMode: "dark" });

    expect((await new SettingsService().loadUiPrefs()).themeMode).toBe("dark");
  });
});
