import { describe, expect, it } from "vitest";
import { buildRegularCoopResultBlocks } from "~/services/coop/pipeline";
import { messages as coopMessages } from "~/services/slack/domain/coop";

describe("생협 검수 스레드 수정 안내", () => {
  it("생협 메시지에서 !수정 명령을 받는다", () => {
    const matching = coopMessages.filter((message) =>
      typeof message.regex === "string"
        ? "!수정 복지관식당 토요일을 미운영으로 바꿔줘".includes(message.regex)
        : message.regex.test("!수정 복지관식당 토요일을 미운영으로 바꿔줘"));
    expect(matching).toHaveLength(1);
  });

  it("변환 완료 메시지에 수정 예시를 보여준다", () => {
    const blocks = buildRegularCoopResultBlocks({
      token: "a".repeat(32),
      reviewUrl: "https://bot.example.com/review/token",
      shopCount: 11,
      excludedCount: 3,
      blockingCount: 0,
      infoCount: 3,
    }, { env: "stage", year: 2026, termName: "1학기", fileName: "시간표.png" }, "U1");
    const json = JSON.stringify(blocks);
    expect(json).toContain("`!수정`");
    expect(json).toContain("세탁소 평일 운영시간");
  });
});
