/**
 * First-error capture for the extension iframe.
 *
 * An extension hub is a black box to the person using it: when something throws,
 * the app shows a generic screen and the real message is only in the browser
 * console — which the reporter usually paraphrases, and which nobody has when the
 * bug report arrives. "Something about define not being a function, and now I'm
 * unauthorised" is not enough to act on, and there is no second chance to ask.
 *
 * So the page records what actually failed, from before the SDK handshake starts,
 * and the access gate prints it verbatim next to the friendly copy. That covers
 * the two cases that matter: an error thrown by a script we did not write (the
 * `source` tells you whose file it was), and a rejected promise nobody awaited.
 *
 * Deliberately dumb: an array, a cap, and two listeners. It must never be the
 * reason a page fails to load, so every entry point swallows its own errors and
 * the listeners never call preventDefault — the console still gets everything.
 */

export interface CapturedError {
  /** ISO timestamp, so the order is still readable after copy/paste. */
  at: string;
  kind: "error" | "unhandledrejection";
  message: string;
  /** "file:line:col" for a script error. Names the culprit when it is not our bundle. */
  source?: string;
  stack?: string;
}

/** Small enough to stay readable when pasted into a bug report. */
const MAX_CAPTURED = 8;

const captured: CapturedError[] = [];
let installed = false;

function record(entry: CapturedError): void {
  if (captured.length >= MAX_CAPTURED) return;
  // Identical errors fire repeatedly (a render loop, a polling call). Keep one.
  if (captured.some((e) => e.kind === entry.kind && e.message === entry.message)) return;
  captured.push(entry);
}

function messageOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const source = value as { message?: unknown; name?: unknown };
    if (typeof source.message === "string" && source.message) {
      return typeof source.name === "string" && source.name
        ? `${source.name}: ${source.message}`
        : source.message;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
}

function stackOf(value: unknown): string | undefined {
  if (value && typeof value === "object") {
    const stack = (value as { stack?: unknown }).stack;
    if (typeof stack === "string" && stack) return stack;
  }
  return undefined;
}

/**
 * Attach the listeners. Safe to call more than once; only the first call binds.
 * Call this as early as possible — before SDK.init(), before React — or the
 * errors worth catching will already have happened.
 */
export function installBootDiagnostics(target: Window = window): void {
  if (installed) return;
  installed = true;
  try {
    target.addEventListener("error", (event: ErrorEvent) => {
      try {
        const filename = event.filename ?? "";
        const position =
          typeof event.lineno === "number" && event.lineno > 0
            ? `${filename}:${event.lineno}:${event.colno ?? 0}`
            : filename;
        record({
          at: new Date().toISOString(),
          kind: "error",
          message: event.error ? messageOf(event.error) : (event.message ?? "Script error"),
          source: position || undefined,
          stack: stackOf(event.error),
        });
      } catch {
        /* diagnostics must never break the page */
      }
    });

    target.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
      try {
        record({
          at: new Date().toISOString(),
          kind: "unhandledrejection",
          message: messageOf(event.reason),
          stack: stackOf(event.reason),
        });
      } catch {
        /* diagnostics must never break the page */
      }
    });
  } catch {
    /* an environment without addEventListener is not worth failing over */
  }
}

export function getCapturedErrors(): CapturedError[] {
  return captured.slice();
}

/**
 * A plain-text block for the clipboard. `context` carries whatever the caller
 * knows that this module does not — the extension version, the failing call —
 * so one paste answers "what broke, where, and in which build".
 */
export function formatDiagnostics(context: Record<string, string | number | undefined>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || value === "") continue;
    lines.push(`${key}: ${value}`);
  }
  if (captured.length === 0) {
    lines.push("javascript errors: none captured");
    return lines.join("\n");
  }
  lines.push(`javascript errors: ${captured.length}`);
  for (const entry of captured) {
    lines.push("");
    lines.push(`  [${entry.kind}] ${entry.message}`);
    if (entry.source) lines.push(`  at ${entry.source}`);
    if (entry.stack) {
      for (const line of entry.stack.split("\n").slice(0, 6)) {
        lines.push(`    ${line.trim()}`);
      }
    }
  }
  return lines.join("\n");
}

/** Test hook. */
export function __resetBootDiagnostics(): void {
  captured.length = 0;
  installed = false;
}
