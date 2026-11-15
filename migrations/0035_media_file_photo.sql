-- A file photo is a library image that does not show the story's own event: a historical or stock photograph
-- used to illustrate. The homepage lead caption is shortened to the credit, so this flag is how a reader still
-- learns it is a file photo there. Editors set it in the media editor; existing rows start unflagged and are
-- not guessed at from their captions.
ALTER TABLE media ADD COLUMN is_file_photo INTEGER NOT NULL DEFAULT 0 CHECK (is_file_photo IN (0, 1));
