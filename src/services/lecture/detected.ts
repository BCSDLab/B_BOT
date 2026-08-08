import { createReviewToken, isValidToken } from "./reviewStore";
import type { KoinEnv } from "./target";

/**
 * 배치가 강의 공지를 감지했을 때 넘겨주는 값.
 *
 * 배치는 슬랙을 모른다. 감지만 알리고, 알림 문구·버튼·검토·반영은 전부 삐봇이 한다.
 * 버튼 클릭이 배치로 가면 배치도 서명 검증과 상태 관리를 다시 만들어야 한다.
 */
export interface DetectedNotice {
  target: KoinEnv;
  year: number;
  term: string;
  fileUrl: string;
  noticeUrl?: string;
  noticeTitle?: string;
}

const TERMS = ["1학기", "2학기", "여름학기", "겨울학기"];

/** 학교가 올린 파일만 받는다. 남이 넣은 주소로 봇이 아무거나 받아오게 두지 않는다. */
const ALLOWED_FILE_HOSTS = ["koreatech.ac.kr", "koreatech.in"];

export function isAllowedFileUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === "https:" &&
      ALLOWED_FILE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))
    );
  } catch {
    return false;
  }
}

export interface ParseResult {
  ok: boolean;
  notice?: DetectedNotice;
  reason?: string;
}

/** 배치가 보낸 값을 그대로 믿지 않는다. 여기서 걸러야 버튼 누른 뒤에 깨지지 않는다. */
export function parseDetected(body: unknown): ParseResult {
  const raw = (body ?? {}) as Record<string, unknown>;
  const target = raw.target;
  const year = Number(raw.year);
  const term = String(raw.term ?? "");
  const fileUrl = String(raw.file_url ?? "");

  if (target !== "stage" && target !== "prod") {
    return { ok: false, reason: "target은 stage 또는 prod여야 합니다." };
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { ok: false, reason: "year가 올바르지 않습니다." };
  }
  if (!TERMS.includes(term)) {
    return { ok: false, reason: `term은 ${TERMS.join(" · ")} 중 하나여야 합니다.` };
  }
  if (!isAllowedFileUrl(fileUrl)) {
    return { ok: false, reason: "file_url이 학교 주소(https)가 아닙니다." };
  }

  return {
    ok: true,
    notice: {
      target,
      year,
      term,
      fileUrl,
      noticeUrl: raw.notice_url ? String(raw.notice_url) : undefined,
      noticeTitle: raw.notice_title ? String(raw.notice_title) : undefined,
    },
  };
}

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * 공지 첨부파일을 받는다. 슬랙 파일과 달리 봇 토큰을 붙이지 않는다 —
 * 학교 서버에 우리 토큰을 보낼 이유가 없다.
 */
export async function downloadNoticeFile(url: string): Promise<ArrayBuffer> {
  if (!isAllowedFileUrl(url)) {
    throw new Error("학교 주소가 아닌 곳에서는 파일을 받지 않습니다.");
  }

  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`첨부파일을 받지 못했습니다 (HTTP ${response.status}).`);
  }

  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > MAX_BYTES) {
    throw new Error(`파일이 너무 큽니다 (${Math.round(size / 1024 / 1024)}MB).`);
  }

  const buffer = await response.arrayBuffer();
  // xlsx는 zip이라 PK로 시작한다. 로그인 페이지가 오면 여기서 걸린다.
  const head = new Uint8Array(buffer.slice(0, 2));
  if (head[0] !== 0x50 || head[1] !== 0x4b) {
    throw new Error("엑셀 파일이 아닙니다. 첨부 주소를 확인해주세요.");
  }

  return buffer;
}

const key = (token: string) => `lecture-detected:${token}`;

/** 버튼을 누를 때까지 들고 있는다. 주소가 길어 버튼 value에 담기 어렵다. */
export async function saveDetected(notice: DetectedNotice): Promise<string> {
  const token = createReviewToken();
  await useStorage("kvStorage").setItem(key(token), notice);
  return token;
}

export async function loadDetected(token: string): Promise<DetectedNotice | null> {
  if (!isValidToken(token)) {
    return null;
  }
  return (await useStorage("kvStorage").getItem<DetectedNotice>(key(token))) ?? null;
}

export async function dropDetected(token: string): Promise<void> {
  await useStorage("kvStorage").removeItem(key(token));
}

/** 파일명은 주소 끝에서 딴다. 검토 화면과 기록에 무엇을 읽었는지 남기려는 것이다. */
export function fileNameOf(notice: DetectedNotice): string {
  try {
    const last = decodeURIComponent(new URL(notice.fileUrl).pathname.split("/").pop() ?? "");
    return last || `${notice.year}-${notice.term}.xlsx`;
  } catch {
    return `${notice.year}-${notice.term}.xlsx`;
  }
}
