# Brain Web Quality Sprint (Focus: Core Product)

Goal: Make Brain Web excellent as a memory-first note + learning system (no feature bloat).

## Success Criteria (for Sanjay day-to-day)

1. Morning home feed is useful in <60s.
2. Note capture from voice/text is reliable and discoverable later.
3. Memory continuity in chat feels personal and correct.
4. Concept graph answers "why is this connected?" clearly.

## Sprint Phases

### Phase 1 — Home Feed Reliability
- [x] Unified `/home/feed` endpoint
- [x] Actionable Home cards (open/dismiss)
- [x] Task query fallback for tenant-less legacy tasks
- [x] Continuity sourced from real chat history (Postgres)

### Phase 2 — Capture & Consolidation
- [ ] Inbox normalization for voice/text/note imports
- [ ] De-duplication + source stitching (same idea from multiple inputs)
- [ ] Quick "convert to concept/task" actions

### Phase 3 — Memory Trust
- [ ] Memory Inspector panel (what was used + why)
- [ ] User controls: forget/correct/pin memory
- [ ] Confidence thresholds tuning + decay policy checks

### Phase 4 — Learning Quality
- [ ] Topic-gap detection from conversation + notes
- [ ] Structured explain/drill loops
- [ ] Better concept linkage rationale in UI

## Guardrails
- Keep UI minimal.
- Ship only what improves daily repeat usage.
- Prefer quality/reliability over adding new surfaces.
