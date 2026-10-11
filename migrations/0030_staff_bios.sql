-- Short plain-text author bios for staff (src/lib/bios.ts). A bio is public on the staff member's profile and
-- under their byline on stories, but only while the account holds a staff role: reads join staff_roles, so
-- removing the role hides the bio without deleting what the person wrote. Deleting the account deletes it.
CREATE TABLE staff_bios (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  bio TEXT NOT NULL CHECK (length(bio) BETWEEN 1 AND 600),
  updated_at INTEGER NOT NULL
);
