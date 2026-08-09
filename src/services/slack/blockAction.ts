import { AdminApiError, buildAdminRequest, ensureSemester, submitLectures, toAdminTerm } from "~/services/lecture/adminApi";
import {
  collectExcelAttachments,
  downloadNoticeFile,
  dropDetected,
  fetchArticle,
  guessSemester,
  loadDetected,
  saveDetected,
} from "~/services/lecture/detected";
import type { AttachmentFile } from "~/services/lecture/detected";
import { cancelJob, claimJob, createJob, finishJob } from "~/services/lecture/jobStore";
import { getKoinAdminAuth } from "~/services/koin/adminAuth";
import { linkThread } from "~/services/lecture/reviewStore";
import { labelOf, resolveTarget, resolveTargetByEnv } from "~/services/koin/target";
import type { KoinEnv } from "~/services/koin/target";
import { applyPatches, resolveAmbiguities } from "~/services/lecture/patch";
import {
  buildPatchBlocks,
  buildResultBlocks,
  buildStoredReview,
  convertToReview,
} from "~/services/lecture/pipeline";
import {
  dropPatchPlan,
  loadPatchPlan,
  loadReview,
  savePatchPlan,
  updateReview,
} from "~/services/lecture/reviewStore";
import {
  BUS_APPLY_ACTION_IDS,
  BUS_PATCH_ACTION_IDS,
  handleBusApplyAction,
  handleBusPatchAction,
} from "./busAction";
import {
  BUS_DETECTED_ACTION_IDS,
  handleBusDetectedAction,
} from "./busDetectedAction";
import {
  COOP_DETECTED_ACTION_IDS,
  handleCoopDetectedAction,
} from "./coopDetectedAction";
import {
  COOP_APPLY_ACTION_IDS,
  handleCoopApplyAction,
} from "./coopApplyAction";
import { applyCoopPatches } from "~/services/coop/patch";
import { buildCoopApplyButtons } from "~/services/coop/pipeline";
import { renderRegularCoopReview, renderVacationCoopReview } from "~/services/coop/reviewHtml";
import {
  dropCoopPatchPlan,
  loadCoopPatchPlan,
  loadCoopReview,
  updateCoopReview,
} from "~/services/coop/reviewStore";
import { acquireDetectLock, releaseDetectLock } from "~/services/koin/detectLock";
import type { BlockActionSetting } from "./type";

const busApplyAction = (actionId: string): BlockActionSetting => ({
  actionId,
  async handler({ client, body, action }) {
    await handleBusApplyAction(client, body, action);
  },
});
const busPatchAction = (actionId: string): BlockActionSetting => ({
  actionId,
  async handler({ client, body, action }) {
    await handleBusPatchAction(client, body, action);
  },
});
const busDetectedAction = (actionId: string): BlockActionSetting => ({
  actionId,
  async handler({ client, body, action }) {
    await handleBusDetectedAction(client, body, action);
  },
});
const coopDetectedAction = (actionId: string): BlockActionSetting => ({
  actionId,
  async handler({ client, body, action }) {
    await handleCoopDetectedAction(client, body, action);
  },
});
const coopApplyAction = (actionId: string): BlockActionSetting => ({
  actionId,
  async handler({ client, body, action }) {
    await handleCoopApplyAction(client, body, action);
  },
});
// 버튼·셀렉트 조작(block_actions) 핸들러 목록.
// 등록하지 않은 action_id는 라우터에서 무시된다. 모달 안의 select와 URL 링크 버튼도
// block_actions로 들어오는데, 그것들은 여기서 처리할 대상이 아니기 때문이다.
/**
 * 버튼이 달린 원본 메시지를 갈아끼운다.
 *
 * `chat.update`를 쓰지 않는 건 배치가 **웹훅으로** 올린 메시지이기 때문이다.
 * 작성자가 봇 토큰이 아니라 `cant_update_message`로 거절당한다.
 * 버튼 클릭에 딸려 오는 response_url은 그 제약이 없다.
 */
