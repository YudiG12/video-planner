-- Per-block versions for scripts (#10). The block value itself stays in videos.script;
-- this table holds the version counter and the previous value of each block.
-- A block with no row here is at version 0.
CREATE TABLE script_blocks (
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  block TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  prev TEXT,                 -- JSON of the value before the latest change (NULL = block was empty)
  actor TEXT,                -- who made the latest change (owner | agente)
  updated_at TEXT
  , PRIMARY KEY (video_id, block)
);
