# Shot Retouch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add continuous-shot retouching that reuses unchanged video clips and calls Seedance only when the selected shot's generated visual must change.

**Architecture:** Validate and persist one-shot revisions through a focused retouch module, archive the previous output, and run a retouch pipeline that reconstructs provider assets from disk. Expose the behavior in a completed-video timeline editor with separate local-recompose and Seedance-regenerate commands.

**Tech Stack:** TypeScript, Express, SQLite, React 19, FFmpeg, Vitest

---

### Task 1: Retouch Domain Rules

- [x] Write failing tests for completed-job eligibility, single-shot patching, unchanged total duration, and material intervals.
- [x] Implement `retouch.ts` pure validation and plan-update helpers.
- [x] Run focused tests.

### Task 2: Revision Persistence and Cached Assets

- [x] Write failing tests for revision records and cached provider-asset selection.
- [x] Add revision persistence and output archival helpers.
- [x] Add a retouch pipeline that regenerates at most the selected shot and reuses other provider files.
- [x] Run focused tests.

### Task 3: Retouch API

- [x] Add request schemas and `POST /api/jobs/:id/retouch`.
- [x] Add revision-list and rollback endpoints.
- [x] Run type checking and API smoke tests.

### Task 4: Completed Video Editor

- [x] Add API client methods and a focused `RetouchWorkspace` component.
- [x] Keep the existing MP4 visible while a retouch is processing.
- [x] Add responsive timeline and material timing controls.

### Task 5: Verification

- [x] Run the full test suite and production build.
- [x] Restart the LAN service.
- [x] Verify desktop/mobile behavior and console output with Playwright.
