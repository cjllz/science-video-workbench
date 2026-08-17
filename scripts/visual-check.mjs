import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const outputDirectory = path.resolve("data", "qa");
await fs.mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const results = [];
try {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 }
  ]) {
    const page = await browser.newPage({ viewport });
    await page.goto("http://127.0.0.1:8787", { waitUntil: "networkidle" });
    await page.locator('input[type="file"][accept=".csv,.xlsx"]').setInputFiles(path.resolve("fixtures", "health-trend.csv"));
    await page.locator(".data-asset").waitFor({ state: "visible" });
    await page.screenshot({ path: path.join(outputDirectory, `${viewport.name}.png`), fullPage: true });
    const metrics = await page.evaluate(() => ({
      title: document.title,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      videoVisible: Boolean(document.querySelector("video")),
      formVisible: Boolean(document.querySelector("form")),
      dataAssetVisible: Boolean(document.querySelector(".data-asset"))
    }));
    results.push({ viewport: viewport.name, ...metrics });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.horizontalOverflow || !result.formVisible || !result.dataAssetVisible)) process.exitCode = 1;
