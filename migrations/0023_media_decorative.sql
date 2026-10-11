-- An image needs an editorial decision about its text alternative: meaningful alt text, or an explicit
-- "decorative" choice (rendered with an empty alt). decorative = 1 means an editor made that choice.
-- Existing rows are not decided for anyone: a row with empty alt and decorative = 0 is undecided, and
-- the media library flags it as needing alt text until an editor describes it or marks it decorative.
ALTER TABLE media ADD COLUMN decorative INTEGER NOT NULL DEFAULT 0 CHECK (decorative IN (0, 1));
