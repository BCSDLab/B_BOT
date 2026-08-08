import type { StructuredImageMimeType } from "~/helper/adapter/structured";

/** 슬랙에 올라온 파일 중 우리가 다루는 정보만. */
export interface SlackFile {
  id: string;
  name: string;
  filetype: string;
  size: number;
  url_private_download?: string;
  url_private?: string;
}

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * 봇 토큰을 붙여 요청하므로 슬랙이 아닌 주소로는 절대 보내지 않는다.
 * 서명 검증이 있으면 여기까지 위조된 주소가 오지 않지만, 한쪽이 뚫려도
 * 토큰은 나가지 않게 두 겹으로 둔다.
 */
export function isSlackFileUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && (hostname === "slack.com" || hostname.endsWith(".slack.com"));
  } catch {
    return false;
  }
}

export function findExcelFile(files: SlackFile[] | undefined): SlackFile | null {
  return (
    files?.find(
      (file) => file.filetype === "xlsx" || file.name?.toLowerCase().endsWith(".xlsx"),
    ) ?? null
  );
}

/** 버스 시간표처럼 xls/xlsx/csv를 모두 받는 경우. findExcelFile은 xlsx 전용이다. */
export function findSpreadsheetFile(files: SlackFile[] | undefined): SlackFile | null {
  return (
    files?.find((file) =>
      [".xls", ".xlsx", ".csv"].some((extension) =>
        file.name?.toLowerCase().endsWith(extension),
      ),
    ) ?? null
  );
}

const IMAGE_MIME_BY_TYPE: Record<string, StructuredImageMimeType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function slackImageMimeType(file: SlackFile): StructuredImageMimeType | null {
  const fileType = file.filetype?.toLowerCase();
  if (IMAGE_MIME_BY_TYPE[fileType]) {
    return IMAGE_MIME_BY_TYPE[fileType];
  }
  const extension = file.name?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return IMAGE_MIME_BY_TYPE[extension] ?? null;
}

export function findImageFile(files: SlackFile[] | undefined): SlackFile | null {
  return files?.find((file) => slackImageMimeType(file) !== null) ?? null;
}

async function download(file: SlackFile): Promise<ArrayBuffer> {
  const url = file.url_private_download ?? file.url_private;
  if (!url) {
    throw new Error("파일 다운로드 주소가 없습니다.");
  }
  if (!isSlackFileUrl(url)) {
    throw new Error("슬랙이 아닌 주소로는 파일을 받지 않습니다.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`파일이 너무 큽니다 (${Math.round(file.size / 1024 / 1024)}MB).`);
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${import.meta.env.SLACK_BOT_TOKEN}` },
  });
  if (!response.ok) {
    throw new Error(`파일을 받지 못했습니다 (HTTP ${response.status}).`);
  }
  return response.arrayBuffer();
}

/**
 * 슬랙 파일은 공개 URL이 아니다. 봇 토큰을 Authorization 헤더에 넣어야 받을 수 있고,
 * 앱에 `files:read` 스코프가 없으면 본문 대신 로그인 HTML이 돌아온다.
 * 그래서 상태 코드만 보지 않고 내용이 엑셀인지까지 확인한다.
 */
export async function downloadSlackFile(file: SlackFile): Promise<ArrayBuffer> {
  const buffer = await download(file);
  // xlsx는 zip이라 PK로 시작한다. 로그인 페이지가 오면 여기서 걸린다.
  const head = new Uint8Array(buffer.slice(0, 2));
  if (head[0] !== 0x50 || head[1] !== 0x4b) {
    throw new Error("엑셀 파일이 아닙니다. 봇에 files:read 권한이 있는지 확인해주세요.");
  }

  return buffer;
}

/**
 * xls/xlsx/csv를 모두 받는다. xlsx는 zip이라 PK로 시작하므로 여기서도 검사한다.
 * xls(BIFF)·csv는 매직 바이트 규칙이 달라 이름만으로 구분한다.
 */
export async function downloadSlackSpreadsheet(file: SlackFile): Promise<Buffer> {
  const buffer = await download(file);
  if (file.name?.toLowerCase().endsWith(".xlsx")) {
    const head = new Uint8Array(buffer.slice(0, 2));
    if (head[0] !== 0x50 || head[1] !== 0x4b) {
      throw new Error("엑셀 파일이 아닙니다. 봇에 files:read 권한이 있는지 확인해주세요.");
    }
  }
  return Buffer.from(buffer);
}

export async function downloadSlackImage(
  file: SlackFile,
): Promise<{ buffer: ArrayBuffer; mimeType: StructuredImageMimeType }> {
  const mimeType = slackImageMimeType(file);
  if (!mimeType) {
    throw new Error("지원하는 이미지 형식이 아닙니다. PNG, JPEG, WebP, GIF를 사용해주세요.");
  }

  const buffer = await download(file);
  const bytes = new Uint8Array(buffer);
  const valid =
    (mimeType === "image/png" && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) ||
    (mimeType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (mimeType === "image/gif" && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) ||
    (mimeType === "image/webp" && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50);

  if (!valid) {
    throw new Error("이미지 파일 내용이 확장자와 일치하지 않습니다.");
  }
  return { buffer, mimeType };
}
