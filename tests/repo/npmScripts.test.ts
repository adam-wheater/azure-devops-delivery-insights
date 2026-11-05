import * as fs from "fs";
import * as path from "path";

/**
 * Guards against a class of bug that is INVISIBLE on this project's CI.
 *
 * What happened: build.ps1 was changed to run `npm run lint` and
 * `npm run format:check`, matching the pipeline. Both scripts passed their file
 * globs in SINGLE quotes. npm runs scripts through `cmd.exe` on Windows, and
 * cmd.exe does not strip single quotes — so eslint and prettier were handed a
 * literal path called `'src/**' + '/*.{ts,tsx}'`, found nothing, and the build
 * died on Windows at a step that had passed on Linux CI forever.
 *
 * CI runs on ubuntu-latest, where `sh` strips the quotes and everything works.
 * So no amount of pipeline coverage catches this; only reading the script text
 * does. Hence a test rather than a lint rule.
 *
 * Double quotes are correct on both: cmd.exe strips them, and POSIX shells strip
 * them too, leaving the glob for the tool itself to expand.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readJson(relativePath: string): any {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

describe("npm scripts run on Windows as well as CI", () => {
  const scripts: Record<string, string> = readJson("package.json").scripts ?? {};

  it("never single-quotes an argument", () => {
    const offenders = Object.entries(scripts)
      .filter(([, command]) => command.includes("'"))
      .map(([name, command]) => `${name}: ${command}`);

    expect(offenders).toEqual([]);
  });

  it("defines every script build.ps1 and the CI workflow invoke", () => {
    // A renamed script is the other way this breaks, and it fails with an
    // unhelpful npm error rather than naming what is missing.
    for (const name of ["lint", "lint:fix", "format", "format:check", "test", "build", "package"]) {
      expect(scripts[name]).toBeDefined();
    }
  });

  it("keeps build.ps1 and the CI workflow installing the same way", () => {
    // A local build that installs differently from the pipeline is not a check,
    // it is a second opinion. --legacy-peer-deps was missing from build.ps1
    // while ci.yml passed it.
    const workflow = fs.readFileSync(
      path.join(REPO_ROOT, ".github", "workflows", "ci.yml"),
      "utf8"
    );
    const script = fs.readFileSync(path.join(REPO_ROOT, "build.ps1"), "utf8");

    expect(workflow).toMatch(/npm ci --legacy-peer-deps/);
    expect(script).toMatch(/'ci', '--legacy-peer-deps'/);
  });
});

describe("build.ps1 parses under Windows PowerShell", () => {
  const script = fs.readFileSync(path.join(REPO_ROOT, "build.ps1"), "utf8");

  it("contains no non-ASCII characters", () => {
    // Windows PowerShell 5.1 decodes a .ps1 with no byte-order mark as ANSI, so
    // any non-ASCII character is silently mangled. Harmless inside a comment
    // until the day it is not — and the file cannot be executed here to find out.
    const offenders = script
      .split("\n")
      .map((line, index) => ({ line: index + 1, text: line }))
      .filter((entry) => /[^\x00-\x7F]/.test(entry.text))
      .map((entry) => `line ${entry.line}`);

    expect(offenders).toEqual([]);
  });

  it("has no trailing whitespace after a line-continuation backtick", () => {
    // A backtick followed by a space is not a continuation; the next line then
    // parses as a separate statement and the arguments silently go missing.
    const offenders = script
      .split("\n")
      .map((line, index) => ({ line: index + 1, text: line.replace(/\r$/, "") }))
      .filter((entry) => /`[ \t]+$/.test(entry.text))
      .map((entry) => `line ${entry.line}`);

    expect(offenders).toEqual([]);
  });
});
