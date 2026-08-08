import { describe, expect, it } from "vitest";
import {
  buildRegularCoopResultBlocks,
  expectedRegularSemester,
} from "~/services/coop/pipeline";
import { messages as coopMessages, parseCoopCommand, parseVacationBoundary } from "~/services/slack/domain/coop";
import { messages as lectureMessages } from "~/services/slack/domain/lecture";

describe("!생협반영 인자", () => {
  it("연도와 정규학기를 읽는다", () => {
    expect(parseCoopCommand("!생협반영 2026 1학기")).toEqual({ year: 2026, kind: "regular", termName: "1학기" });
    expect(parseCoopCommand("  !생협반영   2026  2학기 ")).toEqual({ year: 2026, kind: "regular", termName: "2학기" });
  });

  it("하계·동계방학을 읽고 불완전한 명령을 거절한다", () => {
    expect(parseCoopCommand("!생협반영 2026 하계방학")).toEqual({
      year: 2026, kind: "vacation", season: "하계", termName: "하계방학",
    });
    expect(parseCoopCommand("!생협반영 2026 동계방학")).toEqual({
      year: 2026, kind: "vacation", season: "동계", termName: "동계방학",
    });
    expect(parseCoopCommand("!생협반영")).toBeNull();
    expect(parseCoopCommand("!생협반영 2026 여름학기")).toBeNull();
    expect(parseCoopCommand("!생협반영 26 1학기")).toBeNull();
  });

  it("방학 시작일 명령은 ISO 날짜만 읽는다", () => {
    expect(parseVacationBoundary("!학기구분 2026-07-18")).toBe("2026-07-18");
    expect(parseVacationBoundary("!학기구분 7월 18일")).toBeNull();
  });

  it("명령 대상 학기를 이미지 표기와 같은 형식으로 만든다", () => {
    expect(expectedRegularSemester({ year: 2026, termName: "1학기" })).toBe("26-1학기");
  });

  it("강의 반영 명령과 서로 겹치지 않는다", () => {
    const handlers = [...lectureMessages, ...coopMessages];
    const matching = (text: string) => handlers.filter((handler) =>
      typeof handler.regex === "string"
        ? text.includes(handler.regex)
        : handler.regex.test(text));

    expect(matching("!강의반영 2026 1학기")).toHaveLength(1);
    expect(matching("!생협반영 2026 1학기")).toHaveLength(1);
  });
});

describe("생협 변환 완료 메시지", () => {
  it("검토 링크와 변환 건수를 보여준다", () => {
    const blocks = buildRegularCoopResultBlocks({
      token: "a".repeat(32),
      reviewUrl: "https://bot.example.com/review/token",
      shopCount: 11,
      excludedCount: 3,
      blockingCount: 0,
      infoCount: 3,
    }, { env: "stage", year: 2026, termName: "1학기", fileName: "시간표.png" }, "U1");

    expect(JSON.stringify(blocks)).toContain("반영 대상 *11개*");
    expect(JSON.stringify(blocks)).not.toContain("2캠 제외");
    expect(JSON.stringify(blocks)).toContain("https://bot.example.com/review/token");
    expect(JSON.stringify(blocks)).toContain("coop:apply");
  });
});
