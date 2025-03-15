import type {
  GenericMessageEvent,
  MessageChangedEvent,
  MessageRepliedEvent,
  SlackEvent,
} from "@slack/web-api";
import { messageFunctionList } from "~/services/slack/message";

type Body = SlackEvent | {
  type: "url_verification";
  challenge?: string;
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event);
  if (body.type === "url_verification" && body.challenge) {
    return { challenge: body.challenge };
  }

  if (body.type !== "message") {
    return "not Implemented";
  }
  if (body.channel_type !== "channel") {
    return "not Implemented";
  }
  if (body.subtype === undefined) {
    const eventBody = body as GenericMessageEvent;
    const text = eventBody.text;
    for(const messageFunction of messageFunctionList) {
      if (typeof messageFunction.regex === "string") {
        const isIncluded = text.includes(messageFunction.regex);
        if (!isIncluded) {
          continue;
        }
        await messageFunction.handler({
          client: event.context.slackWebClient,
          text,
          ts: eventBody.thread_ts,
          user: eventBody.user,
          channel: eventBody.channel,
        });
      } else {
        const isMatched = messageFunction.regex.test(text);
        if (!isMatched) {
          continue;
        }
        await messageFunction.handler({
          client: event.context.slackWebClient,
          text,
          ts: eventBody.thread_ts,
          user: eventBody.user,
          channel: eventBody.channel,
        });
      }
    }
  } else if (body.subtype === "message_changed") {
    const eventBody = body as MessageChangedEvent;
    if (eventBody.message.subtype !== undefined) {
      return;
    }
    const message = eventBody.message as GenericMessageEvent;
    const text = message.text;
    for(const messageFunction of messageFunctionList) {
      if (typeof messageFunction.regex === "string") {
        const isIncluded = text.includes(messageFunction.regex);
        if (!isIncluded) {
          continue;
        }
        await messageFunction.handler({
          client: event.context.slackWebClient,
          text,
          ts: message?.thread_ts,
          user: message.user,
          channel: message.channel,
        });
      } else {
        const isMatched = messageFunction.regex.test(text);
        if (!isMatched) {
          continue;
        }
        await messageFunction.handler({
          client: event.context.slackWebClient,
          text,
          ts: message?.thread_ts,
          user: message.user,
          channel: message.channel,
        });
      }
    }
  } else if (body.subtype === "message_replied") {
    const eventBody = body as MessageRepliedEvent;
    if (eventBody.message.subtype !== undefined) {
      return;
    }
    const message = eventBody.message as GenericMessageEvent;
    const text = message.text;
    for(const messageFunction of messageFunctionList) {
      if (typeof messageFunction.regex === "string") {
        const isIncluded = text.includes(messageFunction.regex);
        if (!isIncluded) {
          continue;
        }
        await messageFunction.handler({
          client: event.context.slackWebClient,
          text,
          ts: message.thread_ts,
          user: message.user,
          channel: message.channel,
        });
      } else {
        const isMatched = messageFunction.regex.test(text);
        if (!isMatched) {
          continue;
        }
        await messageFunction.handler({
          client: event.context.slackWebClient,
          text,
          ts: message.thread_ts,
          user: message.user,
          channel: message.channel,
        });
      }
    }
  }
});