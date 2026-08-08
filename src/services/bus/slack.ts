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
    // `!버스반영` 스레드 안에서 승인 흐름이 끝나도록 같은 스레드에 잇는다.
    ...(job.slack?.ts ? { thread_ts: job.slack.ts } : {}),
    text: "버스 시간표 검수 요청",
    blocks: buildReviewApprovalBlocks(job),
  });
}
export async function sendStatus(
  client: WebClient,
  channel: string,
  text: string,
  threadTs?: string,
) {
  await client.chat.postMessage({
    channel,
    ...(threadTs ? { thread_ts: threadTs } : {}),
    text,
  });
}
