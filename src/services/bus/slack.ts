import type { WebClient } from "@slack/web-api";
import { buildReviewApprovalBlocks } from "./pipeline";
import type { BusJob } from "./types";

export async function sendReviewApproval(
  client: WebClient,
  channel: string,
  job: BusJob,
) {
  await client.chat.postMessage({
    channel,
    text: "버스 시간표 검수 요청",
    blocks: buildReviewApprovalBlocks(job),
  });
}
export async function sendStatus(
  client: WebClient,
  channel: string,
  text: string,
) {
  await client.chat.postMessage({ channel, text });
}
