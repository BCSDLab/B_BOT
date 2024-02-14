import {  } from "@slack/web-api"

export default eventHandler((e) => {
  console.debug(e)
  return { e: "" }
})
