# Benchmark How-To

Run from the `gbrain-companion/` directory with your env vars set.

## Quick run (3 configs, 2 runs each, ~8 min)

```bash
cd /Users/ryan/gbrain/.claude/worktrees/exciting-lichterman-2785f0/gbrain-companion
N_RUNS=2 SKIP_HEADLESS=1 bun run bench
```

## Full run (5 configs including headless, 3 runs each, ~20 min)

```bash
N_RUNS=3 bun run bench
```

## Configs tested

| Config | headless | stabilityInterval | driver |
|--------|----------|-------------------|--------|
| A-baseline   | false | 1500ms | ephemeral |
| B-fast-poll  | false | 500ms  | ephemeral |
| C-persistent | false | 500ms  | persistent |
| D-headless   | true  | 500ms  | ephemeral |
| E-hl-persist | true  | 500ms  | persistent |

## What to look for

- **B vs A**: savings from faster polling alone (~0–1s expected)
- **C vs B**: savings from persistent driver (init+shutdown amortized; ~10s saved per call after first)
- **D vs B**: savings from headless mode (if Gemini accepts headless Chrome — may fail)
- The "Per-N-calls total time comparison" section at the end shows compounding benefit of persistent driver

## Running headless only

```bash
N_RUNS=3 SKIP_HEADLESS=0 bun run bench 2>&1 | grep -A5 "headless"
```

## Batch mode (production)

Persistent driver for multiple slugs:

```bash
bun run batch wiki/projects/super-engine wiki/projects/other-page
# or from stdin:
echo -e "wiki/projects/foo\nwiki/projects/bar" | bun run batch
```
