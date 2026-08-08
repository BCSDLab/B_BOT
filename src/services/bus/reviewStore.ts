import { randomBytes } from "node:crypto";
import type { BusPatch } from "./patch";
import type { BusKoinEnv } from "./target";
import type { BusConversion } from "./types";

/**
 * 검토 페이지는 로그인 없이 링크만으로 열린다. 슬랙에서 바로 눌러야 하기 때문이다.
 * 대신 토큰을 추측할 수 없게 만들고 기한을 둔다.
 *
 * **이건 인증이 아니다.** 링크를 아는 사람은 누구나 볼 수 있다.
 */
const TOKEN_BYTES = 16;
const EXPIRE_DAYS = 7;

export interface BusReviewMeta {
  /** 어느 코인에 반영할 건지. 검토·반영 내내 바뀌지 않아야 한다. */
  env: BusKoinEnv;
  sourceFileName: string;
  routeCount: number;
  issueCount: number;
  createdAt: string;
}

/**
 * conversions가 원본이고 HTML은 그걸로 만든 결과다.
 * 어드민 요청도 반영할 때 conversions에서 다시 만든다 — 검토 화면과 실제로 보낼 값이
 * 갈라지지 않게 하려는 것이다.
 */
export interface StoredBusReview {
  html: string;
  conversions: BusConversion[];
  meta: BusReviewMeta;
}

export function createBusReviewToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/** 경로 조작이나 오타로 엉뚱한 키를 읽지 않도록 형식을 먼저 본다. */
export function isValidBusReviewToken(token: string): boolean {
  return new RegExp(`^[0-9a-f]{${TOKEN_BYTES * 2}}$`).test(token);
}

export function isBusReviewExpired(createdAt: string, now: Date): boolean {
  const age = now.getTime() - new Date(createdAt).getTime();
  return !Number.isFinite(age) || age > EXPIRE_DAYS * 24 * 60 * 60 * 1000;
}

export function buildBusReviewUrl(token: string): string {
  const base = import.meta.env.APP_BASE_URL ?? "";
  // 슬랙 버튼의 url은 절대 주소여야 한다. 비어 있으면 변환을 다 마친 뒤
  // 메시지를 올리는 단계에서 invalid_blocks로 실패해 원인이 보이지 않는다.
  if (!/^https?:\/\//.test(base)) {
    throw new Error("APP_BASE_URL이 절대 주소로 설정되어 있지 않습니다.");
  }
  return `${base.endsWith("/") ? base : `${base}/`}bus-review/${token}`;
}

const key = (token: string) => `bus-review:${token}`;
/** 스레드에 답장한 수정 요청이 어느 변환 건인지 찾으려면 필요하다. */
const threadKey = (channel: string, threadTs: string) => `bus-thread:${channel}:${threadTs}`;
/** 적용 버튼을 누를 때까지 들고 있을 수정 계획. 버튼 value에 담기엔 크다. */
const patchKey = (token: string) => `bus-patch:${token}`;

export async function saveBusReview(review: StoredBusReview): Promise<string> {
  const token = createBusReviewToken();
  await useStorage("kvStorage").setItem(key(token), review);
  return token;
}

/** 수정을 적용한 뒤 같은 토큰에 덮어쓴다. 링크가 바뀌지 않아 새로고침만 하면 된다. */
export async function updateBusReview(token: string, review: StoredBusReview): Promise<void> {
  await useStorage("kvStorage").setItem(key(token), review);
}

export async function loadBusReview(token: string): Promise<StoredBusReview | null> {
  if (!isValidBusReviewToken(token)) {
    return null;
  }
  const stored = await useStorage("kvStorage").getItem<StoredBusReview>(key(token));
  if (!stored) {
    return null;
  }
  if (isBusReviewExpired(stored.meta.createdAt, new Date())) {
    await useStorage("kvStorage").removeItem(key(token));
    return null;
  }
  return stored;
}

export async function linkBusThread(channel: string, threadTs: string, token: string): Promise<void> {
  await useStorage("kvStorage").setItem(threadKey(channel, threadTs), { token });
}

export async function findBusTokenByThread(channel: string, threadTs: string): Promise<string | null> {
  const stored = await useStorage("kvStorage").getItem<{ token: string }>(
    threadKey(channel, threadTs),
  );
  return stored?.token ?? null;
}

export interface StoredBusPatchPlan {
  reviewToken: string;
  patches: BusPatch[];
  problems: string[];
  /** 감사 로그용으로 남기는 원래 자연어 요청. */
  request: string;
  createdAt: string;
}

export async function saveBusPatchPlan(
  reviewToken: string,
  plan: Pick<StoredBusPatchPlan, "patches" | "problems" | "request">,
): Promise<string> {
  const token = createBusReviewToken();
  await useStorage("kvStorage").setItem(patchKey(token), {
    reviewToken,
    ...plan,
    createdAt: new Date().toISOString(),
  } satisfies StoredBusPatchPlan);
  return token;
}

export async function loadBusPatchPlan(token: string): Promise<StoredBusPatchPlan | null> {
  if (!isValidBusReviewToken(token)) {
    return null;
  }
  const stored = await useStorage("kvStorage").getItem<StoredBusPatchPlan>(patchKey(token));
  if (!stored) {
    return null;
  }
  if (isBusReviewExpired(stored.createdAt, new Date())) {
    await useStorage("kvStorage").removeItem(patchKey(token));
    return null;
  }
  return stored;
}

/** 적용됐거나 취소된 계획은 남겨두지 않는다. 두 번 눌러 두 번 적용되면 안 된다. */
export async function dropBusPatchPlan(token: string): Promise<void> {
  await useStorage("kvStorage").removeItem(patchKey(token));
}
