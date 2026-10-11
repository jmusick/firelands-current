-- Newsroom and moderation actions in the admin audit log.
--
-- Earlier entries point at a user, business, ad or media item through a dedicated column. Stories, events,
-- discussions, corrections and news tips share this pair instead: what kind of record it was and its id.
-- No foreign key, so an entry outlives the record it describes (target_label keeps the title).
ALTER TABLE admin_audit_log ADD COLUMN target_type TEXT;
ALTER TABLE admin_audit_log ADD COLUMN target_id TEXT;

-- Whether the action happened. 'denied' is a signed-in account that reached an admin endpoint it has no role
-- for, or sent it a cross-origin request; the throttle in src/lib/audit.ts keeps these from flooding the log.
-- Existing rows were all changes that went through.
ALTER TABLE admin_audit_log ADD COLUMN outcome TEXT NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'denied'));

CREATE INDEX admin_audit_log_resource_idx ON admin_audit_log(target_type, target_id, created_at DESC);
-- The denied-attempt throttle looks up one actor's recent entries for an action.
CREATE INDEX admin_audit_log_actor_idx ON admin_audit_log(actor_id, action, created_at DESC);
