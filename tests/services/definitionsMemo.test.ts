import { fetchDeployments, __clearDefinitionsMemo } from "@/services/DeploymentService";
import { DEFAULT_DELIVERY_SETTINGS } from "@/models/interfaces";
import { __setMockClient, __resetMockClients } from "../__mocks__/azure-devops-extension-api";

const getDefinitions = jest.fn();
const getBuilds = jest.fn();

beforeEach(() => {
  __resetMockClients();
  __clearDefinitionsMemo();
  getDefinitions.mockReset().mockResolvedValue([]);
  getBuilds.mockReset().mockResolvedValue([]);
  __setMockClient("BuildRestClient", {
    getDefinitions,
    getBuilds,
    getBuildTimeline: jest.fn(),
    getBuildChanges: jest.fn(),
  });
});

const settings = {
  ...DEFAULT_DELIVERY_SETTINGS,
  production: { ...DEFAULT_DELIVERY_SETTINGS.production, detectionMode: "stage-only" as const },
};

describe("the pipeline directory memo", () => {
  it("serves a re-run inside the TTL from the memo instead of refetching", async () => {
    // The key used to embed minDate down to the millisecond, so no two calls
    // could ever share it and the memo documented in the README never hit.
    await fetchDeployments("Contoso", settings, () => undefined);
    await fetchDeployments("Contoso", settings, () => undefined);

    expect(getDefinitions).toHaveBeenCalledTimes(1);
  });

  it("refetches when the analysis window changes", async () => {
    await fetchDeployments("Contoso", settings, () => undefined);
    await fetchDeployments("Contoso", { ...settings, timePeriodDays: 30 }, () => undefined);

    expect(getDefinitions).toHaveBeenCalledTimes(2);
  });
});
