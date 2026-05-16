# Roadmap

## Phase 1: MVP pipeline (Week 1)
- [ ] Setup TypeScript + super-engine dependency
- [ ] Implement gbrain GET client (search, page, write)
- [ ] Single-shot ask: read slug → prompt Gemini → print response
- [ ] Smoke test with `wiki/projects/super-engine`

## Phase 2: Write-back loop (Week 2)
- [ ] Write Gemini response to `wiki/ai-output/YYYY-MM-DD/<slug>`
- [ ] Provenance auto-tagging (source: ai, ai_confidence)
- [ ] Conflict detection (check existing slug)

## Phase 3: Conversation sedimentation (Week 3)
- [ ] Multi-turn conversation mode
- [ ] Auto-summarize on session end
- [ ] Write to `wiki/conversations/YYYY-MM-DD/<topic>`

## Phase 4: Scheduled maintenance (Week 4)
- [ ] Cron: daily find_orphans → Gemini suggests links → draft to `wiki/draft/maintenance-YYYY-MM-DD`
- [ ] Human review workflow (no auto-apply)

## Phase 5: Optional - Telegram bridge
- [ ] Evaluate: build vs adopt project-golem's bridge
- [ ] Decision deferred
