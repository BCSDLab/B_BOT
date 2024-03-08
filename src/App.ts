import express from 'express';
import eventRouter from './routes/event';
import dotenv from 'dotenv';
import lectureNoticeRouter from './routes/slash/lecture-notice';

dotenv.config();  // Load environment variables from .env file 
// Express 앱 생성
const expressApp = express();
expressApp.use(express.json())
expressApp.use('/event', eventRouter);
expressApp.use('/slash/lecture-notice', lectureNoticeRouter);

// 서버 시작
const port = process.env.PORT || 3000;

expressApp.listen(port, () => {});