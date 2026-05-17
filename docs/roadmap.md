# Roadmap

## Phase 0: Performance (done)

- [x] Benchmark baseline: init ~18s, gen ~24s
- [x] P1: newConversation:false → gen 10.4s (-57%)
- [x] P2-P4: evaluated, rejected (Chrome args / stabilityInterval / blockResources)
- [x] Window Daemon: persistent driver + Unix socket → gen 4-5s (-83% vs baseline)
  - [x] Chrome Preferences patch (suppress session restore dialog)
  - [x] CDP minimize window to Dock (macOS positioning workaround)
  - [x] Context retention by default, --new-topic for reset

## Phase 1: MVP pipeline

- [ ] gbrain GET client (search, page, write)
- [ ] Single-shot ask: read slug → prompt Gemini → print response
- [ ] Smoke test with `wiki/projects/super-engine`

## Phase 2: Write-back loop

- [ ] Write Gemini response to `wiki/ai-output/YYYY-MM-DD/<slug>`
- [ ] Provenance auto-tagging (source: ai, ai_confidence)
- [ ] Conflict detection (check existing slug)

## Phase 3: Conversation sedimentation

- [ ] Multi-turn conversation mode (context already working via daemon)
- [ ] Auto-summarize on session end
- [ ] Write to `wiki/conversations/YYYY-MM-DD/<topic>`

## Phase 4: Scheduled maintenance

- [ ] Cron: daily find_orphans → Gemini suggests links → draft to `wiki/draft/maintenance-YYYY-MM-DD`
- [ ] Human review workflow (no auto-apply)

## Phase 5: Optional - Telegram bridge

- [ ] Evaluate: build vs adopt project-golem's bridge
- [ ] Decision deferred

## Future performance options

- Gemini Flash model: estimated gen 3-4s (model swap, 1-2 days)
- Gemini API direct: estimated gen 1-3s (removes Web UI entirely)
