// eventRouter.js
import express from 'express';
import { boltApp } from '../../config/boltApp';

const eventRouter = express.Router();

eventRouter.get('/', (req, res) => {
  console.log(process.env.SLACK_BOT_SIGNING_SECRET)
  res.send({
    message: 'Hello, World!',
    tokens: {
      signingSecret: process.env.SLACK_BOT_SIGNING_SECRET,
      botToken: process.env.SLACK_BOT_TOKEN
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
  // boltApp.processEvent(req.body);
});

// 이벤트 핸들러 등록
// boltApp.event('app_mention', async ({ event, say }) => {
//   await say(`Hello <@${event.user}>!`);
// });

export default eventRouter;
