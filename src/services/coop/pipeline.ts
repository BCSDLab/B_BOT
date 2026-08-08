import type { KnownBlock } from "@slack/web-api";
import type { StructuredImageMimeType } from "~/helper/adapter/structured";
import {
  coopTargetLabel,
  isCoopProduction,
  type CoopKoinEnv,
} from "./target";
import { fetchCoopShopBaseline } from "./baseline";
import { convertRegularTimetable, convertVacationTimetable } from "./convert";
import { buildReviewUrl, saveCoopReview } from "./reviewStore";
import { renderRegularCoopReview, renderVacationCoopReview } from "./reviewHtml";
import type {
  CoopShopBaseline,
  RawRegularCoopTimetable,
  RegularConversionResult,
  VacationSeason,
} from "./types";
import { extractCoopTimetable, extractRegularTimetable, extractVacationTimetable } from "./vision";

export interface RegularCoopArtifacts {
  conversion: RegularConversionResult;
  requestJson: string;
  reviewHtml: string;
}

export interface RegularCoopTarget {
  env: CoopKoinEnv;
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

export interface VacationCoopTarget {
  env: CoopKoinEnv;
  year: number;
  season: VacationSeason;
  fileName: string;
}

export interface VacationCoopOutcome extends RegularCoopOutcome {
  semesterCount: 2;
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

export async function extractVacationCoopImage({
  image,
  mimeType,
  fileName,
}: {
  image: ArrayBuffer | Uint8Array;
  mimeType: StructuredImageMimeType;
  fileName: string;
}): Promise<RawRegularCoopTimetable> {
  const bytes = image instanceof Uint8Array ? image : new Uint8Array(image);
  if (bytes.byteLength === 0) throw new Error("생협 시간표 이미지가 비어 있습니다.");
  return await extractVacationTimetable({
    imageBase64: Buffer.from(bytes).toString("base64"),
    mimeType,
    fileName,
  });
}

export async function extractCoopImage({
  image,
  mimeType,
  fileName,
}: {
  image: ArrayBuffer | Uint8Array;
  mimeType: StructuredImageMimeType;
  fileName: string;
}): Promise<RawRegularCoopTimetable> {
  const bytes = image instanceof Uint8Array ? image : new Uint8Array(image);
  if (bytes.byteLength === 0) throw new Error("생협 시간표 이미지가 비어 있습니다.");
  return await extractCoopTimetable({
    imageBase64: Buffer.from(bytes).toString("base64"),
    mimeType,
    fileName,
  });
}

export async function convertVacationCoopToReview(
  raw: RawRegularCoopTimetable,
  vacationStartDate: string,
  target: VacationCoopTarget,
): Promise<VacationCoopOutcome> {
  if (!/^https?:\/\//.test(import.meta.env.APP_BASE_URL ?? "")) {
    throw new Error("서버 설정이 없습니다: APP_BASE_URL");
  }
  const baseline = await fetchCoopShopBaseline();
  const split = convertVacationTimetable(raw, baseline, vacationStartDate);
  if (split.year !== target.year || split.season !== target.season) {
    throw new Error(`명령은 ${target.year} ${target.season}방학인데 이미지에서는 ${split.year} ${split.season}방학으로 읽었습니다.`);
  }
  const periods = [
    { kind: "계절학기" as const, conversion: split.seasonal, request: split.seasonal.request },
    { kind: "방학" as const, conversion: split.vacation, request: split.vacation.request },
  ];
  const blockingCount = periods.reduce((count, period) =>
    count + period.conversion.issues.filter((issue) => issue.severity === "blocking").length, 0);
  const infoCount = periods.reduce((count, period) =>
    count + period.conversion.issues.filter((issue) => issue.severity === "info").length, 0);
  const token = await saveCoopReview({
    html: renderVacationCoopReview(split),
    request: split.seasonal.request,
    conversion: split.seasonal,
    periods,
    meta: {
      env: target.env,
      year: target.year,
      termName: `${target.season}계절학기·${target.season}방학`,
      sourceFileName: target.fileName,
      shopCount: split.seasonal.shops.length,
      blockingCount,
      createdAt: new Date().toISOString(),
    },
  });
  return {
    token,
    reviewUrl: buildReviewUrl(token),
    shopCount: split.seasonal.shops.length,
    excludedCount: split.seasonal.excludedShops.length,
    blockingCount,
    infoCount,
    semesterCount: 2,
  };
}

export function buildVacationCoopResultBlocks(
  outcome: VacationCoopOutcome,
  target: VacationCoopTarget,
  requesterId: string,
): KnownBlock[] {
  const lines = [
    `*${target.year} ${target.season} 생협 운영시간* 변환 완료`,
    `대상: ${coopTargetLabel(target.env)}`,
    `학기 *2개* · 학기별 매장 *${outcome.shopCount}개*`,
  ];
  if (outcome.blockingCount > 0) lines.push(`:warning: 확인이 필요한 항목 *${outcome.blockingCount}건*`);
  type ActionsBlock = Extract<KnownBlock, { type: "actions" }>;
  const elements: ActionsBlock["elements"] = [{
    type: "button", text: { type: "plain_text", text: "검토 페이지 열기", emoji: true },
    url: outcome.reviewUrl, action_id: "coop:review_link",
  }];
  elements.push(...buildCoopApplyButtons(outcome.token, target.env, outcome.shopCount));
  return [
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
    { type: "actions", elements },
    { type: "section", text: { type: "mrkdwn", text: [
      "*수정할 때는 적용할 학기를 먼저 적어주세요.*",
      "예) `!수정 방학 복지관식당 평일을 미운영으로 바꿔줘`",
      "예) `!수정 계절학기 세탁소 평일 운영시간을 11:30 - 18:30으로 바꿔줘`",
    ].join("\n") } },
    { type: "context", elements: [{ type: "mrkdwn", text: `${target.fileName} · 검토 링크는 7일 후 만료됩니다 · 요청: <@${requesterId}>` }] },
  ];
}

export async function convertRegularCoopToReview(
  image: ArrayBuffer,
  mimeType: StructuredImageMimeType,
  target: RegularCoopTarget,
): Promise<RegularCoopOutcome> {
  if (image.byteLength === 0) throw new Error("생협 시간표 이미지가 비어 있습니다.");
  const raw = await extractRegularTimetable({
    imageBase64: Buffer.from(new Uint8Array(image)).toString("base64"),
    mimeType,
    fileName: target.fileName,
  });
  return await convertRegularRawCoopToReview(raw, target);
}

export async function convertRegularRawCoopToReview(
  raw: RawRegularCoopTimetable,
  target: RegularCoopTarget,
): Promise<RegularCoopOutcome> {
  if (!/^https?:\/\//.test(import.meta.env.APP_BASE_URL ?? "")) {
    throw new Error("서버 설정이 없습니다: APP_BASE_URL");
  }
  const baseline = await fetchCoopShopBaseline();
  const artifacts = buildRegularCoopArtifacts(raw, baseline);

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
      env: target.env,
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
    isCoopProduction(target.env)
      ? `:rotating_light: 대상: *${coopTargetLabel(target.env)}*`
      : `대상: ${coopTargetLabel(target.env)}`,
    `반영 대상 *${outcome.shopCount}개*`,
  ];
  if (outcome.blockingCount > 0) {
    lines.push(`:warning: 확인이 필요한 항목 *${outcome.blockingCount}건*`);
  }

