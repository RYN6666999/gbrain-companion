# gbrain-companion

Personal AI pipeline connecting [gbrain](https://gbrain-production-18fa.up.railway.app) knowledge base with [super-engine](https://github.com/RYN6666999/super-engine) driven Gemini Web.

## Why

- Programmatically utilize paid Gemini Pro subscription (no API token cost)
- Auto-sediment cross-AI conversations into gbrain
- Self-maintaining knowledge base via scheduled orchestration
- Independence from any single AI platform (Claude, Genspark, etc.)

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

## Implementation notes

- Chrome window is minimized to Dock on init — CDP/Playwright interactions work on minimized windows
- macOS prevents windows from extending below the screen bottom, so `windowState: 'minimized'` is the only reliable way to hide the window
- Chrome Preferences are patched before launch (`exit_type: Normal`) to suppress session restore dialogs
- Context is preserved across calls; `--new-topic` triggers `newConversation: true` → page reload

## License

Private. Personal use only.
