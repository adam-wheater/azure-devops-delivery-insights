/**
 * Links back into Azure DevOps from inside the extension iframe.
 *
 * The collection URI is resolved through the location service rather than
 * assembled from the org name, so this works on Azure DevOps Server (where the
 * host is a company URL with a collection path) as well as Services.
 *
 * Navigation goes through the host navigation service rather than relying on the
 * iframe being allowed to open windows itself: extension frames are sandboxed and
 * a bare window.open can be blocked. The anchors still carry a real href so
 * middle-click and "copy link" keep working.
 */
import * as SDK from "azure-devops-extension-sdk";
import {
  CommonServiceIds,
  ILocationService,
  IHostNavigationService,
} from "azure-devops-extension-api";

let collectionUriPromise: Promise<string | null> | null = null;

function normaliseBase(uri: string): string {
  return uri.endsWith("/") ? uri : `${uri}/`;
}

/** Root URL of the current collection/organisation, or null if it cannot be resolved. */
export async function getCollectionUri(): Promise<string | null> {
  if (!collectionUriPromise) {
    const pending = (async () => {
      try {
        const location = await SDK.getService<ILocationService>(CommonServiceIds.LocationService);
        const uri = await location.getServiceLocation();
        return uri ? normaliseBase(uri) : null;
      } catch {
        return null;
      }
    })();
    pending.catch(() => {
      if (collectionUriPromise === pending) collectionUriPromise = null;
    });
    collectionUriPromise = pending;
  }
  return collectionUriPromise;
}

/** Test hook. */
export function __resetCollectionUri(): void {
  collectionUriPromise = null;
}

/** The build results page for a run: <collection>/<project>/_build/results?buildId=N */
export function buildResultsUrl(
  collectionUri: string | null,
  projectName: string,
  buildId: number
): string | null {
  if (!collectionUri || !projectName || !Number.isFinite(buildId)) return null;
  return `${normaliseBase(collectionUri)}${encodeURIComponent(projectName)}/_build/results?buildId=${buildId}&view=results`;
}

/** The pipeline's own page (all runs for a definition). */
export function pipelineUrl(
  collectionUri: string | null,
  projectName: string,
  definitionId: number
): string | null {
  if (!collectionUri || !projectName || !Number.isFinite(definitionId) || definitionId < 0) {
    return null;
  }
  return `${normaliseBase(collectionUri)}${encodeURIComponent(projectName)}/_build?definitionId=${definitionId}`;
}

/** Open a URL in a new tab via the host, falling back to window.open. */
export async function openInHost(url: string): Promise<void> {
  try {
    const nav = await SDK.getService<IHostNavigationService>(
      CommonServiceIds.HostNavigationService
    );
    nav.openNewWindow(url, "");
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
