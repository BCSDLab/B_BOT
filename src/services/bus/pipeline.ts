import type { KnownBlock } from "@slack/web-api";
import { convertExcelDeterministically } from "./deterministicConversion";
import { analyseExcel, analyseXlsx } from "./excelAnalyzer";
import type { BusPatchPlan } from "./patch";
import { busLabelOf, isBusProduction, type BusKoinEnv } from "./target";
import { renderBusReviewHtml } from "./reviewHtml";
import type { BusReviewMeta, StoredBusReview } from "./reviewStore";
import { buildBusReviewUrl, saveBusReview } from "./reviewStore";
import { validateConversion } from "./validation";
import { totalRouteCount, type BusConversion } from "./types";

export interface BusConversionTarget {
  /** 채널로 정해진 대상. 변환부터 반영까지 바뀌지 않는다. */
  env: BusKoinEnv;
  fileName: string;
}

async function readSheetContext(buffer: Buffer, extension: string) {
  // These packages are optional runtime adapters so production can use the parser
  // best suited to its deployment image while the workflow itself stays portable.
  if (extension === ".xlsx") return analyseXlsx(buffer);
  if (extension === ".xls") return analyseExcel(buffer);
  throw new Error("unsupported attachment extension");
}

/**
 * 첨부를 검토 가능한 변환 결과까지 끌고 간다. 결정론적 파서만 쓰고, LLM은
 * `!수정`의 자연어 해석에만 쓴다.
 */
export async function convertSpreadsheetToConversions(
  buffer: Buffer,
  extension: string,
): Promise<BusConversion[]> {
  const context = await readSheetContext(buffer, extension);
  if (!context || typeof context !== "object" || !("sheets" in context))
    throw new Error("현재 deterministic 변환은 Excel 파일만 지원합니다.");
  return convertExcelDeterministically(
    context as ReturnType<typeof analyseExcel>,
  ).map(validateConversion);
}

export interface BusConversionOutcome {
  token: string;
  reviewUrl: string;
  routeCount: number;
  issueCount: number;
  semesterTypes: string[];
}

/** conversions에 실제로 등장하는 학기 구분. 정규+계절이 한 파일에 같이 나올 수 있다. */
function semesterTypesOf(conversions: BusConversion[]): string[] {
  const found = new Set<string>();
  for (const conversion of conversions) {
    for (const payload of conversion.payloads) found.add(payload.semester_type);
  }
  return [...found];
}

/**
 * conversions 목록으로 저장할 형태를 만든다. 수정을 적용한 뒤에도 같은 함수를 쓴다 —
 * 검토 화면과 실제로 반영할 값이 갈라지지 않게 하려는 것이다.
 */
export function buildStoredBusReview(
  conversions: BusConversion[],
  target: BusConversionTarget,
): StoredBusReview {
  const html = renderBusReviewHtml(target.fileName, conversions);
  const meta: BusReviewMeta = {
    env: target.env,
    sourceFileName: target.fileName,
    routeCount: totalRouteCount(conversions),
    issueCount: conversions.reduce((count, conversion) => count + conversion.warnings.length, 0),
    createdAt: new Date().toISOString(),
  };
  return { html, conversions, meta };
}

/**
 * 엑셀 한 개를 검토 가능한 상태까지 끌고 간다.
 */
export async function convertBusToReview(
  buffer: Buffer,
  extension: string,
  target: BusConversionTarget,
): Promise<BusConversionOutcome> {
  const conversions = await convertSpreadsheetToConversions(buffer, extension);
  if (conversions.length === 0) {
    throw new Error("버스 시간표를 하나도 읽지 못했습니다. 파일 형식을 확인해주세요.");
  }
  const stored = buildStoredBusReview(conversions, target);
  const token = await saveBusReview(stored);
  return {
    token,
    reviewUrl: buildBusReviewUrl(token),
    routeCount: stored.meta.routeCount,
    issueCount: stored.meta.issueCount,
    semesterTypes: semesterTypesOf(conversions),
  };
}

/**
 * 변환 결과 안내. 확인이 필요한 게 있어도 반영 버튼은 그대로 두고 경고만 붙인다 —
 * 판단은 검수자가 한다.
 */
export function buildReviewApprovalBlocks(
  outcome: BusConversionOutcome,
  target: BusConversionTarget,
  requesterId: string,
): KnownBlock[] {
  const prod = isBusProduction(target.env);
  const lines = [
    "*버스 시간표* 변환 완료",
    prod ? `:rotating_light: 대상: *${busLabelOf(target.env)}*` : `대상: ${busLabelOf(target.env)}`,
    `반영 대상 *${outcome.routeCount}개*`,
  ];
  if (outcome.issueCount > 0) {
    lines.push(`:warning: 확인이 필요한 항목 *${outcome.issueCount}건*`);
  }

  return [
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "검토 페이지 열기", emoji: true },
          url: outcome.reviewUrl,
          action_id: "bus:review_link",
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: `${prod ? "프로덕션에 " : ""}${outcome.issueCount > 0 ? "그래도 반영" : "반영"}`,
            emoji: true,
          },
          style: outcome.issueCount > 0 || prod ? undefined : "primary",
          action_id: "bus:apply",
          value: JSON.stringify({ token: outcome.token, requesterId }),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "취소", emoji: true },
          style: "danger",
          action_id: "bus:cancel",
          value: JSON.stringify({ token: outcome.token, requesterId }),
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: [
            "*잘못 추출된 값은 이 스레드에서 `!수정`으로 고칠 수 있습니다.*",
            "예) `!수정 천안역 1회 터미널 시간을 08:05로 바꿔줘`",
            "예) `!수정 천안역 1회 운행요일을 월수금으로 바꿔줘`",
          ].join("\n"),
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${target.fileName} · 검토 링크는 7일 후 만료됩니다 · 요청: <@${requesterId}>`,
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
  patchToken: string,
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
        value: JSON.stringify({ patchToken, requesterId }),
      },
      {
        type: "button",
        action_id: "bus:patch_cancel",
        text: { type: "plain_text", text: "취소" },
        value: JSON.stringify({ patchToken, requesterId }),
      },
    ],
  });
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `수정 요청: <@${requesterId}>` }],
  });
  return blocks;
}
