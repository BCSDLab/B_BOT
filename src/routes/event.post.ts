import type {
  ReactionAddedEvent,
  ReactionRemovedEvent,
  SlackEvent,
  WebClient,
} from "@slack/web-api";
import { messageFunctionList } from "~/services/slack/message";
import { matchesText, readUserMessage, type IncomingMessage } from "~/services/slack/incomingMessage";
import { botUserId } from "~/utils/slackBot";
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
