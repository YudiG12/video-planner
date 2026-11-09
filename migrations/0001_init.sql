CREATE TABLE series (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('longo','vertical')),
  color TEXT NOT NULL,
  bg TEXT NOT NULL,
  description TEXT,
  phrase_open TEXT,
  phrase_close TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sponsors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo TEXT
);
CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('longo','vertical')),
  status TEXT NOT NULL DEFAULT 'Ideias',
  series_id TEXT REFERENCES series(id),
  episode INTEGER,
  sponsor_id TEXT REFERENCES sponsors(id),
  publish_date TEXT,
  position REAL NOT NULL DEFAULT 0,
  script TEXT NOT NULL DEFAULT '{}',
  derivatives TEXT NOT NULL DEFAULT '{}',
  notion_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX videos_status ON videos(status, position);
CREATE INDEX videos_date ON videos(publish_date);
CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  before TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX history_video ON history(video_id, at);

-- Exemplos. Troque pelas suas séries e patrocinadores (veja o README).
INSERT INTO sponsors (id, name, logo) VALUES
 ('acme','Acme',NULL);

INSERT INTO series (id,name,format,color,bg,description,phrase_open,phrase_close,position) VALUES
 ('dicas','Dicas Rápidas','vertical','#3767A8','#E8EEF6','Uma dica de programação por vídeo','Esse é o episódio {ep} de Dicas Rápidas, a série com uma dica de programação por vídeo.','Esse foi o episódio {ep} de Dicas Rápidas. Me segue pro próximo vídeo.',1),
 ('rotina','Rotina de Dev','vertical','#2F8A5B','#E3F3EA','Um dia de trabalho, do começo ao fim','Esse é o episódio {ep} de Rotina de Dev, a série onde eu mostro um dia de trabalho.','Esse foi o episódio {ep} de Rotina de Dev. Me segue pro próximo vídeo.',2),
 ('tutorial','Tutorial','longo','#0E7C86','#E3F1F2','Passo a passo técnico',NULL,NULL,3),
 ('vlog','Vlog','longo','#9A6510','#F8EFDF','Bastidores e rotina',NULL,NULL,4),
 ('opiniao','Opinião','longo','#C23B5E','#FBE9EE','Notícias e opinião',NULL,NULL,5);
