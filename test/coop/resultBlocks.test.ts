import { describe, expect, it } from "vitest";
import { buildRegularCoopResultBlocks } from "~/services/coop/pipeline";

const outcome = {
  token: "a".repeat(32),
  reviewUrl: "https://bot.example.com/review/token",
  shopCount: 11,
  excludedCount: 3,
  blockingCount: 0,
  infoCount: 3,
};

describe("생협 반영 버튼", () => {
  it("차단 이슈가 없으면 스테이지 반영 버튼을 보여준다", () => {
    const blocks = buildRegularCoopResultBlocks(
      outcome,
      { env: "stage", year: 2026, termName: "1학기", fileName: "시간표.png" },
      "U1",
    );
    const json = JSON.stringify(blocks);
    expect(json).toContain("스테이지");
    expect(json).toContain("coop:apply");
    expect(json).toContain("coop:cancel");
  });

  it("차단 이슈가 있으면 반영과 취소 버튼을 숨긴다", () => {
    const blocks = buildRegularCoopResultBlocks(
      { ...outcome, blockingCount: 1 },
      { env: "stage", year: 2026, termName: "1학기", fileName: "시간표.png" },
      "U1",
    );
    const json = JSON.stringify(blocks);
    expect(json).not.toContain("coop:apply");
    expect(json).not.toContain("coop:cancel");
  });

  it("프로덕션 반영에는 확인 대화상자를 붙인다", () => {
    const blocks = buildRegularCoopResultBlocks(
      outcome,
      { env: "prod", year: 2026, termName: "1학기", fileName: "시간표.png" },
      "U1",
    );
    const json = JSON.stringify(blocks);
    expect(json).toContain("프로덕션에 반영");
    expect(json).toContain("프로덕션에 반영할까요?");
  });
});
