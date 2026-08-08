import { planPatches } from "~/services/lecture/patch";
import { buildPatchBlocks, buildResultBlocks, convertToReview } from "~/services/lecture/pipeline";
import { findTokenByThread, linkThread, loadReview, savePatchPlan } from "~/services/lecture/reviewStore";
import { downloadSlackFile, findExcelFile } from "~/utils/slackFile";
import { readThreadContext, threadRootOf } from "~/utils/slackThread";
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
    async handler({ client, channel, ts, text, user, files, parentTs }) {
      // 스레드 안에서 다시 실행할 수도 있다. 그때 ts는 그 답글 자신의 것이라
      // 스레드를 대표하는 값(루트)으로 맞춰야 !수정이 찾아갈 수 있다.
      const threadRoot = threadRootOf(ts, parentTs);

      // 한 스레드에 변환이 둘이면 !수정이 어느 것에 적용되는지 헷갈린다.
      // 덮어쓰는 대신 막는다. 만료돼 조회되지 않는 건 막을 이유가 없다.
      if (parentTs) {
        const existing = await findTokenByThread(channel, threadRoot);
        if (existing && (await loadReview(existing))) {
          await client.chat.postMessage({
            channel,
            thread_ts: threadRoot,
            text: "이 스레드에는 이미 변환 결과가 있습니다.",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: [
                    ":no_entry: *이 스레드에는 이미 변환 결과가 있습니다.*",
                    "새 메시지로 시작해주세요. 한 스레드에 둘이 있으면 `!수정`이 어느 것에 적용되는지 알 수 없습니다.",
                  ].join("\n"),
                },
              },
            ],
          });
          return;
        }
      }

      const parsed = parseCommand(text);
      const excel = findExcelFile(files);

      if (!parsed || !excel) {
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
        thread_ts: threadRoot,
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

        // 이 스레드에 온 수정 요청이 어느 변환 건인지 찾을 수 있게 해둔다.
        await linkThread(channel, threadRoot, outcome.token);

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

/**
 * 검토 중 발견한 수정 사항을 스레드에 자연어로 적으면 받는다.
 * 명령어 접두사를 두지 않은 건, 이미 그 스레드가 어느 변환 건인지 정해져 있어서다.
 * 반대로 변환 스레드가 아닌 곳의 대화는 여기까지 오지 않는다.
 */
const EDIT_COMMAND = /^!수정/;

messages.push({
  regex: EDIT_COMMAND,
  async handler({ client, channel, ts, text, user, parentTs }) {
    const request = text.replace(EDIT_COMMAND, "").trim();
    const token = parentTs ? await findTokenByThread(channel, parentTs) : null;
    const stored = token ? await loadReview(token) : null;

    // 변환 스레드가 아니거나 만료됐으면 어디서 써야 하는지 알려준다.
    // 조용히 무시하면 왜 반응이 없는지 알 수 없다.
    if (!parentTs || !stored) {
      await client.chat.postMessage({
        channel,
        thread_ts: ts,
        text: "변환 결과 스레드에서 사용해주세요.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                ":thread: *`!수정`은 변환 결과 스레드 안에서 써주세요.*",
                parentTs
                  ? "이 스레드의 검토 링크가 만료됐거나 변환 기록을 찾지 못했습니다."
                  : "`!강의반영`으로 만든 결과 메시지에 답글로 달아주세요.",
              ].join("\n"),
            },
          },
        ],
      });
      return;
    }

    if (request === "") {
      await client.chat.postMessage({
        channel,
        thread_ts: parentTs,
        text: "무엇을 바꿀지 적어주세요.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                ":pencil: *무엇을 바꿀지 함께 적어주세요.*",
                "예) `!수정 유체역학 03 담당교수를 우창규로 바꿔줘`",
              ].join("\n"),
            },
          },
        ],
      });
      return;
    }

    const placeholder = await client.chat.postMessage({
      channel,
      thread_ts: parentTs,
      text: "수정 요청 확인 중",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: ":mag: 수정 요청을 확인하는 중…" } },
      ],
    });
    const messageTs = placeholder.ts as string;

    try {
      const context = await readThreadContext(client, channel, parentTs, ts);
      const plan = await planPatches(request, stored.lectures, stored.timeFormat, context);

      if (plan.patches.length === 0 && plan.ambiguities.length === 0) {
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
                  ...plan.problems.map((p) => `• ${p}`),
                ].join("\n"),
              },
            },
          ],
        });
        return;
      }

      const patchToken = await savePatchPlan(token, plan);
      await client.chat.update({
        channel,
        ts: messageTs,
        text: `수정 ${plan.patches.length}건 확인`,
        blocks: buildPatchBlocks(plan, patchToken, user),
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
