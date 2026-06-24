import type {
  GenericMessageEvent,
  MessageChangedEvent,
  MessageRepliedEvent,
  ReactionAddedEvent,
  ReactionRemovedEvent,
  SlackEvent,
  WebClient,
} from "@slack/web-api";
import { messageFunctionList } from "~/services/slack/message";
import { setFeedback } from "~/services/rag";

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

  const context = event.context as Context;

  if (body.event.type === "reaction_added" || body.event.type === "reaction_removed") {
    await handleReaction(context.slackWebClient, body.event).catch(console.error);
    return { ok: true };
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

  processMessage({
    client: context.slackWebClient,
    text,
    ts: threadTs,
    user: userId,
    channel: channelId,
  }).catch(console.error);

  return { ok: true };
});

// 봇 user id 캐시(자신이 선제공한 👍👎를 만족도로 오집계하지 않으려고 필터).
let _botUserId: string | undefined | null = null;
async function botUserId(client: WebClient): Promise<string | undefined> {
  if (_botUserId !== null) return _botUserId;
  try {
    _botUserId = ((await client.auth.test()) as { user_id?: string }).user_id;
  } catch {
    _botUserId = undefined;
  }
  return _botUserId;
}

const FEEDBACK: Record<string, number> = { "+1": 1, "-1": -1 };

// 👍/👎 → rag_query_log.feedback. 추가=값, 제거=취소(null). 봇 자신·기타 이모지는 무시.
async function handleReaction(
  client: WebClient,
  reactionEvent: ReactionAddedEvent | ReactionRemovedEvent,
) {
  const value = FEEDBACK[reactionEvent.reaction];
  if (value === undefined) return;
  if (reactionEvent.item.type !== "message") return;
  const me = await botUserId(client);
  if (me && reactionEvent.user === me) return;
  await setFeedback(
    reactionEvent.item.ts,
    reactionEvent.type === "reaction_added" ? value : null,
  );
}

async function processMessage({
  client,
  text,
  ts,
  user,
  channel,
}: {
  client: WebClient;
  text: string;
  ts: string;
  user: string;
  channel: string;
}) {
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

    try {
      await messageFunction.handler({
        client,
        text,
        ts,
        user,
        channel,
      });
    } catch (error) {
      console.error('Handler error:', error);
      await sendSlackText({
        client,
        channel,
        threadTs: ts,
        text: `오류가 발생했어요: ${error instanceof Error ? error.message : '알 수 없는 오류입니다'}`,
      });
    }
  }
}