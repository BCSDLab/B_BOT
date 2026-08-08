import { createHash } from "node:crypto";
import type { SlackFile } from "~/utils/slackFile";
import type { BusJob } from "./types";
import { registerCandidate } from "./workflow";

/** Creates a job after the command handler has downloaded the Slack file. */
export async function registerBusAttachment(
  file: SlackFile,
  bytes: Buffer,
): Promise<BusJob | undefined> {
  const url = file.url_private_download ?? file.url_private;
  if (!url || !/^https:\/\/files\.slack\.com\//.test(url)) {
    throw new Error("valid Slack attachment URL is required");
  }
  if (!/\.(xls|xlsx|csv)$/i.test(file.name)) {
    throw new Error("xls, xlsx, csv 파일만 처리할 수 있습니다.");
  }
  if (bytes.length > 20 * 1024 * 1024) {
    throw new Error("첨부파일이 20MiB를 초과합니다.");
  }

  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  return registerCandidate({
    domain: "BUS",
    article_id: `bus:${file.id || sourceHash}`,
    article_url: url,
    article_title: "버스 시간표 반영",
    attachment_url: url,
    source_hash: sourceHash,
  });
}