  type ActionsBlock = Extract<KnownBlock, { type: "actions" }>;
  const actionElements: ActionsBlock["elements"] = [{
    type: "button",
    text: { type: "plain_text", text: "검토 페이지 열기", emoji: true },
    url: outcome.reviewUrl,
    action_id: "coop:review_link",
  }];
  actionElements.push(...buildCoopApplyButtons(
    outcome.token,
    target.env,
    outcome.shopCount,
  ));

  return [
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
    {
      type: "actions",
      elements: actionElements,
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

export function buildCoopApplyButtons(token: string, env: CoopKoinEnv, shopCount: number) {
  const prod = isCoopProduction(env);
  return [
    {
      type: "button" as const,
      text: {
        type: "plain_text" as const,
        text: prod ? "프로덕션에 반영" : "반영하기",
        emoji: true,
      },
      style: prod ? undefined : ("primary" as const),
      action_id: "coop:apply",
      value: JSON.stringify({ token }),
      ...(prod ? {
        confirm: {
          title: { type: "plain_text" as const, text: "프로덕션에 반영할까요?" },
          text: { type: "mrkdwn" as const, text: `생협 매장 *${shopCount}개*를 실제 서비스에 반영합니다.` },
          confirm: { type: "plain_text" as const, text: "반영" },
          deny: { type: "plain_text" as const, text: "취소" },
        },
      } : {}),
    },
    {
      type: "button" as const,
      text: { type: "plain_text" as const, text: "취소", emoji: true },
      style: "danger" as const,
      action_id: "coop:cancel",
      value: JSON.stringify({ token }),
    },
  ];
}
