import type { WebClient } from "@slack/web-api";

// 봇 자신의 user id. auth.test는 매번 부를 필요가 없어 한 번만 받아둔다.
let cached: string | undefined | null = null;

export async function botUserId(client: WebClient): Promise<string | undefined> {
  if (cached !== null) {
    return cached;
  }
  try {
    cached = ((await client.auth.test()) as { user_id?: string }).user_id;
  } catch {
    cached = undefined;
  }
  return cached;
}

/** `<@U123>` 형태로 봇을 부른 메시지인지. */
export function mentionsBot(text: string, id: string | undefined): boolean {
  return Boolean(id) && text.includes(`<@${id}>`);
}

/** 멘션 부분을 걷어낸 본문. 모델에 넘길 땐 호출 표시가 없는 게 낫다. */
export function stripMention(text: string, id: string | undefined): string {
  return id ? text.replaceAll(`<@${id}>`, "").trim() : text.trim();
}
