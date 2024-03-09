import { boltApp } from '../../config/boltApp';

let threadChannelId='';
let threadTimestamp = '';

// command - '/'명령을 처리하기 위해 사용
// ack - 명령 수신확인 메서드, body - 수신한 데이터
boltApp.command('/강의공지', async ({ ack, body, client }) => {
  await ack();

  try {
    threadChannelId=body.channel_id;
    threadTimestamp=body.thread_ts || '';

    // 모달 열기
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'lecture_modal',
        title: {
          type: 'plain_text',
          text: '강의 공지',
        },
        blocks: [
          {
            type: 'input',
            block_id: 'location',
            label: {
              type: 'plain_text',
              text: '강의 장소는 어디인가요?',
            },
            element: {
              type: 'plain_text_input',
              action_id: 'location_input',
            },
          },
          {
            type: 'input',
            block_id: 'time',
            label: {
              type: 'plain_text',
              text: '강의 시간은 몇시인가요?',
            },
            element: {
              type: 'plain_text_input',
              action_id: 'time_input',
            },
          },    
          {
            type: 'input',
            block_id: 'checkbox_block',
            label: {
              type: 'plain_text',
              text: '온라인 진행 여부',
            },
            element: {
              type: 'checkboxes',
              action_id: 'checkbox_input',
              options: [
                {
                  text: {
                    type: 'plain_text',
                    text: '진행 여부',
                  },
                  value: 'option',
                },
              ],
            },
          },
        ],
        submit: {
          type: 'plain_text',
          text: 'Submit',
        },
      },
    });


  } catch (error) {
    // 
  }
});

boltApp.view('lecture_modal', async ({ ack, view, context, }) => {
  await ack();

  const location = view['state']['values']['location']['location_input']['value'];
  const time = view['state']['values']['time']['time_input']['value'];
  const online=view['state']['values']['checkbox_block']['checkbox_input']['value'];
  // 스레드에 멘션
  try {

    await boltApp.client.chat.postMessage({
      token: context.botToken,
      channel: threadChannelId,
      text: `새로운 강의 공지\n장소: ${location}\n시간: ${time} 온라인여부 ${online}`,
      thread_ts: threadTimestamp, // 스레드를 시작할 메시지의 timestamp를 지정
    });

  } catch (error) {
    //
  }
});