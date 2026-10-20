import type { KoinAdminAuth } from "./adminAuth";

/** 응답이 없으면 반영 작업이 APPLYING에 묶여 다시 누를 수도 없다. 그래서 모든 요청에 시한을 둔다. */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface AdminRequest {
  method: "GET" | "POST" | "PUT";
  body?: unknown;
  timeoutMs?: number;
}

/** 코인 Admin API 호출. 인증 헤더·JSON 직렬화·시한을 한 곳에서 붙인다. */
export function adminFetch(
  { baseUrl, accessToken }: KoinAdminAuth,
  path: string,
  { method, body, timeoutMs = DEFAULT_TIMEOUT_MS }: AdminRequest,
): Promise<Response> {
  return fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** 실패 응답 본문 앞부분. 오류 메시지에 붙여 백엔드에 넘길 단서로 쓴다. */
export async function errorSnippet(response: Response): Promise<string> {
  return (await response.text().catch(() => "")).slice(0, 300);
}
