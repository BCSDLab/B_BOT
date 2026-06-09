import type { WebClient } from "@slack/web-api";
import { sendSlackText } from "~/utils/slackFunction";
import { messageFunctionList } from "./message";

interface ProcessSlackMessageParams {
  client: WebClient;
  text: string;
  ts: string;
  user: string;
  channel: string;
}

export async function processSlackMessage({
  client,
  text,
  ts,
  user,
  channel,
}: ProcessSlackMessageParams) {
  for (const messageFunction of messageFunctionList) {
    const isMatch = typeof messageFunction.regex === "string"
      ? text.includes(messageFunction.regex)
      : messageFunction.regex.test(text);

    if (!isMatch) {
      continue;
    }

    try {
      await messageFunction.handler({
        client,
        text,
        ts,
        user,
        channel,
      });
    } catch (error) {
      console.error("Slack message handler error:", error);
      await sendSlackText({
        client,
        channel,
        threadTs: ts,
        text: `오류가 발생했어요: ${error instanceof Error ? error.message : "알 수 없는 오류입니다"}`,
      });
    }
  }
}
