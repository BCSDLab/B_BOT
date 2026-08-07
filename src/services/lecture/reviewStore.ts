import { randomBytes } from "node:crypto";
import type { AdminLectureCreateRequest } from "./adminApi";

/**
 * 검토 페이지는 로그인 없이 링크만으로 열린다. 슬랙에서 바로 눌러야 하기 때문이다.
 * 대신 토큰을 추측할 수 없게 만들고 기한을 둔다.
 *
 * **이건 인증이 아니다.** 링크를 아는 사람은 누구나 볼 수 있다.
 * 담기는 값이 학교가 공개한 편람이라 이 수준으로 두지만,
 * 개인정보가 들어가게 되면 인증을 붙여야 한다.
 */
const TOKEN_BYTES = 16;
const EXPIRE_DAYS = 7;

export interface ReviewMeta {
  year: number;
  termName: string;
  sourceFileName: string;
  lectureCount: number;
  issueCount: number;
  createdAt: string;
}

interface StoredReview {
  html: string;
  meta: ReviewMeta;
  /** 반영 버튼이 눌렸을 때 그대로 보낼 요청. 버튼 value에 담기엔 커서 여기 둔다. */
  request: AdminLectureCreateRequest;
}

export function createReviewToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/** 경로 조작이나 오타로 엉뚱한 키를 읽지 않도록 형식을 먼저 본다. */
export function isValidToken(token: string): boolean {
  return new RegExp(`^[0-9a-f]{${TOKEN_BYTES * 2}}$`).test(token);
}

export function isExpired(createdAt: string, now: Date): boolean {
  const age = now.getTime() - new Date(createdAt).getTime();
  return !Number.isFinite(age) || age > EXPIRE_DAYS * 24 * 60 * 60 * 1000;
}

export function buildReviewUrl(token: string): string {
  const base = import.meta.env.APP_BASE_URL ?? "";
  // 슬랙 버튼의 url은 절대 주소여야 한다. 비어 있으면 변환을 다 마친 뒤
  // 메시지를 올리는 단계에서 invalid_blocks로 실패해 원인이 보이지 않는다.
  if (!/^https?:\/\//.test(base)) {
    throw new Error("APP_BASE_URL이 절대 주소로 설정되어 있지 않습니다.");
  }
  return `${base.endsWith("/") ? base : `${base}/`}review/${token}`;
}

const key = (token: string) => `lecture-review:${token}`;

export async function saveReview(
  review: StoredReview,
): Promise<string> {
  const token = createReviewToken();
  await useStorage("kvStorage").setItem(key(token), review);
  return token;
}

export async function loadReview(token: string): Promise<StoredReview | null> {
  if (!isValidToken(token)) {
    return null;
  }
  const stored = await useStorage("kvStorage").getItem<StoredReview>(key(token));
  if (!stored) {
    return null;
  }
  if (isExpired(stored.meta.createdAt, new Date())) {
    await useStorage("kvStorage").removeItem(key(token));
    return null;
  }
  return stored;
}
