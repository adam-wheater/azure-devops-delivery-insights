/**
 * Current-user identity, with ZERO additional OAuth scopes.
 *
 * SDK.getUser() returns IUserContext with exactly five fields — descriptor, id,
 * name, displayName, imageUrl. There is no email/upn/mail field. `name` is
 * documented verbatim in the SDK source as "Name of the user (email/login)", so it
 * is the sign-in name: the UPN in AAD-backed organisations, the account email in
 * MSA-backed ones. That is what the allowlist matches on.
 *
 * We deliberately do NOT reach for GraphRestClient.getUser().mailAddress, which
 * would give the authoritative mail of record: it needs a new manifest scope, and a
 * scope change sets InstalledExtensionStateFlags.NeedsReauthorization on every
 * existing install ("Extension scopes have changed and the extension requires
 * re-authorization"). That is per-install state which reverting the manifest cannot
 * undo — it would silently break every organisation that already has this
 * extension. Not worth it for a UX gate.
 *
 * CALLING CONTRACT: getUser() and getHost() are SYNCHRONOUS and THROW
 * ("Attempted to call getUser() before init() was complete...") rather than
 * returning undefined. They are only safe inside the subtree mounted by
 * DeliveryInsightsHub.tsx, which awaits SDK.init() then SDK.ready() before
 * rendering. Do not call them from a lazily-imported module or an error boundary
 * outside that chain.
 */
import * as SDK from "azure-devops-extension-sdk";

export interface CurrentUser {
  /** Immutable per the SDK ("Unique id for the user"). The durable allowlist key. */
  id: string;
  /** The raw sign-in name exactly as Azure DevOps reports it. Shown verbatim when access is denied. */
  rawName: string;
  /** Lowercased, trimmed rawName. Primary match key. */
  email: string;
  /** Every string an allowlist entry may legitimately match — raw plus guest un-mangling. */
  emailCandidates: string[];
  displayName: string;
  imageUrl: string;
  descriptor: string;
  /** Provider tag parsed off the descriptor ("aad" | "msa" | "svc" | ...). Copy only, never gate logic. */
  provider: string;
}

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * AAD B2B guests carry a mangled UPN in the resource tenant:
 *   adam_contoso.com#EXT#@fabrikam.onmicrosoft.com  ->  adam@contoso.com
 * while an admin will naturally type the real address into the allowlist.
 *
 * Heuristic: split the local part on its LAST underscore. A local part that itself
 * contains underscores can mis-split, which is exactly why the locked screen prints
 * the raw string so a mismatch is self-fixable.
 */
export function unmangleGuestUpn(email: string): string[] {
  const marker = "#ext#@";
  const idx = email.indexOf(marker);
  if (idx === -1) return [];
  const localPart = email.slice(0, idx);
  const lastUnderscore = localPart.lastIndexOf("_");
  if (lastUnderscore <= 0 || lastUnderscore === localPart.length - 1) return [];
  return [`${localPart.slice(0, lastUnderscore)}@${localPart.slice(lastUnderscore + 1)}`];
}

export function buildEmailCandidates(rawName: string): string[] {
  const email = normalizeEmail(rawName);
  const candidates = new Set<string>();
  if (email) {
    candidates.add(email);
    for (const alt of unmangleGuestUpn(email)) candidates.add(alt);
  }
  return [...candidates];
}

export function getCurrentUser(): CurrentUser {
  const user = SDK.getUser();
  const rawName = user.name ?? "";
  return {
    id: user.id,
    rawName,
    email: normalizeEmail(rawName),
    emailCandidates: buildEmailCandidates(rawName),
    displayName: user.displayName ?? rawName,
    imageUrl: user.imageUrl ?? "",
    descriptor: user.descriptor ?? "",
    provider: (user.descriptor ?? "").split(".")[0].toLowerCase(),
  };
}

/**
 * "publisher.extension@version" for the build currently running.
 *
 * A bug report that names the version is a different conversation from one that
 * says "the latest one" — Marketplace installs update out from under people, and
 * the console never says which build threw. Defensive because this is only ever
 * called while something is already going wrong.
 */
export function getExtensionBuild(): string {
  try {
    const context = SDK.getExtensionContext() as { id?: string; version?: string };
    if (!context) return "unknown";
    return context.version
      ? `${context.id ?? "extension"}@${context.version}`
      : (context.id ?? "unknown");
  } catch {
    return "unknown";
  }
}

export interface OrgInfo {
  id: string;
  name: string;
  serviceVersion: string;
  /** HostType is NON-contiguous: Unknown=0, Deployment=1, Enterprise=2, Organization=4. */
  type: number;
  /** true for Azure DevOps Services, false for Azure DevOps Server. */
  isHosted: boolean;
}

export function getOrgInfo(): OrgInfo {
  const host = SDK.getHost() as unknown as OrgInfo;
  return {
    id: host.id,
    name: host.name,
    serviceVersion: host.serviceVersion,
    type: host.type,
    isHosted: host.isHosted,
  };
}

/** Initials for the avatar chip. Falls back to the email local part. */
export function initialsFor(user: Pick<CurrentUser, "displayName" | "email">): string {
  const source = user.displayName?.trim() || user.email;
  if (!source) return "?";
  const words = source.split(/[\s.@_-]+/).filter(Boolean);
  const raw =
    words.length === 0
      ? source.slice(0, 2)
      : words.length === 1
        ? words[0].slice(0, 2)
        : words[0][0] + words[1][0];
  // Uppercase here rather than relying on text-transform, so the accessible name
  // matches what is drawn.
  return raw.slice(0, 2).toUpperCase();
}
