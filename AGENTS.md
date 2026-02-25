# Brain Web Agent Preferences

## Engineering default
- Prefer production-oriented designs over the fastest implementation path.
- Minimize hardcoded routing/business logic in service files; prefer config-driven behavior and provider abstractions.
- Optimize for correctness, observability, maintainability, and safe rollout.
- If a fast tactical patch is necessary, explicitly label it as temporary and outline the production follow-up.

## Web search / live data
- Treat web retrieval as a provider architecture (Exa for web/docs/news, structured providers for exact metrics).
- Keep provider routing policy configurable where practical (aliases, indicator catalogs, query heuristics).
