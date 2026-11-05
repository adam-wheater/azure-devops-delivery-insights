import * as React from "react";
import { AccessControlDoc, AccessControlService, AclEntry } from "../services/AccessControlService";
import { normalizeEmail } from "../services/identity";
import { useAccess, AccessDisclaimer } from "./AccessGate";
import { Banner, IconCheck, IconUsers, IconX, Modal } from "./ui";

const accessControl = new AccessControlService();

function initials(entry: AclEntry): string {
  const source = entry.displayName?.trim() || entry.email;
  const words = source.split(/[\s.@_-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]).slice(0, 2);
}

export const AdminPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { projectId, projectName, user, doc: initialDoc, refresh } = useAccess();
  const [doc, setDoc] = React.useState<AccessControlDoc | null>(initialDoc);
  const [email, setEmail] = React.useState("");
  const [grantAdmin, setGrantAdmin] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = React.useState("");
  const [showDanger, setShowDanger] = React.useState(false);

  const entries = React.useMemo(
    () =>
      [...(doc?.entries ?? [])].sort(
        (a, b) => Number(b.isAdmin) - Number(a.isAdmin) || a.email.localeCompare(b.email)
      ),
    [doc]
  );

  const adminCount = entries.filter((e) => e.isAdmin).length;
  const normalized = normalizeEmail(email);

  const run = async (action: () => Promise<AccessControlDoc>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setDoc(next);
      refresh();
    } catch (err) {
      setError((err as Error)?.message ?? "The change could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = (event: React.FormEvent) => {
    event.preventDefault();
    if (!normalized) return;
    void run(async () => {
      const next = await accessControl.grantAccess(projectId, normalized, grantAdmin, user);
      setEmail("");
      setGrantAdmin(false);
      return next;
    });
  };

  return (
    <Modal
      title={
        <span className="ax-row">
          <IconUsers size={17} /> Manage access
        </span>
      }
      onClose={onClose}
      wide
      footer={
        <button type="button" className="ax-btn" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="ax-banner ax-banner--info" role="status">
        <IconUsers size={16} />
        <div className="ax-banner__body">
          <div className="ax-banner__title">Who can open Delivery Insights for {projectName}</div>
          <AccessDisclaimer />
        </div>
      </div>

      {error && (
        <Banner tone="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      <form className="ax-row" onSubmit={handleAdd} style={{ marginBottom: 20 }}>
        <label className="ax-sr-only" htmlFor="ax-grant-email">
          Email address to grant access to
        </label>
        <input
          id="ax-grant-email"
          className="ax-input"
          style={{ flex: "1 1 260px" }}
          type="text"
          inputMode="email"
          autoComplete="off"
          placeholder="name@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setEmail((v) => v.trim())}
          disabled={busy}
        />
        <label className="ax-row" style={{ gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={grantAdmin}
            onChange={(e) => setGrantAdmin(e.target.checked)}
            disabled={busy}
          />
          Admin
        </label>
        <button type="submit" className="ax-btn ax-btn--primary" disabled={busy || !normalized}>
          Grant access
        </button>
      </form>

      {normalized && normalized !== email && (
        <p className="ax-fine" style={{ marginTop: -12, marginBottom: 16 }}>
          Will be stored as <span className="ax-mono">{normalized}</span>
        </p>
      )}

      {adminCount === 1 && (
        <Banner tone="warn" title="Only one administrator">
          If this account loses access, nobody can manage the list from inside the extension. Grant
          admin to a second person.
        </Banner>
      )}

      <div>
        {entries.map((entry) => {
          const isSelf = entry.userId === user.id || normalizeEmail(entry.email) === user.email;
          const lastAdmin = entry.isAdmin && adminCount <= 1;
          return (
            <div className="ax-member-row" key={entry.email}>
              <span className="ax-avatar" aria-hidden="true">
                {initials(entry)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ax-row" style={{ gap: 6 }}>
                  <span className="ax-mono">{entry.email}</span>
                  {entry.isAdmin && <span className="ax-pill ax-pill--info">Admin</span>}
                  {isSelf && <span className="ax-pill">You</span>}
                  {entry.userId && (
                    <span
                      className="ax-pill ax-pill--success"
                      title="Bound to a stable account id, so it survives a sign-in name change"
                    >
                      <IconCheck size={11} /> Verified
                    </span>
                  )}
                </div>
                <div className="ax-fine">
                  {entry.displayName ? `${entry.displayName} · ` : ""}added by {entry.addedBy} on{" "}
                  {new Date(entry.addedOn).toLocaleDateString()}
                </div>
              </div>
              <button
                type="button"
                className="ax-btn ax-btn--sm"
                disabled={busy || lastAdmin}
                title={lastAdmin ? "Cannot demote the last admin" : undefined}
                onClick={() =>
                  void run(() => accessControl.setAdmin(projectId, entry.email, !entry.isAdmin))
                }
              >
                {entry.isAdmin ? "Revoke admin" : "Make admin"}
              </button>
              <button
                type="button"
                className="ax-btn ax-btn--sm ax-btn--danger"
                disabled={busy || lastAdmin}
                title={lastAdmin ? "Cannot remove the last admin" : undefined}
                onClick={() => void run(() => accessControl.revokeAccess(projectId, entry.email))}
                aria-label={`Remove ${entry.email}`}
              >
                <IconX size={13} /> Remove
              </button>
            </div>
          );
        })}
      </div>

      <div
        style={{ marginTop: 24, borderTop: "1px solid var(--ax-border-subtle)", paddingTop: 16 }}
      >
        <button
          type="button"
          className="ax-btn ax-btn--sm ax-btn--ghost"
          onClick={() => setShowDanger((s) => !s)}
          aria-expanded={showDanger}
        >
          {showDanger ? "Hide" : "Show"} danger zone
        </button>

        {showDanger && (
          <div style={{ marginTop: 12 }}>
            <p className="ax-fine">
              Resetting removes every entry and makes you the sole administrator. Use this if the
              original owner has left. Type <strong>RESET</strong> to confirm.
            </p>
            <div className="ax-row" style={{ marginTop: 8 }}>
              <label className="ax-sr-only" htmlFor="ax-reset-confirm">
                Type RESET to confirm
              </label>
              <input
                id="ax-reset-confirm"
                className="ax-input"
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                placeholder="RESET"
              />
              <button
                type="button"
                className="ax-btn ax-btn--danger"
                disabled={busy || resetConfirm !== "RESET"}
                onClick={() =>
                  void run(async () => {
                    const next = await accessControl.forceReset(projectId, user);
                    setResetConfirm("");
                    return next;
                  })
                }
              >
                Reset access list
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
