import CHANNEL_ID from "@/constant/CHANNEL_ID.json";

const 패키지명 = {
  "FRONT_KOIN_LIBRARY": "@bcsdlab/koin",
  "FRONT_UTILS_LIBRARY": "@bcsdlab/utils",
} as const;

interface RequestBody {
  pullRequestLink: string;
  pullRequestTitle: string;
  repositoryName: keyof typeof 패키지명;
  version: string;
}

export default defineEventHandler(async (event) => {

  const { pullRequestLink, pullRequestTitle, repositoryName, version }  = await readBody<RequestBody>(event);
  const packageName = 패키지명[repositoryName];

  if (!packageName) {
    await sendSlackText({
      client: event.context.slackWebClient,
      channel: CHANNEL_ID.트랙_front_end,
      text: `패키지가 배포되었지만, 패키지 이름을 찾을 수 없어요., ${repositoryName}, ${packageName}, ${pullRequestLink}, ${pullRequestTitle}, ${version}`,
      unfurl_links: true,
    });

    throw createError({
      statusCode: 500,
      statusMessage: `패키지가 배포되었지만, 패키지 이름을 찾을 수 없어요., ${repositoryName}, ${packageName}, ${pullRequestLink}, ${pullRequestTitle}, ${version}`
    })
  }

  await sendSlackBlock({
    client: event.context.slackWebClient,
    channel: CHANNEL_ID.트랙_front_end,
    unfurl_links: true,
    blocks: [
      {
        type: "section",
        text: {
          type: "plain_text",
          text: `${packageName} 패키지가 업데이트됐어요!`,
          emoji: true
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `
  서비스별 확인 후 업데이트 부탁드려요 :meow_cookie:
   • <${pullRequestLink}|${pullRequestTitle}>`
        },
      },
      {
        type: "section",
        text: {
          type: "plain_text",
          text: `yarn add ${packageName}@^${version}`,
          emoji: true
        }
      }
    ]
  });
  return "OK";
});