import * as React from "react";
import {
  AccessControlDoc,
  AccessControlService,
  AccessDecision,
} from "../services/AccessControlService";
import { CurrentUser, getCurrentUser, getExtensionBuild, initialsFor } from "../services/identity";
import { formatDiagnostics } from "../services/bootDiagnostics";
import { Banner, Diagnostics, Gate, IconKey, IconLock, IconCopy, Skeleton } from "./ui";

export interface AccessContextValue {
  user: CurrentUser;
  projectId: string;
  projectName: string;
  isAdmin: boolean;
  doc: AccessControlDoc | null;
  refresh: () => void;
}

const AccessContext = React.createContext<AccessContextValue | null>(null);

export function useAccess(): AccessContextValue {
  const value = React.useContext(AccessContext);
  if (!value) throw new Error("useAccess must be used inside AccessGate");
  return value;
}

/**
 * The honesty note. Rendered wherever access is discussed — never hidden behind a
 * disclosure, because the people most likely to over-trust this feature are exactly
 * the ones reading these screens.
 */
export const AccessDisclaimer: React.FC = () => (
  <p className="ax-fine">
    This controls who sees this dashboard. It is <strong>not a security boundary</strong>. Anyone
    who can read builds in this project can read the same data directly from the Azure DevOps REST
    API, and the access list itself lives in extension data that any user of this extension can
    modify through the API.
  </p>
);

const accessControl = new AccessControlService();

