# Phase 1 Smoke Test Results

Date: 2026-05-17
Tester: gbrain-companion agent

| Run | Result | Duration | Chars | Notes |
|-----|--------|----------|-------|-------|
| 1 | ✅ | 48s | 1091 | — |
| 2 | ✅ | 50s | 1021 | — |
| 3 | ✅ | 51s | 1107 | — |
| 4 | ✅ | 49s | 835 | — |
| 5 | ✅ | 48s | 1048 | — |

Pass rate: 5/5

## Notes

- Target slug: `wiki/projects/super-engine`
- All runs: ≥200 chars (min 835, max 1107)
- Avg duration: ~49s (dominated by Gemini Web response time)
- Profile: Chrome Profile 2 (`mandrill210025@gmail.com`)
- Chrome executable required (Playwright bundled Chromium incompatible with Chrome profile format)
