/**
 * Guards what ends up inside the .vsix.
 *
 * The Visual Studio Marketplace rejects an extension package that contains an
 * SVG file, and a vector copy of the icon used to sit next to icon.png in
 * static/. tfx packages every file under each "files" path in the manifest, so
 * anything placed there ships. These checks read the manifest rather than a
 * built package so they fail in a normal test run, before anyone tries to
 * publish.
 */
import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "vss-extension.json"), "utf8"));

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const stat = fs.statSync(dir);
  if (stat.isFile()) return [dir];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => walk(path.join(dir, entry.name)));
}

/** Packaged paths that live in the repository (dist/ is build output). */
const sourcePackagedPaths: string[] = (manifest.files ?? [])
  .map((entry: { path: string }) => entry.path)
  .filter((p: string) => p !== "dist");

describe("extension package contents", () => {
  it("ships no SVG files, which the Marketplace rejects", () => {
    const offenders = sourcePackagedPaths
      .flatMap((p) => walk(path.join(REPO_ROOT, p)))
      .filter((file) => /\.svg$/i.test(file))
      .map((file) => path.relative(REPO_ROOT, file));

    expect(offenders).toEqual([]);
  });

  it("references only PNG images from the manifest", () => {
    const refs: string[] = [];
    if (manifest.icons?.default) refs.push(manifest.icons.default);
    for (const shot of manifest.screenshots ?? []) refs.push(shot.path);
    for (const contribution of manifest.contributions ?? []) {
      const icon = contribution.properties?.icon;
      if (typeof icon === "string") refs.push(icon);
      else if (icon) refs.push(...Object.values(icon as Record<string, string>));
    }

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref).toMatch(/\.png$/i);
      expect(fs.existsSync(path.join(REPO_ROOT, ref))).toBe(true);
    }
  });

  it("uses a 128x128 PNG as the extension icon", () => {
    const png = fs.readFileSync(path.join(REPO_ROOT, manifest.icons.default));
    // PNG signature, then the IHDR chunk carries width and height as big-endian
    // 32-bit integers at bytes 16 and 20.
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(128);
    expect(png.readUInt32BE(20)).toBe(128);
  });
});
