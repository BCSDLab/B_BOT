import type { View } from "@slack/web-api";
import type { CommandSetting, GroupMentionMetadata } from "./type";
import CHANNEL_ID from "@/constant/CHANNEL_ID.json";
import INTERACTION_MODAL from "@/constant/INTERACTION_MODAL.json";
import {
  command as googleMeetCommand,
} from "./domain/googleMeet"

export const commands: CommandSetting[] = [
  {
    command: "/강의공지",
    async handler({
      client,
      command,
    }) {
      const threadChannelId = command.channel_id;
      client.views.open({
        trigger_id: command.trigger_id,
        view: {
          ...INTERACTION_MODAL.강의공지.view as View,
          private_metadata: threadChannelId,
        },
      });
    }
  },
  {
    command: "/test",
    async handler({
      client,
    }) {
      await sendSlackText({
        client,
        channel: CHANNEL_ID.삐봇요청_test,
        text: "테스트 서버 멀쩡함",
      });
    }
  },
  {
    command: "/멘션",
    async handler({
      client,
      command,
    }) {
      const {
        channel_id: channel,
        // 없음
        // message_ts,
        user_id: user,
        } = command;
      const rootTs = undefined;
      await client.views.open({
        trigger_id: command.trigger_id,
        view: {
          ...INTERACTION_MODAL.그룹멘션.view as View,
          private_metadata: JSON.stringify({
            channel_id: channel,
            thread_ts: rootTs,
            user_id: user
          } satisfies GroupMentionMetadata)
        },
      });
    }
  },
  ...googleMeetCommand,
];

