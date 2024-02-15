import { app } from "../../src/config/app";

app.event('message', async ({ event, client, message }) => {
  await client.chat.postMessage({
    channel: "C06JWD4UQJW",
    text: `부르셨나요?`
  });
});
