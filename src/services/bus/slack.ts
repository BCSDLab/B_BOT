import type { KnownBlock, WebClient } from "@slack/web-api";
import type { BusJob } from "./types";
import type { BusPatchPlan } from "./patch";

export const busActionValue = (
  job: BusJob,
  payloadHash = job.payload_hash ?? job.source_hash,
) =>
  JSON.stringify({
    job_id: job.id,
    state_version: job.state_version,
    payload_hash: payloadHash,
  });

export async function sendReviewApproval(
  client: WebClient,
  channel: string,
  job: BusJob,
) {
  const warningCount =
    job.conversions?.reduce(
      (count, conversion) => count + conversion.warnings.length,
      0,
    ) ?? 0;
  await client.chat.postMessage({
    channel,
    text: `버스 시간표 검수 요청 (${warningCount} warnings)`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*버스 시간표 검수 요청*\nWarnings: ${warningCount}\n${job.review_url ? `<${job.review_url}|검수 HTML>` : "검수 HTML은 artifact 저장소에서 확인"}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "bus:approve",
            text: { type: "plain_text", text: "검수 승인" },
            style: "primary",
            value: busActionValue(job, job.payload_hash),
          },
          {
            type: "button",
            action_id: "bus:revision",
            text: { type: "plain_text", text: "수정 요청" },
            value: busActionValue(job),
          },
        ],
      },
    ],
  });
}
export async function sendStatus(
  client: WebClient,
  channel: string,
  text: string,
) {
  await client.chat.postMessage({ channel, text });
}

const patchLine = (patch: BusPatchPlan["patches"][number]) => {
  const where =
    patch.kind === "period"
      ? "적용 기간"
      : `${patch.region} ${patch.routeType} "${patch.routeName}"`;
  const label = {
    arrival_time: `회차 ${patch.tripName} · ${patch.stopName} 도착시각`,
    route_name: "노선명",
    running_days: `회차 ${patch.tripName} 운행요일`,
    period: "적용 기간",
    remove_route: "노선 삭제",
    remove_trip: `회차 ${patch.tripName} 삭제`,
    remove_stop: `정류장 ${patch.stopName} 삭제`,
    add_trip: `회차 ${patch.tripName} 추가`,
    add_stop: `정류장 ${patch.addStop?.name} 추가`,
  }[patch.kind];
  return `• ${where} · ${label}: ${patch.before} → ${patch.after}`;
};

/** `!수정` 미리보기. 적용/취소 버튼의 value는 검증이 끝난 계획의 토큰을 담는다. */
export function buildBusPatchBlocks(
  plan: BusPatchPlan,
  value: string,
  requesterId: string,
): KnownBlock[] {
  const lines = plan.patches.map(patchLine).join("\n");
  const problems = plan.problems.map((problem) => `• ${problem}`).join("\n");
  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*수정 ${plan.patches.length}건*\n\n${lines}` },
    },
  ];
  if (problems) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*적용하지 않은 부분*\n${problems}` },
    });
  }
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        action_id: "bus:patch_apply",
        text: { type: "plain_text", text: "적용" },
        style: "primary",
        value,
      },
      {
        type: "button",
        action_id: "bus:patch_cancel",
        text: { type: "plain_text", text: "취소" },
        value,
      },
    ],
  });
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `수정 요청: <@${requesterId}>` }],
  });
  return blocks;
}
