import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { messageFunctionList } from '~/services/slack/message';

export default defineNitroPlugin(async (nitroApp) => {
  const socketModeClient = new SocketModeClient({
    appToken: import.meta.env.SLACK_APP_TOKEN,
  });
  const webClient = new WebClient(import.meta.env.SLACK_BOT_TOKEN);

  socketModeClient.on(
    "app_mention",
    async ({
      body,
      ack
    }) => {
      try {
        await ack();

        await sendSlackText({
          client: webClient,
          channel: body.event.channel,
          threadTs: body.event.ts,
          text: `안녕하세요, <@${body.event.user}>!`,
        });
      } catch (error) {
        await sendSlackText({
          client: webClient,
          channel: body.event.channel,
          threadTs: body.event.ts,
          text: `어라 삐봇의 상태가 ${error.toString()}`,
        });
      }
    }
  );
  socketModeClient.on(
    "message",
    async ({
      body,
      ack
    }) => {
      try {
        await ack();
        for (const messsageHandlerInfo of messageFunctionList) {
          if (
            (typeof messsageHandlerInfo.regex === "string" &&
            body.event.text.includes(messsageHandlerInfo.regex)) ||
            (messsageHandlerInfo.regex instanceof RegExp &&
            messsageHandlerInfo.regex.test(body.event.text))
          ) {
            await messsageHandlerInfo.handler({
              client: webClient,
              ...body.event,
            });
          }
        }
      } catch (error) {
        await sendSlackText({
          client: webClient,
          channel: body.event.channel,
          threadTs: body.event.ts,
          text: `어라 삐봇의 상태가 ${error.toString()}`,
        });
      }
    }
  );

  await socketModeClient.start();


})