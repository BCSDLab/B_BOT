import type { View } from "@slack/web-api";
import type { ShortcutSetting } from "./type";
import INTERACTION_MODAL from "@/constant/INTERACTION_MODAL.json";

export const shortcuts: ShortcutSetting[] = [
  {
    key: "b-bot_message",
    async handler({
      client,
      shortcut,
    }) {
      if (shortcut.type !== "message_action") return;
      const { channel, message, user } = shortcut;
      const rootTs = message.thread_ts || message.ts;
      await client.views.open({
        trigger_id: shortcut.trigger_id,
        view: {
          ...INTERACTION_MODAL.삐봇메세지.view as View,
          private_metadata: JSON.stringify({
            channel: channel.id,
            thread_ts: rootTs,
            user_id: user.id,
          }),
        }
      });
    }
  },
  {
    key: "thread_check_mention",
    async handler({
      client,
      shortcut,
    }) {
      if (shortcut.type !== "message_action") return;
      const { channel, message, user } = shortcut;
      const { ts, thread_ts } = message;
      const triggeringUserId = user.id;
      const rootTs = thread_ts || ts;
      // 스레드 전체의 대화 목록을 가져옴
      const result = await client.conversations.replies({
        channel: channel.id,
        ts: rootTs, // 전체 스레드 탐색
      });
      const mentionedMembers = new Set<string>();
      const reactedUsers = new Set<string>();
      const commentingUsers = new Set<string>();

      if (result.messages) {
        for (const msg of result.messages) {
          // 멘션된 멤버 수집
          const mentions = msg.text?.match(/<@([A-Z0-9]+)>/g);
          if (mentions) {
            mentions.forEach((mention: string) => {
              const userId = mention.replace(/[<@>]/g, ''); // <@USER_ID> 형태에서 USER_ID 추출
              mentionedMembers.add(userId);
            });
          }

          // 댓글을 작성한 사용자 수집
          if (msg.user) {
            commentingUsers.add(msg.user);
          }

          // 이모지를 단 사람 수집
          if (msg.reactions) {
            for (const reaction of msg.reactions) {
              reaction.users.forEach((user: string) => {
                reactedUsers.add(user);
              });
            }
          }
        }
      }

      // 이모지 또는 댓글을 달지 않은 멤버 필터링
      const nonReactedMembers = Array.from(mentionedMembers).filter(member =>
        !reactedUsers.has(member) && !commentingUsers.has(member) && member !== triggeringUserId
      );

      // 이모지를 달지 않은 멤버들을 다시 멘션
      if (nonReactedMembers.length > 0) {
        const mentionText = nonReactedMembers.map(user => `<@${user}>`).join(', ');

        await sendSlackText({
          client,
          channel: channel.id,
          text: `<@${user.name}>님의 리마인드!
메시지 확인 하셨나요? :meow_sad-rain: 
${mentionText}
메시지 확인 후 댓글이나 이모지를 남겨주세요 :dancing_toad:`,
          threadTs: rootTs,
        });
      } else {
        await sendSlackText({
          client,
          channel: channel.id,
          text: `<@${user.name}>님의 리마인드!
모든 멤버가 메시지를 확인했습니다. :blob_excited:`,
          threadTs: rootTs,
        });
      }
    }
  },
  {
    key: "group_mention",
    async handler({
      client,
      shortcut,
    }) {
      if (shortcut.type !== "message_action") return;
      const { channel, message, user } = shortcut;
      const { ts } = message;
      const rootTs = ts;
      await client.views.open({
        trigger_id: shortcut.trigger_id,
        view: {
          ...INTERACTION_MODAL.그룹멘션.view as View,
          private_metadata: JSON.stringify({
            channel_id: channel.id,
            thread_ts: rootTs,
            userId: user.id
          })
        },
      });
    }
  }
];