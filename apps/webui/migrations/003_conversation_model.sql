-- 003_conversation_model.sql — 会话模型持久化（webui 本地）
-- Moss 模型为用户级设置（PUT /api/v1/users/me/model），无会话级查询接口；
-- webui 本地记录每个会话所选模型，用于重新打开会话时回读显示。
ALTER TABLE conversation_meta ADD COLUMN IF NOT EXISTS model_id text;
