# Independent Panel Scrolling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the authenticated desktop workspace's left, center, and right panels independently scrollable without changing tablet/mobile document flow.

**Architecture:** CSS gives the authenticated shell a fixed dynamic-viewport grid, reserves a row for the optional error banner, and constrains the workspace to the remaining row. Each desktop panel becomes its own native vertical scroll container with contained overscroll; the existing responsive breakpoints explicitly restore normal page flow. A focused Vitest contract test protects the required selectors, while the existing Playwright visual check measures real scroll isolation.

**Tech Stack:** React 19 markup already present, CSS Grid, Vitest, Playwright Core with Microsoft Edge.

---

## File Map

| Path | Responsibility |
| --- | --- |
| `src/client/workspace-layout.test.ts` | Protect the desktop containment and responsive-reset CSS contract. |
| `src/client/styles.css` | Implement fixed desktop viewport rows and three independent scroll containers. |
| `scripts/visual-check.mjs` | Verify computed layout and panel scroll isolation in a real browser. |

## Task 1: Add a Failing Layout Contract Test

**Files:**
- Create: `src/client/workspace-layout.test.ts`
- Test: `src/client/workspace-layout.test.ts`

- [ ] **Step 1: Add exact CSS contract assertions**

Create `src/client/workspace-layout.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(path.resolve("src/client/styles.css"), "utf8");

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`).exec(stylesheet);
  expect(match, `missing CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("desktop workspace scrolling contract", () => {
  it("constrains the authenticated shell and workspace to the viewport", () => {
    expect(rule(".app-shell:not(.login-shell)")).toMatch(/height:\s*100dvh/);
    expect(rule(".app-shell:not(.login-shell)")).toMatch(/overflow:\s*hidden/);
    expect(rule(".workspace")).toMatch(/min-height:\s*0/);
    expect(rule(".workspace")).toMatch(/overflow:\s*hidden/);
  });

  it("gives every desktop panel an independent contained scroll area", () => {
    const panels = rule(".brief-panel, .preview-panel, .history-panel");
    expect(panels).toMatch(/overflow-y:\s*auto/);
    expect(panels).toMatch(/overscroll-behavior-y:\s*contain/);
    expect(panels).toMatch(/scrollbar-gutter:\s*stable/);
  });

  it("restores document flow at the existing tablet breakpoint", () => {
    const tabletBlock = stylesheet.match(/@media \(max-width:\s*1180px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(tabletBlock).toMatch(/\.app-shell:not\(\.login-shell\)[^{]*\{[^}]*height:\s*auto/);
    expect(tabletBlock).toMatch(/\.workspace\s*\{[^}]*overflow:\s*visible/);
    expect(tabletBlock).toMatch(/\.brief-panel, \.preview-panel, \.history-panel\s*\{[^}]*overflow-y:\s*visible/);
  });
});
```

- [ ] **Step 2: Run the focused test and observe the expected failure**

Run:

```powershell
npx vitest run src/client/workspace-layout.test.ts
```

Expected: three tests fail because the desktop viewport containment, panel overflow, and responsive-reset rules are not present yet.

- [ ] **Step 3: Commit the failing contract test**

```powershell
git add src/client/workspace-layout.test.ts
git commit -m "test: specify independent workspace scrolling"
```

## Task 2: Implement Desktop Containment and Independent Scrolling

**Files:**
- Modify: `src/client/styles.css`
- Test: `src/client/workspace-layout.test.ts`

- [ ] **Step 1: Constrain the authenticated shell to the dynamic viewport**

Replace the existing `.app-shell` rule and add explicit grid placement:

```css
.app-shell { min-height: 100vh; }
.app-shell:not(.login-shell) {
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
}
.app-shell:not(.login-shell) .topbar { grid-row: 1; }
.app-shell:not(.login-shell) .global-error { grid-row: 2; }
.app-shell:not(.login-shell) .workspace { grid-row: 3; }
```

The fallback `100vh` must appear before `100dvh`. Keep the login shell in normal document flow.

- [ ] **Step 2: Constrain the workspace and make each panel independently scrollable**

Replace the existing workspace and shared-panel rules with:

```css
.workspace {
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(330px, 390px) minmax(480px, 1fr) minmax(260px, 310px);
  max-width: 1700px;
  width: 100%;
  margin: 0 auto;
  overflow: hidden;
}
.workspace:has(.script-workspace) { grid-template-columns: minmax(300px, 330px) minmax(680px, 1fr) minmax(220px, 250px); }
.brief-panel, .preview-panel, .history-panel {
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-gutter: stable;
  background: rgba(247,246,241,.92);
}
```

Keep the existing individual borders/background declarations immediately after this block.

- [ ] **Step 3: Restore normal flow at the tablet breakpoint**

At the beginning of `@media (max-width: 1180px)`, add:

```css
  .app-shell:not(.login-shell) {
    height: auto;
    min-height: 100vh;
    display: block;
    overflow: visible;
  }
  .workspace {
    height: auto;
    min-height: calc(100vh - 66px);
    overflow: visible;
    grid-template-columns: 350px 1fr;
  }
  .brief-panel, .preview-panel, .history-panel {
    min-height: auto;
    overflow-x: visible;
    overflow-y: visible;
    overscroll-behavior-y: auto;
    scrollbar-gutter: auto;
  }
```

Remove the now-duplicate single-line `.workspace { grid-template-columns: 350px 1fr; }` from that media block. Preserve all other responsive declarations.

- [ ] **Step 4: Run focused and full frontend tests**

Run:

```powershell
npx vitest run src/client/workspace-layout.test.ts
npx vitest run src/client
```

Expected: the three layout tests and all existing client tests pass.

- [ ] **Step 5: Run production build and whitespace validation**

```powershell
npm run build
git diff --check
```

Expected: server and client production builds pass; `dist/` remains ignored; whitespace validation is silent.

- [ ] **Step 6: Commit the CSS implementation**

```powershell
git add src/client/styles.css
git commit -m "fix: isolate desktop panel scrolling"
```

## Task 3: Extend Real-Browser Layout Verification

**Files:**
- Modify: `scripts/visual-check.mjs`

- [ ] **Step 1: Measure page containment and scroll independence**

After the data asset becomes visible, replace the existing `metrics` evaluation with:

```js
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
```

This DOM probe exists only inside the headless browser page and is removed before the screenshot; it does not create a repository file.

- [ ] **Step 2: Strengthen the final browser assertion**

Replace the final process-exit condition with:

```js
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
```

- [ ] **Step 3: Start the local application for browser QA**

Run the server in a persistent terminal:

```powershell
npm run dev:server
```

The local loopback configuration does not require a LAN password. Confirm `http://127.0.0.1:8787` responds before continuing.

- [ ] **Step 4: Run visual QA and inspect generated screenshots**

In another terminal run:

```powershell
npm run qa:visual
```

Expected: JSON reports desktop `pageScrollable: false`, three `panelOverflowY: "auto"` values, and three successful isolation records. Mobile reports normal page scrolling and visible panel overflow. Inspect ignored `data/qa/desktop.png` and `data/qa/mobile.png` for clipping, overlap, or unusable nested scrolling.

- [ ] **Step 5: Commit the reusable browser verification**

```powershell
git add scripts/visual-check.mjs
git commit -m "test: verify independent panel scrolling"
```

Do not add `data/qa/`, `dist/`, server logs, or any screenshot to Git.

## Task 4: Final Verification and Clean Handoff

**Files:**
- Verify only.

- [ ] **Step 1: Run the repository verification pipeline**

```powershell
npm run verify
```

Expected: documentation check, all Vitest tests, and production build pass. If repository hygiene automation from its separate approved plan has not been implemented, `verify` continues to use the repository's current command set and final Git checks below provide the cleanliness evidence.

- [ ] **Step 2: Confirm ignored outputs and a clean tracked worktree**

```powershell
git diff --check
git ls-files -ci --exclude-standard
git status --short --branch
```

Expected: the first two commands print nothing; status shows no tracked or untracked implementation files. Local `dist/`, `data/qa/`, logs, and `.superpowers/` remain ignored and uncommitted.

- [ ] **Step 3: Report responsive scope accurately**

Record that independent scrolling applies only above `1180px`; tablet and mobile retain normal document scrolling. Report the local URL used for verification and stop any temporary dev-server process only after browser QA and final checks complete.

## Self-Review Record

- Spec coverage: desktop viewport containment, optional error row, independent scroll containers, overscroll containment, stable gutters, responsive reset, login isolation, and real-browser verification are each implemented and tested.
- Scope: no React state, business logic, API, server, deployment, draggable width, sidebar collapse, or mobile fixed-panel changes are included.
- Placeholder scan: every code-editing step contains exact content; no unfinished placeholder markers remain.
- Name consistency: selectors and breakpoint values match `src/client/styles.css`, the contract test, the visual script, and the approved design.
- Repository cleanliness: browser screenshots and dev outputs remain under already ignored paths and are explicitly excluded from commits.
