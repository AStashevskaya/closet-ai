-- pgvector ships in the Postgres image (pgvector/pgvector); the extension still has to be enabled per database.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "embedding" vector(768);--> statement-breakpoint
CREATE INDEX "photos_embedding_idx" ON "photos" USING hnsw ("embedding" vector_cosine_ops);