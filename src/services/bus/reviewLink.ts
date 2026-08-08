import { buildBusReviewUrl, saveBusReview, updateBusReview } from "./reviewStore";
import type { BusConversion } from "./types";

/** Stores a bus review page using the bus review route's storage contract. */
export async function saveBusReviewPage(
  html: string,
  conversions: BusConversion[],
  existingToken?: string,
): Promise<{ url: string; token: string }> {
  const review = {
    html,
    meta: {
      sourceFileName: "bus-workflow",
      issueCount: conversions.reduce(
        (count, conversion) => count + conversion.warnings.length,
        0,
      ),
      createdAt: new Date().toISOString(),
    },
  };
  // 수정 반영 뒤에도 같은 링크가 유지되도록 기존 토큰이 있으면 덮어쓴다.
  const token = existingToken ?? (await saveBusReview(review));
  if (existingToken) await updateBusReview(existingToken, review);
  return { url: buildBusReviewUrl(token), token };
}