export const AccessGate: React.FC<{
  projectId: string;
  projectName: string;
  children: React.ReactNode;
}> = ({ projectId, projectName, children }) => {
  const [user] = React.useState<CurrentUser>(() => getCurrentUser());
  const [decision, setDecision] = React.useState<AccessDecision>({ state: "loading" });
  const [claiming, setClaiming] = React.useState(false);
  const [claimError, setClaimError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  const refresh = React.useCallback(() => setNonce((n) => n + 1), []);
  const evaluatedProjectRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    // Re-validating an already-granted decision must NOT drop back to the loading
    // screen: that unmounts `children`, taking the dashboard and the admin modal
    // rendered inside it with it. Every grant used to close the panel and blank the
    // page. Keep the current decision mounted and swap in the fresh one on resolve.
    // A genuine project change is the one case that does need a full reset.
    const projectChanged = evaluatedProjectRef.current !== projectId;
    evaluatedProjectRef.current = projectId;
    if (projectChanged) {
      setDecision({ state: "loading" });
    } else {
      setDecision((prev) => (prev.state === "granted" ? prev : { state: "loading" }));
    }

    accessControl
      .evaluate(projectId, user)
      .then((result) => {
        if (!cancelled) setDecision(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setDecision({
            state: "error",
            kind: "unknown",
            message: "Could not check access.",
            // evaluate() classifies everything it can; anything that still escapes
            // is a defect in this file's own code path, so keep it raw.
            detail: `unhandled · ${err?.message ?? String(err)}`,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, user, nonce]);

  const handleClaim = React.useCallback(async () => {
    setClaiming(true);
    setClaimError(null);
    try {
      const result = await accessControl.claimOwnership(projectId, user);
      if (result.outcome === "error") {
        setClaimError(result.message);
      } else if (result.outcome === "lost") {
        setClaimError(
          "Someone else claimed this dashboard first. Ask them to add your address to the access list."
        );
        refresh();
      } else {
        refresh();
      }
    } catch (err) {
      setClaimError((err as Error)?.message ?? "The ownership claim failed.");
    } finally {
      setClaiming(false);
    }
  }, [projectId, user, refresh]);

  if (decision.state === "loading") {
    return (
      <Gate title={<span className="ax-sr-only">Checking access…</span>} busy>
        <Skeleton variant="value" style={{ margin: "0 auto 16px", width: "60%" }} />
        <Skeleton style={{ width: "85%", margin: "0 auto 8px" }} />
        <Skeleton style={{ width: "70%", margin: "0 auto" }} />
      </Gate>
    );
  }

  if (decision.state === "error") {
    return (
      <Gate title={"Couldn't check access"} icon={<IconLock size={26} />}>
        <p className="ax-gate__body">{decision.message}</p>
        <button type="button" className="ax-btn ax-btn--primary" onClick={refresh}>
          Try again
        </button>
        <div style={{ marginTop: 20 }}>
          <Diagnostics
            report={formatDiagnostics({
              screen: "access check failed",
              build: getExtensionBuild(),
              project: projectName,
              "sign-in name": user.rawName,
              failure: decision.detail,
            })}
          />
        </div>
      </Gate>
    );
  }

  if (decision.state === "unclaimed") {
    return (
      <Gate title={"Set up Delivery Insights"} icon={<IconKey size={26} />}>
        <p className="ax-gate__body">
          Nobody has claimed this dashboard for <strong>{projectName}</strong> yet. Claim it to
          become the administrator. You&apos;ll then grant access to teammates by email address.
        </p>
        <div className="ax-gate__identity">
          <span className="ax-avatar" aria-hidden="true">
            {initialsFor(user)}
          </span>
          <span>
            {user.displayName} · <span className="ax-mono">{user.rawName}</span>
          </span>
        </div>
        {claimError && (
          <Banner tone="error" onDismiss={() => setClaimError(null)}>
            {claimError}
          </Banner>
        )}
        <div>
          <button
            type="button"
            className="ax-btn ax-btn--primary"
            onClick={handleClaim}
            disabled={claiming}
          >
            {claiming ? "Claiming…" : "Claim ownership"}
          </button>
        </div>
        <div style={{ marginTop: 20 }}>
          <AccessDisclaimer />
        </div>
      </Gate>
    );
  }

  if (decision.state === "denied") {
    return (
      <GateLocked
        user={user}
        admins={decision.admins}
        projectName={projectName}
        onRetry={refresh}
      />
    );
  }

  return (
    <AccessContext.Provider
      value={{
        user,
        projectId,
        projectName,
        isAdmin: decision.isAdmin,
        doc: decision.doc,
        refresh,
      }}
    >
      {children}
    </AccessContext.Provider>
  );
};

/**
 * The locked screen. Its whole job is to make a mismatch self-fixable.
 *
 * SDK.getUser().name is the sign-in name, which is the UPN in AAD organisations and
 * the account email in MSA ones. It is NOT guaranteed to equal the directory `mail`
 * attribute — AAD B2B guests are the common divergence. Printing the exact string
 * turns that entire class of bug into "read this to your admin".
 */
const GateLocked: React.FC<{
  user: CurrentUser;
  admins: string[];
  projectName: string;
  onRetry: () => void;
}> = ({ user, admins, projectName, onRetry }) => {
  const [copied, setCopied] = React.useState(false);
  const alternates = user.emailCandidates.filter((c) => c !== user.email);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(user.rawName);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const mailto =
    admins.length > 0
      ? `mailto:${admins.join(",")}?subject=${encodeURIComponent(
          `Delivery Insights access for ${projectName}`
        )}&body=${encodeURIComponent(
          `Please add me to the Delivery Insights access list for ${projectName}.\n\nMy Azure DevOps sign-in name is:\n${user.rawName}\n`
        )}`
      : null;

  return (
    <Gate title={"You don't have access yet"} icon={<IconLock size={26} />}>
      <p className="ax-gate__body">
        Delivery Insights for <strong>{projectName}</strong> is limited to an approved list of
        people. Ask an administrator to add the address below.
      </p>

      <div className="ax-gate__identity">
        <span className="ax-avatar" aria-hidden="true">
          {initialsFor(user)}
        </span>
        <span className="ax-mono">{user.rawName || "(no sign-in name reported)"}</span>
        <button type="button" className="ax-btn ax-btn--sm ax-btn--ghost" onClick={copy}>
          <IconCopy /> {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {alternates.length > 0 && (
        <p className="ax-fine" style={{ marginTop: -8, marginBottom: 16 }}>
          We also tried: <span className="ax-mono">{alternates.join(", ")}</span>
        </p>
      )}

      <div className="ax-row" style={{ justifyContent: "center", marginBottom: 20 }}>
        {mailto && (
          <a className="ax-btn ax-btn--primary" href={mailto}>
            Request access
          </a>
        )}
        <button type="button" className="ax-btn" onClick={onRetry}>
          Check again
        </button>
      </div>

      {admins.length > 0 && (
        <p className="ax-fine" style={{ marginBottom: 16 }}>
          Administrators: <span className="ax-mono">{admins.join(", ")}</span>
        </p>
      )}

      <AccessDisclaimer />

      {/* An admin who lands here is looking at a mismatch, not a missing grant:
            the stored entry and the identity Azure DevOps reports have diverged.
            Both sides are printed so the difference is visible rather than guessed. */}
      <div style={{ marginTop: 16 }}>
        <Diagnostics
          report={formatDiagnostics({
            screen: "access denied",
            build: getExtensionBuild(),
            project: projectName,
            "sign-in name": user.rawName,
            "matched against": user.emailCandidates.join(", ") || "(none)",
            "user id": user.id,
            "stored administrators": admins.join(", ") || "(none)",
          })}
        />
      </div>
    </Gate>
  );
};
