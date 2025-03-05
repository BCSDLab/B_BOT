import express from 'express';
import eventRouter from './old_route/event';
import dotenv from 'dotenv';
import lectureNoticeRouter from './old_route/slash/lecture-notice';
import slashTestRouter from './old_route/slash/test';
import slashMention from './old_route/slash/slashMention'
import {boltApp, expressApp} from './config_old/boltApp';
import frontendReviewMentionRouter from './old_route/api/review-request/frontend';
import meetingRouter from './old_route/slash/google-meet';
import frontendPRMergedRouter from './old_route/api/pr-merged/frontend';
import frontendUpdatePackageRouter from './old_route/api/update-package/frontend';
import frontendErrorNoticeRouter from './old_route/api/error-notice/frontend';
import backendReviewMentionRouter from "./old_route/api/review-request/backend";
import backendPRMergedRouter from "./old_route/api/pr-merged/backend";
import './old_route/slash/threadCheckMention';
import './old_route/slash/bbot-message';

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

/*
** 백엔드 미사용으로 인한 주석 **
expressApp.use('/api/review-request/backend', backendReviewMentionRouter);
expressApp.use('/api/pr-merged/backend', backendPRMergedRouter);
*/

// 서버 시작
const port = import.meta.PORT || 3000;

expressApp.listen(port, () => {
});
