import type { WebClient } from "@slack/web-api";
import type {
  BlockAction,
  SlackAction,
  SlackShortcut,
  ViewSubmitAction,
} from '@slack/bolt';
import { blockActions } from '~/services/slack/blockAction';
import { shortcuts } from '~/services/slack/shortcut';
import { viewActions } from '~/services/slack/viewAction';

type Interaction = SlackAction | SlackShortcut | ViewSubmitAction;

export default defineEventHandler(async (event) => {
  if (!getHeader(event, "content-type").includes("application/x-www-form-urlencoded")) {
    throw createError({
      statusCode: 400,
      statusMessage: "Bad Request",
    });
  }
  const stringfiedBody = await readBody<{ payload: string }>(event);
  const body = JSON.parse(stringfiedBody.payload) as Interaction;
  if (body.type === "block_actions") {
    // 3초 안에 200을 못 받으면 슬랙이 사용자에게 오류를 띄우므로 핸들러를 기다리지 않는다.
    processBlockActions(body, event.context).catch(console.error);
    return { ok: true };
  }
  if (body.type === "message_action") {
    const targetShortcut = shortcuts.find((shortcut) => shortcut.key === body.callback_id);

    if (!targetShortcut) {
      throw createError({
        statusCode: 400,
        statusMessage: "Bad Request",
      });
    }
    console.log({key: targetShortcut.key});
    await targetShortcut.handler({
      client: event.context.slackWebClient,
      shortcut: body,
      context: event.context,
    });
  } else if (body.type === "view_submission") {
    const targetViewAction = viewActions.find((viewAction) => viewAction.actionId === body.view["callback_id"]);

    if (!targetViewAction) {
      throw createError({
        statusCode: 400,
        statusMessage: "Bad Request",
      });
    }

    await targetViewAction.handler({
      client: event.context.slackWebClient,
      action: body,
      context: event.context,
    });
  }

});

async function processBlockActions(
  body: BlockAction,
  context: Record<string, any>,
) {
  const client = context.slackWebClient as WebClient;

  for (const action of body.actions) {
    const targetBlockAction = blockActions.find(
      (blockAction) => blockAction.actionId === action.action_id,
    );

    // 모달 안의 select와 URL 링크 버튼도 여기로 들어온다.
    // 다른 분기처럼 400을 던지면 멀쩡한 모달에서 오류가 뜨므로 무시한다.
    if (!targetBlockAction) {
      continue;
    }

    console.log({ actionId: targetBlockAction.actionId });
    try {
      await targetBlockAction.handler({
        client,
        body,
        action,
        context,
      });
    } catch (error) {
      console.error("Block action handler error:", error);
      await notifyBlockActionError(client, body, error).catch(console.error);
    }
  }
}

// ack를 이미 보낸 뒤라 오류를 응답으로 알릴 수 없다. 누른 사람에게만 보여준다.
async function notifyBlockActionError(
  client: WebClient,
  body: BlockAction,
  error: unknown,
) {
  if (!body.channel?.id) {
    return;
  }

  await client.chat.postEphemeral({
    channel: body.channel.id,
    user: body.user.id,
    text: `오류가 발생했어요: ${error instanceof Error ? error.message : "알 수 없는 오류입니다"}`,
  });
}