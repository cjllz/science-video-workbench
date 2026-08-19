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
    const metrics = await page.evaluate(({ desktop }) => {
      const panels = [".brief-panel", ".preview-panel", ".history-panel"]
        .map((selector) => document.querySelector(selector));
      const originalScrollTops = panels.map((panel) => panel?.scrollTop ?? 0);
      const scrollIsolation = [];

      if (desktop) {
        for (const [index, panel] of panels.entries()) {
          if (!panel) continue;
          const probe = document.createElement("div");
          probe.style.height = "1600px";
          probe.dataset.qaScrollProbe = "true";
          panel.append(probe);
          panel.scrollTop = 240;
          scrollIsolation.push({
            panel: index,
            moved: panel.scrollTop > 0,
            othersUnchanged: panels.every((other, otherIndex) =>
              otherIndex === index || (other?.scrollTop ?? 0) === originalScrollTops[otherIndex]
            )
          });
          panel.scrollTop = originalScrollTops[index];
          probe.remove();
        }
      }

      return {
        title: document.title,
        bodyWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        pageScrollable: document.documentElement.scrollHeight > window.innerHeight + 1,
        panelOverflowY: panels.map((panel) => panel ? getComputedStyle(panel).overflowY : "missing"),
        scrollIsolation,
        videoVisible: Boolean(document.querySelector("video")),
        formVisible: Boolean(document.querySelector("form")),
        dataAssetVisible: Boolean(document.querySelector(".data-asset"))
      };
    }, { desktop: viewport.name === "desktop" });
    results.push({ viewport: viewport.name, ...metrics });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
const desktop = results.find((result) => result.viewport === "desktop");
const mobile = results.find((result) => result.viewport === "mobile");
const invalid = results.some((result) =>
  result.horizontalOverflow || !result.formVisible || !result.dataAssetVisible
);
const desktopInvalid = !desktop || desktop.pageScrollable
  || desktop.panelOverflowY.some((value) => value !== "auto")
  || desktop.scrollIsolation.some((result) => !result.moved || !result.othersUnchanged);
const mobileInvalid = !mobile || !mobile.pageScrollable
  || mobile.panelOverflowY.some((value) => value !== "visible");
if (invalid || desktopInvalid || mobileInvalid) process.exitCode = 1;
