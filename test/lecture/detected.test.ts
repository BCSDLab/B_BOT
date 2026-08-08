import { describe, expect, it } from "vitest";
import { fileNameOf, isAllowedFileUrl, parseDetected } from "~/services/lecture/detected";

const valid = {
  target: "stage",
  year: 2026,
  term: "여름학기",
  file_url: "https://portal.koreatech.ac.kr/upload/붙임2.%20개설교과목.xlsx",
  notice_url: "https://portal.koreatech.ac.kr/notice/1234",
  notice_title: "2026학년도 하계 계절학기 개설교과목 안내",
};

describe("감지 알림 검증", () => {
  it("올바른 요청을 받아들인다", () => {
    const result = parseDetected(valid);
    expect(result.notice?.year).toBe(2026);
    expect(result.notice?.target).toBe("stage");
    expect(result.notice?.noticeTitle).toContain("하계");
  });

  it("대상 환경을 지어내지 않는다", () => {
    // 기본값을 두면 실수로 프로덕션에 알림이 간다.
    for (const target of [undefined, "", "production", "PROD"]) {
      expect(parseDetected({ ...valid, target }).notice).toBeUndefined();
    }
  });

  it("모르는 학기를 통과시키지 않는다", () => {
    expect(parseDetected({ ...valid, term: "계절학기" }).notice).toBeUndefined();
    expect(parseDetected({ ...valid, term: "" }).notice).toBeUndefined();
  });

  it("연도가 이상하면 막는다", () => {
    for (const year of [undefined, "올해", 1800, 3000]) {
      expect(parseDetected({ ...valid, year }).notice).toBeUndefined();
    }
  });

  it("학교 주소가 아니면 받지 않는다", () => {
    // 남이 넣은 주소로 봇이 아무거나 받아오게 두지 않는다.
    expect(parseDetected({ ...valid, file_url: "https://evil.example.com/a.xlsx" }).notice)
      .toBeUndefined();
    expect(parseDetected({ ...valid, file_url: "http://portal.koreatech.ac.kr/a.xlsx" }).notice)
      .toBeUndefined();
  });

  it("무엇이 잘못됐는지 알려준다", () => {
    expect(parseDetected({ ...valid, term: "계절학기" }).reason).toContain("term");
    expect(parseDetected({}).reason).toContain("target");
  });
});

describe("첨부 주소 확인", () => {
  it("학교 도메인만 통과한다", () => {
    expect(isAllowedFileUrl("https://portal.koreatech.ac.kr/a.xlsx")).toBe(true);
    expect(isAllowedFileUrl("https://koreatech.ac.kr/a.xlsx")).toBe(true);
    expect(isAllowedFileUrl("https://api.koreatech.in/a.xlsx")).toBe(true);
  });

  it("접미사 위장을 막는다", () => {
    expect(isAllowedFileUrl("https://koreatech.ac.kr.evil.com/a.xlsx")).toBe(false);
    expect(isAllowedFileUrl("https://notkoreatech.ac.kr/a.xlsx")).toBe(false);
    expect(isAllowedFileUrl("주소아님")).toBe(false);
  });
});

describe("파일 이름", () => {
  it("주소 끝에서 딴다", () => {
    expect(fileNameOf(parseDetected(valid).notice!)).toBe("붙임2. 개설교과목.xlsx");
  });

  it("딸 수 없으면 학기로 만든다", () => {
    const notice = parseDetected({ ...valid, file_url: "https://koreatech.ac.kr/" }).notice!;
    expect(fileNameOf(notice)).toBe("2026-여름학기.xlsx");
  });
});
