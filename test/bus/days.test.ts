import { describe, expect, it } from "vitest";
import { sourceDays } from "~/services/bus/days";

describe("sourceDays", () => {
  it("월~금 범위와 주중 키워드를 평일로 읽는다", () => {
    expect(sourceDays("월~금")).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);
    expect(sourceDays("월 ~ 금요일")).toEqual([
      "MON",
      "TUE",
      "WED",
      "THU",
      "FRI",
    ]);
    expect(sourceDays("주중")).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);
    expect(sourceDays("평일 운행")).toEqual([
      "MON",
      "TUE",
      "WED",
      "THU",
      "FRI",
    ]);
  });

  it("임의의 범위를 정규 순서로 펼친다", () => {
    expect(sourceDays("수~금")).toEqual(["WED", "THU", "FRI"]);
    expect(sourceDays("화~금")).toEqual(["TUE", "WED", "THU", "FRI"]);
  });

  it("나열된 요일을 언급 순서와 무관하게 정규 순서로 돌려준다", () => {
    expect(sourceDays("금,일요일")).toEqual(["FRI", "SUN"]);
    expect(sourceDays("월,수,금")).toEqual(["MON", "WED", "FRI"]);
    expect(sourceDays("월·수·금")).toEqual(["MON", "WED", "FRI"]);
    expect(sourceDays("수 (1대)")).toEqual(["WED"]);
    expect(sourceDays("월,화,수,목,금")).toEqual([
      "MON",
      "TUE",
      "WED",
      "THU",
      "FRI",
    ]);
  });

  it("주말·매일 키워드를 읽는다", () => {
    expect(sourceDays("주말")).toEqual(["SAT", "SUN"]);
    expect(sourceDays("매일")).toEqual([
      "MON",
      "TUE",
      "WED",
      "THU",
      "FRI",
      "SAT",
      "SUN",
    ]);
  });

  it("요일이 없으면 undefined를 돌려준다", () => {
    expect(sourceDays("등교")).toBeUndefined();
    expect(sourceDays("08:30")).toBeUndefined();
  });

  it("숫자 뒤의 월·일을 요일로 오인하지 않는다", () => {
    expect(sourceDays("2026.6.22~7.10")).toBeUndefined();
    expect(sourceDays("6월22일~7월10일")).toBeUndefined();
    expect(sourceDays("2026.12.20.(일) ~ 2.28.(일)")).toEqual(["SUN"]);
  });
});
