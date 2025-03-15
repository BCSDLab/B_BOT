export default defineEventHandler(async (event) => {
  await runTask("crawl:clarity", {
    payload: {
      scheduledTime: Date.now(),
    },
  });

  return "OK";
});