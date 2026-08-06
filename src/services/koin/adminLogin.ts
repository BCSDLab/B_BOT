import { createCipheriv, randomBytes } from "node:crypto";
import type { Pool } from "pg";

const AES_ALGORITHM = "aes-256-gcm";
const AES_IV_LENGTH = 12;
const ENCRYPTION_VERSION = "v1";

interface KoinAdminLoginResponse {
  token: string;
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} 환경변수가 설정되지 않았습니다.`);
  }
  return value;
}

function encryptAccessToken(accessToken: string, encodedKey: string): string {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("KOIN_TOKEN_ENCRYPTION_KEY는 Base64로 인코딩한 32바이트 키여야 합니다.");
  }

  const iv = randomBytes(AES_IV_LENGTH);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(accessToken, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

async function replaceAccessToken(pool: Pool, encryptedAccessToken: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE koin_admin_token IN EXCLUSIVE MODE");
    await client.query("DELETE FROM koin_admin_token");
    await client.query(
      "INSERT INTO koin_admin_token(access_token) VALUES($1)",
      [encryptedAccessToken],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function loginKoinAdmin(pool: Pool): Promise<string> {
  const baseURL = requireEnv("KOIN_API_BASE_URL", import.meta.env.KOIN_API_BASE_URL);
  const email = requireEnv("KOIN_ADMIN_EMAIL", import.meta.env.KOIN_ADMIN_EMAIL);
  const password = requireEnv("KOIN_ADMIN_PASSWORD", import.meta.env.KOIN_ADMIN_PASSWORD);
  const encryptionKey = requireEnv(
    "KOIN_TOKEN_ENCRYPTION_KEY",
    import.meta.env.KOIN_TOKEN_ENCRYPTION_KEY,
  );

  const response = await $fetch<KoinAdminLoginResponse>("admin/user/login", {
    baseURL,
    method: "POST",
    body: {
      email,
      password,
    },
    timeout: 10_000,
  });

  if (typeof response.token !== "string" || response.token.length === 0) {
    throw new Error("KOIN 관리자 로그인 응답에 액세스 토큰이 없습니다.");
  }

  const encryptedAccessToken = encryptAccessToken(response.token, encryptionKey);
  await replaceAccessToken(pool, encryptedAccessToken);

  return response.token;
}
