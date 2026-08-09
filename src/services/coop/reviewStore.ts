import { randomBytes } from "node:crypto";
import type { AdminUpdateSemesterRequest, RegularConversionResult } from "./types";
import type { CoopPatch } from "./patch";
import type { KoinEnv } from "~/services/koin/target";

const TOKEN_BYTES = 16;
const EXPIRE_DAYS = 7;

export function createCoopReviewToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function isValidCoopToken(token: string): boolean {
  return new RegExp(`^[0-9a-f]{${TOKEN_BYTES * 2}}$`).test(token);
}

export function isCoopReviewExpired(createdAt: string, now: Date): boolean {
  const age = now.getTime() - new Date(createdAt).getTime();
  return !Number.isFinite(age) || age > EXPIRE_DAYS * 24 * 60 * 60 * 1000;
}

export function buildReviewUrl(token: string): string {
  const base = import.meta.env.APP_BASE_URL ?? "";
  if (!/^https?:\/\//.test(base)) {
    throw new Error("APP_BASE_URL이 절대 주소로 설정되어 있지 않습니다.");
  }
  return `${base.endsWith("/") ? base : `${base}/`}coop-review/${token}`;
}

export interface StoredCoopReview {
  html: string;
  request: AdminUpdateSemesterRequest;
  conversion: RegularConversionResult;
  periods?: Array<{
    kind: "계절학기" | "방학";
    request: AdminUpdateSemesterRequest;
    conversion: RegularConversionResult;
  }>;
  meta: {
    env: KoinEnv;
    year: number;
    termName: string;
    sourceFileName: string;
    shopCount: number;
    blockingCount: number;
    createdAt: string;
  };
}

const key = (token: string) => `coop-review:${token}`;
const threadKey = (channel: string, threadTs: string) => `coop-thread:${channel}:${threadTs}`;
const patchKey = (token: string) => `coop-patch:${token}`;

export async function saveCoopReview(review: StoredCoopReview): Promise<string> {
  const token = createCoopReviewToken();
  await useStorage("kvStorage").setItem(key(token), review);
  return token;
}

export async function loadCoopReview(token: string): Promise<StoredCoopReview | null> {
  if (!isValidCoopToken(token)) return null;
  const stored = await useStorage("kvStorage").getItem<StoredCoopReview>(key(token));
  if (!stored) return null;
  if (isCoopReviewExpired(stored.meta.createdAt, new Date())) {
    await useStorage("kvStorage").removeItem(key(token));
    return null;
  }
  return stored;
}

export async function updateCoopReview(token: string, review: StoredCoopReview): Promise<void> {
  await useStorage("kvStorage").setItem(key(token), review);
}

export async function linkCoopThread(channel: string, threadTs: string, token: string): Promise<void> {
  await useStorage("kvStorage").setItem(threadKey(channel, threadTs), { token });
}

export async function findCoopTokenByThread(channel: string, threadTs: string): Promise<string | null> {
  const stored = await useStorage("kvStorage").getItem<{ token: string }>(threadKey(channel, threadTs));
  return stored?.token ?? null;
}

export interface StoredCoopPatchPlan {
  reviewToken: string;
  patches: CoopPatch[];
  problems: string[];
  periodIndex?: number;
  createdAt: string;
}

export async function saveCoopPatchPlan(
  reviewToken: string,
  plan: Pick<StoredCoopPatchPlan, "patches" | "problems" | "periodIndex">,
): Promise<string> {
  const token = createCoopReviewToken();
  await useStorage("kvStorage").setItem(patchKey(token), {
    reviewToken,
    ...plan,
    createdAt: new Date().toISOString(),
  } satisfies StoredCoopPatchPlan);
  return token;
}

export async function loadCoopPatchPlan(token: string): Promise<StoredCoopPatchPlan | null> {
  if (!isValidCoopToken(token)) return null;
  const stored = await useStorage("kvStorage").getItem<StoredCoopPatchPlan>(patchKey(token));
  if (!stored || isCoopReviewExpired(stored.createdAt, new Date())) return null;
  return stored;
}

export async function dropCoopPatchPlan(token: string): Promise<void> {
  await useStorage("kvStorage").removeItem(patchKey(token));
}
