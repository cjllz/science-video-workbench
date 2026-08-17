# LAN Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing video workbench reachable from other devices on the current LAN.

**Architecture:** Express will read an optional `HOST` environment variable and default to `0.0.0.0`. The configured host will be used for both the listener and startup log, while `PORT` remains unchanged.

**Tech Stack:** Node.js, Express, TypeScript, Vitest

---

### Task 1: Configurable Listener

**Files:**
- Modify: `src/server/index.ts`
- Test: `src/server/server-config.test.ts`
- Modify: `.env.example`
- Modify: `VIDEO_WORKBENCH.md`

- [ ] Add a failing assertion that requires a `HOST` override with a `0.0.0.0` default.
- [ ] Run `npm test -- src/server/server-config.test.ts` and confirm it fails against the fixed loopback listener.
- [ ] Read `HOST`, pass it to `app.listen`, and log the configured address.
- [ ] Document `HOST=0.0.0.0` and the LAN URL format.
- [ ] Run `npm test` and `npm run build`.
- [ ] Start the server and verify `/api/health` through both loopback and the machine's LAN IPv4 address.
