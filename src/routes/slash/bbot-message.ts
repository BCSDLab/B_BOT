import { boltApp } from '../../config/boltApp';
import { MessageShortcut } from '@slack/bolt';

boltApp.shortcut('b-bot_message', async ({ ack, client, shortcut }) => {
    await ack();

    if (shortcut.type !== 'message_action') return;
    const messageShortcut = shortcut as MessageShortcut;
    const { channel, message, user } = messageShortcut;

    if (!message || !channel || !user) {
        await client.chat.postMessage({
            channel: channel?.id || 'C08689S918Q',
            text: '메시지 정보를 찾을 수 없습니다.',
        });
        return;
    }

    const rootTs = message.thread_ts || message.ts;

    await client.views.open({
        trigger_id: shortcut.trigger_id,
        view: {
            type: 'modal',
            callback_id: 'bbot_input_modal',
            private_metadata: JSON.stringify({
                channel: channel.id,
                thread_ts: rootTs,
                user_id: user.id
            }),
            title: {
                type: 'plain_text',
                text: '삐봇 메시지 입력'
            },
            submit: {
                type: 'plain_text',
                text: '확인'
            },
            blocks: [
                {
                    type: 'input',
                    block_id: 'bbot_message_block',
                    element: {
                        type: 'plain_text_input',
                        action_id: 'bbot_message_input',
                        placeholder: {
                            type: 'plain_text',
                            text: '삐봇이 전달할 메시지를 입력하세요'
                        }
                    },
                    label: {
                        type: 'plain_text',
                        text: '메시지'
                    }
                }
            ]
        }
    });
});

boltApp.view('bbot_input_modal', async ({ ack, body, client, view }) => {
    await ack();

    const metadata = JSON.parse(view.private_metadata);
    const channelId = metadata.channel;
    const threadTs = metadata.thread_ts;
    const userId = metadata.user_id;

    const userInput = view.state.values['bbot_message_block']['bbot_message_input'].value || '';

    try {
        await client.chat.postMessage({
            channel: channelId,
            text: userInput,
            thread_ts: threadTs
        });

        await client.chat.postMessage({
            channel: 'C08689S918Q',
            text: `<@${userId}>님의 삐봇 메시지!\n${userInput}`
        });

    } catch (error: any) {
        console.error(error);
        await client.chat.postMessage({
            channel: channelId,
            text: `메시지 전송 중 에러 발생: ${error.message}`,
            thread_ts: threadTs
        });
    }
});
