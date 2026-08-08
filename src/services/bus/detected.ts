/**
 * 게시판에 새 버스 시간표 공지가 올라오면 외부 시스템(배치)이 Slack에 웹훅으로
 * "확인"/"넘어가기" 버튼을 올린다. 이 모듈은 그 "확인"을 눌렀을 때 게시글을
 * 다시 조회해서 첨부 시간표를 찾아오는 부분만 맡는다 — 배치가 아는 건 action_id와
 * `article_id` 하나뿐이고, 나머지는 전부 여기서 한다(coop/lecture와 동일한 이유).
 *
 * 첨부가 여러 개일 수 있는 coop(이미지)·lecture와 달리 버스 공지 첨부는 항상
 * 시간표 파일 하나뿐이라, 여러 개 중 고르는 단계(*_start_N, KV 저장)가 없다.
 */

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
