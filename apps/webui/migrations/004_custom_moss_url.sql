-- 004_custom_moss_url.sql — 登录页自定义 Moss 服务器地址
-- 会话/身份按「moss 地址 + org + user」区分：自定义地址登录的用户与默认地址下同 org+user 不互相覆盖。
ALTER TABLE web_sessions ADD COLUMN IF NOT EXISTS moss_base_url text;
ALTER TABLE web_principals ADD COLUMN IF NOT EXISTS moss_base_url text;

-- 原内联 UNIQUE (org_id, moss_user_id)（PG 默认命名）替换为「地址归一 + org + user」表达式唯一索引
ALTER TABLE web_principals DROP CONSTRAINT IF EXISTS web_principals_org_id_moss_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS web_principals_identity_key
  ON web_principals (COALESCE(moss_base_url, ''), org_id, moss_user_id);
