import dotenv from 'dotenv';
import {App} from '@slack/bolt'
import express from 'express';

dotenv.config();  // Load environment variables from .env file 

export const expressApp = express();

// Bolt 앱 생성
export const boltApp = new App({
    token: process.env.SLACK_BOT_TOKEN!,
    signingSecret: process.env.SLACK_BOT_SIGNING_SECRET!,
    appToken: process.env.SLACK_APP_TOKEN!,
    socketMode: true,
    developerMode: true,
});