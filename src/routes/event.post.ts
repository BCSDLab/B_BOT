import type {
  GenericMessageEvent,
  MessageChangedEvent,
  MessageRepliedEvent,
  SlackEvent,
} from "@slack/web-api";
import { messageFunctionList } from "~/services/slack/message";

type Body = {
  type: "event_callback";
  event: SlackEvent;
} | {
  type: "url_verification";
  challenge?: string;
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event);
  if (body.type === "url_verification") {
    if (body.challenge) {
      return { challenge: body.challenge };
    }
    return;
  }

  if (body.event.type !== "message") {
    return "not Implemented";
  }
  if (body.event.channel_type !== "channel") {
    return "not Implemented";
  }
  let text = "";
  let threadTs = "";
  let userId = "";
  let channelId = "";

  if (body.event.subtype === undefined) {
    const eventBody = body.event as GenericMessageEvent;
    text = eventBody.text;
    channelId = eventBody.channel;
    userId = eventBody.user;

  } else if (body.event.subtype === "message_changed") {
    const eventBody = body.event as MessageChangedEvent;
    if (eventBody.message.subtype !== undefined) {
      return;
    }
    const message = eventBody.message as GenericMessageEvent;
    text = message.text;
    channelId = message.channel;
    userId = message.user;
    threadTs = message.thread_ts;

  } else if (body.event.subtype === "message_replied") {
    const eventBody = body.event as MessageRepliedEvent;
    if (eventBody.message.subtype !== undefined) {
      return;
    }
    const message = eventBody.message as GenericMessageEvent;
    text = message.text;
    channelId = message.channel;
    userId = message.user;
    threadTs = message.thread_ts;
  }
  for (const messageFunction of messageFunctionList) {
    if (typeof messageFunction.regex === "string") {
      const isIncluded = text.includes(messageFunction.regex);
      if (!isIncluded) {
        continue;
      }
    } else {
      const isMatched = messageFunction.regex.test(text);
      if (!isMatched) {
        continue;
      }
    }
    await messageFunction.handler({
      client: event.context.slackWebClient,
      text,
      ts: threadTs,
      user: userId,
      channel: channelId,
    });
  }
});