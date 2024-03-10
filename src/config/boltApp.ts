import dotenv from 'dotenv'; 
import { App, ExpressReceiver } from '@slack/bolt'
import express from 'express';

dotenv.config();  // Load environment variables from .env file 

export const expressApp = express();

// Bolt 연결용 ExpressReceiver 생성
const expressReceiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_BOT_SIGNING_SECRET!,
  clientSecret: process.env.SLACK_BOT_CLIENT_SECRET!,
  processBeforeResponse: true,
  app: expressApp,
});

// Bolt 앱 생성
export const boltApp = new App({
  token: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_BOT_SIGNING_SECRET!,
  receiver: expressReceiver,
});