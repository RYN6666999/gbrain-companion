# LB-companion · 伴機

> 靈機讀玉簡，遵律令，以煉丹之法鍛技。

**LB-companion** 是 LifeBuilder 生態系的 AI 路由橋接層 — 將對話流量路由至不同 AI 後端（Gemini、Claude、Genspark），並自動沉澱回 LB-arcanum 知識庫。

## LifeBuilder 生態系

| 名號 | Repo | 說明 |
|------|------|------|
| **靈機 · Numen** | [LB-numen](https://github.com/RYN6666999/LB-numen) | Python LLM 執行層，讀玉簡、遵律令、行任務 |
| **玉簡 · Arcanum** | [LB-arcanum](https://github.com/RYN6666999/LB-arcanum) | GBrain 知識庫，13 頁活文件常駐其中 |
| **律令 · Nexus** | [LB-nexus](https://github.com/RYN6666999/LB-nexus) | 軍工級 contract 守門框架 |
| **煉丹爐 · Athanor** | `skills/athanor.md` in LB-numen | 元技能：煉出 Azoth 標準技能 |
| **大還丹 · Azoth** | `openspec/changes/azoth/` in LB-numen | 技能自循環標準 |
| **伴機 · Companion** | [LB-companion](https://github.com/RYN6666999/LB-companion)（本 repo）| AI 路由橋接，Gemini Web 橋 |

---

## Why

- Drive paid Gemini Pro subscription programmatically (no API token cost)
- Auto-sediment cross-AI conversations into GBrain
- Backend-agnostic: swap Claude, Genspark, Gemini without changing the pipeline
- Self-maintaining: scheduled orchestration keeps the knowledge base current

## Architecture

```
┌─────────────┐  newline-JSON  ┌──────────────────────┐
│  client.ts  │◄──────────────►│      daemon.ts        │
│  (CLI)      │  Unix socket   │  GeminiWebDriver      │
└─────────────┘  /tmp/gbrain-  │  (init once, reuse)   │
                 companion.sock│  Chrome in Dock        │
                               └──────────────────────┘
                                        │
                               ┌────────▼────────┐
                               │  super-engine   │
                               │  (Playwright +  │
                               │   Gemini Web)   │
                               └─────────────────┘
                                        │
                               ┌────────▼────────┐
                               │  LB-arcanum     │
                               │  knowledge store│
                               └─────────────────┘
```

## Usage

### Daemon mode

```bash
# Start daemon once — init takes ~18s, then stays alive
bun run daemon

# Ask anything — each call costs only gen time (~4-5s)
bun run ask "your prompt"

# Start a fresh conversation (reloads page, ~26s)
bun run ask --new-topic "new topic prompt"
```

The daemon maintains conversation context across calls by default. Use `--new-topic` to reset.

### Environment

```bash
export GEMINI_PROFILE_DIR="$HOME/Library/Application Support/Google/Chrome/Profile 2"
export CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

## Performance

| Mode | Latency |
|---|---|
| daemon (after init) | **~4-5s** per call |
| daemon init | ~18s (one-time) |
| batch (ephemeral) | ~28s per call |

Gen time is dominated by Gemini server response (~3.5-4s). Unix socket IPC overhead is <0.1s.

## Implementation Notes

- Chrome window is minimized to Dock on init — CDP/Playwright interactions work on minimized windows
- macOS prevents windows from extending below the screen bottom, so `windowState: 'minimized'` is the only reliable way to hide the window
- Chrome Preferences patched before launch (`exit_type: Normal`) to suppress session restore dialogs
- Context preserved across calls; `--new-topic` triggers `newConversation: true` → page reload

## License

Private. Personal use only.
