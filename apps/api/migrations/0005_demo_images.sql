-- TASK-016b: images attached in the public demo. Only images the agent actually used are kept; they are served from
-- /api/demo/images/<id> while the visitor's sandbox lives and deleted with it (24 h).
CREATE TABLE demo_images (
  id          TEXT PRIMARY KEY,            -- random, unguessable; also the file name ("<id>.jpg")
  token_hash  TEXT NOT NULL,               -- sandbox it belongs to
  media_type  TEXT NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp')),
  data        BLOB NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX demo_images_created ON demo_images (created_at);
