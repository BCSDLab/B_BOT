// eventRouter.js
import express from 'express';
import { boltApp } from '../../config/boltApp';
import { makeEvent } from '../../config/makeEvent';

const eventRouter = express.Router();

// 응답 확인용
eventRouter.get('/', (req, res) => {
  res.send({
    message: 'Hello, World!',
  });
});

// 이벤트 구독
eventRouter.post('/', (req, res) => {
  // 이벤트 구독 확인 요청인 경우
  if(req.body.challenge && req.body.type === "url_verification") {
    return res.send({ challenge: req.body.challenge});
  }
  const event = makeEvent(req, res);
  
  boltApp.processEvent(event);
});

// 이벤트 핸들러 등록
boltApp.event('app_mention', async ({ event, say }) => {
  await say(`Hello, <@${event.user}>!`);
});

boltApp.message('!회칙', async ({ event, message, body }) => {
  await boltApp.client.chat.postMessage({
    channel: event.channel,
    text: '회칙은 말이죠... 여기여기 주소로... ',
  });
});

export default eventRouter;
