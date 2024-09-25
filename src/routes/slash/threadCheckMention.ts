import { boltApp } from '../../config/boltApp';
import { SlackShortcut, MessageShortcut } from '@slack/bolt';


// 쓰레드에서 멘션된 사람 중, 이모지를 달지 않은 사람을 멘션하는 기능
boltApp.shortcut('thread_check_mention', async ({ ack, client, shortcut }: { ack: () => void, client: any, shortcut: SlackShortcut }) => {
    try {
        await ack();
        if (shortcut.type !== 'message_action') return;

        const messageShortcut = shortcut as MessageShortcut;
        const { channel, message, user } = messageShortcut;

        if (!message || !channel || !user) {
            await client.chat.postMessage({
                channel: channel.id,
                text: '메시지 정보를 찾을 수 없습니다.',
            });
            return;
        }

        const { ts } = message;
        const triggeringUserId = user.id;

        const result = await client.conversations.replies({
            channel: channel.id,
            ts: ts,
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
    
          await client.chat.postMessage({
              channel: channel.id,
              text: `${mentionText} 메시지 확인 후 이모지를 남겨주세요 :dancing_toad:`,
              thread_ts: ts,
            });
        } else {
            await client.chat.postMessage({
                channel: channel.id,
                text: '모든 멤버가 메시지를 확인했습니다. :blob_excited:',
                thread_ts: ts,
            });
        }
    } catch (error: any) {
        console.error(error);
        const messageShortcut = shortcut as MessageShortcut;
        await client.chat.postMessage({
            channel: messageShortcut.channel.id,
            text: `에러 발생: ${error.message}`,
            thread_ts: messageShortcut.message.ts,
        });
    }
});
