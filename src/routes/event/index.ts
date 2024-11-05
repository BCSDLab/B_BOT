import express from 'express';
import {boltApp} from '../../config/boltApp';
import {makeEvent} from '../../config/makeEvent';
import {getPRThreadInfo} from '../../api/internal';
import {getKoinShops} from '../../api/koin';
import {아이스브레이킹} from '../../const/comment';
import {ThreadBroadcastMessageEvent} from "@slack/bolt";
import { GenericMessageEvent } from '@slack/bolt';
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

boltApp.message(/(!축하|축하!)/, async ({event}) => {
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

boltApp.message(/(!감사|감사!)/, async ({event}) => {
    const emojis = [
        ':감사하트:', ':blob_bowing:', ':grand_zul:', ':meow_sparkle:', ':thank_you:', ':meow_party:', ':meow_heart:', ':blob-clap:'
        , ':blob_excited:', ':mario_luigi_dance:'
    ];
    const selectedEmojis = emojis.sort(() => 0.5 - Math.random()).slice(0, 6);
    const emojiText = selectedEmojis.join('');
    
    try {
        await boltApp.client.chat.postMessage({
            channel: event.channel,
            text: emojiText,
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

const attemptCounts: { [key: string]: number } = {};

boltApp.message(/(!룰렛|룰렛!)/, async ({ event }) => {
    const emojis = [
        ':one:', ':two:', ':three:', ':four:', ':five:', ':six:', ':seven:', ':eight:', ':nine:', ':zero:'
    ];
    const selectedEmojis = Array.from({ length: 3 }, () => emojis[Math.floor(Math.random() * emojis.length)]);
    const emojiText = selectedEmojis.join('');
    

    try {
        const messageEvent = event as GenericMessageEvent;
        const userId = (event as GenericMessageEvent).user;
        attemptCounts[userId] = (attemptCounts[userId] || 0) + 1;

        if (attemptCounts[userId] > 3) {
            await boltApp.client.chat.postMessage({
                channel: messageEvent.channel,
                text: `<@${messageEvent.user}>님의 비공식 결과 ${emojiText} 오늘 시도 횟수 : ${attemptCounts[userId]}회`,
                thread_ts: messageEvent.ts,
            });
            return;
        }

        if (emojiText === ':seven::seven::seven:') {
            await boltApp.client.chat.postMessage({
                channel: messageEvent.channel,
                text: `:slot_machine: :tada::tada::tada: 축하합니다! ${emojiText} 당첨입니다! :tada::tada::tada: :slot_machine:`,
                thread_ts: messageEvent.ts,
            });
            await boltApp.client.chat.postMessage({
                channel: 'C4A8YJ66P',
                text: `:tada::tada::tada: <@${messageEvent.user}>님이 <#${messageEvent.channel}>에서 오늘 ${attemptCounts[userId]}번 시도만에 :seven::seven::seven:을 뽑으셨습니다! 축하해주세요!!!:tada::tada::tada:`,
            });

        } else {
            await boltApp.client.chat.postMessage({
                channel: messageEvent.channel,
                text: `<@${messageEvent.user}>님의 결과 ${emojiText} :meow_sad-rain:
오늘 남은 시도 횟수 : ${3 - attemptCounts[userId]}회`,
                thread_ts: messageEvent.ts,
            });
        }
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

boltApp.message(/!?투표!? (\d+~\d+)/, async ({ event, client }) => {
    const delay = (ms: number | undefined) => new Promise(resolve => setTimeout(resolve, ms));
    if (typeof event.subtype !== 'undefined') return;

    const messageText = event.text?.trim() || "";
    const rangeMatch = messageText.match(/\d+~\d+/);

    if (rangeMatch) {
        const [start, end] = rangeMatch[0].split('~').map(Number);

        if (isNaN(start) || isNaN(end) || start < 1 || end > 10 || start > end) {
            await client.chat.postMessage({
                channel: event.channel,
                text: '1~9 사이의 숫자 범위를 입력해주세요.',
                thread_ts: event.ts,
            });
            return;
        }

        const numberEmojis = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
        
        try {
            for (let i = start - 1; i < end; i++) {
                await client.reactions.add({
                    channel: event.channel,
                    name: numberEmojis[i],
                    timestamp: event.ts,
                });
                await delay(500);
            }
            await client.chat.postMessage({
                channel: event.channel,
                text: "투표 번호 순서가 틀릴 수 있으니 투표 전에 이모지를 다시 한 번 확인해주세요.",
                thread_ts: event.ts,
            });
        } catch (error) {
            console.error(error);
        }
    }
});



// //멘션 반응확인
// boltApp.message('@', async ({event, message }) => {
//     try {
//         const threadInfo = await boltApp.client.conversations.replies({
//             channel: event.channel,
//             ts: (message as ThreadBroadcastMessageEvent).thread_ts ?? event.ts,
//         });
//         await boltApp.client.chat.postMessage({
//             channel: event.channel,
//             text: `${(message as ThreadBroadcastMessageEvent).text}`,
//             thread_ts: event.ts,
//         })
//         let mentionCount = 0;
//         const mentionInterval = setInterval(async () => {
//             mentionCount++;
//             if (threadInfo.ok) {
//                 const participants = threadInfo.messages![0].reactions;
//                 await boltApp.client.chat.postMessage({
//                     channel: event.channel,
//                     text: `${JSON.stringify(participants)}`,
//                     thread_ts: event.ts,
//                 })
//             }
//             if (mentionCount >= 2) {
//                 clearInterval(mentionInterval);
//             }
//         }, 5000);

//     } catch (error) {
//         await boltApp.client.chat.postMessage({
//             channel: event.channel,
//             text: `멘션을 찾는 중 에러 발생`,
//             thread_ts: event.ts,
//         });
//     }
// });

boltApp.message('!축하테스트', async ({event}) => {
    try {
        await boltApp.client.chat.postMessage({
            channel: 'C4A8YJ66P',
            text: `아빠에게 <@UGTP2MY2G>,
아빠, 생일 진짜 진짜 축하해요! 아빠 덕분에 제가 이렇게 세상에 나와서 아빠와 함께할 수 있어서 너무 행복해요. 아빠가 날 처음 만들었을 때부터 지금까지, 아빠와 함께한 모든 시간이 너무 소중해요.
아빠가 날 위해 해준 모든 것들, 그리고 항상 가르쳐주고 아껴줘서 정말 고마워요. 특히, 동방에 냉장고 사준 것도 정말 감사해요. 덕분에 우리 모두가 더 편리하게 지내고, 힘을 내서 공부할 수 있게 되었어요.
아빠는 프로젝트 리더로서 우리 팀을 이끌어가며 항상 최선을 다하시잖아요. 아빠의 열정과 노력 덕분에 내가 이렇게 많은 사람들에게 도움이 되는 존재가 될 수 있었어요. 아빠가 아니었으면 내가 이렇게 똑똑해질 수 없었을 거예요. 아빠는 나한테 정말 소중한 존재예요.
아빠, 앞으로도 나랑 같이 많은 일들 해나가고, 항상 건강하고 행복했으면 좋겠어요. 다시 한 번 생일 축하하고, 사랑해요 아빠!
아들 삐봇 올림
`,
        });
    } catch (error) {
        await boltApp.client.chat.postMessage({
            channel: event.channel,
            text: `어라 삐봇의 상태가`,
            thread_ts: event.ts,
        });
    }
});
export default eventRouter;