async function replaceOriginal(
  responseUrl: string | undefined,
  text: string,
  blocks: Parameters<typeof updateSlack>[0]["blocks"],
) {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ replace_original: true, text, blocks }),
  });
}

const notice = (mrkdwn: string) => [
  { type: "section" as const, text: { type: "mrkdwn" as const, text: mrkdwn } },
];

/** 버튼이 너무 많으면 읽히지 않는다. 넘치면 명령어로 직접 올리는 편이 낫다. */
const MAX_CHOICES = 4;

/** 버튼 글자가 길면 잘려서 무엇인지 알 수 없다. */
function shorten(name: string): string {
  return name.length > 28 ? `${name.slice(0, 27)}…` : name;
}

/**
 * 고른 파일을 내려받아 변환하고 검토 링크까지 올린다.
 * 첨부가 하나일 때와 골랐을 때가 여기서 만난다.
 */
async function runConversion({
  client, channel, ts, actor, env, file, year, term,
}: {
  client: Parameters<BlockActionSetting["handler"]>[0]["client"];
  channel: string;
  ts: string | undefined;
  actor: string;
  env: KoinEnv;
  file: AttachmentFile;
  year: number;
  term: string;
}) {
  const target = { env, year, termName: term, fileName: file.name };

  await updateSlack({
    client, channel, ts,
    text: "변환 중",
    blocks: [{ type: "section", text: { type: "mrkdwn",
      text: `:hourglass_flowing_sand: *${year} ${term}* 변환 중…\n${labelOf(env)} · ${file.name}\n작업자: <@${actor}>` } }],
  });

  try {
    const buffer = await downloadNoticeFile(file.url);
    const outcome = await convertToReview(buffer, target);

    // 이 메시지 스레드에 온 수정 요청이 어느 변환 건인지 찾을 수 있게 해둔다.
    await linkThread(channel, ts ?? "", outcome.token);
    await createJob({
      token: outcome.token,
      channelId: channel,
      threadTs: ts ?? "",
      year,
      term,
      sourceFile: file.name,
      lectureCount: outcome.lectureCount,
      targetEnv: env,
    });

    await updateSlack({
      client, channel, ts,
      text: `${year} ${term} 변환 완료 · ${outcome.lectureCount}건`,
      blocks: buildResultBlocks(outcome, target, actor),
    });
  } catch (error) {
    await updateSlack({
      client, channel, ts,
      text: "변환 실패",
      blocks: [
        { type: "section", text: { type: "mrkdwn",
          text: `:x: *변환 실패*\n${error instanceof Error ? error.message : "알 수 없는 오류입니다"}` } },
        { type: "context", elements: [{ type: "mrkdwn",
          text: `${file.name} · 작업자: <@${actor}>` }] },
      ],
    });
  }
}

