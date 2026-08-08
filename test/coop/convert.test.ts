import { describe, expect, it } from "vitest";
import {
  convertRegularTimetable,
  normalizeDate,
  normalizePhone,
  normalizeSemester,
} from "~/services/coop/convert";
import type { CoopShopBaseline, RawRegularCoopTimetable } from "~/services/coop/types";

const baseline: CoopShopBaseline = {
  semester: "25-2학기",
  from_date: "2025-09-01",
  to_date: "2025-12-19",
  coop_shops: [
    { id: 1, name: "학생식당", phone: "041-560-1278", location: "학생회관 2층",
      remarks: null, opens: [] },
    { id: 2, name: "대즐", phone: "041-560-1779", location: "복지관 1층",
      remarks: "기존 비고", opens: [] },
  ],
};

const raw: RawRegularCoopTimetable = {
  title: "2026-1학기 생협 사업장 운영시간 안내",
  semesterLabel: "2026-1학기",
  fromDate: "2026.3.3.(화)",
  toDate: "2026년 6월 19일",
  shops: [
    {
      groupLabel: "학생", shopLabel: "식당", phone: "560-1278", remark: "",
      operationHours: [
        { dayLabel: "평 일", type: "아침", openTime: "8:00", closeTime: "09:30", rawText: "08:00 - 09:30" },
        { dayLabel: "토요일", type: "아침", openTime: "조식 미운영", closeTime: "조식 미운영", rawText: "조식 미운영" },
      ],
    },
    {
      groupLabel: "본교", shopLabel: "커피점", phone: "560-1779", remark: "배달 서비스 실시",
      operationHours: [
        { dayLabel: "평일", type: "", openTime: "08:30", closeTime: "21:00", rawText: "08:30 - 21:00" },
      ],
    },
    {
      groupLabel: "2캠", shopLabel: "편의점", phone: "521-8088", remark: "",
      operationHours: [
        { dayLabel: "평일", type: "", openTime: "24시간 운영", closeTime: "24시간 운영", rawText: "24시간 운영" },
      ],
    },
  ],
};

describe("정규학기 기본값 정규화", () => {
  it("학기·날짜·전화번호를 표준 형식으로 만든다", () => {
    expect(normalizeSemester("2026.1학기")).toBe("26-1학기");
    expect(normalizeDate("2026년 3월 3일(화)")).toBe("2026-03-03");
    expect(normalizePhone("560-1278")).toBe("041-560-1278");
  });
});

describe("정규학기 변환", () => {
  it("표준 매장에 연결하고 2캠을 제외한다", () => {
    const result = convertRegularTimetable(raw, baseline);

    expect(result.semester).toBe("26-1학기");
    expect(result.fromDate).toBe("2026-03-03");
    expect(result.toDate).toBe("2026-06-19");
    expect(result.request.coop_shops.map((shop) => shop.coop_shop_info.name))
      .toEqual(["학생식당", "대즐"]);
    expect(result.request.coop_shops[0].operation_hours[0]).toEqual({
      type: "아침", day_of_week: "평일", open_time: "08:00", close_time: "09:30",
    });
    expect(result.request.coop_shops[0].operation_hours[1].open_time).toBe("조식 미운영");
    expect(result.excludedShops).toHaveLength(1);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "excluded_second_campus", severity: "info",
    }));
    expect(result.issues.filter((issue) => issue.severity === "blocking")).toHaveLength(0);
  });

  it("기존 매장이 빠지면 반영을 막는다", () => {
    const result = convertRegularTimetable({ ...raw, shops: raw.shops.slice(0, 1) }, baseline);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "missing_shop", shop: "대즐" }));
  });
});
