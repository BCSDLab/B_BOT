import type { BlockAction } from "@slack/bolt";
import type { KnownBlock, WebClient } from "@slack/web-api";
import { submitBusTimetables } from "~/services/bus/adminApi";
import { cancelBusJob, claimBusJob, finishBusJob, setBusVersionSchedules } from "~/services/bus/jobStore";
import { getBusAdminAuth } from "~/services/bus/koinAuth";
import { applyBusPatchesToConversions } from "~/services/bus/patch";
import { buildStoredBusReview } from "~/services/bus/pipeline";
import {
  dropBusPatchPlan,
  loadBusPatchPlan,
  loadBusReview,
  updateBusReview,
} from "~/services/bus/reviewStore";
import { busLabelOf, resolveBusTargetByEnv } from "~/services/bus/target";
import { validateConversion } from "~/services/bus/validation";
import { computeBusVersionSchedules } from "~/services/bus/versionSchedule";

const section = (text: string): KnownBlock[] => [
  { type: "section", text: { type: "mrkdwn", text } },
];

async function update(
  client: WebClient,
  channel: string,
  ts: string | undefined,
  text: string,
  blocks: KnownBlock[],
) {
  await client.chat.update({ channel, ts, text, blocks });
}

export const BUS_APPLY_ACTION_IDS = ["bus:apply", "bus:cancel"] as const;
export const BUS_PATCH_ACTION_IDS = ["bus:patch_apply", "bus:patch_cancel"] as const;

export async function handleBusApplyAction(
  client: WebClient,
  body: BlockAction,
  action: BlockAction["actions"][number],
) {
  if (action.type !== "button" || !body.channel) return;
  const { token } = JSON.parse(action.value ?? "{}") as { token?: string };
  if (!token) return;

  const channel = body.channel.id;
  const ts = body.message?.ts;
  const actor = body.user.id;
  const appliedPayloads: string[] = [];

  if (action.action_id === "bus:cancel") {
    if (!(await cancelBusJob(token, actor))) {
      await client.chat.postEphemeral({
        channel,
        user: actor,
        text: "이미 반영됐거나 진행 중이라 취소할 수 없습니다.",
      });
      return;
    }
    await update(
      client,
      channel,
      ts,
      "버스 시간표 반영 취소됨",
      section(`:no_entry_sign: *버스 시간표 반영을 취소했습니다.*\n<@${actor}>`),
    );
    return;
  }

  const claim = await claimBusJob(token, actor);
  if (!claim.ok) {
    await client.chat.postEphemeral({
      channel,
      user: actor,
      text: claim.reason ?? "지금은 반영할 수 없습니다.",
    });
    return;
  }

  try {
    const stored = await loadBusReview(token);
    if (!stored) {
      await finishBusJob(token, "FAILED", "검토 링크 만료");
      await update(
        client,
        channel,
        ts,
        "버스 검토 링크 만료",
        section(":x: 버스 검토 링크가 만료됐습니다. 파일을 다시 올려주세요."),
      );
      return;
    }

    await update(
      client,
      channel,
      ts,
      "버스 시간표 반영 중",
      section(
        `:hourglass_flowing_sand: *버스 시간표 반영 중…* ${stored.meta.routeCount}개\n` +
          `${busLabelOf(stored.meta.env)} · 작업자: <@${actor}>`,
      ),
    );

    const resolved = resolveBusTargetByEnv(stored.meta.env);
    if (!resolved.target) {
      throw new Error(resolved.reason ?? "대상 환경을 찾지 못했습니다.");
    }
    const auth = await getBusAdminAuth(resolved.target);
    await submitBusTimetables(stored.conversions, auth, ({ target, semesterType }) => {
      appliedPayloads.push(`${target}/${semesterType}`);
    });
    await finishBusJob(token, "APPLIED");
    // 시간표는 지금 반영됐지만, 사이트 버전 문구는 적용 전날 00:05에 바뀌어야 한다.
    await setBusVersionSchedules(token, computeBusVersionSchedules(stored.conversions));

    await update(client, channel, ts, "버스 시간표 반영 완료", [
      ...section(
        `:white_check_mark: *버스 시간표 반영 완료*\n` +
          `${busLabelOf(stored.meta.env)} · 노선 *${stored.meta.routeCount}개*\n` +
          `적용 전날 버전 문구 갱신을 예약했습니다.`,
      ),
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `작업자: <@${actor}> · ${stored.meta.sourceFileName}` }],
      },
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류입니다";
    // 각 PUT은 대상×학기 하나를 통째로 덮어쓴다. 중간에 실패해도 앞선 PUT은 이미
    // 반영된 상태로 남으므로, 재시도가 안전하다는 것과 어디까지 갔는지를 함께 알린다.
    const partial = appliedPayloads.length > 0
      ? `\n:warning: 먼저 반영된 항목: ${appliedPayloads.join(", ")} · 재시도하면 같은 데이터로 다시 덮어씁니다.`
      : "";
    await finishBusJob(token, "FAILED", `${message}${partial}`);
    await update(client, channel, ts, "버스 시간표 반영 실패", [
      ...section(`:x: *버스 시간표 반영 실패*\n${message}${partial}`),
      {
        type: "actions",
        elements: [{
          type: "button",
          text: { type: "plain_text", text: "다시 시도", emoji: true },
          action_id: "bus:apply",
          value: JSON.stringify({ token }),
        }],
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `작업자: <@${actor}> · 원인을 해결한 뒤 눌러주세요.` }],
      },
    ]);
  }
}

