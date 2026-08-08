import type { SlackFile } from "~/utils/slackFile";

const MAX_BYTES = 20 * 1024 * 1024;
const EXTENSIONS = [".xls", ".xlsx", ".csv"];

export function findBusTimetableFile(files: SlackFile[] | undefined): SlackFile | null {
  return files?.find((file) =>
    EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension)),
  ) ?? null;
}

/** Bus attachments allow legacy BIFF .xls files, unlike the lecture-only xlsx helper. */
export async function downloadBusAttachment(file: SlackFile): Promise<Buffer> {
  const url = file.url_private_download ?? file.url_private;
  if (!url) throw new Error("파일 다운로드 주소가 없습니다.");
  if (file.size > MAX_BYTES) throw new Error("첨부파일이 20MiB를 초과합니다.");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${import.meta.env.SLACK_BOT_TOKEN}` },
  });
  if (!response.ok) {
    throw new Error(`파일을 받지 못했습니다 (HTTP ${response.status}).`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("첨부파일이 20MiB를 초과합니다.");
  if (file.name.toLowerCase().endsWith(".xlsx") && (bytes[0] !== 0x50 || bytes[1] !== 0x4b)) {
    throw new Error("엑셀 파일이 아닙니다. 봇에 files:read 권한이 있는지 확인해주세요.");
  }
  return bytes;
}
