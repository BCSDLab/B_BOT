import type { KnownBlock } from "@slack/web-api";
import type { StructuredImageMimeType } from "~/helper/adapter/structured";
import { fetchCoopShopBaseline } from "./baseline";
import { convertRegularTimetable } from "./convert";
import { buildReviewUrl, saveCoopReview } from "./reviewStore";
import { renderRegularCoopReview } from "./reviewHtml";
import type {
  CoopShopBaseline,
  RawRegularCoopTimetable,
  RegularConversionResult,
} from "./types";
import { extractRegularTimetable } from "./vision";

export interface RegularCoopArtifacts {
  conversion: RegularConversionResult;
  requestJson: string;
  reviewHtml: string;
}

export interface RegularCoopTarget {
  year: number;
  termName: "1학기" | "2학기";
  fileName: string;
}

export interface RegularCoopOutcome {
  token: string;
  reviewUrl: string;
  shopCount: number;
  excludedCount: number;
  blockingCount: number;
  infoCount: number;
}

export function expectedRegularSemester(target: Pick<RegularCoopTarget, "year" | "termName">): string {
  return `${String(target.year).slice(-2)}-${target.termName}`;
}

export function buildRegularCoopArtifacts(
  raw: RawRegularCoopTimetable,
  baseline: CoopShopBaseline,
): RegularCoopArtifacts {
  const conversion = convertRegularTimetable(raw, baseline);
  return {
    conversion,
    requestJson: `${JSON.stringify(conversion.request, null, 2)}\n`,
    reviewHtml: renderRegularCoopReview(conversion),
  };
}

export async function convertRegularCoopImage({
  image,
  mimeType,
  fileName,
  baseline,
}: {
  image: ArrayBuffer | Uint8Array;
  mimeType: StructuredImageMimeType;
  fileName: string;
  baseline: CoopShopBaseline;
}): Promise<RegularCoopArtifacts> {
  const bytes = image instanceof Uint8Array ? image : new Uint8Array(image);
  if (bytes.byteLength === 0) {
    throw new Error("생협 시간표 이미지가 비어 있습니다.");
  }
  const raw = await extractRegularTimetable({
    imageBase64: Buffer.from(bytes).toString("base64"),
    mimeType,
    fileName,
  });
  return buildRegularCoopArtifacts(raw, baseline);
}

export async function convertRegularCoopToReview(
  image: ArrayBuffer,
  mimeType: StructuredImageMimeType,
  target: RegularCoopTarget,
): Promise<RegularCoopOutcome> {
  if (!/^https?:\/\//.test(import.meta.env.APP_BASE_URL ?? "")) {
    throw new Error("서버 설정이 없습니다: APP_BASE_URL");
  }
  const baseline = await fetchCoopShopBaseline();
  const artifacts = await convertRegularCoopImage({
    image,
    mimeType,
    fileName: target.fileName,
    baseline,
  });

  const expected = expectedRegularSemester(target);
  if (artifacts.conversion.semester !== expected) {
    throw new Error(`명령은 ${expected}인데 이미지에서는 ${artifacts.conversion.semester || "학기 미상"}(으)로 읽었습니다.`);
  }

  const blockingCount = artifacts.conversion.issues.filter((issue) => issue.severity === "blocking").length;
  const infoCount = artifacts.conversion.issues.filter((issue) => issue.severity === "info").length;
  const token = await saveCoopReview({
    html: artifacts.reviewHtml,
    request: artifacts.conversion.request,
    conversion: artifacts.conversion,
    meta: {
      year: target.year,
      termName: target.termName,
      sourceFileName: target.fileName,
      shopCount: artifacts.conversion.shops.length,
      blockingCount,
      createdAt: new Date().toISOString(),
    },
  });

  return {
    token,
    reviewUrl: buildReviewUrl(token),
    shopCount: artifacts.conversion.shops.length,
    excludedCount: artifacts.conversion.excludedShops.length,
    blockingCount,
    infoCount,
  };
}

export function buildRegularCoopResultBlocks(
  outcome: RegularCoopOutcome,
  target: RegularCoopTarget,
  requesterId: string,
): KnownBlock[] {
  const lines = [
    `*${target.year} ${target.termName} 생협 운영시간* 변환 완료`,
    `반영 대상 *${outcome.shopCount}개* · 2캠 제외 ${outcome.excludedCount}개`,
  ];
  if (outcome.blockingCount > 0) {
    lines.push(`:warning: 확인이 필요한 항목 *${outcome.blockingCount}건*`);
  }

  return [
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
    {
      type: "actions",
      elements: [{
        type: "button",
        text: { type: "plain_text", text: "검토 페이지 열기", emoji: true },
        url: outcome.reviewUrl,
        action_id: "coop:review_link",
      }],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          "*잘못 추출된 값은 이 스레드에서 `!수정`으로 고칠 수 있습니다.*",
          "예) `!수정 세탁소 평일 운영시간을 11:30 - 18:30으로 바꿔줘`",
          "예) `!수정 운영 종료일을 2026-06-19로 바꿔줘`",
        ].join("\n"),
      },
    },
    {
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `${target.fileName} · 검토 링크는 7일 후 만료됩니다 · 요청: <@${requesterId}>`,
      }],
    },
  ];
}
