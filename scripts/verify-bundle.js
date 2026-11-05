#!/usr/bin/env node
/**
 * Post-build sanity check on dist/.
 *
 * Unit tests render components directly and never look at the built page, so
 * none of these can be caught by a test:
 *   1. every emitted stylesheet is referenced by the HTML
 *   2. every asset the HTML references exists on disk
 *   3. every lazy chunk named in the webpack runtime map exists on disk
 *   4. no AMD define() survived into an emitted script
 *   5. no TypeScript declaration files leaked into dist/ (they get published)
 *
 * The hub name is read from webpack.config.js so this script needs no editing.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const webpackSource = fs.readFileSync(path.join(ROOT, "webpack.config.js"), "utf8");
const hubMatch = webpackSource.match(/const HUB = "([^"]+)"/);
if (!hubMatch) {
  console.error('verify-bundle: could not find `const HUB = "..."` in webpack.config.js');
  process.exit(1);
}
const HUB = hubMatch[1];
const HUB_DIR = path.join(DIST, HUB);
const HTML = path.join(HUB_DIR, `${HUB}.html`);

const problems = [];
const fail = (message) => problems.push(message);

if (!fs.existsSync(HTML)) {
  fail(`missing entry page: ${path.relative(DIST, HTML)}`);
} else {
  const html = fs.readFileSync(HTML, "utf8");

  const referenced = new Set();
  const refPattern = /(?:href|src)\s*=\s*["']([^"']+)["']/g;
  let match;
  while ((match = refPattern.exec(html)) !== null) {
    const ref = match[1];
    if (/^(https?:)?\/\//.test(ref) || ref.startsWith("data:") || ref.startsWith("#")) continue;
    referenced.add(ref);
    const resolved = path.join(HUB_DIR, ref);
    if (!fs.existsSync(resolved)) {
      fail(`page references "${ref}" but ${path.relative(DIST, resolved)} was not emitted`);
    }
  }

  const stylesheets = fs.readdirSync(HUB_DIR).filter((f) => f.endsWith(".css"));
  if (stylesheets.length === 0) {
    fail("no stylesheet was emitted — the design system would not load");
  }
  for (const sheet of stylesheets) {
    if (!referenced.has(sheet)) {
      fail(
        `${sheet} was emitted but the page never links it — the app would render unstyled. ` +
          `Add <link rel="stylesheet" href="${sheet}" /> to ${HUB}.html`
      );
    }
  }

  if (!referenced.has(`${HUB}.js`)) fail(`${HUB}.js is not loaded by ${HUB}.html`);
  if (!/id="root" class="ax-root"/.test(html)) {
    fail('the #root element must carry class="ax-root" or the design system never applies');
  }

  const inlineStyle = html.match(/<style>([\s\S]*?)<\/style>/);
  if (inlineStyle) {
    for (const rule of inlineStyle[1].split("}")) {
      const [selector, body] = rule.split("{");
      if (!selector || !body) continue;
      if (/#root/.test(selector) && /(^|[;\s])padding\s*:/.test(body)) {
        fail(
          "the inline <style> sets padding on #root — an ID selector outranks .ax-root, " +
            "so the page would render with no padding. Remove #root from that rule."
        );
      }
    }
  }
}

// Lazy chunks: webpack writes a chunk-id -> name and chunk-id -> hash map into
// the runtime. Reconstruct the URLs and confirm each file landed.
const ENTRY_JS = path.join(HUB_DIR, `${HUB}.js`);
if (fs.existsSync(ENTRY_JS)) {
  const js = fs.readFileSync(ENTRY_JS, "utf8");
  const chunkUrl = js.match(new RegExp(`"${HUB}/"\\+(\\{[^}]*\\})\\[\\w+\\]\\+"\\."\\+(\\{[^}]*\\})`));
  if (chunkUrl) {
    const parseMap = (literal) => {
      const out = {};
      for (const [, id, value] of literal.matchAll(/(\d+):"([^"]+)"/g)) out[id] = value;
      return out;
    };
    const names = parseMap(chunkUrl[1]);
    const hashes = parseMap(chunkUrl[2]);
    for (const id of Object.keys(names)) {
      const file = `${names[id]}.${hashes[id]}.js`;
      if (!fs.existsSync(path.join(HUB_DIR, file))) {
        fail(`lazy chunk "${file}" is requested at runtime but was not emitted`);
      }
    }
  }
}

// AMD leakage: both azure-devops-extension-api and -sdk ship AMD modules.
for (const file of fs.existsSync(HUB_DIR) ? fs.readdirSync(HUB_DIR) : []) {
  if (!file.endsWith(".js")) continue;
  const source = fs.readFileSync(path.join(HUB_DIR, file), "utf8");
  const amd = source.match(/\bdefine\s*\(/);
  if (amd) {
    fail(
      `${file} contains an untransformed AMD define() — the page would fail with ` +
        `"define is not a function". Check how azure-devops-extension-api / -sdk resolved.`
    );
  }
}

// Declaration files are published as Marketplace assets if they land in dist/.
const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};
if (fs.existsSync(DIST)) {
  const leaked = walk(DIST).filter((f) => /\.d\.ts(\.map)?$/.test(f));
  if (leaked.length > 0) {
    fail(
      `${leaked.length} TypeScript declaration file(s) in dist/ — set "declaration": false in tsconfig.json`
    );
  }
}

if (problems.length > 0) {
  console.error("\nBundle verification FAILED:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("");
  process.exit(1);
}

console.log(
  `Bundle verification passed for ${HUB}: stylesheet linked, assets and lazy chunks present, no AMD define(), no .d.ts.`
);
