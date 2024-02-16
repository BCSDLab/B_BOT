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
    attachments: [{
      title: "BCSD Lab 회칙 ver.2024",
      title_link: 'https://bcsdlab.slack.com/files/UKVPYFYP4/F06HEH48TT5/bcsd_lab_________________2024.pdf'
    }],
  });
});

boltApp.message('@frontend', async ({ event, say, context }) => {
  try {
    // 사용자 목록 가져오기
    const usersList = await boltApp.client.users.list()!;
    
    // '@frontend'가 포함된 메시지의 스레드에 멘션할 사용자 목록 필터링
    const mentions = usersList.members!
      .filter(user => user.profile!.display_name && user.profile!.display_name.endsWith('_FrontEnd'))
      .filter(user => user.profile!.status_emoji !== '✨')
      .map(user => `<@${user.id}>`);
      
    // 멘션한 사용자가 존재하는 경우, 해당 메시지의 스레드에 멘션
    if (mentions.length > 0) {
      await boltApp.client.chat.postMessage({
        channel: event.channel,
        text: `프론트엔드 소집!\n${mentions.join(', ')}\n 메시지를 확인해주세요!`,
        thread_ts: event.ts, // 현재 메시지의 스레드 또는 메시지의 타임스탬프를 사용
      });
    }
  } catch (error) {
    boltApp.client.chat.postMessage({
      channel: event.channel,
      text: `에러가 발생했습니다: ${error}`,
    });
  }
});


export default eventRouter;
