import express from 'express';
import {boltApp} from '../../config/boltApp';
import {makeEvent} from '../../config/makeEvent';
import {getPRThreadInfo} from '../../api/internal';
import {getKoinShops} from '../../api/koin';
import {아이스브레이킹} from '../../const/comment';
import {ThreadBroadcastMessageEvent} from "@slack/bolt";
import fs from "fs";

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

boltApp.message('!회칙', async ({event, message, body}) => {
    const filePath = '/home/ubuntu/rule.pdf';
    const fileContent = fs.readFileSync(filePath);

    await boltApp.client.files.upload({
        channels: event.channel,
        initial_comment: 'BCSD Lab 회칙',
        file: fileContent,
        filename: 'BCSD Lab 회칙 ver.2024',
        filetype: 'pdf',
    });
});

boltApp.message('!가위바위보', async ({event}) => {
    const 가위바위보 = ['가위', '바위', '보'];
    const randomIndex = Math.floor(Math.random() * 가위바위보.length);
    const randomValue = 가위바위보[randomIndex];

    await boltApp.client.chat.postMessage({
        channel: event.channel,
        text: randomValue + '!',
        thread_ts: event.ts,
    });
});

boltApp.message('!주사위', async ({event}) => {
    const 주사위 = Math.floor(Math.random() * 6) + 1;

    await boltApp.client.chat.postMessage({
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
        await boltApp.client.chat.postMessage({
            channel: event.channel,
            text: recommend,
            thread_ts: event.ts,
        });
    } catch (error) {
        await boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `점심 메뉴 추천을 가져오는 중 오류가 발생했습니다.`,
            thread_ts: event.ts,
        });
    }
});

boltApp.message('!축하', async ({event}) => {
    try {
        await boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `:tada::tada::tada::tada::tada::tada::tada:`,
            thread_ts: event.ts,
        });
    } catch (error) {
        await boltApp.client.chat.postMessage({
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

        await boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `${아이스브레이킹주제}`,
        })
    } catch (error) {
        await boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `갑분싸....`,
            thread_ts: event.ts,
        });
    }
});

boltApp.message('!추첨', async ({event, message}) => {
    try {
        const threadInfo = await boltApp.client.conversations.replies({
            channel: event.channel,
            ts: (message as ThreadBroadcastMessageEvent).thread_ts ?? event.ts,
        });

        if (threadInfo.ok) {
            const participants = threadInfo.messages![0].reactions?.find(reaction => reaction.name === 'hand')?.users;
            if (participants == null) {
                await boltApp.client.chat.postMessage({
                    channel: event.channel,
                    text: `추첨 대상이 없습니다 :cry:`,
                    thread_ts: event.ts,
                });
                return;
            }

            const randomIndex = Math.floor(Math.random() * participants.length);
            const winner = participants[randomIndex];

            await boltApp.client.chat.postMessage({
                channel: event.channel,
                text: `:hand: 이모지를 단 인원 ${participants.length}명 중 한명을 추첨한 결과를 발표합니다!\n<@${winner}>님, 선정되셨습니다! 축하합니다! :tada:`,
                thread_ts: event.ts,
            });
            return;
        }
        await boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `추첨 대상이 없습니다 :cry:`,
            thread_ts: event.ts,
        });

    } catch (error) {
        await boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `추첨을 진행하는 중 오류가 발생했습니다.`,
            thread_ts: event.ts,
        });
    }
});

//멘션 반응확인
boltApp.message('@', async ({event, message}) => {
    try {
        await boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `멘션찾기`,
            thread_ts: event.ts,
        })
        const threadInfo = await boltApp.client.conversations.replies({
            channel: event.channel,
            ts: (message as ThreadBroadcastMessageEvent).thread_ts ?? event.ts,
        });

        if (threadInfo.ok) {
            const participants = threadInfo.messages![0];
            if (participants == null) {
                await boltApp.client.chat.postMessage({
                    channel: event.channel,
                    text: `${participants}`,
                    thread_ts: event.ts,
                });
                return;
            }
            return;
        }

    } catch (error) {
        await boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `멘션을 찾는 중 에러 발생`,
            thread_ts: event.ts,
        });
    }
});
export default eventRouter;
