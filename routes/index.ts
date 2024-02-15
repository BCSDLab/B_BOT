import { app } from "../src/config/app";

app.message('똑똑', async ({ event, client, message }) => {
  await client.chat.postMessage({
    channel: "C06JWD4UQJW",
    text: `부르셨나요?`
  });
});
