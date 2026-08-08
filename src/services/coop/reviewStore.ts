import {
  buildReviewUrl,
  createReviewToken,
  isExpired,
  isValidToken,
} from "~/services/lecture/reviewStore";
import type { AdminUpdateSemesterRequest } from "./types";

export interface StoredCoopReview {
  html: string;
  request: AdminUpdateSemesterRequest;
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

export { buildReviewUrl };
