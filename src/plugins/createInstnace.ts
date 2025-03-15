import { WebClient } from '@slack/web-api';
import { createPool } from "~/helper/adapter/mysql";
import { initGoogleMeetClient } from "~/helper/adapter/googleMeet";

export default defineNitroPlugin(async (nitroApp) => {
  const webClient = new WebClient(import.meta.env.SLACK_BOT_TOKEN);
  const googleClient = await initGoogleMeetClient();
  const pool = await createPool();
  nitroApp.hooks.hook(
    'request',
    (event) => {
      event.context = {
        ...event.context,
        slackWebClient: webClient,
        googleClient,
        sqlPool: pool,
      }
    }
  );
});