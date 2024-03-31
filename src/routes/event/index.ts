// eventRouter.js
import express from 'express';
import { boltApp } from '../../config/boltApp';
import { makeEvent } from '../../config/makeEvent';
import { handleMessageEventError } from '../../utils/handleEventError';
import { getClientUserList } from '../../api/user';
import { MEMBER_TYPES_KOREAN, MEMBER_TYPES_LOWERCASE, TRACKS_KOREAN, TRACKS_LOWERCASE, TRACK_NAME_MAPPER, TRACK_NAME_KOREAN_MAPPER, MEMBER_TYPES_KOREAN_MAPPER} from '../../const/track';
import { match } from 'ts-pattern';
import { getPRThreadInfo } from '../../api/internal';

const eventRouter = express.Router();

// 응답 확인용
eventRouter.get('/', async (req, res) => {
  try {
    const data = await getPRThreadInfo({ pullRequestLink: 'https://github.com/BCSDLab/KOIN_WEB_RECODE/pull/122'});
    
    res.send({
      message: JSON.stringify(data.data),
    });
  } catch (error) {
    res.send({ message: JSON.stringify(error) });
  }
});

// 이벤트 구독
eventRouter.post('/', (req, res) => {
  // 이벤트 구독 확인 요청인 경우
  if (req.body.challenge && req.body.type === "url_verification") {
    return res.send({ challenge: req.body.challenge });
  }
  const event = makeEvent(req, res);

  boltApp.processEvent(event);
});
// ---------설정---------

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

boltApp.message("!최원빈", async ({ event }) => {
  const userList = await getClientUserList();

  const 최원빈 = userList.members!.find(user => user.profile!.display_name?.startsWith("최원빈"));

  if (최원빈) {
    boltApp.client.chat.postMessage({
      channel: event.channel,
      text: `<@${최원빈.id}>님 확인해주세요!`,
      thread_ts: event.ts,
    });
  }

  else {
    boltApp.client.chat.postMessage({
      channel: event.channel,
      text: `최원빈님을 찾을 수 없습니다.`,
      thread_ts: event.ts,
    });
  }
});

boltApp.message('!슬랙봇그룹', async ({ event }) => {
  const userList = await getClientUserList();

  const slackBotGroup = userList.members!.filter(user =>
    user.profile!.display_name?.startsWith("최정훈") ||
    user.profile!.display_name?.startsWith("최원빈") ||
    user.profile!.display_name?.startsWith("김경윤") ||
    user.profile!.display_name?.startsWith("김도훈")
  );

  if (slackBotGroup) {
    const slackBotGroupMember = slackBotGroup.map(user => `<@${user.id}>`).join(', ');
    boltApp.client.chat.postMessage({
      channel: event.channel,
      text: `${slackBotGroupMember} 님 확인해주세요!`,
      thread_ts: event.ts,
    });
  } else {
    boltApp.client.chat.postMessage({
      channel: event.channel,
      text: `조건에 맞는 사용자를 찾을 수 없습니다.`,
      thread_ts: event.ts,
    });
  }
});

boltApp.message("!리팩토링그룹", async ({ event, message }) => {
  const userList = await getClientUserList();

  const refactoringUsers = userList.members!.filter(user => user.profile!.display_name?.startsWith('김대관') ||
    user.profile!.display_name?.startsWith('김혜준') || user.profile!.display_name?.startsWith('정민구') || user.profile!.display_name?.startsWith('채승윤')
  )

  if (refactoringUsers) {
    const refactorMembers = refactoringUsers.map(user => `<@${user.id}>`).join(', ');
    boltApp.client.chat.postMessage({
      channel: event.channel,
      text: `${refactorMembers} 여러분 확인해주세요!`,
      thread_ts: event.ts,
    });
  }
  else {
    boltApp.client.chat.postMessage({
      channel: event.channel,
      text: `해당하는 그룹 멤버를 찾을 수 없습니다.`,
      thread_ts: event.ts,
    });
  }
});

