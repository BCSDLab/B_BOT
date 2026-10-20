import { WebClient } from '@slack/web-api';
import { getPool } from "~/helper/adapter/postgres";

export default defineNitroPlugin(async (nitroApp) => {
  const webClient = new WebClient(import.meta.env.SLACK_BOT_TOKEN);
  nitroApp.hooks.hook(
    'request',
    (event) => {
      event.context = {
        ...event.context,
        slackWebClient: webClient,
        sqlPool: getPool(),
      }
    }
  );
});