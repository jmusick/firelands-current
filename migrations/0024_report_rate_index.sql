-- The report limit counts a reporter's recent rows inside the INSERT that stores a report; forum threads and
-- replies already have (author_id, created_at) indexes for the same check.
CREATE INDEX forum_reports_reporter_created_idx ON forum_reports(reporter_id, created_at DESC);
