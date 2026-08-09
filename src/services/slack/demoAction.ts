import type { BlockActionSetting } from "./type";

/** `!버튼테스트` 데모. 실제 업무 흐름과는 무관하다. */
export const demoActions: BlockActionSetting[] = [
  {
    // !버튼테스트 데모. 승인 → 진행 상황 갱신 → 완료 순으로 메시지를 덮어쓴다.
    actionId: "demo_button:approve",
    async handler({ client, body, action }) {
      if (action.type !== "button" || !body.channel) return;

      const { requesterId } = JSON.parse(action.value ?? "{}");
      const channel = body.channel.id;
      const ts = body.message?.ts;

      // 누른 직후 아무 반응이 없으면 사람들이 버튼을 또 누른다. 먼저 갱신부터 한다.
      await updateSlack({
        client,
        channel,
        ts,
        text: "처리 중",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:hourglass_flowing_sand: *처리 중...*\n작업자: <@${body.user.id}>`,
            },
          },
        ],
      });

      // 실제 작업 자리. 데모라 지연만 준다.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      await updateSlack({
        client,
        channel,
        ts,
        text: "처리 완료",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:white_check_mark: *처리 완료*\n작업자: <@${body.user.id}>`,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `요청: <@${requesterId}> · 버튼 핸들러 동작 확인용 데모입니다.`,
              },
            ],
          },
        ],
      });
    },
  },
  {
    actionId: "demo_button:reject",
    async handler({ client, body, action }) {
      if (action.type !== "button" || !body.channel) return;

      await updateSlack({
        client,
        channel: body.channel.id,
        ts: body.message?.ts,
        text: "취소됨",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:no_entry_sign: *취소했습니다.*\n<@${body.user.id}>`,
            },
          },
        ],
      });
    },
  },
];
