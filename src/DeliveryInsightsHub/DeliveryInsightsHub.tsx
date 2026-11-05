import * as SDK from "azure-devops-extension-sdk";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { CommonServiceIds } from "azure-devops-extension-api";
import { App } from "../components/App";
import { AccessGate } from "../components/AccessGate";
import { ThemeMode, ThemeProvider } from "../utils/theme";
import { Diagnostics, Gate, Skeleton } from "../components/ui";
import { SettingsService } from "../services/SettingsService";
import { formatDiagnostics, installBootDiagnostics } from "../services/bootDiagnostics";
import "../styles/app.css";

// Before the SDK handshake, before React: an error thrown while the page is still
// loading is exactly the one nobody can describe afterwards, and the access gate
// prints whatever this catches.
installBootDiagnostics();

const settingsService = new SettingsService();

// The theme toggle persists to localStorage for the next page load; the per-user
// extension-data copy follows so the choice travels with the account.
const rememberThemeMode = (mode: ThemeMode) => {
  settingsService.saveUiPrefs({ themeMode: mode }).catch(() => undefined);
};

interface IProjectPageService {
  getProject(): Promise<{ id: string; name: string } | undefined>;
}

/**
 * Resolves the current project once and shares it with everything below.
 *
 * Everything in this tree — including SDK.getUser(), which the access gate calls
 * synchronously — only mounts after SDK.init() and SDK.ready() have both resolved.
 * getUser() throws rather than returning undefined before that point.
 */
const Root: React.FC = () => {
  const [project, setProject] = React.useState<{ id: string; name: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService)
      .then((service) => service.getProject())
      .then((current) => {
        if (cancelled) return;
        if (!current) {
          setError("Could not determine the current Azure DevOps project.");
          return;
        }
        setProject({ id: current.id, name: current.name });
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "Could not determine the current project.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Gate title="Delivery Insights could not start">
        <p className="ax-gate__body">{error}</p>
        <div style={{ marginTop: 20 }}>
          <Diagnostics report={formatDiagnostics({ screen: "startup", failure: error })} />
        </div>
      </Gate>
    );
  }

  if (!project) {
    return (
      <Gate title={<span className="ax-sr-only">Loading project…</span>} busy>
        <Skeleton variant="value" style={{ margin: "0 auto 16px", width: "60%" }} />
        <Skeleton style={{ width: "80%", margin: "0 auto" }} />
      </Gate>
    );
  }

  return (
    <ThemeProvider onModeChange={rememberThemeMode}>
      <AccessGate projectId={project.id} projectName={project.name}>
        <App />
      </AccessGate>
    </ThemeProvider>
  );
};

SDK.init()
  .then(() => SDK.ready())
  .then(() => {
    const container = document.getElementById("root");
    if (container) {
      createRoot(container).render(<Root />);
    }
  })
  .catch((err) => {
    console.error("Failed to initialize Azure DevOps SDK:", err);
    const container = document.getElementById("root");
    if (!container) return;
    // React never mounted, so this is plain DOM. textContent throughout: the
    // failure text is untrusted and this is the one path with no React escaping.
    container.textContent = "";
    const message = document.createElement("p");
    message.textContent =
      "Delivery Insights could not connect to Azure DevOps. Refresh the page to try again.";
    const details = document.createElement("pre");
    details.className = "ax-diag__pre";
    details.textContent = formatDiagnostics({
      screen: "sdk handshake",
      failure: err?.message ?? String(err),
    });
    container.append(message, details);
  });
