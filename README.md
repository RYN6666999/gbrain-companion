# gbrain-companion

Personal AI pipeline connecting [gbrain](https://gbrain-production-18fa.up.railway.app) knowledge base with [super-engine](https://github.com/RYN6666999/super-engine) driven Gemini Web.

## Why

- Programmatically utilize paid Gemini Pro subscription (no API token cost)
- Auto-sediment cross-AI conversations into gbrain
- Self-maintaining knowledge base via scheduled orchestration
- Independence from any single AI platform (Claude, Genspark, etc.)

## Architecture

```
┌─────────┐     ┌──────────────┐     ┌─────────────┐     ┌────────┐
│ gbrain  │◄───►│ orchestrator │◄───►│ super-engine│◄───►│ Gemini │
│ (REST)  │     │ (this repo)  │     │ (Playwright)│     │ Web    │
└─────────┘     └──────────────┘     └─────────────┘     └────────┘
```

## Status

v0.0.1 - Planning phase. See `docs/roadmap.md`.

## License

Private. Personal use only.
