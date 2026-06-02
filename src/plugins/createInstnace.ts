import { App } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { createPool } from "~/helper/adapter/mysql";
import { messageFunctionList } from "~/services/slack/message";
import { shortcuts } from '~/services/slack/shortcut';
import { viewActions } from '~/services/slack/viewAction';
import { commands } from "~/services/slack/command";
import type { GenericMessageEvent } from '@slack/web-api';

export default defineNitroPlugin(async (nitroApp) => {
  const webClient = new WebClient(import.meta.env.SLACK_BOT_TOKEN);
  const pool = createPool();

  nitroApp.hooks.hook('request', (event) => {
    event.context = {
      ...event.context,
      slackWebClient: webClient,
      sqlPool: pool,
    }
  });

  const app = new App({
    token: import.meta.env.SLACK_BOT_TOKEN,
    appToken: import.meta.env.SLACK_APP_TOKEN,
    socketMode: true,
  });

  app.use(async ({ context, next }) => {
    context.sqlPool = pool;
    await next();
  });

  app.message(async ({ message, client }) => {
    if (message.subtype !== undefined) return;
    const msg = message as GenericMessageEvent;
    if (msg.bot_id) return;

    const text = msg.text ?? '';
    const channel = msg.channel;
    const user = msg.user ?? '';
    const ts = msg.ts ?? '';

    for (const messageFunction of messageFunctionList) {
      const isMatch = typeof messageFunction.regex === 'string'
        ? text.includes(messageFunction.regex)
        : messageFunction.regex.test(text);
      if (!isMatch) continue;
      try {
        await messageFunction.handler({ client, text, ts, user, channel });
      } catch (error) {
        console.error('Handler error:', error);
      }
    }
  });

  for (const shortcut of shortcuts) {
    app.shortcut(shortcut.key, async ({ shortcut: s, client, ack }) => {
      await ack();
      await shortcut.handler({ client, shortcut: s });
    });
  }

  for (const viewAction of viewActions) {
    app.view(viewAction.actionId, async ({ view, body, client, ack, context }) => {
      await ack();
      await viewAction.handler({ client, action: body as any, view, context });
    });
  }

  for (const command of commands) {
    app.command(command.command, async ({ command: cmd, client, ack }) => {
      await ack();
      await command.handler({ client, command: cmd as any });
    });
  }

  await app.start();
  console.log('Socket Mode started');
});