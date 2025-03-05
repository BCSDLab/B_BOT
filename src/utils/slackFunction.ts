import type { WebClient, Block, KnownBlock } from "@slack/web-api";

interface SendSlackMessageBaseParams {
  client: WebClient;
  channel: string;
  threadTs?: string;
}

interface SendSlackTextParams extends SendSlackMessageBaseParams {
  text: string;
}

export async function sendSlackText({
  client,
  channel,
  threadTs,
  text,
}: SendSlackTextParams) {
  await client.chat.postMessage({
      channel: channel,
      text,
      thread_ts: threadTs
  });
}

interface SendSlackBlockParams extends SendSlackMessageBaseParams {
  blocks: (KnownBlock | Block)[];
}

export async function sendSlackBlock({
  client,
  channel,
  threadTs,
  blocks,
}: SendSlackBlockParams) {
  await client.chat.postMessage({
      channel: channel,
      blocks,
      thread_ts: threadTs,
  });
}