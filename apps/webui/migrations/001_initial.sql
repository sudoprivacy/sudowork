-- 001_initial.sql — WebUI 业务辅助表（计划 2.1）
-- 只保存 Web Session/偏好/会话锁，不保存任何 Moss 业务对象。

CREATE TABLE web_principals (
  id uuid PRIMARY KEY,
  moss_user_id text NOT NULL,
  org_id text NOT NULL,
  username text NOT NULL,
  created_at timestamptz NOT NULL,
  last_login_at timestamptz NOT NULL,
  UNIQUE (org_id, moss_user_id)
);

CREATE TABLE web_sessions (
  id uuid PRIMARY KEY,
  token_digest bytea NOT NULL UNIQUE,
  principal_id uuid NOT NULL REFERENCES web_principals(id) ON DELETE CASCADE,
  encrypted_moss_tokens bytea NOT NULL,
  token_iv bytea NOT NULL,
  token_auth_tag bytea NOT NULL,
  access_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);

CREATE TABLE user_preferences (
  principal_id uuid PRIMARY KEY REFERENCES web_principals(id) ON DELETE CASCADE,
  theme text NOT NULL DEFAULT 'system',
  font_scale numeric(4,2) NOT NULL DEFAULT 1.0,
  updated_at timestamptz NOT NULL
);

CREATE TABLE conversation_locks (
  principal_id uuid NOT NULL REFERENCES web_principals(id) ON DELETE CASCADE,
  moss_session_id text NOT NULL,
  writer_web_session_id uuid REFERENCES web_sessions(id) ON DELETE SET NULL,
  state text NOT NULL CHECK (state IN ('idle','running','uncertain')),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (principal_id, moss_session_id)
);

CREATE INDEX idx_web_sessions_principal ON web_sessions (principal_id);
CREATE INDEX idx_web_sessions_expires ON web_sessions (expires_at);
