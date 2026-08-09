import {
  AdminApiError,
  buildAdminRequest,
  ensureSemester,
  submitLectures,
  toAdminTerm,
} from "~/services/lecture/adminApi";
import { cancelJob, claimJob, finishJob } from "~/services/lecture/jobStore";
import { getKoinAdminAuth } from "~/services/koin/adminAuth";
import { labelOf, resolveTargetByEnv } from "~/services/koin/target";
import { applyPatches, resolveAmbiguities } from "~/services/lecture/patch";
import { buildPatchBlocks, buildStoredReview } from "~/services/lecture/pipeline";
import {
  dropPatchPlan,
  loadPatchPlan,
  loadReview,
  savePatchPlan,
  updateReview,
} from "~/services/lecture/reviewStore";
import { notice } from "./notice";
import type { BlockActionSetting } from "./type";

/** 검토 결과에 대한 수정 적용·반영·취소. */
export const lectureActions: BlockActionSetting[] = [
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
];
