import { randomBytes } from "node:crypto";
import type { BusPatch } from "./patch";

/**
 * 버스 검토 페이지는 강의와 달리 읽기 전용으로 열린다. 반영 버튼은 Slack 액션으로만
 * 이루어지므로 페이지에는 HTML만 담는다.
 *
 * 슬랙에서 바로 눌러야 해서 로그인 없이 링크만으로 열린다. 대신 토큰을 추측할 수
 * 없게 만들고 기한을 둔다. **이건 인증이 아니다** — 링크를 아는 사람은 누구나 본다.
 */
const TOKEN_BYTES = 16;
const EXPIRE_DAYS = 7;

export interface BusReviewMeta {
  sourceFileName: string;
  issueCount: number;
  createdAt: string;
}

export interface StoredBusReview {
  html: string;
  meta: BusReviewMeta;
}

const key = (token: string) => `bus-review:${token}`;
/** 버스 검토 페이지의 토큰을 job에 남겨 수정 후 같은 링크에 덮어쓴다. */
const patchKey = (token: string) => `bus-patch:${token}`;

export function createBusReviewToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/** 경로 조작이나 오타로 엉뚱한 키를 읽지 않도록 형식을 먼저 본다. */
export function isValidBusReviewToken(token: string): boolean {
  return new RegExp(`^[0-9a-f]{${TOKEN_BYTES * 2}}$`).test(token);
}

function isExpired(createdAt: string, now: Date): boolean {
  const age = now.getTime() - new Date(createdAt).getTime();
  return !Number.isFinite(age) || age > EXPIRE_DAYS * 24 * 60 * 60 * 1000;
}

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
  if (isExpired(stored.meta.createdAt, new Date())) {
    await useStorage("kvStorage").removeItem(key(token));
    return null;
  }
  return stored;
}

export function buildBusReviewUrl(token: string): string {
  const base = import.meta.env.APP_BASE_URL ?? "";
  // 슬랙 버튼·메시지의 url은 절대 주소여야 한다. 비어 있으면 검수 메시지를 올리는
  // 단계에서 실패해 원인이 보이지 않는다.
  if (!/^https?:\/\//.test(base)) {
    throw new Error("APP_BASE_URL이 절대 주소로 설정되어 있지 않습니다.");
  }
  return `${base.endsWith("/") ? base : `${base}/`}bus-review/${token}`;
}

export interface StoredBusPatchPlan {
  jobId: string;
  patches: BusPatch[];
  problems: string[];
  /** 감사 로그용으로 남기는 원래 자연어 요청. */
  request: string;
  createdAt: string;
}

export async function saveBusPatchPlan(
  jobId: string,
  plan: Pick<StoredBusPatchPlan, "patches" | "problems" | "request">,
): Promise<string> {
  const token = createBusReviewToken();
  await useStorage("kvStorage").setItem(patchKey(token), {
    jobId,
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
  if (!stored || isExpired(stored.createdAt, new Date())) {
    return null;
  }
  return stored;
}

/** 적용됐거나 취소된 계획은 남겨두지 않는다. 두 번 눌러 두 번 적용되면 안 된다. */
export async function dropBusPatchPlan(token: string): Promise<void> {
  await useStorage("kvStorage").removeItem(patchKey(token));
}
