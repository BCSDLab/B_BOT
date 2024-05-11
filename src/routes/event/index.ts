// eventRouter.js
import express from 'express';
import {boltApp} from '../../config/boltApp';
import {makeEvent} from '../../config/makeEvent';
import {handleMessageEventError} from '../../utils/handleEventError';
import {
    MEMBER_TYPES_KOREAN,
    MEMBER_TYPES_KOREAN_MAPPER,
    MEMBER_TYPES_LOWERCASE,
    TRACK_NAME_KOREAN_MAPPER,
    TRACKS_KOREAN,
    TRACKS_LOWERCASE
} from '../../const/track';
import {getPRThreadInfo} from '../../api/internal';
import {getKoinShops} from '../../api/koin';
import {아이스브레이킹} from '../../const/comment';
import {BcsdMember, getAllMembers} from "../../utils/member";
import {KnownEventFromType, ThreadBroadcastMessageEvent} from "@slack/bolt";
import {MemberType} from "../../models/mention";


const eventRouter = express.Router();

// 응답 확인용
eventRouter.get('/', async (req, res) => {
    try {
        const data = await getPRThreadInfo({pullRequestLink: 'https://github.com/BCSDLab/KOIN_WEB_RECODE/pull/122'});

        res.send({
            message: JSON.stringify(data.data),
        });
    } catch (error) {
        res.send({message: JSON.stringify(error)});
    }
});

// 이벤트 구독
eventRouter.post('/', (req, res) => {
    // 이벤트 구독 확인 요청인 경우
    if (req.body.challenge && req.body.type === "url_verification") {
        return res.send({challenge: req.body.challenge});
    }
    const event = makeEvent(req, res);

    boltApp.processEvent(event);
});
// ---------설정---------

// 이벤트 핸들러 등록
boltApp.event('app_mention', async ({event, say}) => {
    await say(`Hello, <@${event.user}>!`);
});

// TODO: 90일 지나서 없어짐. 회칙 업데이트가 필요함
boltApp.message('!회칙', async ({event, message, body}) => {
    await boltApp.client.chat.postMessage({
        channel: event.channel,
        attachments: [{
            title: "BCSD Lab 회칙 ver.2024",
            title_link: 'https://bcsdlab.slack.com/files/UKVPYFYP4/F06HEH48TT5/bcsd_lab_________________2024.pdf'
        }],
    });
});

function sendMention(slackBotGroup: BcsdMember[], event: KnownEventFromType<"message">) {
    if (slackBotGroup) {
        const slackBotGroupMember = slackBotGroup.map(user => `<@${user.slack_id}>`).join(', ');
        boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `단체멘션! ${slackBotGroupMember} 님 확인해주세요!`,
            thread_ts: event.ts,
        });
    } else {
        boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `조건에 맞는 사용자를 찾을 수 없습니다.`,
            thread_ts: event.ts,
        });
    }
}

boltApp.message('!슬랙봇그룹', async ({event}) => {
    const members = await getAllMembers();
    const slackBotGroup = members.filter(member =>
        member.name === "최정훈" ||
        member.name === "최원빈" ||
        member.name === "김경윤" ||
        member.name === "김도훈"
    );
    sendMention(slackBotGroup, event);
});

boltApp.message("!리팩토링그룹", async ({event}) => {
    const members = await getAllMembers();
    const refactoringUsers = members.filter(member =>
        member.name === '김대관' ||
        member.name === '김혜준' ||
        member.name === '정민구' ||
        member.name === '채승윤'
    )
    sendMention(refactoringUsers, event);
});

boltApp.message('!인포메이트S', async ({event, message}) => {
    const members = await getAllMembers();
    const infoMateSMembers = members.filter(member =>
        member.name === '이해루' ||
        member.name === '김하나' ||
        member.name === '윤해진' ||
        member.name === '곽승주'
    )
    sendMention(infoMateSMembers, event);
});

boltApp.message('!인포메이트B', async ({event}) => {
    const members = await getAllMembers();
    const infoMateBMembers = members.filter(member =>
        member.name === '김소민' ||
        member.name === '김대의' ||
        member.name === '정해성' ||
        member.name === '김민재'
    )
    sendMention(infoMateBMembers, event)
})

