import dotenv from 'dotenv';
import {App} from '@slack/bolt'
import express from 'express';
import {LogLevel} from "@slack/web-api";

dotenv.config();  // Load environment variables from .env file

export const expressApp = express();

// Bolt 앱 생성
export const boltApp = new App({
    token: import.meta.SLACK_BOT_TOKEN!,
    signingSecret: import.meta.SLACK_BOT_SIGNING_SECRET!,
    appToken: import.meta.SLACK_APP_TOKEN!,
    socketMode: true,
    developerMode: true,
    logLevel: LogLevel.INFO,
});
