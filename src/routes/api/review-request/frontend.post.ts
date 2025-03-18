import { postPRThreadInfo } from "~/helper/api/prThread";
import CHANNEL_ID from "@/constant/CHANNEL_ID.json";

interface RequestBody {
  pullRequestLink: string,
  reviewers: string[],
  writer: string
}

export default defineEventHandler(async (event) => {
  const {
    pullRequestLink,
    reviewers,
    writer
  } = await readBody<RequestBody>(event);

  const userList: TrackMember[] = await getAllDistinctMembers(event.context.sqlPool);
  const mentionList = userList.filter((member) => reviewers.some((reviewer) => member.name == reviewer && member.track_name === "FrontEnd"));
  const writerMember = userList.find((member) => member.name === writer && member.track_name === "FrontEnd");
  if (mentionList.length === 0) {
    throw new Error('리뷰어를 찾을 수 없습니다!');
  }
  const writerMentionString = writerMember ? `<@${writerMember.slack_id}>` : writer;
  const mentionString = mentionList.map((member) => `<@${member.slack_id}>`).join(', ');

  const result = await sendSlackBlock({
    client: event.context.slackWebClient,
    channel: CHANNEL_ID.frontend_github,
    unfurl_links: true,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `
*리뷰어가 할당되었습니다! :blob-wave:*
 • 리뷰하러 가기 >> <${pullRequestLink}|click>
 • 담당자 : ${writerMentionString}
 • 리뷰어 : ${mentionString}`,
        },
      },
    ]
  });
  if (result.ts) {
    await postPRThreadInfo({
      ts: result.ts,
      pullRequestLink,
      reviewers,
      writer
    })
  }

  return "OK";
});