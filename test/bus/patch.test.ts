import { describe, expect, it } from "vitest";
import { hasLlmCredentials } from "~/services/lecture/llm";
import { applyBusPatchesToConversions, planBusPatches, resolvePatch, type RawPatch } from "~/services/bus/patch";
import type { BusConversion, BusRoute } from "~/services/bus/types";
import { validateConversion } from "~/services/bus/validation";

const route = (over = {}): BusRoute => ({
  region: "천안",
  route_type: "등교",
  route_name: "천안역",
  node_info: [
    { name: "터미널" },
    { name: "천안역 (학화호두과자 앞)" },
    { name: "대학(본교)" },
  ],
  route_info: [
    {
      name: "1회",
      running_days: ["MON", "TUE", "WED", "THU", "FRI"] as BusRoute["route_info"][number]["running_days"],
      arrival_time: ["08:10", "08:15", "08:50"],
    },
    {
      name: "2회",
      arrival_time: ["09:10", null, "09:50"],
    },
  ],
  ...over,
});

const conversion = (over = {}): BusConversion => ({
  payloads: [
    {
      target: "commuting",
      semester_type: "REGULAR",
      body: { commuting_bus_timetables: [route()] },
    },
    {
      target: "shuttle",
      semester_type: "REGULAR",
      body: { shuttle_bus_timetables: [route({ route_type: "셔틀", route_name: "천안 셔틀" })] },
    },
  ],
  version_update: {
    type: "shuttle_bus_timetable",
    title: "정규학기",
    content: "2025-03-03~2025-06-20",
  },
  provenance: {},
  warnings: [],
  ...over,
});

