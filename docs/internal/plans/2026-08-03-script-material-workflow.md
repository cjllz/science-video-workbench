# Script and Material Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a script confirmation gate, editable storyboard, uploadable material assets, `@variable` bindings, and confirmed Seedance rendering to the science-video workbench.

**Architecture:** Existing jobs become two-phase records: planning stops at `awaiting_confirmation`, and a separate render command consumes the confirmed plan. A unified material asset store holds media and parsed data; pure helpers validate variables and map confirmed bindings into provider requests and deterministic overlays.

**Tech Stack:** TypeScript, React 19, Express 5, SQLite, Multer, Zod, Vitest, Sharp, FFmpeg, Mammoth, Volcengine Ark

---

### Task 1: Shared Workflow And Variable Contracts

**Files:**
- Modify: `src/shared/video.ts`
- Create: `src/server/material-variables.ts`
- Test: `src/server/material-variables.test.ts`

- [ ] Write failing tests proving `@设备图` and `@七日数据` are extracted, unknown variables are reported, and provider prompts are rewritten in deterministic media order.
- [ ] Run `npm test -- src/server/material-variables.test.ts` and confirm the missing helper failure.
- [ ] Add `MaterialAsset`, `ShotMaterialBinding`, chart configuration, new job statuses, and variable parsing/rewrite helpers.
- [ ] Re-run the focused test and confirm all variable cases pass.

### Task 2: Material And Script Import Persistence

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/server/paths.ts`
- Modify: `src/server/db.ts`
- Create: `src/server/materials.ts`
- Create: `src/server/script-imports.ts`
- Test: `src/server/materials.test.ts`
- Test: `src/server/script-imports.test.ts`

- [ ] Install `mammoth` and write failing tests for MIME classification, safe variable names, TXT import, and DOCX import.
- [ ] Run the focused tests and confirm failures identify the missing import/material implementation.
- [ ] Create material storage and SQLite persistence, retaining parsed data metadata for CSV/XLSX.
- [ ] Implement TXT/MD decoding and DOCX text extraction with length and empty-content validation.
- [ ] Re-run focused tests and confirm persistence/import behavior passes.

### Task 3: Two-Phase Job API

**Files:**
- Modify: `src/server/index.ts`
- Modify: `src/server/pipeline.ts`
- Modify: `src/server/db.ts`
- Create: `src/server/preflight.ts`
- Test: `src/server/preflight.test.ts`

- [ ] Write failing tests for unresolved variables, invalid data fields, invalid shot totals, and a valid confirmed plan.
- [ ] Run the focused preflight tests and observe expected failures.
- [ ] Split `enqueueJob` into planning and rendering actions; planning stops at `awaiting_confirmation`.
- [ ] Add script import, material upload/list, plan patch, and render confirmation endpoints with Zod validation.
- [ ] Preserve existing job compatibility and reject duplicate/invalid rendering transitions.
- [ ] Re-run all server tests.

### Task 4: Seedance Reference Mapping And Local Overlays

**Files:**
- Modify: `src/server/providers/video.ts`
- Modify: `src/server/renderer.ts`
- Test: `src/server/providers/video.test.ts`

- [ ] Write a failing request-builder test for text, image, video, audio, first-frame, and local-only bindings.
- [ ] Run the focused provider test and confirm the request builder is absent.
- [ ] Build Ark `content` from the shot's confirmed bindings and rewrite `@variables` to provider reference indexes.
- [ ] Add deterministic image overlay and chart placement inputs to segment rendering.
- [ ] Keep native Seedance audio disabled and preserve existing fallback behavior.
- [ ] Re-run provider and renderer-related tests.

### Task 5: Script Overview And Material Variable UI

**Files:**
- Modify: `src/client/api.ts`
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles.css`
- Create: `src/client/ScriptWorkspace.tsx`
- Create: `src/client/MaterialLibrary.tsx`

- [ ] Add client methods for script import, material upload/list, plan save, and render confirmation.
- [ ] Change initial submission copy and behavior to generate a script draft rather than a video.
- [ ] Build editable shot cards for headline, narration, visual direction, duration, and material chips.
- [ ] Build a material library supporting image/video/audio/data uploads, variable rename, and insertion into the active shot.
- [ ] Add binding controls for role, mode, placement, chart type, and selected fields.
- [ ] Show preflight errors inline and require explicit "确认剧本并生成视频".
- [ ] Preserve progress, result, history, and feedback views.

### Task 6: End-To-End Verification

**Files:**
- Modify: `VIDEO_WORKBENCH.md`
- Modify: `.env.example`
- Modify: `scripts/visual-check.mjs`

- [ ] Document the two-phase workflow, material URL constraints, and variables.
- [ ] Run `npm test` and require zero failing tests.
- [ ] Run `npm run build` and require a successful TypeScript/Vite build.
- [ ] Start the production server with configured DeepSeek and Ark credentials.
- [ ] Use a browser to create a script draft, edit a shot, upload an image and CSV, insert both variables, save, confirm, and observe rendering start.
- [ ] Probe an Ark image reference with a data URL; record whether direct local image references are accepted.
- [ ] Inspect desktop and mobile screenshots for clipping, overlap, and readable controls.
