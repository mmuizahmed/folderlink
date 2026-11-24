-- Per-app folder scoping. A folder with no rows here is visible to every
-- connected app, so existing folders keep working unchanged. A folder with
-- rows is visible only to the grants listed. The worker is the enforcement
-- point: the bridge never sees a grant id, and the bridge still enforces
-- its local allowlist and approval on top.
CREATE TABLE folder_apps (
  folder_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (folder_id, grant_id)
);

CREATE INDEX idx_folder_apps_grant ON folder_apps (grant_id);
