import type {
  GenericMessageEvent,
  MessageChangedEvent,
  SlackEvent,
  WebClient,
} from "@slack/web-api";
import { processSlackMessage } from "~/services/slack/processMessage";

type Body = {
  type: "event_callback";
  event: SlackEvent;
} | {
  type: "url_verification";
  challenge?: string;
}

interface Context {
  slackWebClient: WebClient;
  [key: string]: unknown;
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event);
  if (body.type === "url_verification") {
    if (body.challenge) {
      return { challenge: body.challenge };
    }
    return;
  }

  const retryNum = getHeader(event, "x-slack-retry-num");
  if (retryNum) {
    return { ok: true };
  }

  if (body.event.type !== "message") {
    return "not Implemented";
  }
  if (body.event.channel_type !== "channel") {
    return "not Implemented";
  }

  const context = event.context as Context;

  let text = "";
  let threadTs = "";
  let userId = "";
  let channelId = "";

  if (body.event.subtype === undefined) {
    const eventBody = body.event as GenericMessageEvent;
    
    if (eventBody.bot_id) {
      return { ok: true };
    }
    
    text = eventBody.text ?? "";
    channelId = eventBody.channel;
    userId = eventBody.user ?? "";
    threadTs = eventBody.ts ?? eventBody.thread_ts ?? "";

  } else if (body.event.subtype === "message_changed") {
    const eventBody = body.event as MessageChangedEvent;
    if (eventBody.message.subtype !== undefined) {
      return;
    }
    const message = eventBody.message as GenericMessageEvent;
    text = message.text ?? "";
    channelId = message.channel ?? "";
    userId = message.user ?? "";
    threadTs = message.ts ?? "";
  }

  if (!text) {
    return { ok: true };
  }

  processSlackMessage({
    client: context.slackWebClient,
    text,
    ts: threadTs,
    user: userId,
    channel: channelId,
  }).catch(console.error);

  return { ok: true };
});