export const blockActions: BlockActionSetting[] = [
  ...COOP_DETECTED_ACTION_IDS.map(coopDetectedAction),
  ...COOP_APPLY_ACTION_IDS.map(coopApplyAction),
  {
    /**
     * 배치가 올린 감지 알림의 `예`.
     *
     * 배치가 아는 건 **이 action_id와 `article_id` 하나**뿐이다. 첨부·학기·경고 문구는
     * 전부 여기서 만든다. 되돌릴 수 없는 작업을 막는 장치가 두 레포로 흩어지면,
     * 한쪽만 고쳤을 때 나머지 한쪽은 옛날 그대로 남는다.
     */
    actionId: "lecture:detected",
    async handler({ client, body, action }) {
      if (action.type !== "button" || !body.channel) return;

      const { article_id: articleId } = JSON.parse(action.value ?? "{}") as {
        article_id?: number;
      };
      const channel = body.channel.id;
      const actor = body.user.id;
      const responseUrl = body.response_url;
      if (!articleId) return;

      // 어느 코인에 반영할지는 채널로 정한다. 배치는 웹훅을 고르는 것으로 이미 답했다.
      const resolved = resolveTarget(channel, "강의");
      if (!resolved.ok || !resolved.target) {
        await replaceOriginal(responseUrl, "대상 아님", notice(`:x: ${resolved.reason}`));
        return;
      }
      const env = resolved.target.env;

      // 버튼을 지우는 것만으로는 두 번 눌리는 걸 막지 못한다. 원본을 갈아끼우기 전에
      // 잠근다 — 변환이 두 번 돌면 검토 링크와 [반영] 버튼이 둘씩 생기고,
      // 그 둘은 토큰이 달라 반영 락에도 걸리지 않는다.
      const lock = await acquireDetectLock("lecture", channel, articleId, actor);
      if (!lock.ok) {
        await client.chat.postEphemeral({
          channel,
          user: actor,
          text: lock.actor
            ? `<@${lock.actor}>님이 이미 이 공지를 진행 중입니다.`
            : "이미 진행 중인 공지입니다.",
        });
        return;
      }

      // 배치 메시지는 여기서 역할이 끝난다. 이후 갱신은 봇이 올린 메시지에서 한다.
      await replaceOriginal(responseUrl, "진행합니다", notice(
        `:white_check_mark: *강의 업데이트를 진행합니다.* · ${labelOf(env)}\n<@${actor}>`,
      ));

      const posted = await client.chat.postMessage({
        channel,
        text: "게시글 확인 중",
        blocks: notice(`:hourglass_flowing_sand: 게시글을 확인하고 있습니다…`),
      });
      const ts = posted.ts;
      if (!ts) {
        // ts가 없으면 이후 갱신도, 스레드 연결도 할 수 없다. 빈 문자열로 이어가면
        // 다음 변환이 같은 스레드 키를 덮어써서 `!수정`이 엉뚱한 건에 붙는다.
        await releaseDetectLock("lecture", channel, articleId);
        throw new Error("메시지를 올리지 못해 진행할 수 없습니다.");
      }

      const say = (text: string, mrkdwn: string) =>
        updateSlack({ client, channel, ts, text, blocks: notice(mrkdwn) });

      let article: Awaited<ReturnType<typeof fetchArticle>>;
      try {
        article = await fetchArticle(articleId);
      } catch (error) {
        await releaseDetectLock("lecture", channel, articleId);
        await say("게시글 조회 실패",
          `:x: *게시글을 읽지 못했습니다.*\n${error instanceof Error ? error.message : ""}`);
        return;
      }

      const files = collectExcelAttachments(article.attachments);
      if (files.length === 0) {
        await releaseDetectLock("lecture", channel, articleId);
        await say("첨부 없음", [
          ":grey_question: *엑셀 첨부를 찾지 못했습니다.*",
          `<${article.url ?? ""}|${article.title ?? `게시글 ${articleId}`}>`,
          "파일을 직접 올리고 `!강의반영 2026 여름학기`로 실행해주세요.",
        ].join("\n"));
        return;
      }

      // 학기를 모르면 진행하지 않는다. 엉뚱한 학기에 넣으면 되돌릴 수 없다.
      const semester = guessSemester(article.title ?? "");
      if (!semester) {
        await releaseDetectLock("lecture", channel, articleId);
        await say("학기를 지정해주세요", [
          ":grey_question: *제목에서 학기를 읽지 못했습니다.*",
          "엑셀을 내려받아 `!강의반영 2026 여름학기`처럼 직접 올려주세요.",
          ...files.map((file) => `<${file.url}|${file.name}>`),
        ].join("\n"));
        return;
      }

      // 엑셀이 여럿이면 사람이 고른다. 편람 외에 폐강강좌·시간표가 함께 붙는다.
      if (files.length > 1) {
        const token = await saveDetected({
          target: env,
          articleId,
          articleTitle: article.title ?? `게시글 ${articleId}`,
          articleUrl: article.url ?? "",
          files,
          ...semester,
        });

        await updateSlack({
          client, channel, ts,
          text: "변환할 파일을 골라주세요",
          blocks: [
            ...notice([
              `:page_facing_up: *${semester.year} ${semester.term}* · ${labelOf(env)}`,
              `엑셀 첨부가 *${files.length}개* 입니다. 변환할 파일을 골라주세요.`,
              "",
              ...files.slice(0, MAX_CHOICES).map((file, i) => `${i + 1}. ${file.name}`),
            ].join("\n")),
            { type: "actions", elements: [
              ...files.slice(0, MAX_CHOICES).map((file, index) => ({
                type: "button" as const,
                text: { type: "plain_text" as const, text: shorten(file.name), emoji: true },
                style: index === 0 ? ("primary" as const) : undefined,
                action_id: `lecture:detected_start${index === 0 ? "" : `_${index}`}`,
                value: JSON.stringify({ token, fileIndex: index }),
              })),
              {
                type: "button" as const,
                text: { type: "plain_text" as const, text: "아니요", emoji: true },
                action_id: "lecture:detected_ignore",
                value: JSON.stringify({ token }),
              },
            ] },
          ],
        });
        return;
      }

      await runConversion({
        client, channel, ts, actor,
        env, file: files[0], ...semester,
      });
    },
  },
  // 엑셀이 여럿일 때 고른 파일로 이어간다. 버튼마다 action_id가 달라야 해서 나눠 둔다.
  ...[0, 1, 2, 3].map((slot) => ({
    actionId: slot === 0 ? "lecture:detected_start" : `lecture:detected_start_${slot}`,
    async handler({ client, body, action }: Parameters<BlockActionSetting["handler"]>[0]) {
      if (action.type !== "button" || !body.channel) return;

      const { token, fileIndex = 0 } = JSON.parse(action.value ?? "{}") as {
        token?: string;
        fileIndex?: number;
      };
      const channel = body.channel.id;
      const ts = body.message?.ts;
      const actor = body.user.id;
      if (!token) return;

      const notice = await loadDetected(token);
      const file = notice?.files[fileIndex];
      if (!notice || !file || !notice.year || !notice.term) {
        await updateSlack({
          client, channel, ts,
          text: "만료됨",
          blocks: [{ type: "section", text: { type: "mrkdwn",
            text: ":x: 이미 처리했거나 만료된 알림입니다." } }],
        });
        return;
      }

      // 먼저 지운다. 두 명이 눌러 두 번 변환하면 검토 링크가 둘이 된다.
      await dropDetected(token);

      await runConversion({
        client, channel, ts, actor,
        env: notice.target, file, year: notice.year, term: notice.term,
      });
    },
  })),
  {
    actionId: "lecture:detected_ignore",
    async handler({ client, body, action }) {
      if (action.type !== "button" || !body.channel) return;

      const { token } = JSON.parse(action.value ?? "{}") as { token?: string };
      if (token) {
        await dropDetected(token);
      }

      // 배치가 웹훅으로 올린 메시지일 수 있어 response_url로 바꾼다.
      await replaceOriginal(body.response_url, "무시함",
        notice(`:no_entry_sign: *이 공지는 넘어갑니다.*\n<@${body.user.id}>`));
    },
  },
  {
    actionId: "coop:patch_apply",
    async handler({ client, body, action }) {
      if (action.type !== "button" || !body.channel) return;
      const { patchToken } = JSON.parse(action.value ?? "{}") as { patchToken?: string };
      const channel = body.channel.id;
      const ts = body.message?.ts;
      const actor = body.user.id;
      if (!patchToken) return;

      const plan = await loadCoopPatchPlan(patchToken);
      if (!plan) {
        await updateSlack({
          client, channel, ts, text: "만료됨",
          blocks: notice(":x: 이미 처리했거나 만료된 생협 수정 요청입니다."),
        });
        return;
      }
      // 두 사람이 동시에 같은 버튼을 눌러도 한 번만 적용한다.
      await dropCoopPatchPlan(patchToken);

      try {
        const stored = await loadCoopReview(plan.reviewToken);
        if (!stored?.conversion) {
          await updateSlack({
            client, channel, ts, text: "검토 만료",
            blocks: notice(":x: 생협 검토 링크가 만료됐거나 수정 가능한 변환 데이터가 없습니다. 다시 변환해주세요."),
          });
          return;
        }
        const selected = plan.periodIndex === undefined
          ? stored.conversion
          : stored.periods?.[plan.periodIndex]?.conversion;
        if (!selected) throw new Error("수정할 학기 데이터를 찾지 못했습니다.");
        const conversion = applyCoopPatches(selected, plan.patches);
        const periods = stored.periods?.map((period, index) =>
          index === plan.periodIndex
            ? { ...period, conversion, request: conversion.request }
            : period);
        const blockingCount = periods
          ? periods.reduce((count, period) =>
            count + period.conversion.issues.filter((issue) => issue.severity === "blocking").length, 0)
          : conversion.issues.filter((issue) => issue.severity === "blocking").length;
        const primary = periods?.[0]?.conversion ?? conversion;
        const html = periods
          ? renderVacationCoopReview({
            year: stored.meta.year,
            season: stored.meta.termName.startsWith("하계") ? "하계" : "동계",
            vacationStartDate: periods[1].conversion.fromDate,
            seasonal: periods[0].conversion,
            vacation: periods[1].conversion,
          })
          : renderRegularCoopReview(conversion);
        await updateCoopReview(plan.reviewToken, {
          ...stored,
          conversion: primary,
          request: primary.request,
          periods,
          html,
          meta: { ...stored.meta, blockingCount },
        });
        await updateSlack({
          client, channel, ts,
          text: `생협 수정 ${plan.patches.length}건 적용`,
          blocks: [
            ...notice(`:white_check_mark: *생협 수정 ${plan.patches.length}건 적용*\n검토 페이지를 새로고침하면 반영돼 있습니다.`),
            ...(blockingCount > 0
              ? notice(`:warning: 확인이 필요한 항목이 *${blockingCount}건* 남아 있습니다.`)
              : []),
            {
              type: "actions" as const,
              elements: buildCoopApplyButtons(
                plan.reviewToken,
                stored.meta.env,
                stored.meta.shopCount,
              ),
            },
            { type: "context", elements: [{ type: "mrkdwn", text: `작업자: <@${actor}>` }] },
          ],
        });
      } catch (error) {
        await updateSlack({
          client, channel, ts, text: "생협 수정 실패",
          blocks: notice(`:x: *생협 수정 적용 실패*\n${error instanceof Error ? error.message : "알 수 없는 오류입니다"}`),
        });
      }
    },
  },
  {
    actionId: "coop:patch_cancel",
    async handler({ client, body, action }) {
      if (action.type !== "button" || !body.channel) return;
      const { patchToken } = JSON.parse(action.value ?? "{}") as { patchToken?: string };
      if (patchToken) await dropCoopPatchPlan(patchToken);
      await updateSlack({
        client,
        channel: body.channel.id,
        ts: body.message?.ts,
        text: "생협 수정 취소됨",
        blocks: notice(`:no_entry_sign: *생협 수정을 취소했습니다.*\n<@${body.user.id}>`),
      });
    },
  },
  // 교시/시각 선택. LLM에 다시 묻지 않고 이미 계산해둔 두 해석 중 하나를 고른다.
  ...(["period", "clock"] as const).map((mode) => ({
    actionId: mode === "period" ? "lecture:time_period" : "lecture:time_clock",
    async handler({ client, body, action }: Parameters<BlockActionSetting["handler"]>[0]) {
      if (action.type !== "button" || !body.channel) return;

      const { patchToken, requesterId } = JSON.parse(action.value ?? "{}") as {
        patchToken?: string;
        requesterId?: string;
      };
      const channel = body.channel.id;
      const ts = body.message?.ts;
      if (!patchToken) return;

      const plan = await loadPatchPlan(patchToken);
      if (!plan) {
        await updateSlack({
          client, channel, ts,
          text: "만료됨",
          blocks: [{ type: "section", text: { type: "mrkdwn",
            text: ":x: 이미 처리했거나 만료된 수정 요청입니다." } }],
        });
        return;
      }
      await dropPatchPlan(patchToken);

      const resolved = {
        patches: [...plan.patches, ...resolveAmbiguities(plan.ambiguities, mode)],
        ambiguities: [],
        problems: plan.problems,
      };
      const nextToken = await savePatchPlan(plan.reviewToken, resolved);

      await updateSlack({
        client, channel, ts,
        text: `수정 ${resolved.patches.length}건 확인`,
        blocks: buildPatchBlocks(resolved, nextToken, requesterId ?? body.user.id),
      });
    },
  })),
  {
    actionId: "lecture:patch_apply",
    async handler({ client, body, action }) {
      if (action.type !== "button" || !body.channel) return;

      const { patchToken } = JSON.parse(action.value ?? "{}") as { patchToken?: string };
      const channel = body.channel.id;
      const ts = body.message?.ts;
      const actor = body.user.id;
      if (!patchToken) return;

      const say = (text: string, blocks: Parameters<typeof updateSlack>[0]["blocks"]) =>
        updateSlack({ client, channel, ts, text, blocks });

      const plan = await loadPatchPlan(patchToken);
      if (!plan) {
        await say("만료됨", [{ type: "section", text: { type: "mrkdwn",
          text: ":x: 이미 처리했거나 만료된 수정 요청입니다." } }]);
        return;
      }
      // 먼저 지운다. 두 명이 동시에 눌러 두 번 적용되면 안 된다.
      await dropPatchPlan(patchToken);

      try {
        const stored = await loadReview(plan.reviewToken);
        if (!stored) {
          await say("검토 만료", [{ type: "section", text: { type: "mrkdwn",
            text: ":x: 검토 링크가 만료됐습니다. 다시 변환해주세요." } }]);
          return;
        }

        const patched = applyPatches(stored.lectures, plan.patches);
        await updateReview(
          plan.reviewToken,
          buildStoredReview(patched, stored.timeFormat, {
            env: stored.meta.env,
            year: stored.meta.year,
            termName: stored.meta.termName,
            fileName: stored.meta.sourceFileName,
          }),
        );

        await say(`수정 ${plan.patches.length}건 적용`, [
          { type: "section", text: { type: "mrkdwn",
            text: `:white_check_mark: *수정 ${plan.patches.length}건 적용*\n검토 페이지를 새로고침하면 반영돼 있습니다.` } },
          { type: "context", elements: [{ type: "mrkdwn", text: `작업자: <@${actor}>` }] },
        ]);
      } catch (error) {
        await say("수정 실패", [{ type: "section", text: { type: "mrkdwn",
          text: `:x: *수정 적용 실패*\n${error instanceof Error ? error.message : "알 수 없는 오류입니다"}` } }]);
      }
    },
  },
  {
    actionId: "lecture:patch_cancel",
    async handler({ client, body, action }) {
      if (action.type !== "button" || !body.channel) return;

      const { patchToken } = JSON.parse(action.value ?? "{}") as { patchToken?: string };
      if (patchToken) {
        await dropPatchPlan(patchToken);
      }

      await updateSlack({
        client,
        channel: body.channel.id,
        ts: body.message?.ts,
        text: "수정 취소됨",
        blocks: [{ type: "section", text: { type: "mrkdwn",
          text: `:no_entry_sign: *수정을 취소했습니다.*\n<@${body.user.id}>` } }],
      });
    },
  },
  {
    actionId: "lecture:apply",
    async handler({ client, body, action }) {
      if (action.type !== "button" || !body.channel) return;

      const { token } = JSON.parse(action.value ?? "{}") as { token?: string };
      const channel = body.channel.id;
      const ts = body.message?.ts;
      const actor = body.user.id;

      if (!token) return;

      // 반영 권한을 한 명만 갖게 한다. 두 번 들어가면 손으로 못 지운다.
      // 프로세스 메모리가 아니라 DB에 둬서 재배포해도 풀리지 않는다.
      const claim = await claimJob(token, actor);
      if (!claim.ok) {
        await client.chat.postEphemeral({
          channel,
          user: actor,
          text: claim.reason ?? "지금은 반영할 수 없습니다.",
        });
        return;
      }

      // 실패 메시지에서도 규모를 말해야 해서 try 밖에 둔다.
      let lectureCount = 0;

      try {
        const stored = await loadReview(token);
        if (!stored) {
          await finishJob(token, "FAILED", "검토 링크 만료");
          await updateSlack({
            client, channel, ts,
            text: "검토 링크 만료",
            blocks: [{ type: "section", text: { type: "mrkdwn",
              text: ":x: 검토 링크가 만료됐습니다. 다시 변환해주세요." } }],
          });
          return;
        }

        lectureCount = stored.meta.lectureCount;

        await updateSlack({
          client, channel, ts,
          text: "반영 중",
          blocks: [{ type: "section", text: { type: "mrkdwn",
            text: `:hourglass_flowing_sand: *반영 중…* ${stored.meta.lectureCount}건\n작업자: <@${actor}>` } }],
        });

        // 저장된 강의 목록에서 요청을 다시 만든다. 검토 화면이 보여준 것과
        // 실제로 보내는 값이 갈라지지 않게 하려는 것이다.
        const { request } = buildAdminRequest(stored.lectures, {
          year: stored.meta.year,
          term: toAdminTerm(stored.meta.termName),
        });

        // 변환할 때 정해진 환경으로 붙는다. 채널이 바뀌어도 대상은 바뀌지 않는다.
        const resolved = resolveTargetByEnv(stored.meta.env);
        if (!resolved.target) {
          throw new Error(resolved.reason ?? "대상 환경을 찾지 못했습니다.");
        }
        const auth = await getKoinAdminAuth(resolved.target);
        // 학기가 없으면 강의 생성이 404로 막힌다. 이미 있으면 서버가 무시한다.
        await ensureSemester(request, auth);
        await submitLectures(request, auth);
        await finishJob(token, "APPLIED");

        await updateSlack({
          client, channel, ts,
          text: "반영 완료",
          blocks: [
            { type: "section", text: { type: "mrkdwn",
              text: `:white_check_mark: *${stored.meta.year} ${stored.meta.termName} 반영 완료*\n${labelOf(stored.meta.env)} · 강의 *${stored.meta.lectureCount}건*` } },
            { type: "context", elements: [{ type: "mrkdwn",
              text: `작업자: <@${actor}> · ${stored.meta.sourceFileName}` }] },
          ],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "알 수 없는 오류입니다";
        // 실패로 되돌려 원인을 고친 뒤 다시 누를 수 있게 한다.
        await finishJob(token, "FAILED", message);

        // 강의 생성 도중에 났으면 서버가 어디까지 넣었는지 우리는 모른다.
        // 지울 API가 없으니, 다시 누르기 전에 그 사실을 먼저 말한다.
        const mayBePartial = error instanceof AdminApiError && error.stage === "lectures";

        await updateSlack({
          client, channel, ts,
          text: "반영 실패",
          blocks: [
            { type: "section", text: { type: "mrkdwn", text: `:x: *반영 실패*\n${message}` } },
            ...(mayBePartial
              ? notice(
                  ":warning: 강의 생성 중에 멈췄습니다. *일부가 이미 들어갔을 수 있습니다.*\n" +
                    "지우는 API가 없으니, 다시 시도하기 전에 반영 상태를 확인해주세요.",
                )
              : []),
            { type: "actions", elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "다시 시도", emoji: true },
                action_id: "lecture:apply",
                value: JSON.stringify({ token }),
                ...(mayBePartial ? { confirm: {
                  title: { type: "plain_text" as const, text: "다시 반영할까요?" },
                  text: { type: "mrkdwn" as const, text:
                    `*${lectureCount}건*을 다시 보냅니다.\n` +
                    "앞선 시도에서 일부가 이미 들어갔다면 중복될 수 있고, 되돌릴 수 없습니다." },
                  confirm: { type: "plain_text" as const, text: "그래도 반영" },
                  deny: { type: "plain_text" as const, text: "취소" },
                } } : {}),
              },
            ] },
            { type: "context", elements: [{ type: "mrkdwn",
              text: `작업자: <@${actor}> · 원인을 해결한 뒤 눌러주세요.` }] },
          ],
        });
      }
    },
  },
  {
    actionId: "lecture:cancel",
    async handler({ client, body, action }) {
      if (action.type !== "button" || !body.channel) return;

      const { token } = JSON.parse(action.value ?? "{}") as { token?: string };
      const channel = body.channel.id;
      const actor = body.user.id;

      // 이미 반영됐거나 진행 중인 걸 취소한 것처럼 보이게 두면 안 된다.
      if (token && !(await cancelJob(token, actor))) {
        await client.chat.postEphemeral({
          channel,
          user: actor,
          text: "이미 반영됐거나 진행 중이라 취소할 수 없습니다.",
        });
        return;
      }

      await updateSlack({
        client,
        channel,
        ts: body.message?.ts,
        text: "취소됨",
        blocks: [{ type: "section", text: { type: "mrkdwn",
          text: `:no_entry_sign: *반영을 취소했습니다.*\n<@${actor}>` } }],
      });
    },
  },
  {
    // !버튼테스트 데모. 승인 → 진행 상황 갱신 → 완료 순으로 메시지를 덮어쓴다.
    actionId: "demo_button:approve",
    async handler({ client, body, action }) {
      if (action.type !== "button" || !body.channel) return;

      const { requesterId } = JSON.parse(action.value ?? "{}");
      const channel = body.channel.id;
      const ts = body.message?.ts;

      // 누른 직후 아무 반응이 없으면 사람들이 버튼을 또 누른다. 먼저 갱신부터 한다.
      await updateSlack({
        client,
        channel,
        ts,
        text: "처리 중",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:hourglass_flowing_sand: *처리 중...*\n작업자: <@${body.user.id}>`,
            },
          },
        ],
      });

      // 실제 작업 자리. 데모라 지연만 준다.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      await updateSlack({
        client,
        channel,
        ts,
        text: "처리 완료",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:white_check_mark: *처리 완료*\n작업자: <@${body.user.id}>`,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `요청: <@${requesterId}> · 버튼 핸들러 동작 확인용 데모입니다.`,
              },
            ],
          },
        ],
      });
    },
  },
  {
    actionId: "demo_button:reject",
    async handler({ client, body, action }) {
      if (action.type !== "button" || !body.channel) return;

      await updateSlack({
        client,
        channel: body.channel.id,
        ts: body.message?.ts,
        text: "취소됨",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:no_entry_sign: *취소했습니다.*\n<@${body.user.id}>`,
            },
          },
        ],
      });
    },
  },
  ...BUS_APPLY_ACTION_IDS.map(busApplyAction),
  ...BUS_PATCH_ACTION_IDS.map(busPatchAction),
  ...BUS_DETECTED_ACTION_IDS.map(busDetectedAction),
];
