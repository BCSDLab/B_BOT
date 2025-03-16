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
  if (body.event.subtype === undefined) {
    const eventBody = body.event as GenericMessageEvent;
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
          googleClient: event.context.googleClient,
        });
      }
    }
  } else if (body.event.subtype === "message_changed") {
    const eventBody = body.event as MessageChangedEvent;
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
          googleClient: event.context.googleClient,
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
          googleClient: event.context.googleClient,
        });
      }
    }
  } else if (body.event.subtype === "message_replied") {
    const eventBody = body.event as MessageRepliedEvent;
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
          googleClient: event.context.googleClient,
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
          googleClient: event.context.googleClient,
        });
      }
    }
  }
});