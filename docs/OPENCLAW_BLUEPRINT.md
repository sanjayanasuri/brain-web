# Brain Web × OpenClaw Blueprint

Goal: make Brain Web feel like a personalized, conversational assistant platform
while preserving your minimal UI style.

## Core product architecture

1. **Assistant Profile Layer** (new)
   - Per-user persona/tone/style/preferences
   - API: `/assistant/profile`, `/assistant/style-prompt`

2. **Memory Layer**
   - canonical conversation events
   - promotion engine (short -> active -> long-term)
   - promoted memory retrieval in prompt assembly

3. **Tool Layer**
   - existing Brain Web tools (web search, retrieval, ingest, scheduling)
   - assistant orchestrates tool selection based on user intent

4. **Suggestion Layer**
   - interest profile + recommendation generation
   - actionable cards (open/search/dismiss)

## Minimal UX constraints

- Keep surfaces sparse: chat/voice dock, today panel, memory inspector.
- Prefer top-3 suggestions over long feeds.
- Preserve conversational continuity across voice and text.

## Next implementation milestone

- Wire `build_assistant_style_prompt()` into voice/text response generation paths,
  so all assistant output conforms to per-user style profile.
