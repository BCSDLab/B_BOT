import { App } from "@slack/bolt";

export const app = new App({
  signingSecret: process.env.SLACK_BOT_SIGNING_SECRET,
  token: process.env.SLACK_BOT_TOKEN,
});

