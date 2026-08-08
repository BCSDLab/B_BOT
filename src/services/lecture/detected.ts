import { createReviewToken, isValidToken } from "./reviewStore";
import type { KoinEnv } from "./target";

export interface AttachmentFile {
  name: string;
  url: string;
}

/**
 * 첨부가 여럿이라 사람이 고르는 동안 들고 있는 값.
 *
 * 배치는 **게시글 번호만** 준다. 첨부·학기는 버튼을 누른 뒤 삐봇이 코인 API로 알아낸다.
 * 배치가 첨부를 추출하고 슬랙 블록을 조립하면 그 지식이 두 레포로 흩어진다.
 */
export interface DetectedNotice {
  target: KoinEnv;
  articleId: number;
  articleTitle: string;
  articleUrl: string;
  year: number;
  term: string;
  /** 엑셀 첨부 후보. 이 순서가 곧 버튼 순서다. */
  files: AttachmentFile[];
}

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

interface ArticleAttachment {
  name?: string;
  url?: string;
}

interface Article {
  title?: string;
  url?: string;
  attachments?: ArticleAttachment[];
}

/** 편람일 가능성이 높은 이름. 이 순서가 곧 버튼 순서가 된다. */
const LIKELY_NAMES = ["개설교과목", "개설 교과목", "편람", "교과목"];

/**
 * 첨부에서 엑셀 후보를 **전부** 모은다.
 *
 * 하나만 고르지 않는 건, 한 공지에 엑셀이 여럿 붙기 때문이다
 * (편람 외에 폐강강좌·시간표 등). 조용히 첫 번째를 집으면 엉뚱한 파일을
 * 변환하고도 아무도 모른다. 둘 이상이면 사람이 고른다.
 *
 * 같은 파일이 여러 번 실려 오는 게시글이 있어 주소로 한 번 걸러낸다.
 * 이름 끝에 `(21 KB)`처럼 크기가 붙어 있어 확장자는 그 앞에서 본다.
 */
export function collectExcelAttachments(
  attachments: ArticleAttachment[] | undefined,
): AttachmentFile[] {
  const seen = new Set<string>();
  const files: AttachmentFile[] = [];

  for (const attachment of attachments ?? []) {
    const url = attachment.url ?? "";
    const name = cleanFileName(attachment.name ?? "");
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);

    if (name.toLowerCase().endsWith(".xlsx") && isAllowedFileUrl(url)) {
      files.push({ name, url });
    }
  }

  // 편람으로 보이는 걸 앞에 둔다. 고르는 사람이 대개 첫 번째를 누르게 된다.
  return files.sort((a, b) => likelihood(b.name) - likelihood(a.name));
}

function likelihood(name: string): number {
  const index = LIKELY_NAMES.findIndex((word) => name.includes(word));
  return index === -1 ? 0 : LIKELY_NAMES.length - index;
}

/** `붙임2. 개설교과목.xlsx(21 KB)` → `붙임2. 개설교과목.xlsx` */
export function cleanFileName(raw: string): string {
  return raw.replace(/\s*\(\s*[\d.]+\s*[KMG]?B\s*\)\s*$/i, "").trim();
}

/**
 * 공지 제목에서 학기를 읽는다.
 *
 * `2026학년도 하계 계절학기 개설교과목 안내` → 2026 여름학기
 * 알아내지 못하면 사람이 지정하게 한다. 추측해서 엉뚱한 학기에 넣으면 되돌릴 수 없다.
 */
export function guessSemester(title: string): { year: number; term: string } | null {
  const year = Number(/(\d{4})\s*학년도/.exec(title)?.[1]);
  if (!Number.isInteger(year)) {
    return null;
  }

  const term = /하계|여름/.test(title)
    ? "여름학기"
    : /동계|겨울/.test(title)
      ? "겨울학기"
      : /1\s*학기/.test(title)
        ? "1학기"
        : /2\s*학기/.test(title)
          ? "2학기"
          : null;

  return term ? { year, term } : null;
}

/** 게시글을 조회해 제목과 첨부를 얻는다. 배치가 넘긴 번호 하나로 나머지를 채운다. */
export async function fetchArticle(baseUrl: string, articleId: number): Promise<Article> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/articles/${articleId}`);
  if (!response.ok) {
    throw new Error(`게시글 ${articleId}을 찾지 못했습니다 (HTTP ${response.status}).`);
  }
  return (await response.json()) as Article;
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
