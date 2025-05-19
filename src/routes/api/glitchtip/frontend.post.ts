import CHANNEL_ID from "@/constant/CHANNEL_ID.json";

export default defineEventHandler(async (event) => {
  try {
    const { attachments } = await readBody(event);

    await event.context.slackWebClient.chat.postMessage({
      channel: CHANNEL_ID.코인_오류_front_end,
      text: ':rotating_light: 코인 서비스에서 오류가 발생했습니다.',
      attachments,
    });

    return "OK";
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: `Error: ${error}`,
    })
  }
});
