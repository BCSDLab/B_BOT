import express from 'express';
import { boltApp } from '../../config/boltApp';
import { MemberType, Team, Track } from '../../models/mention';
import { BCSD_ACTIVE_MEMBER_LIST } from '../../const/track';
import { getClientUserList } from '../../api/user';
import { match } from 'ts-pattern';
import { MEMBER_TYPES_LOWERCASE, TRACKS_LOWERCASE, TRACK_NAME_MAPPER} from '../../const/track';
import findMentionMessage from '../../utils/findMentionMessage';

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
        private_metadata: JSON.stringify({ channel_id: shortcut.channel.id, ts: shortcut.message.ts, userId: shortcut.user.id }) 
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
        private_metadata: JSON.stringify({ channel_id: command.channel_id, ts: command.message_ts, userId: command.user_id }),
      },
    });
  } catch (error) {
    respond(`에러 발생: ${error}`);
  }
});

boltApp.view({ callback_id: 그룹맨션_callback_id , type: 'view_submission' }, async ({ ack, view, client, respond }) => {
  try {
    await ack();
    const track = view['state']['values']['track']['track_select']['selected_option']?.value as Track | 'all' | 'client';
    const team = view['state']['values']['team']['team_select']['selected_option']?.value as Team | 'all';
    const member_type = view['state']['values']['member_type']['member_type_select']['selected_option']?.value as MemberType | 'all';

    const { channel_id, ts, userId } = JSON.parse(view['private_metadata']);

    if(team !== "all") {
      const selectedMember  = await mentionUsersByTeamAndTrack(team, track);
      if(selectedMember.length > 0) {
        client.chat.postMessage({
          channel: channel_id,
          text: `<@${userId}>님의 ${team}팀 ${track === 'all' ? '모든 트랙' : `${track}트랙`} 단체멘션!\n${selectedMember.join(', ')}\n확인 부탁드립니다 :dancing_toad:`,
          thread_ts: ts,
        });
      }
      else {
        client.chat.postMessage({
          channel: channel_id,
          text: '해당하는 인원이 없습니다.',
          thread_ts: ts,
        });
      }
    }
    else {
      //팀이 전체인 경우
      if (
        (!track && !member_type) ||
        !TRACKS_LOWERCASE.some(t => t === track) ||
        !MEMBER_TYPES_LOWERCASE.some(t => t === member_type)
      ) {
        throw new Error('잘못된 멘션 형식입니다.');
      }
     
      // 사용자 목록 가져오기
      const usersList = await getClientUserList();

      const activeUsers = usersList.members!.filter(user => user.deleted === false && user.is_bot === false);

      // 이모지로 상태 표시한 사용자 필터링
      const memberTypeUsers = match(member_type)
        .with("beginner", () => activeUsers!.filter((user) => user.profile!.status_emoji !== ":green_apple:" && user.profile!.status_emoji !== ":sparkles:" && user.profile!.status_emoji !== ":apple:" && user.profile!.status_emoji !== ":tangerine:"))
        .with("regular", () => activeUsers!.filter((user) => user.profile!.status_emoji === ":green_apple:" || user.profile!.status_emoji === ":apple:" || user.profile!.status_emoji === ":tangerine:"))
        .with("mentor", () => activeUsers!.filter((user) => user.profile!.status_emoji === ":sparkles:"))
        .otherwise(() => {
          throw new Error("잘못된 멘션 형식입니다.");
        });

      const mentionMessage = findMentionMessage(track,member_type);
      
      const selectedMember = memberTypeUsers
        .filter(user => user.profile!.display_name && user.profile!.display_name.endsWith(TRACK_NAME_MAPPER[track as keyof typeof TRACK_NAME_MAPPER]))
        .map(user => `<@${user.id}>`);
      
      if(selectedMember.length > 0) {
        client.chat.postMessage({
          channel: channel_id,
          text: `<@${userId}>님의 ${mentionMessage} 단체멘션!\n${selectedMember.join(', ')}\n확인 부탁드립니다 :dancing_toad:`,
          thread_ts: ts,
        });
      }
      else {
        client.chat.postMessage({
          channel: channel_id,
          text: '해당하는 인원이 없습니다.',
          thread_ts: ts,
        });
      }
    }
   
  } catch (error) {
    respond(`에러 발생: ${error}`);
  }
});

async function mentionUsersByTeamAndTrack(team : Team, track: Track | 'all' | 'client') {
  // 팀과 트랙으로 이름 목록 가져오기
  const names = getNamesByTeamAndTrack(team, track);
  
  // 사용자 목록 가져오기
  const usersList = await getClientUserList();

  const activeUsers = usersList.members!.filter(user => !user.deleted && !user.is_bot);

  // 빈 배열을 가진 트랙 식별
  const emptyTracks = Object.values(BCSD_ACTIVE_MEMBER_LIST).flatMap(group =>
    Object.entries(group).filter(([, members]) => members.length === 0).map(([track]) => track)
  );


  const emptyTrackDisplayNames = emptyTracks.map(track => TRACK_NAME_MAPPER[track as keyof typeof TRACK_NAME_MAPPER]);

  // 비어있는 트랙 이름으로 끝나는 사용자 제외
  const filteredUsers = activeUsers.filter(user => {
    const displayName = user.profile?.display_name;
    return !emptyTrackDisplayNames.some(emptyTrackDisplayName => displayName?.endsWith(emptyTrackDisplayName));
  });

  // 이름 목록에 있는 각 이름으로 시작하는 사용자의 ID 찾기
  const mentions = names.flatMap((name : string) => 
    filteredUsers
      .filter(user => user.profile!.display_name && user.profile!.display_name.startsWith(name))
      .map(user => `<@${user.id}>`)
  );

  return mentions;
}

// 팀과 트랙 정보로부터 이름 목록 가져오기
function getNamesByTeamAndTrack(team : Team, track: Track | 'all' | 'client') {
  if (!['all', 'business', 'campus', 'user'].includes(team)) {
    throw new Error('잘못된 팀 이름입니다.');
  }
  
  // 트랙 이름 유효성 확인
  if (!['all', 'frontend', 'backend', 'android', 'ios', 'uiux', 'pm', 'da', 'game'].includes(track)) {
    throw new Error('잘못된 트랙 이름입니다.');
  }
    // 트랙이 'all'일 경우, 해당 팀의 모든 트랙에 대한 사람들의 이름 반환
  if (track === 'all') {
    return Object.values(BCSD_ACTIVE_MEMBER_LIST[team]).flat();
  }
  if(track === 'client') {
    const clientTracks = ['frontend', 'android', 'ios'];
    return clientTracks.flatMap(track => TRACK_NAME_MAPPER[track as keyof typeof TRACK_NAME_MAPPER]);
  }
  // 특정 팀과 트랙에 해당하는 사람 이름 반환
  return BCSD_ACTIVE_MEMBER_LIST[team][track] || [];
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
              text: "클라이언트"
            },
            value: "client"
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