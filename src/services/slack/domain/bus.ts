import { registerBusAttachment } from "~/services/bus/attachmentCommand";
import { busActionValue, buildBusPatchBlocks } from "~/services/bus/pipeline";
import { downloadSlackSpreadsheet, findSpreadsheetFile } from "~/utils/slackFile";
import { findJobByThread } from "~/services/bus/workflow";
import { saveBusPatchPlan } from "~/services/bus/reviewStore";
import { planBusPatches } from "~/services/bus/patch";
import { readThreadContext, threadRootOf } from "~/utils/slackThread";
import type { MessageSetting } from "../type";

const COMMAND = /^!버스반영/;
/** `!버스반영` — 버스 명령은 파일 첨부만 받으므로 완전 일치만 인정한다. */
const ARGS = /^!버스반영\s*$/;

/** 사람이 직접 치는 값이라 규칙을 한 곳에 모아두고 테스트로 고정한다. */
export function parseBusCommand(text: string): boolean {
  return ARGS.test(text.trim());
}

const USAGE = [
  "*사용법* — 버스 시간표 파일을 올리면서 메시지에 함께 적어주세요.",
  "```!버스반영```",
  "지원 형식은 `.xls` `.xlsx` `.csv`입니다.",
].join("\n");

export const messages: MessageSetting[] = [
  {
    regex: COMMAND,
    acceptsFiles: true,
    async handler({ client, channel, ts, text, user, files, parentTs }) {
      // 스레드 안에서 다시 실행할 수도 있다. 그때 ts는 그 답글 자신의 것이라
      // 스레드를 대표하는 값(루트)으로 맞춰야 !수정이 찾아갈 수 있다.
      const threadRoot = threadRootOf(ts, parentTs);
      const file = findSpreadsheetFile(files);

      if (!parseBusCommand(text) || !file) {
        await client.chat.postMessage({
          channel,
          thread_ts: threadRoot,
          text: "사용법을 확인해주세요.",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: [
                  !file ? ":file_folder: 버스 시간표 파일(xls/xlsx/csv)을 함께 올려주세요." : null,
                  !parseBusCommand(text) ? ":pencil: `!버스반영`만 입력해주세요." : null,
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

      const placeholder = await client.chat.postMessage({
        channel,
        thread_ts: threadRoot,
        text: "파일 검증 중",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:hourglass_flowing_sand: *버스 시간표 파일 검증 중…*\n${file.name}`,
            },
          },
        ],
      });
      const messageTs = placeholder.ts as string;

      try {
        const bytes = await downloadSlackSpreadsheet(file);
        const job = await registerBusAttachment(file, bytes, user);
        if (!job) throw new Error("반영 작업을 생성하지 못했습니다.");

        await client.chat.update({
          channel,
          ts: messageTs,
          text: "버스 시간표 반영: 변환 시작 승인 대기",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*버스 시간표 반영*\n첨부: ${file.name}\nSHA-256: \`${job.source_hash}\`\n변환을 시작할까요?`,
              },
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  action_id: "bus:start",
                  text: { type: "plain_text", text: "예" },
                  style: "primary",
                  value: busActionValue(job),
                },
                {
                  type: "button",
                  action_id: "bus:cancel",
                  text: { type: "plain_text", text: "아니요" },
                  style: "danger",
                  value: busActionValue(job),
                },
              ],
            },
            {
              type: "context",
              elements: [{ type: "mrkdwn", text: `${file.name} · 요청: <@${user}>` }],
            },
          ],
        });
      } catch (error) {
        await client.chat.update({
          channel,
          ts: messageTs,
          text: "파일 검증 실패",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `:x: *파일 검증 실패*\n${
                  error instanceof Error ? error.message : "알 수 없는 오류입니다"
                }`,
              },
            },
            {
              type: "context",
              elements: [{ type: "mrkdwn", text: `${file.name} · 요청: <@${user}>` }],
            },
          ],
        });
      }
    },
  },
];

/**
 * 검수 중 발견한 수정 사항을 스레드에 자연어로 적으면 받는다.
 * 스레드가 어느 job에 바인딩됐는지로 대상을 찾는다. 검수 메시지의 "수정 요청" 버튼을
 * 누르면 그 메시지의 스레드가 job에 묶이므로, 먼저 버튼을 눌러야 한다.
 */
const EDIT_COMMAND = /^!수정/;

messages.push({
  regex: EDIT_COMMAND,
    async handler({ client, channel, ts, text, user, parentTs }) {
      const request = text.replace(EDIT_COMMAND, "").trim();
      const threadTs = threadRootOf(ts, parentTs);

    // 강의 변환 스레드는 lecture 도메인이 처리한다. 여기 오는 건 버스 스레드거나
    // 어느 쪽도 아닌 스레드인데, 후자는 lecture 핸들러가 안내하므로 조용히 빠진다.
    const job = await findJobByThread(channel, threadTs);
    if (!job) return;

    if (request === "") {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: "무엇을 바꿀지 적어주세요.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                ":pencil: *무엇을 바꿀지 함께 적어주세요.*",
                "예) `!수정 천안역 1회 터미널 시간을 08:05로 바꿔줘`",
              ].join("\n"),
            },
          },
        ],
      });
      return;
    }

    if (!["REVIEW_PENDING", "REVISION_REQUESTED"].includes(job.state)) {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: "검수 중인 상태에서만 수정할 수 있습니다.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":no_entry: *지금은 수정할 수 없습니다.*\n검수 메시지의 버튼으로 승인·반영이 끝난 뒤엔 수정이 불가능합니다.",
            },
          },
        ],
      });
      return;
    }

    if (!job.conversions?.length) {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: "변환 결과가 없습니다.",
      });
      return;
    }

    const placeholder = await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: "수정 요청 확인 중",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: ":mag: 수정 요청을 확인하는 중…" } },
      ],
    });
    const messageTs = placeholder.ts as string;

    try {
      const context = await readThreadContext(client, channel, threadTs, ts);
      const plan = await planBusPatches(request, job.conversions, context);

      if (plan.patches.length === 0) {
        await client.chat.update({
          channel,
          ts: messageTs,
          text: "수정할 내용을 찾지 못했습니다",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: [
                  ":grey_question: *수정할 내용을 찾지 못했습니다.*",
                  ...plan.problems.map((problem) => `• ${problem}`),
                ].join("\n"),
              },
            },
          ],
        });
        return;
      }

      const patchToken = await saveBusPatchPlan(job.id, {
        patches: plan.patches,
        problems: plan.problems,
        request,
      });
      const value = JSON.stringify({
        job_id: job.id,
        state_version: job.state_version,
        payload_hash: job.payload_hash ?? job.source_hash,
        patch_token: patchToken,
      });
      await client.chat.update({
        channel,
        ts: messageTs,
        text: `수정 ${plan.patches.length}건 확인`,
        blocks: buildBusPatchBlocks(plan, value, user),
      });
    } catch (error) {
      await client.chat.update({
        channel,
        ts: messageTs,
        text: "수정 요청 처리 실패",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:x: *수정 요청을 처리하지 못했습니다*\n${
                error instanceof Error ? error.message : "알 수 없는 오류입니다"
              }`,
            },
          },
        ],
      });
    }
  },
});
