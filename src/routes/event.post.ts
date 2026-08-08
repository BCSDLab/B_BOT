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
import { botUserId } from "~/utils/slackBot";
import type { SlackFile } from "~/utils/slackFile";
import { setFeedback } from "~/services/rag";
import { assertSlackRequest } from "~/utils/slackRequest";

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
  await assertSlackRequest(event);

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
  let files: SlackFile[] | undefined;
  // 스레드 답장인지 알아야 어느 변환 건에 대한 수정인지 찾을 수 있다.
  // 기존 ts는 답장 자신의 ts라 부모를 따로 들고 간다.
  let parentTs: string | undefined;

  if (body.event.subtype === undefined) {
    const eventBody = body.event as GenericMessageEvent;
    
    if (eventBody.bot_id) {
      return { ok: true };
    }
    
    text = eventBody.text ?? "";
    channelId = eventBody.channel;
    userId = eventBody.user ?? "";
    threadTs = eventBody.ts ?? eventBody.thread_ts ?? "";
    parentTs = eventBody.thread_ts;

  } else if (body.event.subtype === "file_share") {
    // 엑셀을 올리면서 명령어를 적는 흐름(!강의반영)을 위해 받는다.
    // 일반 메시지와 달리 subtype이 붙어 있어 위 분기로는 들어오지 않는다.
    const eventBody = body.event as GenericMessageEvent & { files?: SlackFile[] };
    if (eventBody.bot_id) {
      return { ok: true };
    }
    text = eventBody.text ?? "";
    channelId = eventBody.channel;
    userId = eventBody.user ?? "";
    threadTs = eventBody.ts ?? eventBody.thread_ts ?? "";
    parentTs = eventBody.thread_ts;
    files = eventBody.files;

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
    files,
    parentTs,
  }).catch(console.error);

  return { ok: true };
});

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
  files,
  parentTs,
}: {
  client: WebClient;
  text: string;
  ts: string;
  user: string;
  channel: string;
  files?: SlackFile[];
  parentTs?: string;
}) {
  const hasFiles = (files?.length ?? 0) > 0;

  for (const messageFunction of messageFunctionList) {
    // 파일이 붙은 메시지는 그걸 받겠다고 선언한 핸들러만 처리한다.
    if (hasFiles && !messageFunction.acceptsFiles) {
      continue;
    }
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
        files,
        parentTs,
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
