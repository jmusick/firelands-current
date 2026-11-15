-- Marks businesses connected to the publisher so their ads carry a disclosure label instead of "Advertisement".
-- No business is flagged by default; staff tick the box on the business form.
ALTER TABLE businesses ADD COLUMN publisher_affiliated INTEGER NOT NULL DEFAULT 0 CHECK (publisher_affiliated IN (0, 1));
