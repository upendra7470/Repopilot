-- Phase 7 fix: the files table is a *file* snapshot, but tree/submodule
-- entries from the Git Trees API were persisted alongside blobs, inflating
-- file counts (e.g. 117 rows for 86 real files: 31 were directories).
-- Remove non-blob rows first so the CHECK constraint below applies cleanly.
-- Derived data only: a re-sync restores anything removed here.
DELETE FROM "files" WHERE "type" IS DISTINCT FROM 'blob';
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_blob_only" CHECK ("files"."type" = 'blob');
