import express from 'express';
import eventRouter from './routes/event';
import dotenv from 'dotenv';
import lectureNoticeRouter from './routes/slash/lecture-notice';
import slashTestRouter from './routes/slash/test';
import slashMention from './routes/slash/slashMention'
import {boltApp, expressApp} from './config/boltApp';
import frontendReviewMentionRouter from './routes/api/review-request/frontend';
import meetingRouter from './routes/slash/google-meet';
import frontendPRMergedRouter from './routes/api/pr-merged/frontend';
import frontendUpdatePackageRouter from './routes/api/update-package/frontend';
import frontendErrorNoticeRouter from './routes/api/error-notice/frontend';
import backendReviewMentionRouter from "./routes/api/review-request/backend";
import backendPRMergedRouter from "./routes/api/pr-merged/backend";

dotenv.config();  // Load environment variables from .env file
// Express 앱 생성

boltApp.start();

expressApp.use(express.json())
expressApp.use('/event', eventRouter);
expressApp.use('/slash/google-meet', meetingRouter);
expressApp.use('/slash/lecture-notice', lectureNoticeRouter);
expressApp.use('/slash/test', slashTestRouter);
expressApp.use('/slash/slash-mention', slashMention);
expressApp.use('/api/review-request/frontend', frontendReviewMentionRouter);
expressApp.use('/api/pr-merged/frontend', frontendPRMergedRouter);
expressApp.use('/api/update-package/frontend', frontendUpdatePackageRouter);
expressApp.use('/api/error-notice/frontend', frontendErrorNoticeRouter);

// TOOD: 중복 코드 줄이기
expressApp.use('/api/review-request/backend', backendReviewMentionRouter);
expressApp.use('/api/pr-merged/backend', backendPRMergedRouter);

// 서버 시작
const port = process.env.PORT || 3000;

expressApp.listen(port, () => {
});
