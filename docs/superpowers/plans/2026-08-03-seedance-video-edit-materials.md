# Seedance Video Edit Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and replace shot materials during retouch, including true Seedance editing of the existing continuous shot.

**Architecture:** Keep local overlays in the renderer and add a separate Ark video-edit request that includes the cached shot as `reference_video`. Persist provider source URLs in a small per-job manifest so revisions retain edit lineage, while the React retouch editor manages binding changes through pure helper functions.

**Tech Stack:** TypeScript, React 19, Express, Vitest, Ark Content Generation API, FFmpeg.

---

### Task 1: Material Binding Helpers

**Files:**
- Create: `src/client/material-bindings.ts`
- Create: `src/client/material-bindings.test.ts`
- Modify: `src/client/ScriptWorkspace.tsx`

- [ ] Write tests proving image/video default to exact overlay, data defaults to charts, and replacement preserves timing and placement.
- [ ] Run `npm test -- src/client/material-bindings.test.ts` and verify missing exports fail.
- [ ] Implement `createDefaultBinding` and `replaceBindingMaterial` and reuse the default helper in the script editor.
- [ ] Run the focused test and verify it passes.

### Task 2: Ark Video Edit Request

**Files:**
- Modify: `src/shared/video.ts`
- Modify: `src/server/providers/video.ts`
- Modify: `src/server/providers/video-materials.test.ts`

- [ ] Add a failing test expecting `buildArkVideoEditRequest` to include the instruction, material references, and a final `reference_video` role.
- [ ] Run the focused provider test and verify the function is missing.
- [ ] Add `RetouchVisualAction`, accept it in `ShotRetouchInput`, and implement request construction plus `editShotAsset`.
- [ ] Run the focused provider test and verify it passes.

### Task 3: Provider Asset Manifest

**Files:**
- Create: `src/server/provider-assets.ts`
- Create: `src/server/provider-assets.test.ts`
- Modify: `src/server/providers/video.ts`
- Modify: `src/server/revisions.ts`
- Modify: `src/server/revisions.test.ts`

- [ ] Add failing tests for saving/loading source URLs, selecting a public output fallback, and archiving/restoring the manifest.
- [ ] Run the focused tests and verify failure for missing manifest helpers.
- [ ] Implement JSON manifest persistence and include source metadata in `GeneratedAsset`.
- [ ] Copy the manifest during revision archive and restore.
- [ ] Run focused tests and verify they pass.

### Task 4: Retouch Queue And Validation

**Files:**
- Modify: `src/server/retouch.ts`
- Modify: `src/server/retouch.test.ts`
- Modify: `src/server/pipeline.ts`
- Modify: `src/server/index.ts`

- [ ] Add failing tests for normalizing legacy `regenerateVisual` and requiring an editable video source for `edit`.
- [ ] Run the focused tests and verify expected failures.
- [ ] Normalize the action, preflight the source, and route `none`, `edit`, and `regenerate` separately.
- [ ] Ensure provider edit failure retains the cached clip and leaves the archived revision available.
- [ ] Run focused and server tests.

### Task 5: Retouch Material UI

**Files:**
- Modify: `src/client/RetouchWorkspace.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles.css`

- [ ] Add a material selector, upload control, binding replacement selector, remove control, mode controls, timing controls, and chart settings.
- [ ] Add three commands: Apply and recompose, Edit existing shot, and Regenerate shot.
- [ ] Keep the player visible and preserve selected-shot seeking on desktop and mobile.
- [ ] Run `npm run build` and resolve all type/layout errors.

### Task 6: Verification And Documentation

**Files:**
- Modify: `.env.example`
- Modify: `VIDEO_WORKBENCH.md`

- [ ] Document `OUTPUT_PUBLIC_BASE_URL`, temporary Ark URL behavior, and the difference between overlay, edit, and regenerate.
- [ ] Run `npm test` and require all tests to pass.
- [ ] Run `npm run build` and require success.
- [ ] Test add/replace/remove controls and all action states in a real desktop and mobile browser, confirm no console errors, and keep the LAN server running.
