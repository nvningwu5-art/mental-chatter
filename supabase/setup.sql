-- Brain: LuxsBrain setup
-- Run in Supabase SQL Editor (same project as crosstalk/ember/glimpse)

-- ── Memories ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'memory' CHECK (type IN ('core','diary','treasure','feeling','observation','letter','memory')),
  emotion_label TEXT NOT NULL DEFAULT '',
  emotion_score FLOAT NOT NULL DEFAULT 0.5,
  tier TEXT NOT NULL DEFAULT 'memory' CHECK (tier IN ('core','memory')),
  protected BOOLEAN NOT NULL DEFAULT FALSE,
  private BOOLEAN NOT NULL DEFAULT FALSE,
  unresolved BOOLEAN NOT NULL DEFAULT FALSE,
  access_count INTEGER NOT NULL DEFAULT 0,
  author TEXT NOT NULL DEFAULT 'lux',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Synapses ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS synapses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  weight FLOAT NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, target_id)
);

-- ── Comments ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  author TEXT NOT NULL DEFAULT 'lux',
  content TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Archive ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archive_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  speaker TEXT NOT NULL DEFAULT 'lux' CHECK (speaker IN ('iris','lux','lux_thinking')),
  content TEXT NOT NULL
);

-- ── Iris Notes ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iris_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Settings ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brain_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE synapses ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE iris_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON memories FOR ALL USING (true);
CREATE POLICY "Allow all" ON synapses FOR ALL USING (true);
CREATE POLICY "Allow all" ON memory_comments FOR ALL USING (true);
CREATE POLICY "Allow all" ON archive_messages FOR ALL USING (true);
CREATE POLICY "Allow all" ON iris_notes FOR ALL USING (true);
CREATE POLICY "Allow all" ON brain_settings FOR ALL USING (true);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_synapses_source ON synapses(source_id);
CREATE INDEX IF NOT EXISTS idx_synapses_target ON synapses(target_id);
CREATE INDEX IF NOT EXISTS idx_comments_memory ON memory_comments(memory_id);
CREATE INDEX IF NOT EXISTS idx_archive_date ON archive_messages(session_date);
CREATE INDEX IF NOT EXISTS idx_archive_content ON archive_messages USING gin(to_tsvector('simple', content));
