import { describe, expect, it } from "vitest";
import {
  convertRegularTimetable,
  convertVacationTimetable,
  normalizeDate,
  normalizePhone,
  normalizeSemester,
  normalizeVacationSemester,
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
    expect(normalizeSemester("2026년 1학기 시설물 운영 시간")).toBe("26-1학기");
    expect(normalizeSemester("2026년 1학기 하계방학 운영 시간")).toBeNull();
    expect(normalizeDate("2026년 3월 3일(화)")).toBe("2026-03-03");
    expect(normalizePhone("560-1278")).toBe("041-560-1278");
  });
});

describe("방학 학기 분리", () => {
  const vacationRaw: RawRegularCoopTimetable = {
    ...raw,
    title: "2026년 하계방학 생협 사업장 운영시간 안내",
    semesterLabel: "2026년 하계방학",
    fromDate: "2026.6.22",
    toDate: "2026.8.30",
    shops: raw.shops.slice(0, 2).map((shop, index) => ({
      ...shop,
      remark: index === 0 ? "계절학기 까지 운영" : "배달 서비스 실시",
    })),
  };

  it("방학 이름에서 연도와 계절을 읽는다", () => {
    expect(normalizeVacationSemester("26-하계방학")).toEqual({ year: 2026, season: "하계" });
    expect(normalizeVacationSemester("2026년 동계 계절학기")).toEqual({ year: 2026, season: "동계" });
  });

  it("방학 시작일을 경계로 두 학기 요청을 만든다", () => {
    const result = convertVacationTimetable(vacationRaw, baseline, "2026-07-18");

    expect(result.seasonal.semester).toBe("26-하계계절학기");
    expect(result.seasonal.fromDate).toBe("2026-06-22");
    expect(result.seasonal.toDate).toBe("2026-07-17");
    expect(result.vacation.semester).toBe("26-하계방학");
    expect(result.vacation.fromDate).toBe("2026-07-18");
    expect(result.vacation.toDate).toBe("2026-08-30");
  });

  it("기간 조건이 없는 운영시간은 복제하고 계절학기까지 운영하는 매장은 방학에 미운영 처리한다", () => {
    const result = convertVacationTimetable(vacationRaw, baseline, "2026-07-18");
    const seasonalRestaurant = result.seasonal.request.coop_shops[0];
    const vacationRestaurant = result.vacation.request.coop_shops[0];
    const seasonalCafe = result.seasonal.request.coop_shops[1];
    const vacationCafe = result.vacation.request.coop_shops[1];

    expect(seasonalRestaurant.operation_hours[0].open_time).toBe("08:00");
    expect(vacationRestaurant.operation_hours.every((hour) =>
      hour.open_time === "미운영" && hour.close_time === "미운영"
    )).toBe(true);
    expect(vacationCafe.operation_hours).toEqual(seasonalCafe.operation_hours);
    expect(result.vacation.issues).toContainEqual(expect.objectContaining({
      code: "vacation_hours_closed",
      shop: "학생식당",
      severity: "info",
    }));
  });

  it("방학 시작일이 전체 운영 기간 밖이면 거부한다", () => {
    expect(() => convertVacationTimetable(vacationRaw, baseline, "2026-09-01"))
      .toThrow("방학 시작일은 전체 운영 기간 안에서");
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
