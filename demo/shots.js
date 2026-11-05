// Takes the README and Marketplace screenshots from the demo build. Each entry in
// demo/shots.json opens the hub, runs its steps and saves
// static/screenshots/<name>.png.
//
// Needs Playwright, which is not a dependency of this repo:
//   npm i --no-save playwright && npx playwright install chromium
//
// Steps are Playwright selectors: { "click": "role=button[name='Scan']" },
// { "fill": "input[type=search]", "value": "api" }, { "waitFor": "text=Done" },
// { "wait": 300 }. A shot saves the whole page, or only `selector` if given.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const hub = /const HUB = "([^"]+)"/.exec(fs.readFileSync(path.join(root, "webpack.config.js"), "utf8"))[1];
const page = pathToFileURL(path.join(__dirname, "dist", hub, `${hub}.html`)).href;
const shots = JSON.parse(fs.readFileSync(path.join(__dirname, "shots.json"), "utf8"));
const outDir = path.join(root, "static", "screenshots");

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: { width: shot.width ?? 1280, height: shot.height ?? 800 },
      deviceScaleFactor: 2,
      colorScheme: shot.colorScheme ?? "light",
    });
    const tab = await context.newPage();
    const errors = [];
    tab.on("pageerror", (err) => errors.push(err.message));
    await tab.goto(page);
    await tab.waitForSelector(".ax-root > *");
    for (const step of shot.steps ?? []) {
      if (step.click) await tab.click(step.click);
      if (step.fill) await tab.fill(step.fill, step.value ?? "");
      if (step.waitFor) await tab.waitForSelector(step.waitFor);
      if (step.wait) await tab.waitForTimeout(step.wait);
    }
    await tab.waitForTimeout(400);
    const file = path.join(outDir, `${shot.name}.png`);
    if (shot.selector) await tab.locator(shot.selector).first().screenshot({ path: file });
    else await tab.screenshot({ path: file, fullPage: shot.fullPage ?? false });
    if (errors.length) console.warn(`${shot.name}: ${errors.join("; ")}`);
    console.log(`static/screenshots/${shot.name}.png`);
    await context.close();
  }
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
