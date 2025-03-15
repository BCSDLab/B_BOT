import "@total-typescript/ts-reset/fetch";
import type { Pool } from "mysql2/promise";
import type {
  GroupMentionMetadata,
  MentionMetadata,
  ViewActionSetting,
} from "./type";
import INTERACTION_MODAL from "@/constant/INTERACTION_MODAL.json";
import CHANNEL_ID from "@/constant/CHANNEL_ID.json";

export const viewActions: ViewActionSetting[] = [
  {
    actionId: INTERACTION_MODAL.삐봇메세지.callback_id,
    async handler({
      client,
      action: {
        view
      },
    }) {
      const metadata = JSON.parse(view.private_metadata) as MentionMetadata;
      const channelId = metadata.channel;
      const threadTs = metadata.thread_ts;
      const userId = metadata.user_id;

      const userInput = view.state.values['bbot_message_block']['bbot_message_input']?.value?.trim() || '';
      const selectedUserIds = view.state.values['bbot_users_select_block']['bbot_users_select_input'].selected_users || [];

      const mentionText = selectedUserIds.length > 0 ? selectedUserIds.map((id: string) => `<@${id}>`).join(' ') : '';

      const finalMessage = mentionText ? `${mentionText} ${userInput}` : `${userInput}`;

      await sendSlackText({
        client,
        channel: channelId,
        threadTs: threadTs,
        text: finalMessage,
      });

      await sendSlackText({
        client,
        channel: CHANNEL_ID.삐봇_log,
        text: `<@${userId}>님의 삐봇 메시지!\n${finalMessage}`,
      });
    }
  },
  {
    actionId: INTERACTION_MODAL.그룹멘션.callback_id,
    async handler({
      client,
      action: {
        view
      },
      context,
    }) {
      const track = view['state']['values']['track']['track_select']['selected_option']?.value as Track;
      const team = view['state']['values']['team']['team_select']['selected_option']?.value as Team;
      const memberType = view['state']['values']['member_type']['member_type_select']['selected_option']?.value as MemberType;

      const { channel, thread_ts: threadTs, user_id } = JSON.parse(view['private_metadata']) as GroupMentionMetadata;
      const connection = await (context.sqlPool as Pool).getConnection();
      const selectedMember = await getMentionTargetMembers({
        connection,
        team,
        track,
        memberType,
      });

      if (selectedMember.length > 0) {
        let trackText = `${track === 'all' ? '' : `${track}트랙`} `;
        let teamText = `${team === 'all' ? '' : `${team}팀`} `;
        let memberTypeText = `${memberType === 'all' ? '' : `${memberType.toLowerCase()}`} `;
        await sendSlackText({
          client,
          channel: channel,
          text: `<@${user_id}>님의 ${teamText}${trackText}${memberTypeText}단체멘션!\n${selectedMember.join(', ')}\n확인 부탁드립니다 :dancing_toad:`,
          threadTs,
        });
      } else {
        await sendSlackText({
          client,
          channel: channel,
          text: '해당하는 인원이 없습니다.',
          threadTs,
        });
      }
    }
  },
  {
    actionId: INTERACTION_MODAL.강의공지.callback_id,
    async handler({
      client,
      view,
    }) {
      const threadChannelId = view["private_metadata"];
      const content = view["state"]["values"]["content"]["content_input"]["value"];
      const location =
        view["state"]["values"]["location"]["location_input"]["value"];
      const day = view["state"]["values"]["day"]["day_dropdown"]["selected_option"];
      const time = view["state"]["values"]["time"]["time_dropdown"]["selected_option"];
      const online =
        view["state"]["values"]["checkbox_block"]["checkbox_input"];

      // 스레드에 멘션
      await sendSlackText({
        client,
        channel: threadChannelId,
        text: `*비기너 강의 공지*\n${content}\n*장소*: ${location}\n*요일*: ${day?.text.text}\n*시간*: ${time?.text.text}\n*온라인여부*: ${online ? "온라인" : "오프라인"}\n`,
      });
    }
  }
];