import {
  installBootDiagnostics,
  getCapturedErrors,
  formatDiagnostics,
  __resetBootDiagnostics,
} from "@/services/bootDiagnostics";

type Listener = (event: any) => void;

/**
 * A stand-in for `window`. The module takes the target as a parameter precisely so
 * this can be driven without a DOM, and so a test can assert the listeners are
 * passive — an extension that swallowed errors instead of recording them would be
 * strictly worse than one with no diagnostics at all.
 */
function fakeWindow() {
  const listeners: Record<string, Listener[]> = {};
  return {
    listeners,
    addEventListener(type: string, fn: Listener) {
      (listeners[type] ??= []).push(fn);
    },
    emit(type: string, event: unknown) {
      for (const fn of listeners[type] ?? []) fn(event);
    },
  };
}

describe("bootDiagnostics", () => {
  beforeEach(() => __resetBootDiagnostics());

  it("captures a script error with the file that threw it", () => {
    const target = fakeWindow();
    installBootDiagnostics(target as unknown as Window);

    target.emit("error", {
      message: "Uncaught TypeError: define is not a function",
      filename: "https://cdn.example/vendor.js",
      lineno: 12,
      colno: 34,
      error: { name: "TypeError", message: "define is not a function", stack: "TypeError: ..." },
    });

    const [captured] = getCapturedErrors();
    expect(captured.message).toBe("TypeError: define is not a function");
    // Whose file it was is the whole point: an error from a script we did not ship
    // is a different bug from one in our bundle.
    expect(captured.source).toBe("https://cdn.example/vendor.js:12:34");
    expect(captured.kind).toBe("error");
  });

  it("captures an unhandled rejection that is a plain object, not an Error", () => {
    // Rejections cross the extension iframe through XDM, which rebuilds them without
    // a prototype. Anything that assumed `instanceof Error` would record nothing.
    const target = fakeWindow();
    installBootDiagnostics(target as unknown as Window);

    target.emit("unhandledrejection", {
      reason: { name: "TFS.WebApi.Exception", message: "Access denied.", status: 403 },
    });

    expect(getCapturedErrors()[0].message).toBe("TFS.WebApi.Exception: Access denied.");
  });

  it("keeps one copy of a repeating error and stops at the cap", () => {
    const target = fakeWindow();
    installBootDiagnostics(target as unknown as Window);

    for (let i = 0; i < 5; i++) {
      target.emit("error", { message: "same failure", filename: "a.js", lineno: 1, colno: 1 });
    }
    for (let i = 0; i < 20; i++) {
      target.emit("error", { message: `failure ${i}`, filename: "a.js", lineno: 1, colno: 1 });
    }

    const captured = getCapturedErrors();
    expect(captured.filter((e) => e.message === "same failure")).toHaveLength(1);
    expect(captured.length).toBeLessThanOrEqual(8);
  });

  it("binds only once, so a second install does not double-record", () => {
    const target = fakeWindow();
    installBootDiagnostics(target as unknown as Window);
    installBootDiagnostics(target as unknown as Window);

    expect(target.listeners.error).toHaveLength(1);
  });

  it("never throws, whatever the environment or the payload", () => {
    expect(() => installBootDiagnostics({} as unknown as Window)).not.toThrow();

    __resetBootDiagnostics();
    const target = fakeWindow();
    installBootDiagnostics(target as unknown as Window);
    expect(() => target.emit("unhandledrejection", { reason: undefined })).not.toThrow();
    expect(() => target.emit("error", {})).not.toThrow();
  });

  it("formats a report that names the build and the failure in one paste", () => {
    const target = fakeWindow();
    installBootDiagnostics(target as unknown as Window);
    target.emit("error", {
      message: "boom",
      filename: "hub.js",
      lineno: 3,
      colno: 9,
      error: { message: "boom", stack: "Error: boom\n  at one\n  at two" },
    });

    const report = formatDiagnostics({
      screen: "access check failed",
      version: "2.0.8",
      empty: "",
      missing: undefined,
    });

    expect(report).toContain("screen: access check failed");
    expect(report).toContain("version: 2.0.8");
    expect(report).not.toContain("empty:");
    expect(report).not.toContain("missing:");
    expect(report).toContain("[error] boom");
    expect(report).toContain("at hub.js:3:9");
    expect(report).toContain("at one");
  });

  it("says so explicitly when nothing was captured", () => {
    expect(formatDiagnostics({ screen: "startup" })).toContain("javascript errors: none captured");
  });
});
