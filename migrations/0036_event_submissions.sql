-- Events that organizers submit for review (/submit-event). A submission is never an event: it waits in the
-- queue at /admin/events/submissions until an editor converts it into a draft event (event_id), marks it
-- reviewed, or declines it. Dates and times follow the events table: YYYY-MM-DD and HH:MM, Eastern wall-clock.
--
-- name, email and note are the submitter's contact details and message to editors. They are not tied to an
-- account. The columns are NOT NULL, so details removed by retention
-- (src/lib/event-submission-retention.ts) are empty strings, with anonymized_at recording when.
-- decided_at is when the submission last left 'unread'; the retention clocks run from it.
CREATE TABLE event_submissions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('community', 'arts', 'music', 'family', 'food', 'sports', 'outdoors', 'meetings', 'classes')),
  starts_on TEXT NOT NULL,
  start_time TEXT,
  ends_on TEXT,
  end_time TEXT,
  venue TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  community TEXT NOT NULL,
  organizer TEXT NOT NULL DEFAULT '',
  cost TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'reviewed', 'declined', 'converted')),
  event_id TEXT REFERENCES events (id) ON DELETE SET NULL,
  decided_at INTEGER,
  anonymized_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX event_submissions_status_created_idx ON event_submissions(status, created_at DESC);
CREATE INDEX event_submissions_status_decided_idx ON event_submissions(status, decided_at);

-- The daily retention job claims its run here, like tip-retention (migration 0028).
INSERT INTO scheduled_jobs (name, last_run_at) VALUES ('event-submission-retention', 0);
