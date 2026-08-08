import {
  buildRegularCoopResultBlocks,
  buildVacationCoopResultBlocks,
  convertRegularCoopToReview,
  convertVacationCoopToReview,
  extractVacationCoopImage,
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
import { coopTargetLabel, resolveCoopTarget } from "~/services/coop/target";
import type { MessageSetting } from "../type";
import {
  dropPendingCoopVacation,
  loadPendingCoopVacation,
  savePendingCoopVacation,
} from "~/services/coop/vacationStore";

const COMMAND = /^!생협반영/;
const ARGS = /^!생협반영\s+(\d{4})\s*(1학기|2학기|하계방학|동계방학)\s*$/;

export type CoopCommand =
  | { year: number; kind: "regular"; termName: "1학기" | "2학기" }
  | { year: number; kind: "vacation"; season: "하계" | "동계"; termName: "하계방학" | "동계방학" };

export function parseCoopCommand(
  text: string,
): CoopCommand | null {
  const matched = ARGS.exec(text.trim());
  if (!matched) return null;
  const year = Number(matched[1]);
  const termName = matched[2];
  if (termName === "1학기" || termName === "2학기") {
    return { year, kind: "regular", termName };
  }
  return {
    year,
    kind: "vacation",
    season: termName.startsWith("하계") ? "하계" : "동계",
    termName: termName as "하계방학" | "동계방학",
  };
}

const USAGE = [
  "*사용법* — 생협 운영시간 이미지를 올리면서 메시지에 함께 적어주세요.",
  "```!생협반영 2026 1학기```",
  "```!생협반영 2026 하계방학```",
  "방학 시간표는 이미지 추출 후 방학 시작일을 추가로 입력받습니다.",
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
              !parsed ? ":pencil: 연도와 정규학기 또는 하계·동계방학을 적어주세요." : null,
              "",
              USAGE,
            ].filter((line) => line !== null).join("\n"),
          },
        }],
      });
      return;
    }

    const resolved = resolveCoopTarget(channel);
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
          text: `:hourglass_flowing_sand: *${target.year} ${target.termName} 생협 운영시간* 변환 중…\n${coopTargetLabel(target.env)} · ${image.name}`,
        },
      }],
    });
    const messageTs = placeholder.ts as string;

    try {
      const downloaded = await downloadSlackImage(image);
      if (parsed.kind === "vacation") {
        const raw = await extractVacationCoopImage({
          image: downloaded.buffer,
          mimeType: downloaded.mimeType,
          fileName: image.name,
        });
        await savePendingCoopVacation(channel, threadRoot, {
          env: target.env,
          year: parsed.year,
          season: parsed.season,
          fileName: image.name,
          requesterId: user,
          raw,
        });
        await client.chat.update({
          channel,
          ts: messageTs,
          text: "방학 시작일 입력 대기",
          blocks: [{
            type: "section",
            text: { type: "mrkdwn", text: [
              `:calendar: *${parsed.year} ${parsed.season} 운영시간을 읽었습니다.*`,
              `전체 기간: ${raw.fromDate} - ${raw.toDate}`,
              "",
              "계절학기와 방학을 나눌 *방학 시작일*을 이 스레드에 입력해주세요.",
              "예) `!학기구분 2026-07-18`",
            ].join("\n") },
          }, {
            type: "context",
            elements: [{ type: "mrkdwn", text: `${image.name} · 입력 대기 24시간 · 요청: <@${user}>` }],
          }],
        });
        return;
      }
      const regularTarget = {
        env: target.env,
        year: parsed.year,
        termName: parsed.termName,
        fileName: image.name,
      };
      const outcome = await convertRegularCoopToReview(
        downloaded.buffer,
        downloaded.mimeType,
        regularTarget,
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
        blocks: buildRegularCoopResultBlocks(outcome, regularTarget, user),
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

export function parseVacationBoundary(text: string): string | null {
  return /^!학기구분\s+(20\d{2}-\d{2}-\d{2})\s*$/.exec(text.trim())?.[1] ?? null;
}

messages.push({
  regex: /^!학기구분/,
  async handler({ client, channel, text, user, parentTs }) {
    if (!parentTs) return;
    const pending = await loadPendingCoopVacation(channel, parentTs);
    if (!pending) return;
    const vacationStartDate = parseVacationBoundary(text);
    if (!vacationStartDate) {
      await client.chat.postMessage({
        channel,
        thread_ts: parentTs,
        text: "방학 시작일 형식을 확인해주세요.",
        blocks: [{ type: "section", text: { type: "mrkdwn", text: ":pencil: `!학기구분 YYYY-MM-DD` 형식으로 입력해주세요." } }],
      });
      return;
    }
    const placeholder = await client.chat.postMessage({
      channel,
      thread_ts: parentTs,
      text: "생협 방학 시간표 분리 중",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `:hourglass_flowing_sand: *${vacationStartDate}* 기준으로 계절학기와 방학을 나누는 중…` } }],
    });
    const messageTs = placeholder.ts as string;
    try {
      const target = {
        env: pending.env,
        year: pending.year,
        season: pending.season,
        fileName: pending.fileName,
      };
      const outcome = await convertVacationCoopToReview(pending.raw, vacationStartDate, target);
      await dropPendingCoopVacation(channel, parentTs);
      await linkCoopThread(channel, parentTs, outcome.token);
      await createCoopJob({
        token: outcome.token,
        channelId: channel,
        threadTs: messageTs,
        year: target.year,
        term: `${target.season}계절학기·${target.season}방학`,
        sourceFile: target.fileName,
        shopCount: outcome.shopCount,
        targetEnv: target.env,
      });
      await client.chat.update({
        channel,
        ts: messageTs,
        text: `${target.year} ${target.season} 생협 운영시간 변환 완료`,
        blocks: buildVacationCoopResultBlocks(outcome, target, user),
      });
    } catch (error) {
      await client.chat.update({
        channel,
        ts: messageTs,
        text: "생협 방학 시간표 분리 실패",
        blocks: [{ type: "section", text: { type: "mrkdwn", text: `:x: *분리 실패*\n${error instanceof Error ? error.message : "알 수 없는 오류입니다"}` } }],
      });
    }
  },
});

const EDIT_COMMAND = /^!수정/;

messages.push({
  regex: EDIT_COMMAND,
  async handler({ client, channel, ts, text, user, parentTs }) {
    if (!parentTs) return;
    const token = await findCoopTokenByThread(channel, parentTs);
    if (!token) return;

    let request = text.replace(EDIT_COMMAND, "").trim();
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
    let periodIndex: number | undefined;
    let conversion = stored.conversion;
    if (stored.periods) {
      const selected = /^(계절학기|방학)\s+/.exec(request);
      if (!selected) {
        await client.chat.postMessage({
          channel,
          thread_ts: parentTs,
          text: "수정할 학기를 적어주세요.",
          blocks: [{
            type: "section",
            text: { type: "mrkdwn", text: [
              ":pencil: 방학 시간표는 수정할 학기를 먼저 적어주세요.",
              "예) `!수정 방학 복지관식당 평일을 미운영으로 바꿔줘`",
              "예) `!수정 계절학기 복지관식당 평일을 11:40 - 13:30으로 바꿔줘`",
            ].join("\n") },
          }],
        });
        return;
      }
      periodIndex = selected[1] === "계절학기" ? 0 : 1;
      conversion = stored.periods[periodIndex].conversion;
      request = request.slice(selected[0].length).trim();
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
      const plan = await planCoopPatches(request, conversion, context);
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
      const patchToken = await saveCoopPatchPlan(token, { ...plan, periodIndex });
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
