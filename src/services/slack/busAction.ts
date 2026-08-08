import type { WebClient } from "@slack/web-api";
import type { BlockAction } from "@slack/bolt";
import {
  applyBusPatches,
  bindSlackThread,
  cancelJob,
  getJob,
  publish,
  requestRevision,
  runConversion,
} from "~/services/bus/workflow";
import {
  dropBusPatchPlan,
  loadBusPatchPlan,
} from "~/services/bus/reviewStore";
import { sendReviewApproval, sendStatus } from "~/services/bus/slack";
import { busActionValue } from "~/services/bus/pipeline";

interface BusActionValue {
  job_id: string;
  state_version: number;
  payload_hash: string;
  patch_token?: string;
}

function parseBusActionValue(raw: string | undefined): BusActionValue {
  const value: unknown = JSON.parse(raw ?? "{}");
  if (
    !value ||
    typeof value !== "object" ||
    !("job_id" in value) ||
    typeof value.job_id !== "string" ||
    !("state_version" in value) ||
    typeof value.state_version !== "number" ||
    !("payload_hash" in value) ||
    typeof value.payload_hash !== "string"
  ) {
    throw new Error("invalid bus action payload");
  }
  const patchToken =
    "patch_token" in value && typeof value.patch_token === "string"
      ? value.patch_token
      : undefined;
  return { ...(value as BusActionValue), patch_token: patchToken };
}

export async function handleBusAction(
  client: WebClient,
  body: BlockAction,
  action: BlockAction["actions"][number],
) {
  if (action.type !== "button" || !body.channel) return;
  const value = parseBusActionValue(action.value);
  const job = await getJob(value.job_id);
  if (!job || job.state_version !== value.state_version)
    throw new Error("stale action");
  const expectedHash = job.payload_hash ?? job.source_hash;
  if (action.action_id !== "bus:patch_cancel" && value.payload_hash !== expectedHash)
    throw new Error("payload hash mismatch");
  if (action.action_id !== "bus:patch_apply" && action.action_id !== "bus:patch_cancel") {
    await bindSlackThread(job.id, body.channel.id, body.message?.ts ?? "");
  }
  if (action.action_id === "bus:cancel") {
    await cancelJob(job.id);
    await sendStatus(client, body.channel.id, "버스 시간표 업데이트를 취소했습니다.");
    return;
  }
  if (action.action_id === "bus:start" || action.action_id === "bus:retry") {
    try {
      const converted = await runConversion(job.id);
      await sendReviewApproval(client, body.channel.id, converted);
    } catch (error) {
      const current = await getJob(job.id);
      if (!current || current.state !== "FAILED") throw error;
      await client.chat.postMessage({
        channel: body.channel.id,
        thread_ts: body.message?.ts,
        text: "변환 실패",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:x: *변환 실패*\n${
                error instanceof Error ? error.message : "알 수 없는 오류입니다"
              }\n일시적인 문제였다면 아래 버튼으로 재시도할 수 있습니다.`,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                action_id: "bus:retry",
                text: { type: "plain_text", text: "재시도" },
                style: "danger",
                value: busActionValue(current),
              },
            ],
          },
        ],
      });
    }
    return;
  }
  if (action.action_id === "bus:revision") {
    await requestRevision(job.id);
    await client.chat.postMessage({
      channel: body.channel.id,
      thread_ts: body.message?.ts,
      text: "수정할 내용을 이 스레드에 남겨 주세요.",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: ":pencil: *수정할 내용을 이 스레드에 남겨 주세요.*\n`!수정 노선과 내용` 형태로 적어주세요. 예) `!수정 천안역 1회 터미널 시간을 08:05로`",
          },
        },
      ],
    });
    return;
  }
  if (action.action_id === "bus:approve") {
    await publish(job.id, value.payload_hash);
    await sendStatus(
      client,
      body.channel.id,
      "버스 시간표 Admin API 반영 완료. 적용 전날 버전 갱신을 예약했습니다.",
    );
    return;
  }
  if (action.action_id === "bus:patch_cancel") {
    if (!value.patch_token) throw new Error("missing patch token");
    await dropBusPatchPlan(value.patch_token);
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message?.ts,
      text: "수정 취소됨",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: ":x: 수정 요청을 취소했습니다." },
        },
      ],
    });
    return;
  }
  if (action.action_id === "bus:patch_apply") {
    if (!value.patch_token) throw new Error("missing patch token");
    const plan = await loadBusPatchPlan(value.patch_token);
    if (!plan) throw new Error("patch plan expired or missing");
    if (plan.jobId !== job.id)
      throw new Error("patch plan does not match this job");
    // 먼저 지운다. 두 명이 동시에 눌러 두 번 적용되면 안 된다.
    await dropBusPatchPlan(value.patch_token);
    const updated = await applyBusPatches(
      job.id,
      plan.patches,
      plan.request,
      value.payload_hash,
    );
    if (updated.review_url) {
      await client.chat.postMessage({
        channel: body.channel.id,
        thread_ts: body.message?.ts,
        text: "수정 적용 완료 · 재검수 필요",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:white_check_mark: *수정 ${plan.patches.length}건 적용*\n<${updated.review_url}|검수 HTML>이 갱신됐습니다. 다시 확인해주세요.`,
            },
          },
        ],
      });
    }
    await sendReviewApproval(client, body.channel.id, updated);
    return;
  }
}
