import type { StructuredImageMimeType } from "~/helper/adapter/structured";
import {
  cleanFileName,
  fetchArticle,
  isAllowedFileUrl,
} from "~/services/lecture/detected";
import { createReviewToken, isValidToken } from "~/services/lecture/reviewStore";
import { normalizeSemester } from "./convert";
import type { KoinEnv } from "~/services/lecture/target";

export interface CoopNoticeImage {
  name: string;
  url: string;
  mimeType: StructuredImageMimeType;
}

interface ArticleAttachment {
  name?: string;
  url?: string;
  created_at?: string;
}

export interface DetectedCoopNotice {
  env: KoinEnv;
  articleId: number;
  articleTitle: string;
  articleUrl: string;
  year: number;
  termName: "1학기" | "2학기";
  images: CoopNoticeImage[];
}

const IMAGE_MIME: Record<string, StructuredImageMimeType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
const LIKELY_NAMES = ["운영시간", "운영 시간", "생협", "시설물"];
const MAX_BYTES = 20 * 1024 * 1024;

function mimeTypeOf(name: string): StructuredImageMimeType | null {
  const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return IMAGE_MIME[extension] ?? null;
}

function likelihood(name: string): number {
  const index = LIKELY_NAMES.findIndex((word) => name.includes(word));
  return index === -1 ? 0 : LIKELY_NAMES.length - index;
}

/** 생협 공지의 이미지 후보를 모두 모으고, 같은 주소는 가장 최근 이름만 남긴다. */
export function collectCoopImages(
  attachments: ArticleAttachment[] | undefined,
): CoopNoticeImage[] {
  const newest = new Map<string, { image: CoopNoticeImage; at: string }>();
  for (const attachment of attachments ?? []) {
    const url = attachment.url ?? "";
    const name = cleanFileName(attachment.name ?? "");
    const mimeType = mimeTypeOf(name);
    if (!url || !name || !mimeType || !isAllowedFileUrl(url)) continue;

    const at = attachment.created_at ?? "";
    const kept = newest.get(url);
    if (!kept || at > kept.at) {
      newest.set(url, { image: { name, url, mimeType }, at });
    }
  }
  return [...newest.values()]
    .map(({ image }) => image)
    .sort((a, b) => likelihood(b.name) - likelihood(a.name));
}

/** 공지 제목에서 정규학기만 읽는다. 계절학기·방학은 normalizeSemester가 거절한다. */
export function guessRegularCoopSemester(
  title: string,
): { year: number; termName: "1학기" | "2학기" } | null {
  if (/(?:하계|동계)\s*방학|여름\s*학기|겨울\s*학기|계절\s*학기/.test(title)) {
    return null;
  }
  const academicYear = /(20\d{2})\s*학년도.*?([12])\s*학기/.exec(title);
  if (academicYear) {
    return {
      year: Number(academicYear[1]),
      termName: `${academicYear[2]}학기` as "1학기" | "2학기",
    };
  }
  const semester = normalizeSemester(title);
  const matched = /^(\d{2})-([12])학기$/.exec(semester ?? "");
  if (!matched) return null;
  return {
    year: 2000 + Number(matched[1]),
    termName: `${matched[2]}학기` as "1학기" | "2학기",
  };
}

export function hasImageSignature(
  bytes: Uint8Array,
  mimeType: StructuredImageMimeType,
): boolean {
  return (
    (mimeType === "image/png" && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) ||
    (mimeType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (mimeType === "image/gif" && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) ||
    (mimeType === "image/webp" && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
  );
}

/** 학교 게시글 이미지 다운로드. Slack 토큰은 학교 서버로 보내지 않는다. */
export async function downloadCoopNoticeImage(
  image: CoopNoticeImage,
): Promise<ArrayBuffer> {
  if (!isAllowedFileUrl(image.url)) {
    throw new Error("학교 주소가 아닌 곳에서는 파일을 받지 않습니다.");
  }
  const response = await fetch(image.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`첨부 이미지를 받지 못했습니다 (HTTP ${response.status}).`);
  }
  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > MAX_BYTES) {
    throw new Error(`파일이 너무 큽니다 (${Math.round(size / 1024 / 1024)}MB).`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(`파일이 너무 큽니다 (${Math.round(buffer.byteLength / 1024 / 1024)}MB).`);
  }
  if (!hasImageSignature(new Uint8Array(buffer), image.mimeType)) {
    throw new Error("이미지 파일 내용이 확장자와 일치하지 않습니다.");
  }
  return buffer;
}

export { fetchArticle };

const key = (token: string) => `coop-detected:${token}`;

export async function saveDetectedCoop(notice: DetectedCoopNotice): Promise<string> {
  const token = createReviewToken();
  await useStorage("kvStorage").setItem(key(token), notice);
  return token;
}

export async function loadDetectedCoop(token: string): Promise<DetectedCoopNotice | null> {
  if (!isValidToken(token)) return null;
  return (await useStorage("kvStorage").getItem<DetectedCoopNotice>(key(token))) ?? null;
}

export async function dropDetectedCoop(token: string): Promise<void> {
  await useStorage("kvStorage").removeItem(key(token));
}