describe("버스 수정 적용", () => {
  it("원본을 건드리지 않는다", () => {
    const original = conversion();
    const before = structuredClone(original);

    applyBusPatchesToConversions([original], [
      {
        semester: "REGULAR",
        target: "commuting",
        region: "천안",
        routeType: "등교",
        routeName: "천안역",
        kind: "arrival_time",
        tripName: "1회",
        stopName: "터미널",
        before: "08:10",
        after: "08:05",
        rawValue: "08:05",
        value: "08:05",
      },
    ]);

    expect(original).toEqual(before);
  });

  it("도착시각을 바꾼다", () => {
    const [next] = applyBusPatchesToConversions([conversion()], [
      {
        semester: "REGULAR",
        target: "commuting",
        region: "천안",
        routeType: "등교",
        routeName: "천안역",
        kind: "arrival_time",
        tripName: "1회",
        stopName: "터미널",
        before: "08:10",
        after: "08:05",
        rawValue: "08:05",
        value: "08:05",
      },
    ]);
    const target = Object.values(next.payloads[0].body)[0][0];
    expect(target.route_info[0].arrival_time[0]).toBe("08:05");
    expect(target.route_info[1].arrival_time[0]).toBe("09:10");
    expect(validateConversion(next)).toBeTruthy();
  });

  it("노선명을 바꾸고, 같은 요청의 뒤따르는 패치가 새 이름을 따라잡는다", () => {
    const [next] = applyBusPatchesToConversions([conversion()], [
      {
        semester: "REGULAR",
        target: "commuting",
        region: "천안",
        routeType: "등교",
        routeName: "천안역",
        kind: "route_name",
        before: "천안역",
        after: "천안역1",
        rawValue: "천안역1",
        value: "천안역1",
      },
      {
        semester: "REGULAR",
        target: "commuting",
        region: "천안",
        routeType: "등교",
        routeName: "천안역1",
        kind: "arrival_time",
        tripName: "2회",
        stopName: "대학(본교)",
        before: "09:50",
        after: "10:00",
        rawValue: "10:00",
        value: "10:00",
      },
    ]);
    const target = Object.values(next.payloads[0].body)[0][0];
    expect(target.route_name).toBe("천안역1");
    expect(target.route_info[1].arrival_time[2]).toBe("10:00");
    expect(validateConversion(next)).toBeTruthy();
  });

  it("운행요일을 바꾼다", () => {
    const [next] = applyBusPatchesToConversions([conversion()], [
      {
        semester: "REGULAR",
        target: "commuting",
        region: "천안",
        routeType: "등교",
        routeName: "천안역",
        kind: "running_days",
        tripName: "1회",
        before: "월~금",
        after: "월,수,금",
        rawValue: "월수금",
        days: ["MON", "WED", "FRI"],
      },
    ]);
    const target = Object.values(next.payloads[0].body)[0][0];
    expect(target.route_info[0].running_days).toEqual(["MON", "WED", "FRI"]);
    expect(target.route_info[1].running_days).toBeUndefined();
  });

  it("적용 기간을 바꾼다", () => {
    const [next] = applyBusPatchesToConversions([conversion()], [
      {
        semester: "REGULAR",
        target: "commuting",
        region: "",
        routeType: "",
        routeName: "",
        kind: "period",
        before: "2025-03-03~2025-06-20",
        after: "2025-03-02~2025-06-19",
        rawValue: "2025-03-02~2025-06-19",
        value: "2025-03-02~2025-06-19",
      },
    ]);
    expect(next.version_update.content).toBe("2025-03-02~2025-06-19");
  });

  it("회차를 삭제한다", () => {
    const [next] = applyBusPatchesToConversions([conversion()], [
      {
        semester: "REGULAR",
        target: "commuting",
        region: "천안",
        routeType: "등교",
        routeName: "천안역",
        kind: "remove_trip",
        tripName: "2회",
        before: "2회 삭제",
        after: "삭제",
        rawValue: "2회",
      },
    ]);
    const target = Object.values(next.payloads[0].body)[0][0];
    expect(target.route_info).toHaveLength(1);
    expect(validateConversion(next)).toBeTruthy();
  });

  it("정류장을 삭제하면 모든 회차에서 빠진다", () => {
    const [next] = applyBusPatchesToConversions([conversion()], [
      {
        semester: "REGULAR",
        target: "commuting",
        region: "천안",
        routeType: "등교",
        routeName: "천안역",
        kind: "remove_stop",
        stopName: "천안역 (학화호두과자 앞)",
        before: "삭제",
        after: "삭제",
        rawValue: "천안역",
      },
    ]);
    const target = Object.values(next.payloads[0].body)[0][0];
    expect(target.node_info).toHaveLength(2);
    for (const trip of target.route_info) expect(trip.arrival_time).toHaveLength(2);
    expect(validateConversion(next)).toBeTruthy();
  });

  it("회차를 추가한다", () => {
    const [next] = applyBusPatchesToConversions([conversion()], [
      {
        semester: "REGULAR",
        target: "commuting",
        region: "천안",
        routeType: "등교",
        routeName: "천안역",
        kind: "add_trip",
        tripName: "3회",
        before: "-",
        after: "3회 추가",
        rawValue: "3회",
        value: "10:10",
      },
    ]);
    const target = Object.values(next.payloads[0].body)[0][0];
    expect(target.route_info).toHaveLength(3);
    expect(target.route_info[2].arrival_time).toEqual(["10:10", null, null]);
    expect(validateConversion(next)).toBeTruthy();
  });

  it("정류장을 추가한다", () => {
    const [next] = applyBusPatchesToConversions([conversion()], [
      {
        semester: "REGULAR",
        target: "commuting",
        region: "천안",
        routeType: "등교",
        routeName: "천안역",
        kind: "add_stop",
        before: "-",
        after: "두정역 추가",
        rawValue: "두정역",
        addStop: { name: "두정역", afterStop: "터미널" },
      },
    ]);
    const target = Object.values(next.payloads[0].body)[0][0];
    expect(target.node_info.map((node) => node.name)).toEqual(["터미널", "두정역", "천안역 (학화호두과자 앞)", "대학(본교)"]);
    for (const trip of target.route_info) expect(trip.arrival_time).toHaveLength(4);
    expect(validateConversion(next)).toBeTruthy();
  });

  it("노선을 삭제한다", () => {
    const [next] = applyBusPatchesToConversions([conversion()], [
      {
        semester: "REGULAR",
        target: "commuting",
        region: "천안",
        routeType: "등교",
        routeName: "천안역",
        kind: "remove_route",
        before: "천안역 삭제",
        after: "삭제",
        rawValue: "천안역",
      },
    ]);
    const remaining = Object.values(next.payloads[0].body)[0];
    expect(remaining).toHaveLength(0);
    expect(() => validateConversion(next)).toThrow();
  });

  it("다른 학기의 노선은 건드리지 않는다", () => {
    const [next] = applyBusPatchesToConversions([conversion()], [
      {
        semester: "REGULAR",
        target: "shuttle",
        region: "천안",
        routeType: "셔틀",
        routeName: "천안 셔틀",
        kind: "arrival_time",
        tripName: "1회",
        stopName: "터미널",
        before: "08:10",
        after: "12:00",
        rawValue: "12:00",
        value: "12:00",
      },
    ]);
    const commuting = Object.values(next.payloads[0].body)[0][0];
    const shuttle = Object.values(next.payloads[1].body)[0][0];
    expect(commuting.route_info[0].arrival_time[0]).toBe("08:10");
    expect(shuttle.route_info[0].arrival_time[0]).toBe("12:00");
  });

  it("없는 정류장을 삭제하면 오류를 던진다", () => {
    expect(() =>
      applyBusPatchesToConversions([conversion()], [
        {
          semester: "REGULAR",
          target: "commuting",
          region: "천안",
          routeType: "등교",
          routeName: "천안역",
          kind: "remove_stop",
          stopName: "없는 정류장",
          before: "삭제",
          after: "삭제",
          rawValue: "없는 정류장",
        },
      ]),
    ).toThrow(/정류장을 찾지 못했습니다/);
  });

  it("없는 기준 정류장에 정류장을 추가하면 오류를 던진다", () => {
    expect(() =>
      applyBusPatchesToConversions([conversion()], [
        {
          semester: "REGULAR",
          target: "commuting",
          region: "천안",
          routeType: "등교",
          routeName: "천안역",
          kind: "add_stop",
          before: "-",
          after: "두정역 추가",
          rawValue: "두정역",
          addStop: { name: "두정역", afterStop: "없는 기준" },
        },
      ]),
    ).toThrow(/정류장 위치를 찾지 못했습니다/);
  });

  it("없는 정류장의 도착시각을 바꾸면 오류를 던진다", () => {
    expect(() =>
      applyBusPatchesToConversions([conversion()], [
        {
          semester: "REGULAR",
          target: "commuting",
          region: "천안",
          routeType: "등교",
          routeName: "천안역",
          kind: "arrival_time",
          tripName: "1회",
          stopName: "없는 정류장",
          before: "08:10",
          after: "08:05",
          rawValue: "08:05",
          value: "08:05",
        },
      ]),
    ).toThrow(/정류장을 찾지 못했습니다/);
  });
});