boltApp.message('!인포메이트S', async ({ event, message }) => {
  const 인포메이트S이름 = ["이해루", "김하나", "윤해진", "곽승주"];

  const userList = await getClientUserList();

  const 인포메이트S멘션 = 인포메이트S이름.reduce((acc, name) => {
    const user = userList.members!.find(user => user.profile!.display_name?.startsWith(name));

    if (user) {
      acc.push(`<@${user.id}>`);
    }

    return acc;
  }, [] as string[]);

  boltApp.client.chat.postMessage({
    channel: event.channel,
    text: `인포메이트S 멤버들 확인해주세요!\n${인포메이트S멘션.join(', ')}\n`,
    thread_ts: event.ts,
  });
});

boltApp.message('!인포메이트B', async ({ event }) => {
  const userList = await getClientUserList();

  const informateB = userList.members!.filter(user =>
    user.profile!.display_name?.startsWith("김소민") ||
    user.profile!.display_name?.startsWith("김대의") ||
    user.profile!.display_name?.startsWith("정해성") ||
    user.profile!.display_name?.startsWith("김민재")
  );

  if (informateB) {
    const informateBMembers = informateB.map(user => `<@${user.id}>`);
    boltApp.client.chat.postMessage({
      channel: event.channel,
      text: `인포메이트B 멤버들 확인해주세요!\n${informateBMembers.join(', ')}\n`,
      thread_ts: event.ts,
    });
  }
  else {
    boltApp.client.chat.postMessage({
      channel: event.channel,
      text: `인포메이트B 멤버들을 찾을 수 없습니다.`,
      thread_ts: event.ts,
    });
  }
})

boltApp.message('!멘션', async ({ event, message }) => {
  try {
    // 메시지 형태 -> !멘션 frontend.beginner
    if ('text' in message) {
      const mentionTarget = message.text!.split(' ')[1];

      let [track, memberType] = mentionTarget.split('.');

      if ( TRACKS_KOREAN.some(t => t === track) && MEMBER_TYPES_KOREAN.some(t => t === memberType)) {
        track = TRACK_NAME_KOREAN_MAPPER[track as keyof typeof TRACK_NAME_KOREAN_MAPPER];
        memberType = MEMBER_TYPES_KOREAN_MAPPER[memberType as keyof typeof MEMBER_TYPES_KOREAN_MAPPER];
      }

      if (
        (!track && !memberType) ||
        !TRACKS_LOWERCASE.some(t => t === track) ||
        !MEMBER_TYPES_LOWERCASE.some(t => t === memberType)
      ) {
        throw new Error('잘못된 멘션 형식입니다.');
      }
     
      // 사용자 목록 가져오기
      const usersList = await getClientUserList();

      const activeUsers = usersList.members!.filter(user => user.deleted === false && user.is_bot === false);

      // 이모지로 상태 표시한 사용자 필터링
      const memberTypeUsers = match(memberType)
        .with("beginner", () => activeUsers!.filter((user) => user.profile!.status_emoji !== ":green_apple:" && user.profile!.status_emoji !== ":sparkles:" && user.profile!.status_emoji !== ":apple:" && user.profile!.status_emoji !== ":tangerine:"))
        .with("regular", () => activeUsers!.filter((user) => user.profile!.status_emoji === ":green_apple:" || user.profile!.status_emoji === ":apple:" || user.profile!.status_emoji === ":tangerine:"))
        .with("mentor", () => activeUsers!.filter((user) => user.profile!.status_emoji === ":sparkles:"))
        .otherwise(() => {
          throw new Error("잘못된 멘션 형식입니다.");
        });

      const mentions = memberTypeUsers
        .filter(user => user.profile!.display_name && user.profile!.display_name.endsWith(TRACK_NAME_MAPPER[track as keyof typeof TRACK_NAME_MAPPER]))
        .map(user => `<@${user.id}>`);


      // 멘션한 사용자가 존재하는 경우, 해당 메시지의 스레드에 멘션
      if (mentions.length > 0) {
        await boltApp.client.chat.postMessage({
          channel: event.channel,
          text: `단체멘션! 해당하는 분들은 메시지를 확인해주세요.\n${mentions.join(', ')}\n`,
          thread_ts: event.ts, // 현재 메시지의 스레드 또는 메시지의 타임스탬프를 사용
        });
      }

      else {
        await boltApp.client.chat.postMessage({
          channel: event.channel,
          text: `해당하는 멘션 대상이 없습니다.`,
          thread_ts: event.ts,
        });
      }
    }
  } catch (error) {
    handleMessageEventError({ event, error });
  }
});


export default eventRouter;
