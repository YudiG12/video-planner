-- screenshots and images pasted into scripts (JPEG downscaled in the browser)
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
