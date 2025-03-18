import { WebClient } from '@slack/web-api';
import { createPool } from "~/helper/adapter/mysql";

export default defineNitroPlugin(async (nitroApp) => {
  const webClient = new WebClient(import.meta.env.SLACK_BOT_TOKEN);
  const pool = await createPool();
  console.log(pool.config);
  nitroApp.hooks.hook(
    'request',
    (event) => {
      console.log(pool.config);
      event.context = {
        ...event.context,
        slackWebClient: webClient,
        sqlPool: pool,
      }
    }
  );
});