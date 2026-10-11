CREATE TABLE community_links (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  county TEXT NOT NULL CHECK (county IN ('erie', 'ottawa', 'sandusky', 'huron', 'lorain', 'seneca')),
  community TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('government', 'chamber', 'police', 'fire', 'library', 'sheriff', 'health', 'parks', 'elections')),
  description TEXT NOT NULL DEFAULT '',
  checked_on TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX community_links_directory_idx ON community_links(status, county, community COLLATE NOCASE, category, name COLLATE NOCASE);
