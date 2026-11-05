/**
 * Classification of Azure DevOps extension-data failures.
 *
 * Why this exists: the ownership claim and the access check must be able to tell
 * "this document does not exist" apart from "we could not reach the server". If a
 * network blip reads as "no ACL exists", a second user wrongly claims ownership.
 *
 * IMPORTANT — never use `err instanceof Error` here. Rejections cross the extension
 * iframe boundary through XDM, which rebuilds them as PLAIN OBJECTS
 * (XDM.js:229-231 rejects with `_customDeserializeObject(...)`, and that function
 * only re-wraps `__proxyFunctionId` / `__proxyDate` / `__circularReference` — it
 * never restores a prototype). `name` and `message` do survive because the
 * serializer walks the prototype chain (XDM.js:19-32). So: duck-type only.
 *
 * The two failure shapes we can rely on:
 *  - Fetch.js:122-127 — connectivity: `name === "NetworkException"`, NO `status`.
 *  - Fetch.js:139-162 — server: numeric `status`, `name === "TFS.WebApi.Exception"`,
 *    plus `responseText` and a parsed `serverError`.
 */

export type DataFailureKind = "not-found" | "denied" | "transient" | "unknown";

export class ExtensionDataError extends Error {
  readonly kind: DataFailureKind;
  readonly status?: number;
  readonly raw: unknown;

  constructor(kind: DataFailureKind, message: string, raw: unknown, status?: number) {
    super(message);
    this.name = "ExtensionDataError";
    this.kind = kind;
    this.status = status;
    this.raw = raw;
  }
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

export function classify(err: unknown): ExtensionDataError {
  if (err instanceof ExtensionDataError) return err;

  const source: Record<string, unknown> =
    err && typeof err === "object" ? (err as Record<string, unknown>) : {};

  const name = readString(source, "name");
  const message =
    readString(source, "message") ??
    (typeof err === "string" ? err : "Extension data request failed");
  const status = typeof source.status === "number" ? (source.status as number) : undefined;

  // Connectivity: the server was never reached, so we learned nothing about the document.
  if (name === "NetworkException") {
    return new ExtensionDataError("transient", message, err);
  }

  // No numeric status means we cannot prove the document is absent. Treating this as
  // "not found" is precisely the bug that lets a second user claim ownership.
  if (status === undefined) {
    return new ExtensionDataError("transient", message, err);
  }

  if (status === 404) return new ExtensionDataError("not-found", message, err, status);

  // 401 is an EXPIRED SESSION, not a permissions problem. An extension hub is
  // routinely left open for hours and the access token ages out underneath it.
  // Classifying it as "denied" would send the user to an org admin for something
  // no admin can fix; it is retryable once a fresh token has been acquired
  // (BaseDataService drops its memoised manager on a 401 so a retry can work).
  if (status === 401) return new ExtensionDataError("transient", message, err, status);

  if (status === 403) return new ExtensionDataError("denied", message, err, status);
  if (status === 408 || status === 429 || status >= 500) {
    return new ExtensionDataError("transient", message, err, status);
  }

  return new ExtensionDataError("unknown", message, err, status);
}

export function isNotFound(err: unknown): boolean {
  return classify(err).kind === "not-found";
}

/** Human-readable copy for a failure, used by the gate and the error banner. */
export function describeFailure(error: ExtensionDataError | DataFailureKind): string {
  const kind: DataFailureKind = typeof error === "string" ? error : error.kind;
  const status = typeof error === "string" ? undefined : error.status;

  if (status === 401) {
    return "Your Azure DevOps session expired. Try again, or reload the page to sign in.";
  }

  switch (kind) {
    case "not-found":
      return "The requested data does not exist.";
    case "denied":
      // Being told "an admin must re-approve" is useless to the person who IS the
      // admin unless it says where to go. This is the extension's own authorisation,
      // not the project's — no amount of project permission fixes it.
      return (
        "Azure DevOps refused this extension access to its own stored data (HTTP 403). " +
        "This is the extension's authorisation, not your project permissions. In Organization " +
        "settings → Extensions → Delivery Insights, check whether it is waiting for approval, " +
        "then reload this page."
      );
    case "transient":
      return "Could not reach Azure DevOps. Check your connection and try again.";
    default:
      return "An unexpected error occurred while reading extension data.";
  }
}

/**
 * The unfriendly version, for the diagnostics disclosure and the clipboard.
 *
 * `describeFailure` is deliberately reassuring and deliberately lossy; when it is
 * wrong there is nothing left to go on. This keeps the raw shape — including the
 * server's own message, which is the only place the real cause usually appears.
 */
export function technicalDetail(error: ExtensionDataError): string {
  const parts = [`kind=${error.kind}`];
  if (error.status !== undefined) parts.push(`status=${error.status}`);

  const raw = error.raw;
  if (raw && typeof raw === "object") {
    const source = raw as Record<string, unknown>;
    const name = readString(source, "name");
    if (name) parts.push(`name=${name}`);
    const serverError = source.serverError;
    if (serverError && typeof serverError === "object") {
      const typeKey = readString(serverError as Record<string, unknown>, "typeKey");
      if (typeKey) parts.push(`typeKey=${typeKey}`);
    }
  }

  parts.push(`message=${error.message}`);
  return parts.join(" · ");
}
