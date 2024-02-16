import express from 'express';
import dotenv from 'dotenv'; 
import { App, ExpressReceiver } from '@slack/bolt'

dotenv.config();  // Load environment variables from .env file 

// Bolt 연결용 ExpressReceiver 생성
const expressReceiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_BOT_SIGNING_SECRET!,
  processBeforeResponse: true,
});

// Bolt 앱 생성
export const boltApp = new App({
  token: process.env.SLACK_BOT_TOKEN!,
  receiver: expressReceiver,
});