# Decision: Window Daemon Architecture

**Date:** 2026-05-17  
**Status:** Adopted

## Context

After Phase 1-4 performance testing, gen latency stabilized at ~10.4s (P1 result). The dominant cost is Gemini server response time (~8-9s), not local overhead. The only remaining client-side lever is eliminating repeated `driver.init()` cost (~18s).

## Decision

Implement a persistent daemon (`src/daemon.ts`) that:
1. Initializes GeminiWebDriver once on startup
2. Listens on a Unix domain socket for prompt requests
3. Returns responses without reinitializing Chrome

CLI client (`src/client.ts`) connects to the socket for each `ask` invocation.

## Protocol

Newline-delimited JSON over `/tmp/gbrain-companion.sock`:

```
Request:  { type: 'ask', prompt: string, requestId: string, newConversation?: boolean }
Response: { requestId, ok: true, text, genMs }
        | { requestId, ok: false, error }
```

## Alternatives considered

| Option | Rejected reason |
|---|---|
| HTTP server (localhost) | Unix socket is lighter, no port management |
| stdin/stdout pipe | Can't be shared across multiple CLI invocations |
| Keep ephemeral (batch.ts) | Doesn't solve single-shot latency |

## Window management

**Problem:** Chrome needs to run visible (headless:false required by GeminiWebDriver) but should not occupy the desktop.

**Attempted:** CDP `Browser.setWindowBounds` with `top = screenH - 40` to show only the tab strip.

**Why it failed:** macOS enforces that a window's bottom edge cannot exceed the screen bottom. The window manager moves the window up automatically, showing the full window. No amount of extreme `top` values bypasses this clamp.

**Solution:** `windowState: 'minimized'` — sends Chrome to the Dock. CDP/Playwright interactions continue to work on minimized windows. Gemini page does not pause generation when minimized.

## Session restore dialog

Chrome marks its exit as crashed when killed without graceful shutdown. On next launch, it shows a "restore session?" dialog that blocks page interaction.

Two-layer defense:
1. **Pre-launch:** Patch `Preferences` file to set `exit_type: Normal` and `exited_cleanly: true`
2. **Post-init:** Send `Escape` key; fall back to locator-based button click

## Context management

- Default: preserve context across calls (`newConversation: false`, no soft-reset prefix)
- `--new-topic` flag: triggers `newConversation: true` → driver reloads page (~26s) → fresh context
- Rationale: daemon use case is sequential workflow where context continuity is valuable; soft-reset prefix was a batch.ts workaround, not needed here

## Result

| Metric | Before (batch ephemeral) | After (daemon) |
|---|---|---|
| Gen latency (after init) | ~28s | **~4-5s** |
| Improvement | — | -83% vs P0 baseline |
| Init cost | Paid every call | Paid once at startup |
