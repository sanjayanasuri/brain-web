# Unified Content Pipeline Contract (Phase 0)

This document locks the minimal schema contract for a single ingestion pipeline that supports:
- URL / web clipper ingest
- Social post/comment ingest (link, pasted text, screenshot OCR)
- Voice conversations (audio upload → transcript + chunking + thought extraction)

## Postgres (canonical source of truth)

All ingested sources become a `content_items` row plus optional downstream tables.

### `content_items`

- `id` (uuid, pk)
- `user_id` (uuid)
- `type` (enum: `article | social_post | social_comment | snippet | transcript`)
- `source_url` (text, nullable)
- `source_platform` (text, nullable) — e.g. `instagram`, `x`, `web`
- `title` (text, nullable)
- `raw_text` (text, nullable)
- `raw_html` (text, nullable)
- `raw_media_url` (text, nullable) — signed URL to screenshot/audio in S3-compatible storage
- `extracted_text` (text, nullable)
- `status` (enum: `created | extracted | extracted_partial | analyzed | failed`)
- `created_at`, `updated_at`

### `content_analyses`

- `id` (uuid, pk)
- `content_item_id` (fk → `content_items.id`)
- `model` (text)
- `summary_short` (text)
- `summary_long` (text)
- `key_points` (jsonb array)
- `entities` (jsonb array)
- `topics` (jsonb array)
- `questions` (jsonb array)
- `action_items` (jsonb array)
- `analysis_json` (jsonb)
- `created_at`

### `transcript_chunks`

- `id` (uuid, pk)
- `content_item_id` (fk → transcript `content_items.id`)
- `chunk_index` (int)
- `speaker` (text: `user | assistant`)
- `text` (text)
- `start_ms` / `end_ms` (int, nullable)
- `created_at`

### `thoughts`

- `id` (uuid, pk)
- `user_id` (uuid)
- `text` (text) — extracted question/decision/insight
- `type` (enum: `question | decision | insight`)
- `source_content_item_id` (fk → `content_items.id`)
- `source_chunk_id` (fk → `transcript_chunks.id`, nullable)
- `created_at`

## Neo4j (topics/entities linking)

Nodes:
- `(:Topic {id, name, canonical_key, tenant_id?})`
- `(:Entity {id, name, type, tenant_id?})`
- `(:Content {id, type, created_at, tenant_id?})`

Edges:
- `(Content)-[:MENTIONS_TOPIC]->(Topic)`
- `(Content)-[:MENTIONS_ENTITY]->(Entity)`
- `(Thought)-[:ABOUT_TOPIC]->(Topic)`
- `(Topic)-[:RELATED_TO]->(Topic)` (optional later)

## Qdrant (vector search)

Collections:
- `content_item_text`
  - payload minimum: `content_item_id`, `user_id`, `type`, `source_url`
  - recommended (safety): `tenant_id`
- `transcript_chunks`
  - payload minimum: `content_item_id`, `chunk_id`, `user_id`, `speaker`
  - recommended (safety): `tenant_id`