describe("버스 수정 요청 해석 (LLM 없이 코드 가드)", () => {
  const raw = (over: Partial<RawPatch> = {}): RawPatch => ({
    semester: "정규학기",
    region: "천안",
    direction: "등교",
    route: "천안역",
    field: "remove_route",
    trip: "",
    stop: "",
    value: "",
    days: "",
    newStop: "",
    referenceStop: "",
    position: "",
    ...over,
  });

  it("마지막 남은 노선 삭제는 미리보기 단계에서 막는다", () => {
    const problems: string[] = [];
    const patch = resolvePatch(raw(), [conversion()], problems);

    expect(patch).toBeNull();
    expect(problems.join(" ")).toMatch(/마지막 남은 노선/);
  });

  it("둘 이상 노선 중 하나는 삭제할 수 있다", () => {
    const two = conversion();
    (two.payloads[0].body.commuting_bus_timetables as BusRoute[]).push(
      route({ route_name: "천안역2" }),
    );
    const problems: string[] = [];
    const patch = resolvePatch(raw(), [two], problems);

    expect(patch?.kind).toBe("remove_route");
    expect(patch?.routeName).toBe("천안역");
    expect(problems).toHaveLength(0);
  });
});

describe.skipIf(!hasLlmCredentials())("버스 수정 요청 해석", () => {
  it("도착시각 수정을 한 건으로 만든다", async () => {
    const plan = await planBusPatches("천안역 노선 1회 터미널 시간을 08:05로 바꿔줘", [conversion()]);

    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0].kind).toBe("arrival_time");
    expect(plan.patches[0].after).toBe("08:05");
  });

  it("방향까지 지정해야 여러 노선을 구분한다", async () => {
    const withBoth = conversion();
    const plan = await planBusPatches("천안역 노선 1회 터미널을 08:05로", [withBoth]);

    // 등교·하교가 같은 노선명이면 추측하지 않고 알려준다.
    expect(plan.patches).toHaveLength(0);
    expect(plan.problems.join(" ")).toMatch(/여러 노선/);
  });

  it("없는 노선은 찾지 못했다고 알린다", async () => {
    const plan = await planBusPatches("대전 노선 1회 터미널을 08:05로 바꿔줘", [conversion()]);

    expect(plan.patches).toHaveLength(0);
    expect(plan.problems.join(" ")).toMatch(/찾지 못/);
  });
});
