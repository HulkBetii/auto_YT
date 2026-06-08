-- Enable pgvector (idempotent — Neon already has it available as an extension).
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

-- Exactly one active version per prompt_key — enforced at the DB level so concurrent
-- "create new active version" transactions can't both succeed.
CREATE UNIQUE INDEX "prompt_versions_one_active_per_key" ON "prompt_versions" ("prompt_key") WHERE "is_active" = true;
--> statement-breakpoint

-- IVFFlat cosine-distance index for semantic anti-duplication lookups (videos.topic_embedding <=> query).
CREATE INDEX "videos_topic_embedding_cosine_idx" ON "videos" USING ivfflat ("topic_embedding" vector_cosine_ops) WITH (lists = 100);
