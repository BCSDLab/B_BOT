import { buildResultBlocks, convertToReview } from "~/services/lecture/pipeline";
import { downloadSlackFile, findExcelFile } from "~/utils/slackFile";
import type { MessageSetting } from "../type";

const COMMAND = /^!강의반영/;
/** `!강의반영 2026 여름학기` */
const ARGS = /^!강의반영\s+(\d{4})\s*(1학기|2학기|여름학기|겨울학기)\s*$/;

/** 사람이 직접 치는 값이라 규칙을 한 곳에 모아두고 테스트로 고정한다. */
export function parseCommand(text: string): { year: number; termName: string } | null {
  const matched = ARGS.exec(text.trim());
  return matched ? { year: Number(matched[1]), termName: matched[2] } : null;
}

const USAGE = [
  "*사용법* — 엑셀 파일을 올리면서 메시지에 함께 적어주세요.",
  "```!강의반영 2026 여름학기```",
  "학기는 `1학기` `2학기` `여름학기` `겨울학기` 중 하나입니다.",
].join("\n");

export const messages: MessageSetting[] = [
  {
    regex: COMMAND,
    acceptsFiles: true,
    async handler({ client, channel, ts, text, user, files }) {
      const parsed = parseCommand(text);
      const excel = findExcelFile(files);

      if (!parsed || !excel) {
        await client.chat.postMessage({
          channel,
          thread_ts: ts,
          text: "사용법을 확인해주세요.",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: [
                  !excel ? ":file_folder: 엑셀 파일(.xlsx)을 함께 올려주세요." : null,
                  !parsed ? ":pencil: 연도와 학기를 적어주세요." : null,
                  "",
                  USAGE,
                ]
                  .filter((line) => line !== null)
                  .join("\n"),
              },
            },
          ],
        });
        return;
      }

      const target = { ...parsed, fileName: excel.name };

      // 변환은 LLM 호출과 파싱이 걸려 수십 초가 나올 수 있다.
      // 먼저 붙잡아두지 않으면 사람들이 명령어를 또 친다.
      const placeholder = await client.chat.postMessage({
        channel,
        thread_ts: ts,
        text: "변환 중",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:hourglass_flowing_sand: *${target.year} ${target.termName}* 변환 중…\n${excel.name}`,
            },
          },
        ],
      });
      const messageTs = placeholder.ts as string;

      try {
        const buffer = await downloadSlackFile(excel);
        const outcome = await convertToReview(buffer, target);

        await client.chat.update({
          channel,
          ts: messageTs,
          text: `${target.year} ${target.termName} 변환 완료 · ${outcome.lectureCount}건`,
          blocks: buildResultBlocks(outcome, target, user),
        });
      } catch (error) {
        // 실패해도 원래 메시지를 갱신한다. 새 메시지를 쌓으면 어느 게 최신인지 헷갈린다.
        await client.chat.update({
          channel,
          ts: messageTs,
          text: "변환 실패",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `:x: *변환 실패*\n${
                  error instanceof Error ? error.message : "알 수 없는 오류입니다"
                }`,
              },
            },
            {
              type: "context",
              elements: [{ type: "mrkdwn", text: `${excel.name} · 요청: <@${user}>` }],
            },
          ],
        });
      }
    },
  },
];
