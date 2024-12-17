import { boltApp } from '../../config/boltApp';
import { SlackShortcut, MessageShortcut } from '@slack/bolt';

boltApp.shortcut('b-bot_message', async ({ ack, client, shortcut }: { ack: () => void, client: any, shortcut: SlackShortcut }) => {
    await ack();

    // shortcut이 message_action 타입인지 확인
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

    // 메시지 단축키 실행 시 모달 표시
    await client.views.open({
        trigger_id: shortcut.trigger_id,
        view: {
            type: 'modal',
            callback_id: 'bbot_input_modal',
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