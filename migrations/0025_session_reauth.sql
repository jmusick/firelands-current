-- When each session last proved its owner's identity (a password entered, or a provider sign-in completed),
-- which gates privileged staff actions. A session's own createdAt is not enough: it also covers sessions
-- opened by an emailed link, and it never moves. Rows are written by the sign-in hooks in src/lib/auth.ts and
-- by /api/reauth; a session without a row counts as stale. They go away with the session.
CREATE TABLE session_reauth (
  session_id TEXT PRIMARY KEY REFERENCES "session" ("id") ON DELETE CASCADE,
  reauthenticated_at INTEGER NOT NULL
);
