import type {
  GenericMessageEvent,
  MessageChangedEvent,
  ReactionAddedEvent,
  ReactionRemovedEvent,
  SlackEvent,
  WebClient,
} from "@slack/web-api";
import { messageFunctionList } from "~/services/slack/message";
import type { MessageSetting } from "~/services/slack/type";
import { botUserId } from "~/utils/slackBot";
import type { SlackFile } from "~/utils/slackFile";
import { setFeedback } from "~/services/rag";
import { assertSlackRequest } from "~/utils/slackRequest";
import { sendSlackText } from "~/utils/slackFunction";
import { errorMessage } from "~/utils/errorMessage";

type Body = {
  type: "event_callback";
  event: SlackEvent;
} | {
  type: "url_verification";
  challenge?: string;
}

type MessageEvent = Extract<SlackEvent, { type: "message" }>;

interface IncomingMessage {
  text: string;
  ts: string;
  user: string;
  channel: string;
  files?: SlackFile[];
  // 스레드 답장인지 알아야 어느 변환 건에 대한 수정인지 찾을 수 있다.
  // ts는 답장 자신의 ts라 부모를 따로 들고 간다.
  parentTs?: string;
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

  const message = readUserMessage(body.event);
  if (!message?.text) {
    return { ok: true };
  }

  processMessage({ client: context.slackWebClient, ...message }).catch(console.error);

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

/** 사람이 쓴 메시지만 꺼낸다. 봇 메시지와 처리하지 않는 subtype은 null. */
function readUserMessage(event: MessageEvent): IncomingMessage | null {
  // file_share: 엑셀을 올리면서 명령어를 적는 흐름(!강의반영)을 위해 받는다.
  // 일반 메시지와 달리 subtype이 붙어 있어 따로 허용해야 들어온다.
  if (event.subtype === undefined || event.subtype === "file_share") {
    const message = event as GenericMessageEvent & { files?: SlackFile[] };
    if (message.bot_id) {
      return null;
    }
    return {
      text: message.text ?? "",
      channel: message.channel,
      user: message.user ?? "",
      ts: message.ts ?? message.thread_ts ?? "",
      parentTs: message.thread_ts,
      files: event.subtype === "file_share" ? message.files : undefined,
    };
  }

  if (event.subtype === "message_changed") {
    const changed = (event as MessageChangedEvent).message;
    if (changed.subtype !== undefined) {
      return null;
    }
    const message = changed as GenericMessageEvent;
    return {
      text: message.text ?? "",
      channel: message.channel ?? "",
      user: message.user ?? "",
      ts: message.ts ?? "",
    };
  }

  return null;
}

function matchesText({ regex }: MessageSetting, text: string): boolean {
  return typeof regex === "string" ? text.includes(regex) : regex.test(text);
}

async function processMessage({
  client,
  text,
  ts,
  user,
  channel,
  files,
  parentTs,
}: IncomingMessage & { client: WebClient }) {
  const hasFiles = (files?.length ?? 0) > 0;

  // 파일이 붙은 메시지는 그걸 받겠다고 선언한 핸들러만 처리한다.
  const handlers = messageFunctionList.filter(
    (setting) => (!hasFiles || setting.acceptsFiles) && matchesText(setting, text),
  );

  for (const messageFunction of handlers) {
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
        text: `오류가 발생했어요: ${errorMessage(error)}`,
      });
    }
  }
}