export async function handleBusPatchAction(
  client: WebClient,
  body: BlockAction,
  action: BlockAction["actions"][number],
) {
  if (action.type !== "button" || !body.channel) return;
  const { patchToken, requesterId } = JSON.parse(action.value ?? "{}") as {
    patchToken?: string;
    requesterId?: string;
  };
  if (!patchToken) return;

  const channel = body.channel.id;
  const ts = body.message?.ts;

  if (action.action_id === "bus:patch_cancel") {
    await dropBusPatchPlan(patchToken);
    await update(
      client,
      channel,
      ts,
      "수정 취소됨",
      section(":x: 수정 요청을 취소했습니다."),
    );
    return;
  }

  const plan = await loadBusPatchPlan(patchToken);
  if (!plan) {
    await update(
      client,
      channel,
      ts,
      "수정 계획 만료",
      section(":x: 수정 계획이 만료됐습니다. `!수정`을 다시 요청해주세요."),
    );
    return;
  }
  // 먼저 지운다. 두 명이 동시에 눌러 두 번 적용되면 안 된다.
  await dropBusPatchPlan(patchToken);

  try {
    const stored = await loadBusReview(plan.reviewToken);
    if (!stored) throw new Error("검토 링크가 만료됐습니다. 파일을 다시 올려주세요.");
    const next = applyBusPatchesToConversions(stored.conversions, plan.patches).map(
      validateConversion,
    );
    // HTML도 함께 다시 만든다. conversions만 바꾸면 검토 페이지가 수정 전 값을 보여준다.
    const rebuilt = buildStoredBusReview(next, {
      env: stored.meta.env,
      fileName: stored.meta.sourceFileName,
    });
    await updateBusReview(plan.reviewToken, rebuilt);

    await client.chat.postMessage({
      channel,
      thread_ts: ts,
      text: "버스 시간표 수정 적용",
      blocks: [
        ...section(
          `:white_check_mark: *수정 ${plan.patches.length}건 적용*\n검토 페이지가 갱신됐습니다. 다시 확인해주세요.`,
        ),
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `요청: <@${requesterId ?? body.user.id}>` }],
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류입니다";
    await update(
      client,
      channel,
      ts,
      "수정 적용 실패",
      section(`:x: *수정 적용 실패*\n${message}`),
    );
  }
}
