import {
  buildReviewUrl,
  createReviewToken,
  isExpired,
  isValidToken,
} from "~/services/lecture/reviewStore";
import type { AdminUpdateSemesterRequest, RegularConversionResult } from "./types";
import type { CoopPatch } from "./patch";

export interface StoredCoopReview {
  html: string;
  request: AdminUpdateSemesterRequest;
  conversion: RegularConversionResult;
  meta: {
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
  const token = createReviewToken();
  await useStorage("kvStorage").setItem(key(token), review);
  return token;
}

export async function loadCoopReview(token: string): Promise<StoredCoopReview | null> {
  if (!isValidToken(token)) return null;
  const stored = await useStorage("kvStorage").getItem<StoredCoopReview>(key(token));
  if (!stored) return null;
  if (isExpired(stored.meta.createdAt, new Date())) {
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
  createdAt: string;
}

export async function saveCoopPatchPlan(
  reviewToken: string,
  plan: Pick<StoredCoopPatchPlan, "patches" | "problems">,
): Promise<string> {
  const token = createReviewToken();
  await useStorage("kvStorage").setItem(patchKey(token), {
    reviewToken,
    ...plan,
    createdAt: new Date().toISOString(),
  } satisfies StoredCoopPatchPlan);
  return token;
}

export async function loadCoopPatchPlan(token: string): Promise<StoredCoopPatchPlan | null> {
  if (!isValidToken(token)) return null;
  const stored = await useStorage("kvStorage").getItem<StoredCoopPatchPlan>(patchKey(token));
  if (!stored || isExpired(stored.createdAt, new Date())) return null;
  return stored;
}

export async function dropCoopPatchPlan(token: string): Promise<void> {
  await useStorage("kvStorage").removeItem(patchKey(token));
}

export { buildReviewUrl };
