import express from 'express';
import eventRouter from './routes/event';
import dotenv from 'dotenv';
import lectureNoticeRouter from './routes/slash/lecture-notice';
import slashTestRouter from './routes/slash/test';
import slashMention from './routes/slash/slashMention'
import { boltApp, expressApp } from './config/boltApp';
import frontendReviewMenotionRouter from './routes/api/review-request/frontend';
import meetingRouter from './routes/slash/google-meet';

dotenv.config();  // Load environment variables from .env file 
// Express 앱 생성

boltApp.start();

expressApp.use('/slash/test', slashTestRouter);

expressApp.use(express.json())
expressApp.use('/event', eventRouter);
expressApp.use('/slash/google-meet', meetingRouter);
expressApp.use('/slash/lecture-notice', lectureNoticeRouter);
expressApp.use('/slash/test', slashTestRouter);
expressApp.use('/slash/slash-mention', slashMention);
expressApp.use('/api/review-request/frontend', frontendReviewMenotionRouter);

// 서버 시작
const port = process.env.PORT || 3000;

expressApp.listen(port, () => {});