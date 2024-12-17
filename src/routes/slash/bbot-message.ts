import { boltApp } from '../../config/boltApp';
import { SlackShortcut, MessageShortcut } from '@slack/bolt';

boltApp.shortcut('b-bot_message', async ({ ack, client, shortcut }) => {
  await ack(); // 단축키 수신 확인

  // 메시지 단축키 정보 확인
  // shortcut은 message_action 타입일 경우 message, channel 정보 포함
  if (shortcut.type === 'message_action') {
      const { channel, message, user } = shortcut;

      // 여기서 모달을 띄움
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
  }
});

