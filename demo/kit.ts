// Helpers for demo/api.ts: the Azure DevOps services and REST clients the hub
// asks for, backed by sample data instead of an organization.
export { CommonServiceIds } from "azure-devops-extension-api/Common/CommonServices";

/** Promise that settles after `ms`, so loading states show for a moment. */
export const delay = <T>(value: T, ms = 150): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

export const projectPageService = (name = "Contoso") => ({
  getProject: () => Promise.resolve({ id: "6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c", name }),
});

/** Extension data storage kept in memory, with the 404 a real missing document gives. */
export function extensionDataService(seed: Record<string, Record<string, any>> = {}) {
  const store = new Map<string, Map<string, any>>();
  for (const [collection, docs] of Object.entries(seed)) {
    store.set(collection, new Map(Object.entries(docs).map(([id, doc]) => [id, { id, ...doc }])));
  }
  const docs = (collection: string) => {
    if (!store.has(collection)) store.set(collection, new Map());
    return store.get(collection)!;
  };
  const notFound = () => Promise.reject({ status: 404, message: "Document not found" });
  const manager = {
    getDocument: (collection: string, id: string) =>
      docs(collection).has(id) ? delay(docs(collection).get(id)) : notFound(),
    getDocuments: (collection: string) => delay([...docs(collection).values()]),
    createDocument: (collection: string, doc: any) =>
      docs(collection).has(doc.id)
        ? Promise.reject({ status: 409, message: "Document already exists" })
        : manager.setDocument(collection, doc),
    setDocument: (collection: string, doc: any) => {
      const saved = { ...doc, id: doc.id ?? String(Date.now()), __etag: (doc.__etag ?? 0) + 1 };
      docs(collection).set(saved.id, saved);
      return delay(saved);
    },
    updateDocument: (collection: string, doc: any) => manager.setDocument(collection, doc),
    deleteDocument: (collection: string, id: string) => {
      docs(collection).delete(id);
      return delay(undefined);
    },
    getValue: (key: string) => delay(docs("$settings").get(key)?.value),
    setValue: (key: string, value: any) => {
      docs("$settings").set(key, { id: key, value });
      return delay(value);
    },
  };
  return { getExtensionDataManager: () => Promise.resolve(manager) };
}

/**
 * Builds the `getClient` the hub imports. `clients` maps a REST client class name
 * (WorkItemTrackingRestClient, GitRestClient, ...) to the methods the hub calls;
 * any other method rejects with its name, so a gap in the sample data is obvious.
 */
export function clientFactory(clients: Record<string, Record<string, (...args: any[]) => any>>) {
  return (clientClass: { name: string }) => {
    const name = clientClass.name;
    const methods = clients[name] ?? {};
    return new Proxy(methods, {
      get: (target, prop) => {
        if (prop in target || typeof prop === "symbol" || prop === "then") {
          return (target as any)[prop];
        }
        return () => Promise.reject(new Error(`Demo has no data for ${name}.${prop}`));
      },
    });
  };
}
