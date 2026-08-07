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

export function findExcelFile(files: SlackFile[] | undefined): SlackFile | null {
  return (
    files?.find(
      (file) => file.filetype === "xlsx" || file.name?.toLowerCase().endsWith(".xlsx"),
    ) ?? null
  );
}

/**
 * 슬랙 파일은 공개 URL이 아니다. 봇 토큰을 Authorization 헤더에 넣어야 받을 수 있고,
 * 앱에 `files:read` 스코프가 없으면 본문 대신 로그인 HTML이 돌아온다.
 * 그래서 상태 코드만 보지 않고 내용이 엑셀인지까지 확인한다.
 */
export async function downloadSlackFile(file: SlackFile): Promise<ArrayBuffer> {
  const url = file.url_private_download ?? file.url_private;
  if (!url) {
    throw new Error("파일 다운로드 주소가 없습니다.");
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

  const buffer = await response.arrayBuffer();
  // xlsx는 zip이라 PK로 시작한다. 로그인 페이지가 오면 여기서 걸린다.
  const head = new Uint8Array(buffer.slice(0, 2));
  if (head[0] !== 0x50 || head[1] !== 0x4b) {
    throw new Error("엑셀 파일이 아닙니다. 봇에 files:read 권한이 있는지 확인해주세요.");
  }

  return buffer;
}
