/**
 * Access list for the Delivery Insights hub.
 *
 * Model: the first user to open the hub in a project claims ownership and becomes
 * admin. That admin then grants access to other people by email address. Everyone
 * else sees a locked screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS A UX GATE, NOT A SECURITY BOUNDARY. Two facts make that unavoidable:
 *   1. The underlying build data is readable by anyone with `vso.build` on the
 *      project, straight from the REST API, with or without this extension.
 *   2. The ACL document lives in extension data at Default/Current scope, which any
 *      principal holding `vso.extension.data` for this extension can rewrite via
 *      the REST API.
 * Both facts are stated in the product UI (locked screen and admin panel), not just
 * here. Real enforcement would need a server we control.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Race safety: nothing in the shipped typings promises that `createDocument`
 * rejects on a duplicate id — it is a POST with the document id omitted from the
 * route, while `setDocument` is a documented PUT upsert. So the claim is written to
 * converge correctly under EITHER semantics: write with a random nonce, then read
 * back and check whose nonce survived. Both racers observe the same last-write-wins
 * winner, and the loser never overwrites.
 */
import { BaseDataService, SHARED } from "./BaseDataService";
import { classify, DataFailureKind, describeFailure, technicalDetail } from "./extensionDataErrors";
import { CurrentUser, normalizeEmail } from "./identity";

const COLLECTION = "delivery-insights-acl";

/** Extension data has no project scope, so the project id is encoded in the document id. */
export function aclDocId(projectId: string): string {
  return `acl.${projectId}`;
}

export interface AclEntry {
  /** Normalized email — the grant key as typed by an admin. */
  email: string;
  /** Bound on first successful sign-in. Immutable, so a later UPN change cannot lock the user out. */
  userId?: string;
  displayName?: string;
  isAdmin: boolean;
  addedBy: string;
  /** ISO string. Never store Date objects — they do not survive the storage round trip cleanly. */
  addedOn: string;
}

export interface AccessControlDoc {
  id: string;
  schemaVersion: 1;
  claimNonce: string;
  claimedAt: string;
  entries: AclEntry[];
  /** Optimistic-concurrency token. Undocumented in the published typings; passed through untouched. */
  __etag?: number;
}

export type AccessDecision =
  | { state: "loading" }
  | { state: "unclaimed" }
  | { state: "granted"; isAdmin: boolean; entry: AclEntry; doc: AccessControlDoc }
  | { state: "denied"; rawName: string; candidates: string[]; admins: string[] }
  /** `detail` is the raw failure, kept verbatim for the diagnostics disclosure. */
  | { state: "error"; kind: DataFailureKind; message: string; detail: string };

