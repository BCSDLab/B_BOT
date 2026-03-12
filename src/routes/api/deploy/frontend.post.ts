import CHANNEL_ID from "@/constant/CHANNEL_ID.json";

interface RequestBody {
  status: 'success' | 'failure';
  environment: 'Production' | 'Stage';
  repository: string;
  branch: string;
  actor: string;
  commitMessage: string;
  runUrl: string;
}

export default defineEventHandler(async (event) => {
  const {
    status,
    environment,
    repository,
    branch,
    actor,
    commitMessage,
    runUrl,
  } = await readBody<RequestBody>(event);

  const userList: TrackMember[] = await getAllDistinctMembers(event.context.sqlPool);
  const actorMember = userList.find((member) => member.name === actor && member.track_name === 'FrontEnd');
  const actorMentionString = actorMember ? `<@${actorMember.slack_id}>` : actor;

  const isSuccess = status === 'success';
  const icon = isSuccess ? ':white_check_mark:' : ':x:';
  const statusText = isSuccess ? '배포 성공' : '배포 실패';

  await sendSlackBlock({
    client: event.context.slackWebClient,
    channel: CHANNEL_ID.frontend_github,
    unfurlLinks: false,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${icon} *[${environment}] ${statusText}*\n• Repo: \`${repository}\`\n• Branch: \`${branch}\`\n• Author: ${actorMentionString}\n• Commit: ${commitMessage}\n• <${runUrl}|Actions 보기>`,
        },
      },
    ],
  });

  return "OK";
});
