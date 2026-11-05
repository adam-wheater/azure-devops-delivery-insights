// Stands in for azure-devops-extension-sdk in the demo build (see
// demo/webpack.config.js). The hub starts at once, signed in as a sample user;
// demo/api.ts supplies the services and can override `user` and `host`.
import * as demo from "./api";

// Read through a plain object: `user` and `host` are optional exports.
const sample: { user?: unknown; host?: unknown; services: Record<string, unknown> } = demo;

const defaultUser = {
  id: "8d1f2c4e-5b6a-4c7d-9e8f-0a1b2c3d4e5f",
  name: "alex.morgan@contoso.com",
  displayName: "Alex Morgan",
  descriptor: "aad.ZGVtby11c2Vy",
  imageUrl: "",
};
const defaultHost = {
  id: "3f9a1b2c-7d8e-4f60-a1b2-c3d4e5f6a7b8",
  name: "contoso",
  serviceVersion: "demo",
  type: 4,
  isHosted: true,
};

export const init = () => Promise.resolve();
export const ready = () => Promise.resolve();
export const notifyLoadSucceeded = () => Promise.resolve();
export const notifyLoadFailed = () => Promise.resolve();
export const getAccessToken = () => Promise.resolve("demo-token");
export const getAppToken = () => Promise.resolve("demo-token");
export const getUser = () => sample.user ?? defaultUser;
export const getHost = () => sample.host ?? defaultHost;
export const getExtensionContext = () => ({
  publisherId: "adam-wheater",
  extensionId: "demo",
  id: "adam-wheater.demo",
  version: "1.0.0",
});
export const getConfiguration = () => ({});
export const getContributionId = () => "adam-wheater.demo.hub";
export const resize = () => undefined;

export function getService<T>(id: string): Promise<T> {
  const service = sample.services[id];
  return service
    ? Promise.resolve(service as T)
    : Promise.reject(new Error(`Demo has no service ${id}`));
}
