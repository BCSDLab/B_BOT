import pkg from '@slack/bolt';
const { App } = pkg;

export const app = new App({
  signingSecret: process.env.SLACK_BOT_SIGNING_SECRET,
  token: process.env.SLACK_BOT_TOKEN,
});

