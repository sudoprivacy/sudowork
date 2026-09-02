-- 002_conversation_meta.sql — 会话元数据（标题/置顶，对齐 Sudowork 本地会话元信息）
-- Moss 无标题/置顶字段且无对应 API（title 写入函数为死代码、无 rename 路由，已实测确认），
-- webui 本地存储是唯一路径。principal 维度隔离（同一 Moss 会话对不同登录主体各自维护）。

CREATE TABLE conversation_meta (
  principal_id uuid NOT NULL,
  moss_session_id text NOT NULL,
  title text,
  pinned boolean NOT NULL DEFAULT false,
  pinned_at bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, moss_session_id)
);

CREATE INDEX idx_conversation_meta_pinned ON conversation_meta (principal_id, pinned) WHERE pinned;
