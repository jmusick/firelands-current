-- Lets the "Related coverage" query on a story page find other stories from the same community
-- (compared without regard to case, as the query does) without scanning every story.
CREATE INDEX news_articles_community_published_idx ON news_articles(community COLLATE NOCASE, status, published_at DESC);