/** Delay before reading back a claim, giving a concurrent writer time to land. */
const CLAIM_SETTLE_MS = 750;
/** Second confirmation, so a read-back that raced a slower writer is still corrected. */
const CLAIM_CONFIRM_MS = 2000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function newNonce(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function adminEmails(doc: AccessControlDoc | null): string[] {
  return (doc?.entries ?? []).filter((e) => e.isAdmin).map((e) => e.email);
}

export class AccessControlService extends BaseDataService {
  async load(projectId: string): Promise<AccessControlDoc | null> {
    return this.getDocumentOrNull<AccessControlDoc>(COLLECTION, aclDocId(projectId), SHARED);
  }

  /**
   * First-claim-wins ownership.
   *
   * Returns the document that actually won. `claimed` tells the caller whether the
   * current user is the winner. A transient failure returns an error decision —
   * never "unclaimed", which would invite a second claim.
   */
  async claimOwnership(
    projectId: string,
    user: CurrentUser
  ): Promise<
    | { outcome: "claimed"; doc: AccessControlDoc }
    | { outcome: "lost"; doc: AccessControlDoc }
    | { outcome: "error"; kind: DataFailureKind; message: string; detail: string }
  > {
    const docId = aclDocId(projectId);

    try {
      const existing = await this.load(projectId);
      if (existing && existing.entries?.length) {
        return { outcome: "lost", doc: existing };
      }

      const nonce = newNonce();
      const now = new Date().toISOString();
      const candidate: AccessControlDoc = {
        id: docId,
        schemaVersion: 1,
        claimNonce: nonce,
        claimedAt: now,
        entries: [
          {
            email: user.email,
            userId: user.id,
            displayName: user.displayName,
            isAdmin: true,
            addedBy: user.email,
            addedOn: now,
          },
        ],
      };

      // POST first — the only primitive with any chance of being create-only. If it
      // rejects because the document already exists, the read-back below still
      // resolves the race correctly, so the rejection is not fatal on its own.
      let createFailure: unknown = null;
      try {
        await this.createDocument<AccessControlDoc>(COLLECTION, candidate, SHARED);
      } catch (err) {
        createFailure = err;
      }

      await delay(CLAIM_SETTLE_MS);
      let winner = await this.load(projectId);

      if (!winner) {
        // Nothing landed at all. If the create failed for a reason we can name, report it.
        if (createFailure) {
          const classified = classify(createFailure);
          return {
            outcome: "error",
            kind: classified.kind,
            message: describeFailure(classified),
            detail: technicalDetail(classified),
          };
        }
        return {
          outcome: "error",
          kind: "transient",
          message: "The ownership claim could not be confirmed. Please try again.",
          detail: "kind=transient · the document was absent after the claim was written",
        };
      }

      if (winner.claimNonce === nonce) {
        // Confirm once more — a slower concurrent writer may still overwrite us.
        await delay(CLAIM_CONFIRM_MS);
        winner = (await this.load(projectId)) ?? winner;
      }

      return winner.claimNonce === nonce
        ? { outcome: "claimed", doc: winner }
        : { outcome: "lost", doc: winner };
    } catch (err) {
      const classified = classify(err);
      return {
        outcome: "error",
        kind: classified.kind,
        message: describeFailure(classified),
        detail: technicalDetail(classified),
      };
    }
  }

  async evaluate(projectId: string, user: CurrentUser): Promise<AccessDecision> {
    let doc: AccessControlDoc | null;
    try {
      doc = await this.load(projectId);
    } catch (err) {
      const classified = classify(err);
      // A transient failure must never read as "unclaimed" — that is the path that
      // would let a bystander take ownership during an outage.
      return {
        state: "error",
        kind: classified.kind,
        message: describeFailure(classified),
        detail: technicalDetail(classified),
      };
    }

    if (!doc || !doc.entries?.length) return { state: "unclaimed" };

    // Immutable id first: survives UPN and display-name changes.
    let entry = doc.entries.find((e) => e.userId && e.userId === user.id);
    let needsBind = false;

    if (!entry) {
      entry = doc.entries.find((e) => user.emailCandidates.includes(normalizeEmail(e.email)));
      needsBind = Boolean(entry && !entry.userId);
    }

    if (!entry) {
      return {
        state: "denied",
        rawName: user.rawName,
        candidates: user.emailCandidates,
        admins: adminEmails(doc),
      };
    }

    if (needsBind) {
      // Best effort — a failed bind must never deny access.
      try {
        doc = await this.mutate(projectId, (current) => {
          const target = current.entries.find(
            (e) => normalizeEmail(e.email) === normalizeEmail(entry!.email)
          );
          if (target && !target.userId) {
            target.userId = user.id;
            target.displayName = user.displayName;
          }
          return current;
        });
        entry = doc.entries.find((e) => e.userId === user.id) ?? entry;
      } catch {
        /* keep the in-memory decision */
      }
    }

    return { state: "granted", isAdmin: entry.isAdmin, entry, doc };
  }

  /** Read → apply → PATCH, with a bounded retry on conflict. Transient errors rethrow immediately. */
  private async mutate(
    projectId: string,
    apply: (doc: AccessControlDoc) => AccessControlDoc,
    attempts = 3
  ): Promise<AccessControlDoc> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const current = await this.load(projectId);
      if (!current) {
        throw new Error("The access list no longer exists. Reload the page to claim it again.");
      }

      const next = apply({ ...current, entries: current.entries.map((e) => ({ ...e })) });

      try {
        return await this.updateDocument<AccessControlDoc>(COLLECTION, next, SHARED);
      } catch (err) {
        const classified = classify(err);
        if (classified.kind === "transient" || classified.kind === "denied") throw classified;
        lastError = classified;
      }
    }

    throw lastError ?? new Error("Could not update the access list.");
  }

  async grantAccess(
    projectId: string,
    email: string,
    isAdmin: boolean,
    grantedBy: CurrentUser
  ): Promise<AccessControlDoc> {
    const key = normalizeEmail(email);
    if (!key) throw new Error("Enter an email address.");
    if (!key.includes("@") || /\s/.test(key)) {
      throw new Error(`"${email.trim()}" does not look like an email address.`);
    }

    return this.mutate(projectId, (doc) => {
      const existing = doc.entries.find((e) => normalizeEmail(e.email) === key);
      if (existing) {
        existing.isAdmin = existing.isAdmin || isAdmin;
        return doc;
      }
      doc.entries.push({
        email: key,
        isAdmin,
        addedBy: grantedBy.email,
        addedOn: new Date().toISOString(),
      });
      return doc;
    });
  }

  async revokeAccess(projectId: string, email: string): Promise<AccessControlDoc> {
    const key = normalizeEmail(email);
    return this.mutate(projectId, (doc) => {
      const target = doc.entries.find((e) => normalizeEmail(e.email) === key);
      if (!target) return doc;
      if (target.isAdmin && doc.entries.filter((e) => e.isAdmin).length <= 1) {
        throw new Error("Cannot remove the last admin. Grant admin to someone else first.");
      }
      doc.entries = doc.entries.filter((e) => normalizeEmail(e.email) !== key);
      return doc;
    });
  }

  async setAdmin(projectId: string, email: string, isAdmin: boolean): Promise<AccessControlDoc> {
    const key = normalizeEmail(email);
    return this.mutate(projectId, (doc) => {
      const target = doc.entries.find((e) => normalizeEmail(e.email) === key);
      if (!target) throw new Error(`${email} is not on the access list.`);
      if (!isAdmin && target.isAdmin && doc.entries.filter((e) => e.isAdmin).length <= 1) {
        throw new Error("Cannot demote the last admin. Grant admin to someone else first.");
      }
      target.isAdmin = isAdmin;
      return doc;
    });
  }

  /**
   * Deliberate last-write-wins reset. Admin-only, behind a typed confirmation in the
   * UI. `__etag: -1` is the conventional force-overwrite marker; it is not documented
   * in the published typings, so the PUT upsert is what actually guarantees the write.
   */
  async forceReset(projectId: string, user: CurrentUser): Promise<AccessControlDoc> {
    const now = new Date().toISOString();
    const doc: AccessControlDoc = {
      id: aclDocId(projectId),
      schemaVersion: 1,
      claimNonce: newNonce(),
      claimedAt: now,
      entries: [
        {
          email: user.email,
          userId: user.id,
          displayName: user.displayName,
          isAdmin: true,
          addedBy: user.email,
          addedOn: now,
        },
      ],
      __etag: -1,
    };
    return this.setDocument<AccessControlDoc>(COLLECTION, doc, SHARED);
  }
}
