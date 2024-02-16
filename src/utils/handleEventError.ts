import { AppMentionEvent, KnownEventFromType } from "@slack/bolt";
import { boltApp } from "../config/boltApp";

export function handleMessageEventError({ event, error }: {
  event: KnownEventFromType<'message'>,
  error: unknown
}) {
   boltApp.client.chat.postMessage({
    channel: event.channel,
    text: `에러가 발생했습니다: ${error}`,
  });
}