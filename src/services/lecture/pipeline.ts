import type { KnownBlock } from "@slack/web-api";
import { blockingIssues, buildAdminRequest, toAdminTerm } from "./adminApi";
import { convertRows } from "./convert";
import { renderReviewPage } from "./reviewHtml";
import { buildReviewUrl, saveReview } from "./reviewStore";
import { readSheetFromBuffer } from "./sheet";
import { generateMappingSpec } from "./spec";

export interface ConversionTarget {
  year: number;
  /** `여름학기`처럼 사람이 쓰는 이름. enum 변환은 안쪽에서 한다. */
  termName: string;
  fileName: string;
}

/** 변환을 시작하기 전에 없으면 반드시 실패할 설정만 확인한다. */
function assertConfigured(): void {
  const missing = [
    !/^https?:\/\//.test(import.meta.env.APP_BASE_URL ?? "") ? "APP_BASE_URL" : null,
    !import.meta.env.OPENAI_API_KEY && !import.meta.env.ANTHROPIC_API_KEY
      ? "OPENAI_API_KEY (또는 ANTHROPIC_API_KEY)"
      : null,
  ].filter((name) => name !== null);

  if (missing.length > 0) {
    throw new Error(`서버 설정이 없습니다: ${missing.join(", ")}`);
  }
}

export interface ConversionOutcome {
  token: string;
  reviewUrl: string;
  lectureCount: number;
  blockingCount: number;
  emptyValueCount: number;
  parseFailureCount: number;
  withoutTimeCount: number;
}

/**
 * 엑셀 한 개를 검토 가능한 상태까지 끌고 간다.
 * 스펙 생성만 LLM이고 나머지는 전부 결정적이다.
 */
export async function convertToReview(
  buffer: ArrayBuffer,
  { year, termName, fileName }: ConversionTarget,
): Promise<ConversionOutcome> {
  const term = toAdminTerm(termName);
  // LLM 호출과 파싱은 수십 초가 걸린다. 설정 때문에 실패할 거면 그 전에 알린다.
  assertConfigured();
  const rows = await readSheetFromBuffer(buffer);
  const spec = await generateMappingSpec(rows);
  const converted = convertRows(rows, spec);

  if (converted.lectures.length === 0) {
    throw new Error("강의를 하나도 읽지 못했습니다. 파일이 편람이 맞는지 확인해주세요.");
  }

  const { request, issues } = buildAdminRequest(converted.lectures, { year, term });
  const blocking = blockingIssues(issues);

  const generatedAt = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const html = renderReviewPage({
    year,
    termName,
    sourceFileName: fileName,
    generatedAt,
    lectures: converted.lectures,
    issues,
    parseFailures: converted.issues.map((i) => ({
      row: i.row,
      value: i.value,
      message: i.message,
    })),
  });

  const token = await saveReview({
    html,
    request,
    meta: {
      year,
      termName,
      sourceFileName: fileName,
      lectureCount: converted.lectures.length,
      issueCount: blocking.length,
      createdAt: new Date().toISOString(),
    },
  });

  return {
    token,
    reviewUrl: buildReviewUrl(token),
    lectureCount: converted.lectures.length,
    blockingCount: blocking.length,
    emptyValueCount: issues.length - blocking.length,
    parseFailureCount: converted.issues.length,
    withoutTimeCount: converted.lectures.filter((l) => l.lecture_infos.length === 0).length,
  };
}

/**
 * 변환 결과 안내. 확인이 필요한 게 있으면 반영 버튼을 아예 내리지 않고 경고를 붙인다.
 * 판단은 사람이 하되, 무엇을 감수하는지는 보이게 한다.
 */
export function buildResultBlocks(
  outcome: ConversionOutcome,
  target: ConversionTarget,
  requesterId: string,
): KnownBlock[] {
  const warn = outcome.blockingCount > 0 || outcome.parseFailureCount > 0;

  const lines = [
    `*${target.year} ${target.termName}* 변환 완료`,
    `강의 *${outcome.lectureCount}건* · 시간 없음 ${outcome.withoutTimeCount}건`,
  ];
  if (outcome.parseFailureCount > 0) {
    lines.push(`:warning: 강의시간 해석 실패 *${outcome.parseFailureCount}건*`);
  }
  if (outcome.blockingCount > 0) {
    lines.push(`:warning: 반영을 막는 항목 *${outcome.blockingCount}건*`);
  }
  if (outcome.emptyValueCount > 0) {
    // 반영은 되지만 원본이 비어 있다는 사실은 알고 넘어가야 한다.
    lines.push(`엑셀에 값이 없는 항목 ${outcome.emptyValueCount}건 (빈 값으로 반영)`);
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
          action_id: "lecture:review_link",
        },
        {
          type: "button",
          text: { type: "plain_text", text: warn ? "그래도 반영" : "반영", emoji: true },
          style: warn ? undefined : "primary",
          action_id: "lecture:apply",
          value: JSON.stringify({ token: outcome.token, requesterId }),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "취소", emoji: true },
          style: "danger",
          action_id: "lecture:cancel",
          value: JSON.stringify({ token: outcome.token, requesterId }),
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
