import { App } from "@slack/bolt";
import type { GenericMessageEvent } from "@slack/web-api";
import { WebClient } from '@slack/web-api';
import { createPool } from "~/helper/adapter/mysql";
import { commands } from "~/services/slack/command";
import { processSlackMessage } from "~/services/slack/processMessage";
import { shortcuts } from "~/services/slack/shortcut";
import { viewActions } from "~/services/slack/viewAction";

export default defineNitroPlugin(async (nitroApp) => {
  const webClient = new WebClient(import.meta.env.SLACK_BOT_TOKEN);
  const pool = createPool();

  nitroApp.hooks.hook("request", (event) => {
    event.context = {
      ...event.context,
      slackWebClient: webClient,
      sqlPool: pool,
    };
  });

  const socketApp = new App({
    token: import.meta.env.SLACK_BOT_TOKEN,
    appToken: import.meta.env.SLACK_APP_TOKEN,
    socketMode: true,
  });

  socketApp.message(async ({ message, client }) => {
    if (message.subtype !== undefined) {
      return;
    }

    const slackMessage = message as GenericMessageEvent;
    if (slackMessage.bot_id || !slackMessage.text) {
      return;
    }

    await processSlackMessage({
      client,
      text: slackMessage.text,
      ts: slackMessage.ts ?? slackMessage.thread_ts ?? "",
      user: slackMessage.user ?? "",
      channel: slackMessage.channel,
    });
  });

  for (const shortcut of shortcuts) {
    socketApp.shortcut(shortcut.key, async ({ shortcut: action, client, ack }) => {
      await ack();
      await shortcut.handler({
        client,
        shortcut: action,
        context: { sqlPool: pool },
      });
    });
  }

  for (const viewAction of viewActions) {
    socketApp.view(viewAction.actionId, async ({ view, body, client, ack }) => {
      await ack();
      await viewAction.handler({
        client,
        action: body as any,
        view,
        context: { sqlPool: pool },
      });
    });
  }

  for (const command of commands) {
    socketApp.command(command.command, async ({ command: action, client, ack }) => {
      await ack();
      await command.handler({
        client,
        command: action as any,
      });
    });
  }

  void socketApp.start()
    .then(() => {
      console.log("Slack Socket Mode started");
    })
    .catch((error) => {
      console.error("Slack Socket Mode failed to start:", error);
    });

  nitroApp.hooks.hook("close", async () => {
    await Promise.allSettled([
      socketApp.stop(),
      pool.end(),
    ]);
  });
});
