import express from 'express';
import { boltApp } from '../../config/boltApp';
import { MemberType, Team, Track } from '../../models/mention';
import { BCSD_ACTIVE_MEMBER_LIST } from '../../const/track';
import { getClientUserList } from '../../api/user';
import { match } from 'ts-pattern';

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
    const track = view['state']['values']['track']['track_select']['selected_option']?.value as Track | 'all';
    const team = view['state']['values']['team']['team_select']['selected_option']?.value as Team | 'all';
    const member_type = view['state']['values']['member_type']['member_type_select']['selected_option']?.value as MemberType | 'all';
    
    const { channel_id, ts } = JSON.parse(view['private_metadata']);
    const userList = await getClientUserList();

    const selectedMember = selectMember(userList, track, team, member_type);
    client.chat.postMessage({
      channel: channel_id,
      text: `${selectedMember}확인 해주세요.`,
      thread_ts: ts,
    });
  } catch (error) {
    respond(`에러 발생: ${error}`);
  }
});

const selectMember = (userList: any ,track: Track | 'all', team: Team | 'all', memberType: MemberType | 'all'): string[] => {
  let selectedMembers: string[] = [];
  const activeUsers = userList.members!.filter((user: any) => user.deleted === false && user.is_bot === false);
  const memberTypeUsers = match(memberType)
        .with("beginner", () => activeUsers!.filter((user: any) => user.profile!.status_emoji !== ":green_apple:" && user.profile!.status_emoji !== ":sparkles:" && user.profile!.status_emoji !== ":apple:" && user.profile!.status_emoji !== ":tangerine:"))
        .with("regular", () => activeUsers!.filter((user: any) => user.profile!.status_emoji === ":green_apple:" || user.profile!.status_emoji === ":apple:" || user.profile!.status_emoji === ":tangerine:"))
        .with("mentor", () => activeUsers!.filter((user: any) => user.profile!.status_emoji === ":sparkles:"))
        .otherwise(() => {
          throw new Error("잘못된 멘션 형식입니다.");
        });
  if (track === 'all' && team === 'all' && memberType === 'all') {
    // 모든 사용자의 ID 반환
    selectedMembers = userList.members.map((user: any) => user.id);
  } else {
    // 조건에 맞는 사용자의 ID 찾기 (실제 구현에서는 조건에 맞게 로직을 추가해야 합니다)
    const membersByTrackAndTeam = team !== 'all' && track !== 'all' ? BCSD_ACTIVE_MEMBER_LIST[team]?.[track] : undefined;
    if (membersByTrackAndTeam) {
      selectedMembers = membersByTrackAndTeam.flatMap((memberName: string) => 
        userList.members
          .filter((user: any) => user.profile.display_name === memberName)
          .map((user: any) => user.id)
      );
    }
  }
  
  return selectedMembers;
}
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