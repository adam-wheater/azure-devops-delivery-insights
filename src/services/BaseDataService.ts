import * as SDK from "azure-devops-extension-sdk";
import {
  CommonServiceIds,
  IExtensionDataService,
  IExtensionDataManager,
} from "azure-devops-extension-api";
import { classify, ExtensionDataError } from "./extensionDataErrors";

/**
 * getAccessToken() resolves rather than rejects when the host cannot mint a token
 * — an expired session, a host-side script failure during the XDM round trip, a
 * handshake that completed before the token service was ready. Handing the empty
 * result to getExtensionDataManager produces an unauthenticated manager whose
 * every call comes back 403, which reads as "this extension is not authorised"
 * and sends the user to an org admin for something no admin can fix. Naming the
 * real cause here is the difference between a reload and a support ticket.
 */
function assertToken(token: string | undefined | null): string {
  if (typeof token === "string" && token.length > 0) return token;
  throw new ExtensionDataError(
    "transient",
    "Azure DevOps did not issue an access token for this extension. Reload the page; if it " +
      "keeps happening, sign out and back in to Azure DevOps.",
    { name: "NoAccessToken" }
  );
}

/**
 * Document scope. Extension data has exactly two scopes — there is NO project
 * scope, and the REST route
 *   .../Data/Scopes/{scopeType}/{scopeValue}/Collections/{collection}/Documents/{id}
 * has no project segment. Project partitioning must be encoded in the document id
 * by the caller (see SettingsService / AccessControlService).
 */
export interface DocumentOptions {
  scopeType?: string;
  scopeValue?: string;
}

/** Shared by every user in the organisation. This is also the server default. */
export const SHARED: DocumentOptions = { scopeType: "Default", scopeValue: "Current" };

/** Private to the signed-in user. Must be asked for explicitly. */
export const PRIVATE: DocumentOptions = { scopeType: "User", scopeValue: "Me" };

/** The subset of IExtensionDataManager we use, including methods missing from the published typings. */
interface DataManager extends IExtensionDataManager {
  getDocument(collectionName: string, id: string, documentOptions?: DocumentOptions): Promise<any>;
  getDocuments(collectionName: string, documentOptions?: DocumentOptions): Promise<any[]>;
  createDocument(collectionName: string, doc: any, documentOptions?: DocumentOptions): Promise<any>;
  setDocument(collectionName: string, doc: any, documentOptions?: DocumentOptions): Promise<any>;
  updateDocument(collectionName: string, doc: any, documentOptions?: DocumentOptions): Promise<any>;
  deleteDocument(
    collectionName: string,
    id: string,
    documentOptions?: DocumentOptions
  ): Promise<void>;
}

export class BaseDataService {
  private managerPromise: Promise<DataManager> | null = null;

  protected async getManager(): Promise<DataManager> {
    if (!this.managerPromise) {
      const pending = (async () => {
        const dataService = await SDK.getService<IExtensionDataService>(
          CommonServiceIds.ExtensionDataService
        );
        const accessToken = assertToken(await SDK.getAccessToken());
        const extensionContext = SDK.getExtensionContext();
        return (await dataService.getExtensionDataManager(
          extensionContext.id,
          accessToken
        )) as DataManager;
      })();

      // Do not memoise a rejection: one failed token fetch would otherwise poison
      // every data call for the lifetime of the page.
      pending.catch(() => {
        if (this.managerPromise === pending) this.managerPromise = null;
      });

      this.managerPromise = pending;
    }
    return this.managerPromise;
  }

  /**
   * Run a manager call, classifying failures on the way out.
   *
   * A 401 means the memoised access token has aged out (extension hubs are often
   * left open for hours). The manager is rebuilt on the next call so a retry can
   * actually succeed — without this, the token baked into the memoised manager
   * stays dead for the lifetime of the page and every retry fails identically.
   */
  private async withManager<T>(fn: (manager: DataManager) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.getManager());
    } catch (err) {
      const classified: ExtensionDataError = classify(err);
      if (classified.status === 401) this.managerPromise = null;
      throw classified;
    }
  }

  /**
   * Returns null ONLY when the document genuinely does not exist (HTTP 404).
   * Every other failure — denied, transient, unknown — is rethrown as an
   * ExtensionDataError so callers can react differently.
   */
  protected async getDocumentOrNull<T>(
    collection: string,
    id: string,
    options: DocumentOptions = SHARED
  ): Promise<T | null> {
    try {
      return await this.withManager((manager) => manager.getDocument(collection, id, options));
    } catch (err) {
      if ((err as ExtensionDataError).kind === "not-found") return null;
      throw err;
    }
  }

  /** Convenience wrapper for callers that genuinely cannot fail (settings, cache). */
  protected async getDocumentOrDefault<T>(
    collection: string,
    id: string,
    fallback: T,
    options: DocumentOptions = SHARED
  ): Promise<T> {
    try {
      const doc = await this.getDocumentOrNull<T>(collection, id, options);
      return doc ?? fallback;
    } catch {
      return fallback;
    }
  }

  protected async getDocuments<T>(
    collection: string,
    options: DocumentOptions = SHARED
  ): Promise<T[]> {
    return this.withManager((manager) => manager.getDocuments(collection, options)) as Promise<T[]>;
  }

  /** POST — the closest thing available to a create-only primitive. */
  protected async createDocument<T>(
    collection: string,
    doc: T,
    options: DocumentOptions = SHARED
  ): Promise<T> {
    return this.withManager((manager) =>
      manager.createDocument(collection, doc, options)
    ) as Promise<T>;
  }

  /** PUT — documented upsert (creates if absent, otherwise overwrites). */
  protected async setDocument<T>(
    collection: string,
    doc: T,
    options: DocumentOptions = SHARED
  ): Promise<T> {
    return this.withManager((manager) =>
      manager.setDocument(collection, doc, options)
    ) as Promise<T>;
  }

  /** PATCH — documented as requiring the document to already exist. */
  protected async updateDocument<T>(
    collection: string,
    doc: T,
    options: DocumentOptions = SHARED
  ): Promise<T> {
    return this.withManager((manager) =>
      manager.updateDocument(collection, doc, options)
    ) as Promise<T>;
  }

  protected async deleteDocument(
    collection: string,
    id: string,
    options: DocumentOptions = SHARED
  ): Promise<void> {
    await this.withManager((manager) => manager.deleteDocument(collection, id, options));
  }
}
