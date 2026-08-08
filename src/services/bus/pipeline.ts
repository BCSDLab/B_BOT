import type { KnownBlock } from "@slack/web-api";
import { convertExcelDeterministically } from "./deterministicConversion";
import { analyseExcel, analyseXlsx } from "./excelAnalyzer";
import type { BusPatchPlan } from "./patch";
import type { BusConversion, BusJob } from "./types";
import { normalizeTime, validateConversion } from "./validation";

/**
 * 검수 버튼·수정 미리보기에 실어 보낼 value. 낡은 버튼이 새 job 상태를 덮어쓰지
 * 않도록 버전과 페이로드 해시를 함께 담는다.
 */
export const busActionValue = (
  job: BusJob,
  payloadHash = job.payload_hash ?? job.source_hash,
) =>
  JSON.stringify({
    job_id: job.id,
    state_version: job.state_version,
    payload_hash: payloadHash,
  });

/** 검수 요청 알림 블록. 승인과 수정 요청 버튼을 실어 보낸다. */
export function buildReviewApprovalBlocks(job: BusJob): KnownBlock[] {
  const warningCount =
    job.conversions?.reduce(
      (count, conversion) => count + conversion.warnings.length,
      0,
    ) ?? 0;
  return [
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
  ];
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

async function readSheetContext(buffer: Buffer, extension: string) {
  if (extension === ".csv")
    return buffer
      .toString("utf8")
      .split(/\r?\n/)
      .map((line, index) => ({
        row: index + 1,
        cells: line.split(",").map(normalizeTime),
      }));
  // These packages are optional runtime adapters so production can use the parser
  // best suited to its deployment image while the workflow itself stays portable.
  if (extension === ".xlsx") return analyseXlsx(buffer);
  if (extension === ".xls") return analyseExcel(buffer);
  throw new Error("unsupported attachment extension");
}

/**
 * 다운로드한 첨부를 검토 가능한 변환 결과까지 끌고 간다.
 * 상태 전이는 부르는 쪽(workflow)이 하고, 여기는 변환만 담당한다.
 */
export async function convertSpreadsheetToConversions(
  buffer: Buffer,
  extension: string,
  revisionNote?: string,
): Promise<BusConversion[]> {
  const context = await readSheetContext(buffer, extension);
  if (!context || typeof context !== "object" || !("sheets" in context))
    throw new Error("현재 deterministic 변환은 Excel 파일만 지원합니다.");
  const conversions = convertExcelDeterministically(
    context as ReturnType<typeof analyseExcel>,
  ).map(validateConversion);
  if (revisionNote) {
    for (const conversion of conversions) {
      conversion.warnings.push(
        `검수자 수정 요청: ${revisionNote} (자동 변경 없이 재검수 필요)`,
      );
    }
  }
  return conversions;
}
