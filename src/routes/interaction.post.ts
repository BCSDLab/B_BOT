import type {
  SlackAction,
  SlackShortcut,
  ViewSubmitAction,
} from '@slack/bolt';
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
  const body = await readBody<Interaction>(event);
  if (body.type === "shortcut") {
    const targetShortcut = shortcuts.find((shortcut) => shortcut.key === body.callback_id);

    if (!targetShortcut) {
      throw createError({
        statusCode: 400,
        statusMessage: "Bad Request",
      });
    }

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