/**
 * Writes dist/THIRD-PARTY-NOTICES.txt: the license text of every runtime
 * dependency, since those packages are bundled into dist/<HUB>.js.
 *
 * Their MIT, BSD and similar terms require the notice to travel with the code.
 * The .vsix ships dist/ but not node_modules/, and the LICENSE.txt that terser
 * extracts only points at a LICENSE file nobody receives. Runs after every
 * production build (postbuild), so the list can never fall behind package.json.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/** Finds a package the way Node does: node_modules in `fromDir`, then each parent. */
function findPackage(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    if (dir === path.dirname(dir)) return null;
  }
}

const found = new Map();
function visit(name, fromDir) {
  const dir = findPackage(name, fromDir);
  if (!dir || found.has(dir)) return; // optional dependency not installed, or seen
  const pkg = readJson(path.join(dir, "package.json"));
  found.set(dir, pkg);
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
    visit(dep, dir);
  }
}

const manifest = readJson(path.join(root, "vss-extension.json"));
for (const dep of Object.keys(readJson(path.join(root, "package.json")).dependencies ?? {})) {
  visit(dep, root);
}

const rule = "=".repeat(78);
const sections = [...found.entries()]
  .sort(([, a], [, b]) => a.name.localeCompare(b.name))
  .map(([dir, pkg]) => {
    const licenseFile = fs
      .readdirSync(dir)
      .find((file) => /^(licen[cs]e|copying)(\.|-|$)/i.test(file));
    const text = licenseFile
      ? fs.readFileSync(path.join(dir, licenseFile), "utf8").trim()
      : `Licensed under ${pkg.license ?? "an unstated license"}; the package ships no license file.`;
    const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    return [rule, `${pkg.name} ${pkg.version} (${pkg.license ?? "unknown"})`, repo, rule, text]
      .filter(Boolean)
      .join("\n");
  });

const header =
  `${manifest.name} includes the third-party software listed below. Each component\n` +
  `remains under its own license, reproduced in full, and nothing in this\n` +
  `extension's LICENSE limits your rights under those licenses.\n`;

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist", "THIRD-PARTY-NOTICES.txt"), `${header}\n${sections.join("\n\n")}\n`);
console.log(`Wrote dist/THIRD-PARTY-NOTICES.txt (${found.size} packages).`);
