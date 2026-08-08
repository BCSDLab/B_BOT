import {
  buildRegularCoopResultBlocks,
  convertRegularCoopToReview,
} from "~/services/coop/pipeline";
import { buildCoopPatchBlocks, planCoopPatches } from "~/services/coop/patch";
import {
  findCoopTokenByThread,
  linkCoopThread,
  loadCoopReview,
  saveCoopPatchPlan,
} from "~/services/coop/reviewStore";
import { downloadSlackImage, findImageFile } from "~/utils/slackFile";
import { readThreadContext, threadRootOf } from "~/utils/slackThread";
import { createCoopJob } from "~/services/coop/jobStore";
import { labelOf, resolveTarget } from "~/services/lecture/target";
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

    const resolved = resolveTarget(channel);
    if (!resolved.target) {
      await client.chat.postMessage({
        channel,
        thread_ts: threadRoot,
        text: "생협 반영 대상 채널이 아닙니다.",
        blocks: [{
          type: "section",
          text: { type: "mrkdwn", text: `:x: ${resolved.reason ?? "반영 대상을 찾지 못했습니다."}` },
        }],
      });
      return;
    }

    const target = { ...parsed, env: resolved.target.env, fileName: image.name };
    const placeholder = await client.chat.postMessage({
      channel,
      thread_ts: threadRoot,
      text: "생협 운영시간 변환 중",
      blocks: [{
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:hourglass_flowing_sand: *${target.year} ${target.termName} 생협 운영시간* 변환 중…\n${labelOf(target.env)} · ${image.name}`,
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
      await linkCoopThread(channel, threadRoot, outcome.token);
      await createCoopJob({
        token: outcome.token,
        channelId: channel,
        threadTs: messageTs,
        year: target.year,
        term: target.termName,
        sourceFile: target.fileName,
        shopCount: outcome.shopCount,
        targetEnv: target.env,
      });
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

const EDIT_COMMAND = /^!수정/;

messages.push({
  regex: EDIT_COMMAND,
  async handler({ client, channel, ts, text, user, parentTs }) {
    if (!parentTs) return;
    const token = await findCoopTokenByThread(channel, parentTs);
    if (!token) return;

    const request = text.replace(EDIT_COMMAND, "").trim();
    const stored = await loadCoopReview(token);
    if (!stored) {
      await client.chat.postMessage({
        channel,
        thread_ts: parentTs,
        text: "생협 검토 링크가 만료됐습니다.",
        blocks: [{
          type: "section",
          text: { type: "mrkdwn", text: ":x: 생협 검토 링크가 만료됐습니다. 이미지를 다시 변환해주세요." },
        }],
      });
      return;
    }
    if (!stored.conversion) {
      await client.chat.postMessage({
        channel,
        thread_ts: parentTs,
        text: "이전 변환 결과는 수정할 수 없습니다.",
        blocks: [{
          type: "section",
          text: { type: "mrkdwn", text: ":information_source: 수정 기능 배포 전에 만든 결과입니다. 이미지를 다시 변환해주세요." },
        }],
      });
      return;
    }
    if (!request) {
      await client.chat.postMessage({
        channel,
        thread_ts: parentTs,
        text: "무엇을 바꿀지 적어주세요.",
        blocks: [{
          type: "section",
          text: {
            type: "mrkdwn",
            text: [
              ":pencil: *무엇을 바꿀지 함께 적어주세요.*",
              "예) `!수정 세탁소 평일 운영시간을 11:30 - 18:30으로 바꿔줘`",
              "예) `!수정 복지관식당 토요일을 미운영으로 바꿔줘`",
              "예) `!수정 운영 종료일을 2026-06-19로 바꿔줘`",
            ].join("\n"),
          },
        }],
      });
      return;
    }

    const placeholder = await client.chat.postMessage({
      channel,
      thread_ts: parentTs,
      text: "생협 수정 요청 확인 중",
      blocks: [{
        type: "section",
        text: { type: "mrkdwn", text: ":mag: 생협 수정 요청을 확인하는 중…" },
      }],
    });
    const messageTs = placeholder.ts as string;

    try {
      const context = await readThreadContext(client, channel, parentTs, ts);
      const plan = await planCoopPatches(request, stored.conversion, context);
      if (plan.patches.length === 0) {
        await client.chat.update({
          channel,
          ts: messageTs,
          text: "수정할 내용을 찾지 못했습니다.",
          blocks: [{
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                ":grey_question: *수정할 내용을 찾지 못했습니다.*",
                ...plan.problems.map((problem) => `• ${problem}`),
              ].join("\n"),
            },
          }],
        });
        return;
      }
      const patchToken = await saveCoopPatchPlan(token, plan);
      await client.chat.update({
        channel,
        ts: messageTs,
        text: `생협 수정 ${plan.patches.length}건 확인`,
        blocks: buildCoopPatchBlocks(plan, patchToken, user),
      });
    } catch (error) {
      await client.chat.update({
        channel,
        ts: messageTs,
        text: "생협 수정 요청 처리 실패",
        blocks: [{
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:x: *수정 요청을 처리하지 못했습니다*\n${error instanceof Error ? error.message : "알 수 없는 오류입니다"}`,
          },
        }],
      });
    }
  },
});
