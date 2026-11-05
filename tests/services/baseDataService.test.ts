import { BaseDataService, SHARED } from "@/services/BaseDataService";
import { ExtensionDataError } from "@/services/extensionDataErrors";
import {
  __setMockService,
  __resetMockServices,
  __setMockAccessToken,
} from "../__mocks__/azure-devops-extension-sdk";
import { CommonServiceIds } from "../__mocks__/azure-devops-extension-api";

class Probe extends BaseDataService {
  read(collection: string, id: string) {
    return this.getDocumentOrNull<{ id: string }>(collection, id, SHARED);
  }
}

const getExtensionDataManager = jest.fn();
const getDocument = jest.fn();

beforeEach(() => {
  __resetMockServices();
  __setMockAccessToken("mock-access-token");
  getExtensionDataManager.mockReset().mockResolvedValue({ getDocument });
  getDocument.mockReset().mockResolvedValue({ id: "doc" });
  __setMockService(CommonServiceIds.ExtensionDataService, { getExtensionDataManager });
});

describe("BaseDataService access token", () => {
  it("builds a manager with the token the host issued", async () => {
    await expect(new Probe().read("c", "doc")).resolves.toEqual({ id: "doc" });
    expect(getExtensionDataManager).toHaveBeenCalledWith("mock-extension-id", "mock-access-token");
  });

  it("fails with a named cause when the host issues no token", async () => {
    // getAccessToken resolves with an empty string rather than rejecting when the
    // host cannot mint one. Passing that through produces an unauthenticated
    // manager whose every call is a 403 — which reads as "this extension is not
    // authorised" and sends an admin chasing a permission that is not the problem.
    __setMockAccessToken("");

    const error = (await new Probe().read("c", "doc").catch((e) => e)) as ExtensionDataError;

    expect(error).toBeInstanceOf(ExtensionDataError);
    expect(error.kind).toBe("transient");
    expect(error.message).toMatch(/access token/i);
    expect(getExtensionDataManager).not.toHaveBeenCalled();
  });

  it("does not memoise the failure, so a later call can succeed", async () => {
    __setMockAccessToken("");
    const service = new Probe();
    await expect(service.read("c", "doc")).rejects.toBeInstanceOf(ExtensionDataError);

    __setMockAccessToken("fresh-token");
    await expect(service.read("c", "doc")).resolves.toEqual({ id: "doc" });
    expect(getExtensionDataManager).toHaveBeenCalledWith("mock-extension-id", "fresh-token");
  });
});
