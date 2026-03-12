import CHANNEL_ID from "@/constant/CHANNEL_ID.json";

interface RequestBody {
  status: 'success' | 'failure';
  environment: 'Production' | 'Stage';
  branch: string;
  actor: string;
  commitMessage: string;
  runUrl: string;
}

export default defineEventHandler(async (event) => {
  const {
    status,
    environment,
    branch,
    actor,
    commitMessage,
    runUrl,
  } = await readBody<RequestBody>(event);

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
          text: `${icon} *[${environment}] ${statusText}*\n• Branch: \`${branch}\`\n• Author: ${actor}\n• Commit: ${commitMessage}\n• <${runUrl}|Actions 보기>`,
        },
      },
    ],
  });

  return "OK";
});
