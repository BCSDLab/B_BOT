/**
 * 게시판에 새 버스 시간표 공지가 올라오면 외부 시스템(배치)이 Slack에 웹훅으로
 * "확인"/"넘어가기" 버튼을 올린다. 이 모듈은 그 "확인"을 눌렀을 때 게시글을
 * 다시 조회해서 첨부 시간표를 찾아오는 부분만 맡는다 — 배치가 아는 건 action_id와
 * `article_id` 하나뿐이고, 나머지는 전부 여기서 한다(coop/lecture와 동일한 이유).
 *
 * 시간표 파일이 여러 개 붙는 공지도 있어(정규학기·계절학기가 따로 올라오는 경우 등),
 * lecture와 동일하게 둘 이상이면 사람이 버튼으로 고르게 한다.
 */

import { createBusReviewToken, isValidBusReviewToken } from "./reviewStore";
import type { KoinEnv } from "~/services/koin/target";

interface BusArticleAttachment {
  name?: string;
  url?: string;
  created_at?: string;
}

export interface BusArticle {
  title?: string;
  url?: string;
  attachments?: BusArticleAttachment[];
}

export interface BusNoticeFile {
  name: string;
  url: string;
}

/**
 * 첨부가 여럿이라 사람이 고르는 동안 들고 있는 값.
 *
 * 배치는 **게시글 번호만** 준다. 첨부는 버튼을 누른 뒤 삐봇이 코인 API로 알아낸다.
 */
export interface BusDetectedNotice {
  target: KoinEnv;
  articleId: number;
  articleTitle: string;
  articleUrl: string;
  /** 시간표 첨부 후보. 이 순서가 곧 버튼 순서다. */
  files: BusNoticeFile[];
}

const MAX_BYTES = 20 * 1024 * 1024;
const ARTICLE_BASE_URL = "https://api.koreatech.in";
const ALLOWED_FILE_HOSTS = ["koreatech.ac.kr", "koreatech.in"];

export function cleanBusFileName(raw: string): string {
  return raw.replace(/\s*\(\s*[\d.]+\s*[KMG]?B\s*\)\s*$/i, "").trim();
}

export function isAllowedBusFileUrl(url: string): boolean {
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

export async function fetchBusArticle(articleId: number): Promise<BusArticle> {
  const response = await fetch(`${ARTICLE_BASE_URL}/articles/${articleId}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`게시글 ${articleId}을 찾지 못했습니다 (HTTP ${response.status}).`);
  }
  return (await response.json()) as BusArticle;
}

/** 버스 공지의 시간표(xls/xlsx) 첨부를 모은다. 같은 주소는 가장 최근 이름만 남긴다. */
export function collectBusSpreadsheets(
  attachments: BusArticleAttachment[] | undefined,
): BusNoticeFile[] {
  const newest = new Map<string, { file: BusNoticeFile; at: string }>();
  for (const attachment of attachments ?? []) {
    const url = attachment.url ?? "";
    const name = cleanBusFileName(attachment.name ?? "");
    const isSpreadsheet = [".xls", ".xlsx"].some((extension) =>
      name.toLowerCase().endsWith(extension),
    );
    if (!url || !name || !isSpreadsheet || !isAllowedBusFileUrl(url)) continue;

    const at = attachment.created_at ?? "";
    const kept = newest.get(url);
    if (!kept || at > kept.at) {
      newest.set(url, { file: { name, url }, at });
    }
  }
  return [...newest.values()].map(({ file }) => file);
}

/** 학교 게시글 첨부 다운로드. Slack 봇 토큰은 학교 서버로 보내지 않는다. */
export async function downloadBusNoticeFile(file: BusNoticeFile): Promise<Buffer> {
  if (!isAllowedBusFileUrl(file.url)) {
    throw new Error("학교 주소가 아닌 곳에서는 파일을 받지 않습니다.");
  }
  const response = await fetch(file.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`첨부 파일을 받지 못했습니다 (HTTP ${response.status}).`);
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    throw new Error(`파일이 너무 큽니다 (${Math.round(declared / 1024 / 1024)}MB).`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(`파일이 너무 큽니다 (${Math.round(buffer.byteLength / 1024 / 1024)}MB).`);
  }
  if (file.name.toLowerCase().endsWith(".xlsx")) {
    // xlsx는 zip이라 PK로 시작한다. slackFile.ts의 검사와 같은 이유.
    const head = new Uint8Array(buffer.slice(0, 2));
    if (head[0] !== 0x50 || head[1] !== 0x4b) {
      throw new Error("엑셀 파일이 아닙니다.");
    }
  }
  return Buffer.from(buffer);
}

const key = (token: string) => `bus-detected:${token}`;

/** 버튼을 누를 때까지 들고 있는다. 주소가 길어 버튼 value에 담기 어렵다. */
export async function saveBusDetected(notice: BusDetectedNotice): Promise<string> {
  const token = createBusReviewToken();
  await useStorage("kvStorage").setItem(key(token), notice);
  return token;
}

export async function loadBusDetected(token: string): Promise<BusDetectedNotice | null> {
  if (!isValidBusReviewToken(token)) {
    return null;
  }
  return (await useStorage("kvStorage").getItem<BusDetectedNotice>(key(token))) ?? null;
}

export async function dropBusDetected(token: string): Promise<void> {
  await useStorage("kvStorage").removeItem(key(token));
}
