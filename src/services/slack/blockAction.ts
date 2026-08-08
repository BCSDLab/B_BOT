import { buildAdminRequest, ensureSemester, submitLectures, toAdminTerm } from "~/services/lecture/adminApi";
import { getKoinAdminAuth } from "~/services/lecture/koinAuth";
import { applyPatches, resolveAmbiguities } from "~/services/lecture/patch";
import { buildPatchBlocks, buildStoredReview } from "~/services/lecture/pipeline";
import {
  dropPatchPlan,
  loadPatchPlan,
  loadReview,
  savePatchPlan,
  updateReview,
} from "~/services/lecture/reviewStore";
import type { BlockActionSetting } from "./type";

/** 여러 명이 동시에 눌러 두 번 반영되는 걸 막는다. 되돌릴 API가 없어 특히 조심해야 한다. */
const applying = new Set<string>();

// 버튼·셀렉트 조작(block_actions) 핸들러 목록.
// 등록하지 않은 action_id는 라우터에서 무시된다. 모달 안의 select와 URL 링크 버튼도
// block_actions로 들어오는데, 그것들은 여기서 처리할 대상이 아니기 때문이다.
export const blockActions: BlockActionSetting[] = [
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

      // 중복 반영 방어. 어드민에 수정·삭제 API가 없어 두 번 들어가면 손으로 못 지운다.
      if (applying.has(token)) {
        await client.chat.postEphemeral({
          channel,
          user: actor,
          text: "이미 다른 분이 반영을 진행 중입니다.",
        });
        return;
      }
      applying.add(token);

      try {
        const stored = await loadReview(token);
        if (!stored) {
          await updateSlack({
            client, channel, ts,
            text: "검토 링크 만료",
            blocks: [{ type: "section", text: { type: "mrkdwn",
              text: ":x: 검토 링크가 만료됐습니다. 다시 변환해주세요." } }],
          });
          return;
        }

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

        const auth = await getKoinAdminAuth();
        // 학기가 없으면 강의 생성이 404로 막힌다. 이미 있으면 서버가 무시한다.
        await ensureSemester(request, auth);
        await submitLectures(request, auth);

        await updateSlack({
          client, channel, ts,
          text: "반영 완료",
          blocks: [
            { type: "section", text: { type: "mrkdwn",
              text: `:white_check_mark: *${stored.meta.year} ${stored.meta.termName} 반영 완료*\n강의 *${stored.meta.lectureCount}건*` } },
            { type: "context", elements: [{ type: "mrkdwn",
              text: `작업자: <@${actor}> · ${stored.meta.sourceFileName}` }] },
          ],
        });
      } catch (error) {
        await updateSlack({
          client, channel, ts,
          text: "반영 실패",
          blocks: [
            { type: "section", text: { type: "mrkdwn",
              text: `:x: *반영 실패*\n${error instanceof Error ? error.message : "알 수 없는 오류입니다"}` } },
            { type: "context", elements: [{ type: "mrkdwn",
              text: `작업자: <@${actor}> · 원인을 해결하고 다시 변환해주세요.` }] },
          ],
        });
      } finally {
        applying.delete(token);
      }
    },
  },
  {
    actionId: "lecture:cancel",
    async handler({ client, body, action }) {
      if (action.type !== "button" || !body.channel) return;

      await updateSlack({
        client,
        channel: body.channel.id,
        ts: body.message?.ts,
        text: "취소됨",
        blocks: [{ type: "section", text: { type: "mrkdwn",
          text: `:no_entry_sign: *반영을 취소했습니다.*\n<@${body.user.id}>` } }],
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
];
