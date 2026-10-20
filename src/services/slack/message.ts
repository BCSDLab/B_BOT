import type { MessageSetting } from "./type";

import ICEBRAKING_QUESTIONS from "@/constant/ICEBRAKING_QUESTIONS.json";
import CHANNEL_ID from "@/constant/CHANNEL_ID.json";
import BASE_URL from "@/constant/BASE_URL.json";
import { messages as googleMeetMessages } from "./domain/googleMeet";
import { messages as lectureMessages } from "./domain/lecture";
import { messages as coopMessages } from "./domain/coop";
import { messages as busMessages } from "./domain/bus";
import { answerStream, logQuery } from "~/services/rag";
import { errorMessage } from "~/utils/errorMessage";
import { sendSlackBlock, sendSlackText } from "~/utils/slackFunction";


const USER_TEXT_REGEX = /<@([A-Z0-9]+)\|.+>/g;

export const messageFunctionList: MessageSetting[] = [
  {
    regex: /^!질문\s+/,
    async handler({ client, channel, ts, text, user }) {
      const question = text.replace(/^!질문\s+/, "").trim();
      if (!question) return;
      const placeholder = await client.chat.postMessage({
        channel,
        thread_ts: ts,
        text: "🔍 문서를 찾아보는 중이에요…",
      });
      const msgTs = placeholder.ts as string;
      let lastUpdate = 0;
      const startedAt = Date.now();
      try {
        const { text: body, sources } = await answerStream(question, (partial) => {
          const now = Date.now();
          if (!partial || now - lastUpdate < 1500) return; // 슬랙 rate limit 고려(~1.5s)
          lastUpdate = now;
          client.chat.update({ channel, ts: msgTs, text: partial + " ▍" }).catch(() => {});
        });
        const sourceText = sources.length
          ? "\n\n📎 출처:\n" +
            sources
              .map((s) => `• ${s.source_url.startsWith("http") ? `<${s.source_url}|${s.title}>` : s.title}`)
              .join("\n")
          : "";
        await client.chat.update({ channel, ts: msgTs, text: `${body}${sourceText}` });
        await logQuery({
          channel, msgTs, user, question, answer: body,
          found: sources.length > 0,
          sourceUrls: sources.map((s) => s.source_url),
          latencyMs: Date.now() - startedAt,
        });
        // 한 번 탭으로 피드백하도록 봇이 👍👎 선제공(reaction_added로 만족도 집계)
        await client.reactions.add({ channel, timestamp: msgTs, name: "+1" }).catch(() => {});
        await client.reactions.add({ channel, timestamp: msgTs, name: "-1" }).catch(() => {});
      } catch (error) {
        await client.chat.update({
          channel,
          ts: msgTs,
          text: `검색 중 오류가 발생했어요: ${errorMessage(error, "알 수 없는 오류")}`,
        });
        await logQuery({
          channel, msgTs, user, question, answer: "",
          found: false, sourceUrls: [], latencyMs: Date.now() - startedAt,
        });
      }
    },
  },
  {
    regex: /^!회칙/,
    async handler({
      client,
      channel,
      ts,
    }) {
      await sendSlackBlock({
        client,
        channel,
        threadTs: ts,
        blocks: [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "BCSD Lab 회칙 입니다."
            },
            "accessory": {
              "type": "button",
              "text": {
                "type": "plain_text",
                "text": "바로가기",
                "emoji": true
              },
              "value": "click_link",
              "url": `${import.meta.env.APP_BASE_URL}rule_2024.pdf`,
              "action_id": "button-action"
            }
          }
        ],
      })
    }
  },
  {
    regex: /^!가위바위보/,
    async handler({
      client,
      channel,
      ts,
    }) {
      const 가위바위보 = ['가위', '바위', '보'];
      const randomIndex = Math.floor(Math.random() * 가위바위보.length);
      const randomValue = 가위바위보[randomIndex];

      await sendSlackText({
        client,
        channel,
        threadTs: ts,
        text: `${randomValue}!`,
      })
    },
  },
  {
    regex: /^!주사위/,
    async handler({
      client,
      channel,
      ts,
    }) {
      const 주사위 = Math.floor(Math.random() * 6) + 1;

      await sendSlackText({
        client,
        channel,
        threadTs: ts,
        text: `주사위 결과: ${주사위}`,
      })
    },
  },
  {
    regex: /^!점메추/,
    async handler({
      client,
      channel,
      ts,
      user,
    }) {
      const shopsResponse = await $fetch<{ shops: Shop[] }>(
        "/shops",
        {
          baseURL: BASE_URL.KOREATECH_BASE_URL,
        }
      );
      const shopList = shopsResponse.shops.map(shop => shop.name);
      const randomIndex = Math.floor(Math.random() * shopList.length);
      let recommend = `${shopList[randomIndex]} 어떠세요?`;

      if (shopList[randomIndex].includes('콜밴') || shopList[randomIndex].includes('콜벤'))
        recommend = '오늘은 굶으세요.'

      await sendSlackText({
        client,
        channel,
        threadTs: ts,
        text: `<@${user}>님, ${recommend}`,
      });
    }
  },
  {
    regex: /(!축하|축하!)/,
    async handler({
      client,
      channel,
      ts,
      text
    }) {
      if (USER_TEXT_REGEX.test(text)) {
        const match = text.matchAll(USER_TEXT_REGEX);
        const userId = Array.from(match, (matchResult) => `<@${matchResult[1]}>`);
        await sendSlackText({
          client,
          channel,
          threadTs: ts,
          text: `:tada::tada::tada ${userId.join(' ')}, 축하합니다! :tada::tada::tada:`,
        });
        return;
      }
      await sendSlackText({
        client,
        channel,
        threadTs: ts,
        text: `:tada::tada::tada::tada::tada::tada::tada:`,
      });
      return;
    },
  },
  {
    regex: /(!룰렛|룰렛!)/,
    async handler({
      client,
      channel,
      ts,
      user: userId
    }) {
      const emojis = [
        ':one:', ':two:', ':three:', ':four:', ':five:', ':six:', ':seven:', ':eight:', ':nine:', ':zero:'
      ];
      const selectedEmojis = Array.from({ length: 3 }, () => emojis[Math.floor(Math.random() * emojis.length)]);
      const emojiText = selectedEmojis.join('');

      const storage = useStorage('kvStorage');
      const key = `roulette_${(new Date()).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }).replaceAll('. ', '-')}`;
      const attemptCounts = await storage.getItem<Record<string, number>>(`roullet-${key}`);
      attemptCounts[userId] = (attemptCounts[userId] || 0) + 1;

      if (attemptCounts[userId] > 3) {
        await sendSlackText({
          client,
          channel: channel,
          text: `<@${userId}>님의 비공식 결과 ${emojiText} 오늘 시도 횟수 : ${attemptCounts[userId]}회`,
          threadTs: ts,
        });
        return;
      }

      if (emojiText === ':seven::seven::seven:') {
        await sendSlackText({
          client,
          channel: channel,
          text: `:slot_machine: :tada::tada::tada: 축하합니다! ${emojiText} 당첨입니다! :tada::tada::tada: :slot_machine:`,
          threadTs: ts,
        });
        await sendSlackText({
          client,
          channel: CHANNEL_ID.채팅방,
          text: `:tada::tada::tada: <@${userId}>님이 <#${channel}>에서 오늘 ${attemptCounts[userId]}번 시도만에 :seven::seven::seven:을 뽑으셨습니다! 축하해주세요!!!:tada::tada::tada:`,
        });

      } else {
        await sendSlackText({
          client,
          channel: channel,
          text: `<@${userId}>님의 결과 ${emojiText} :meow_sad-rain:
      오늘 남은 시도 횟수 : ${3 - attemptCounts[userId]}회`,
          threadTs: ts,
        });
      }
    }
  },
  {
    regex: /!아이스브레이킹/,
    async handler({
      client,
      channel,
      ts,
    }) {
      const randomIndex = Math.floor(Math.random() * ICEBRAKING_QUESTIONS.length);
      const 아이스브레이킹주제 = ICEBRAKING_QUESTIONS[randomIndex];

      await sendSlackText({
        client,
        channel: channel,
        threadTs: ts,
        text: `${아이스브레이킹주제}`,
      })
    }
  },
  {
    regex: /!추첨/,
    async handler({
      client,
      channel,
      ts,
    }) {

      const threadInfo = await client.conversations.replies({
        channel,
        ts,
      });

      if (!threadInfo.ok) {
        await sendSlackText({
          client,
          channel,
          threadTs: ts,
          text: `추첨 대상이 없습니다 :cry:`,
        })
      }
      const participants = threadInfo.messages![0].reactions?.find(reaction => reaction.name === 'hand')?.users;
      if (participants == null) {
        await client.chat.postMessage({
          channel: channel,
          text: `추첨 대상이 없습니다 :cry:`,
          thread_ts: ts,
        });
        return;
      }

      const randomIndex = Math.floor(Math.random() * participants.length);
      const winner = participants[randomIndex];

      await sendSlackText({
        client,
        channel: channel,
        text: `:hand: 이모지를 단 인원 ${participants.length}명 중 한명을 추첨한 결과를 발표합니다!\n<@${winner}>님, 선정되셨습니다! 축하합니다! :tada:`,
        threadTs: ts,
      });
    }
  },
  {
    regex: /(!상태창|상태창!)/,
    async handler({
      client,
      channel,
      ts,
    }) {
      await sendSlackText({
        client,
        channel,
        text: '상태창은 돌아올 예정이에요!',
        threadTs: ts,
      })
      // TODO: 상태창(일주일 활동 기록) 복구. 이전 구현은 git 기록 참고.
    }
  },
  ...googleMeetMessages,
  ...lectureMessages,
  ...coopMessages,
  ...busMessages,
];

interface Shop {
  name: string;
  [key: string]: string;
}
