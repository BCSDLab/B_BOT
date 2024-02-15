import { app } from "../../config/app"
import { web } from "../../config/webClient"

export default eventHandler((e) => {
  // 특정 채널의 id를 가져온다
  console.log("token: "+ process.env.SLACK_BOT_TOKEN)
  web.conversations.list({
    limit: 20,
    cursor: "dGVhbTpDMDUwNjdTSFAwRg=="
  }).then((res) => {
    web.chat.postMessage({
      channel: "C06JWD4UQJW",
      text: "Hello world!"
    })
  })

  return { e: "" }
})
