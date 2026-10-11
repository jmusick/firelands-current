-- Retention for news tips (src/lib/tip-retention.ts): declined tips are deleted 90 days after they were
-- declined, and tips kept as part of the reporting record lose the submitter's name, email and account link
-- a year after the newsroom's decision.

-- When the newsroom last moved the tip out of 'unread' (reviewed, declined or converted to a story). The
-- retention clocks run from here rather than updated_at, so a later edit can't push a deletion back.
-- Until now updated_at only ever changed with the status, so it is the decision time for existing tips.
ALTER TABLE news_submissions ADD COLUMN decided_at INTEGER;
UPDATE news_submissions SET decided_at = updated_at WHERE status != 'unread';

-- When the submitter's name and email were blanked and the account link cleared. The columns are NOT NULL,
-- so a removed name or email is an empty string; this marks why.
ALTER TABLE news_submissions ADD COLUMN anonymized_at INTEGER;

CREATE INDEX news_submissions_status_decided_idx ON news_submissions(status, decided_at);

-- Daily jobs run from the five-minute cron. A job claims its run by moving last_run_at forward, so it runs
-- once a day however many invocations overlap, and catches up after a missed day.
CREATE TABLE scheduled_jobs (
  name TEXT PRIMARY KEY,
  last_run_at INTEGER NOT NULL
);
INSERT INTO scheduled_jobs (name, last_run_at) VALUES ('tip-retention', 0);
