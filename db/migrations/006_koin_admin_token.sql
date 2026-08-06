-- 006_koin_admin_token.sql
-- KOIN 관리자 API 액세스 토큰. AES-256-GCM 암호문만 저장하며 최신 1건을 유지한다.

CREATE TABLE koin_admin_token (
  access_token text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
