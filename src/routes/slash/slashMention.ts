import express from 'express';
import { boltApp } from '../../config/boltApp';

const slashMentionRouter = express.Router();

const 그룹맨션_callback_id = 'group_mention';

boltApp.shortcut('group_mention', async ({ ack, client, context, respond, shortcut, body }) => {
  try {
    await ack();
    if (shortcut.type !== 'message_action') return;
       
    // 모달 열기
    await client.views.open({
      trigger_id: body.trigger_id,
      view: { 
        ...그룹맨션_모달_뷰, 
        private_metadata: JSON.stringify({ channel_id: shortcut.channel.id, ts: shortcut.message.ts }) 
      },
    });
  }
  catch (error) {
    respond(`에러 발생: ${error}`);
  }
});

boltApp.command('/멘션', async ({ ack, client, respond, command }) => {
  try {
    await ack();
    
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        ...그룹맨션_모달_뷰,
        private_metadata: JSON.stringify({ channel_id: command.channel_id, ts: command.message_ts }),
      },
    });
  } catch (error) {
    respond(`에러 발생: ${error}`);
  }
});

boltApp.view({ callback_id: 그룹맨션_callback_id , type: 'view_submission' }, async ({ ack, view, client, respond }) => {
  try {
    await ack();
    const track = view['state']['values']['track']['track_select']['selected_option']?.value;
    const team = view['state']['values']['team']['team_select']['selected_option']?.value;
    const member_type = view['state']['values']['member_type']['member_type_select']['selected_option']?.value;
    
    const { channel_id, ts } = JSON.parse(view['private_metadata']);
    
    client.chat.postMessage({
      channel: channel_id,
      text: `멘션할 트랙: ${track}\n멘션할 팀: ${team}\n멘션할 멤버: ${member_type}`,
      thread_ts: ts,
    });
  } catch (error) {
    respond(`에러 발생: ${error}`);
  }
});

const 그룹맨션_모달_뷰 = {
  type: 'modal',
  callback_id: 그룹맨션_callback_id,
  title: {
    type: 'plain_text',
    text: '그룹 멘션',
  },
  blocks: [
    {
      type: 'section',
      block_id: 'track',
      text: {
        type: "mrkdwn",
        text: "어떤 트랙을 멘션할까요?"
      },
      accessory: {
        action_id: "track_select",
        type: "static_select",
        initial_option: {
          text: {
            type: "plain_text",
            text: "전체"
          },
          value: "all"
        },
        options: [
          {
            text: {
              type: "plain_text",
              text: "전체"
            },
            value: "all"
          },
          {
            text: {
              type: "plain_text",
              text: "FrontEnd"
            },
            value: "frontend"
          },
          {
            text: {
              type: "plain_text",
              text: "BackEnd"
            },
            value: "backend"
          },
          {
            text: {
              type: "plain_text",
              text: "Android"
            },
            value: "android"
          },
          {
            text: {
              type: "plain_text",
              text: "UI/UX"
            },
            value: "uiux"
          },
          {
            text: {
              type: "plain_text",
              text: "Game"
            },
            value: "game"
          },
          {
            text: {
              type: "plain_text",
              text: "iOS"
            },
            value: "ios"
          },
          {
            text: {
              type: "plain_text",
              text: "Product Manager"
            },
            value: "pm"
          },
          {
            text: {
              type: "plain_text",
              text: "Data Analyst"
            },
            value: "da"
          }
        ]
      },
    },
    {
      type: 'section',
      block_id: 'team',
      text: {
        type: "mrkdwn",
        text: "어떤 팀을 멘션할까요?"
      },
      accessory: {
        action_id: "team_select",
        type: "static_select",
        initial_option: {
          text: {
            type: "plain_text",
            text: "전체"
          },
          value: "all"
        },
        options: [
          {
            text: {
              type: "plain_text",
              text: "전체"
            },
            value: "all"
          },
          {
            text: {
              type: "plain_text",
              text: "Business Team"
            },
            value: "business"
          },
          {
            text: {
              type: "plain_text",
              text: "Campus Team"
            },
            value: "campus"
          },
          {
            text: {
              type: "plain_text",
              text: "User Team"
            },
            value: "user"
          },
        ]
      },
    },
    {
      type: 'section',
      block_id: 'member_type',
      text: {
        type: "mrkdwn",
        text: "비기너, 레귤러, 멘토 중 누굴 멘션할까요?"
      },
      accessory: {
        action_id: "member_type_select",
        type: "static_select",
        initial_option: {
          text: {
            type: "plain_text",
            text: "Regular"
          },
          value: "regular"
        },
        options: [
          {
            text: {
              type: "plain_text",
              text: "전체"
            },
            value: "all"
          },
          {
            text: {
              type: "plain_text",
              text: "Mentor"
            },
            value: "mentor"
          },
          {
            text: {
              type: "plain_text",
              text: "Regular"
            },
            value: "regular"
          },
          {
            text: {
              type: "plain_text",
              text: "Beginner"
            },
            value: "beginner"
          },
        ]
      },
    },
  ],
  submit: {
    type: 'plain_text',
    text: 'Submit',
  },
} as any;

export default slashMentionRouter