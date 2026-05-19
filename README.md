# LB-Nuntius

> 靈機讀玉簡，遵律令，以煉丹之法鍛技。

**LB-Nuntius**（信使）是 LifeBuilder 生態系的 Gemini Web 橋接工具。
將 AI 對話路由至不同後端（Gemini / Claude / Genspark），並自動沉澱回 Arcanum 知識庫。

---

## LifeBuilder 命名體系

| 名號 | Repo | 定位 |
|------|------|------|
| **Numen · 靈機** | [LB-numen](https://github.com/RYN6666999/LB-numen) | LLM 推理瞬間（不可控，只能觀察） |
| **Arcanum · 玉簡** | [LB-arcanum](https://github.com/RYN6666999/LB-arcanum) | gbrain 私密記憶層（被授權者才能讀寫） |
| **Nexus · 律令** | [LB-nexus](https://github.com/RYN6666999/LB-nexus) | SPEC→guard→contract→IMPL 不可繞過的守門 |
| **Athanor · 煉丹爐** | `skills/athanor.md` in LB-numen | 元技能：把需求煉成符合標準的新技能 |
| **Azoth · 大還丹** | `openspec/changes/azoth/` in LB-numen | 技能成品的最低標準（合格證） |

LB-Nuntius 不是命名體系的核心組件 — 它是一個使用 Arcanum 作記憶層的橋接工具。

---

## Why

- Drive paid Gemini Pro subscription programmatically (no API token cost)
- Auto-sediment cross-AI conversations into Arcanum (LB-arcanum)
- Backend-agnostic: swap Claude, Genspark, Gemini without changing the pipeline
- Self-maintaining: scheduled orchestration keeps the knowledge base current

## Architecture

```
┌─────────────┐  newline-JSON  ┌──────────────────────┐
│  client.ts  │◄──────────────►│      daemon.ts        │
│  (CLI)      │  Unix socket   │  GeminiWebDriver      │
└─────────────┘  /tmp/gbrain-  │  (init once, reuse)   │
                 nuntius.sock  │  Chrome in Dock        │
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
                               │  (Arcanum 知識庫)|
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