boltApp.message('!멘션', async ({event, message}) => {
    try {
        // 메시지 형태 -> !멘션 frontend.beginner
        if ('text' in message) {
            const mentionTarget = message.text!.split(' ')[1];
            let [track, memberType] = mentionTarget.split('.');

            // 한글.한글 형태인 경우
            if (TRACKS_KOREAN.some(t => t === track) && MEMBER_TYPES_KOREAN.some(t => t === memberType)) {
                track = TRACK_NAME_KOREAN_MAPPER[track as keyof typeof TRACK_NAME_KOREAN_MAPPER];
                memberType = MEMBER_TYPES_KOREAN_MAPPER[memberType as keyof typeof MEMBER_TYPES_KOREAN_MAPPER] as MemberType;
            }

            if (
                (!track && !memberType) ||
                !TRACKS_LOWERCASE.some(t => t === track) ||
                !MEMBER_TYPES_LOWERCASE.some(t => t === memberType)
            ) {
                throw new Error('잘못된 멘션 형식입니다.');
            }
            let members = await getAllMembers();
            let filtered = members.filter((member) =>
                member.track_name === track ||
                member.member_type === memberType
            );
            sendMention(filtered, event)
        }
    } catch (error) {
        handleMessageEventError({event, error});
    }
});

boltApp.message('!가위바위보', async ({event}) => {
    const 가위바위보 = ['가위', '바위', '보'];
    const randomIndex = Math.floor(Math.random() * 가위바위보.length);
    const randomValue = 가위바위보[randomIndex];

    boltApp.client.chat.postMessage({
        channel: event.channel,
        text: randomValue + '!',
        thread_ts: event.ts,
    });
});

boltApp.message('!주사위', async ({event}) => {
    const 주사위 = Math.floor(Math.random() * 6) + 1;

    boltApp.client.chat.postMessage({
        channel: event.channel,
        text: `주사위 결과: ${주사위}`,
        thread_ts: event.ts,
    });
});

boltApp.message('!점메추', async ({event}) => {
    try {
        const shopList = (await getKoinShops()).data.shops.map(shop => shop.name);
        const randomIndex = Math.floor(Math.random() * shopList.length);
        let recommend = `${shopList[randomIndex]} 어떠세요?`;

        if (shopList[randomIndex].includes('콜밴') || shopList[randomIndex].includes('콜벤')) recommend = '오늘은 굶으세요.'
        boltApp.client.chat.postMessage({
            channel: event.channel,
            text: recommend,
            thread_ts: event.ts,
        });
    } catch (error) {
        boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `점심 메뉴 추천을 가져오는 중 오류가 발생했습니다.`,
            thread_ts: event.ts,
        });
    }
});


boltApp.message('!축하', async ({event}) => {
    try {
        boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `:tada::tada::tada::tada::tada::tada::tada:`,
            thread_ts: event.ts,
        });
    } catch (error) {
        boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `어라 삐봇의 상태가`,
            thread_ts: event.ts,
        });
    }
});

boltApp.message('!아이스브레이킹', async ({event}) => {
    try {
        const randomIndex = Math.floor(Math.random() * 아이스브레이킹.length);
        const 아이스브레이킹주제 = 아이스브레이킹[randomIndex];

        boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `${아이스브레이킹주제}`,
        })
    } catch (error) {
        boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `갑분싸....`,
            thread_ts: event.ts,
        });
    }
});

boltApp.message('!추첨', async ({ event, message }) => {
    try {
        const threadInfo = await boltApp.client.conversations.replies({
            channel: event.channel,
            ts: (message as ThreadBroadcastMessageEvent).thread_ts ?? event.ts,
        });

        if(threadInfo.ok === true){
            const participants = threadInfo.messages![0].reactions?.find(reaction => reaction.name === 'hand')?.users;
            if(participants == null) {
                boltApp.client.chat.postMessage({
                    channel: event.channel,
                    text: `추첨 대상이 없습니다 :cry:`,
                    thread_ts: event.ts,
                });  
                return;
            }

            const randomIndex = Math.floor(Math.random() * participants.length);
            const winner = participants[randomIndex];

            boltApp.client.chat.postMessage({
                channel: event.channel,
                text: `:hand: 이모지를 단 인원 ${participants.length}명 중 한명을 추첨한 결과를 발표합니다!\n<@${winner}>님, 선정되셨습니다! 축하합니다! :tada:`,
                thread_ts: event.ts,
            });
            return;
        }
        boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `추첨 대상이 없습니다 :cry:`,
            thread_ts: event.ts,
        });
        
    } catch (error) {
        boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `추첨을 진행하는 중 오류가 발생했습니다.`,
            thread_ts: event.ts,
        });
    }
});

export default eventRouter;
