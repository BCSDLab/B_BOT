import {
  buildRegularCoopResultBlocks,
  convertRegularCoopToReview,
} from "~/services/coop/pipeline";
import { downloadSlackImage, findImageFile } from "~/utils/slackFile";
import { threadRootOf } from "~/utils/slackThread";
import type { MessageSetting } from "../type";

const COMMAND = /^!생협반영/;
const ARGS = /^!생협반영\s+(\d{4})\s*(1학기|2학기)\s*$/;

export function parseCoopCommand(
  text: string,
): { year: number; termName: "1학기" | "2학기" } | null {
  const matched = ARGS.exec(text.trim());
  return matched
    ? { year: Number(matched[1]), termName: matched[2] as "1학기" | "2학기" }
    : null;
}

const USAGE = [
  "*사용법* — 생협 운영시간 이미지를 올리면서 메시지에 함께 적어주세요.",
  "```!생협반영 2026 1학기```",
  "현재는 정규학기 `1학기`와 `2학기`만 지원합니다.",
].join("\n");

export const messages: MessageSetting[] = [{
  regex: COMMAND,
  acceptsFiles: true,
  async handler({ client, channel, ts, text, user, files, parentTs }) {
    const threadRoot = threadRootOf(ts, parentTs);
    const parsed = parseCoopCommand(text);
    const image = findImageFile(files);

    if (!parsed || !image) {
      await client.chat.postMessage({
        channel,
        thread_ts: threadRoot,
        text: "사용법을 확인해주세요.",
        blocks: [{
          type: "section",
          text: {
            type: "mrkdwn",
            text: [
              !image ? ":frame_with_picture: 이미지 파일(PNG, JPEG, WebP, GIF)을 함께 올려주세요." : null,
              !parsed ? ":pencil: 연도와 정규학기를 적어주세요." : null,
              "",
              USAGE,
            ].filter((line) => line !== null).join("\n"),
          },
        }],
      });
      return;
    }

    const target = { ...parsed, fileName: image.name };
    const placeholder = await client.chat.postMessage({
      channel,
      thread_ts: threadRoot,
      text: "생협 운영시간 변환 중",
      blocks: [{
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:hourglass_flowing_sand: *${target.year} ${target.termName} 생협 운영시간* 변환 중…\n${image.name}`,
        },
      }],
    });
    const messageTs = placeholder.ts as string;

    try {
      const downloaded = await downloadSlackImage(image);
      const outcome = await convertRegularCoopToReview(
        downloaded.buffer,
        downloaded.mimeType,
        target,
      );
      await client.chat.update({
        channel,
        ts: messageTs,
        text: `${target.year} ${target.termName} 생협 운영시간 변환 완료 · ${outcome.shopCount}개`,
        blocks: buildRegularCoopResultBlocks(outcome, target, user),
      });
    } catch (error) {
      await client.chat.update({
        channel,
        ts: messageTs,
        text: "생협 운영시간 변환 실패",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:x: *변환 실패*\n${error instanceof Error ? error.message : "알 수 없는 오류입니다"}`,
            },
          },
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: `${image.name} · 요청: <@${user}>` }],
          },
        ],
      });
    }
  },
}];
