// eventRouter.js
import express from 'express';
import { boltApp } from '../../config/boltApp';

const eventRouter = express.Router();

// 응답 확인용
eventRouter.get('/', (req, res) => {
  res.send({
    message: 'Hello, World!',
    token: {
      bot: process.env.SLACK_BOT_TOKEN,
      signing: process.env.SLACK_BOT_SIGNING_SECRET,
    }
  });
});

// 이벤트 구독
eventRouter.post('/', (req, res) => {
  // 이벤트 구독 확인 요청인 경우
  if(req.body.challenge && req.body.type === "url_verification") {
    return res.send({ challenge: req.body.challenge});
  }
  
  // 요청 본문에서 이벤트 추출 및 처리
  boltApp.processEvent(req.body);
});

// 이벤트 핸들러 등록
boltApp.event('app_mention', async ({ event, say }) => {
  await say(`안녕하세요 <@${event.user}>!`);
});

export default eventRouter;
