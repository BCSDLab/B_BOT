import { describe, expect, it } from "vitest";
import { parseStructuredWorkbook } from "~/services/bus/regularParser";
import type { AnalysedWorkbook } from "~/services/bus/excelAnalyzer";

const cell = (row: number, column: number, value: unknown) => ({ row, column, value });

function workbook(): AnalysedWorkbook {
  return {
    sheets: [
      {
        name: "REGULAR",
        cells: [
          cell(1, 1, "천안 지역 등교"),
          cell(1, 4, "천안 셔틀"),
          cell(2, 1, "정류장"),
          cell(2, 2, "천안역"),
          cell(2, 3, "터미널"),
          cell(2, 4, "셔틀 1회"),
          cell(3, 1, "천안역"),
          cell(4, 1, "터미널"),
          cell(5, 1, "대학"),
          cell(3, 2, "07:50/08:10"),
          cell(4, 2, "08:00/08:20"),
          cell(3, 3, "08:10"),
          cell(4, 3, "08:20"),
          cell(5, 3, "08:50"),
          cell(3, 4, "08:10"),
          cell(4, 4, "08:20"),
          cell(5, 4, "08:50"),
        ],
        merges: [],
      },
    ],
    tables: [],
  };
}

describe("parseStructuredWorkbook", () => {
  it("통학 슬래시 결합을 다중 회차로 분리하고 셔틀은 그대로 둔다", () => {
    const routes = parseStructuredWorkbook(workbook());

    const commuting = routes.filter((r) => r.target === "commuting");
    const shuttle = routes.filter((r) => r.target === "shuttle");

    const joined = commuting.find((r) => r.route.route_name === "천안역")!;
    expect(joined.route.node_info).toEqual([{ name: "천안역" }, { name: "터미널" }]);
    expect(joined.route.route_info).toHaveLength(2);
    expect(joined.route.route_info[0]).toMatchObject({
      name: "1회",
      arrival_time: ["07:50", "08:00"],
    });
    expect(joined.route.route_info[1]).toMatchObject({
      name: "2회",
      arrival_time: ["08:10", "08:20"],
    });
    for (const trip of joined.route.route_info)
      expect(trip.running_days).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);

    const plain = commuting.find((r) => r.route.route_name === "터미널")!;
    expect(plain.route.route_info).toHaveLength(1);
    expect(plain.route.route_info[0]).toMatchObject({
      name: "1회",
      arrival_time: ["08:10", "08:20", "08:50"],
    });

    expect(shuttle).toHaveLength(1);
    expect(shuttle[0].route.route_name).toBe("천안 셔틀");
    expect(shuttle[0].route.node_info).toHaveLength(3);
    expect(shuttle[0].route.route_info).toHaveLength(1);
    expect(shuttle[0].route.route_info[0]).toMatchObject({
      name: "셔틀 1회",
      arrival_time: ["08:10", "08:20", "08:50"],
    });
  });

  it("주말 셔틀은 등교/하교를 한 노선에 담고, 소속을 상위 제목에서 찾아 회차명에 방향을 붙인다", () => {
    const weekend: AnalysedWorkbook = {
      sheets: [
        {
          name: "REGULAR",
          cells: [
            cell(8, 1, "2026학년도 학기 중 일학습병행대학 주말통학버스 운행시간표"),
            cell(9, 1, "(천안시내) 토요일 통학 셔틀버스"),
            cell(10, 1, "정류장"),
            cell(10, 2, "등교 2회"),
            cell(10, 4, "하교 2회"),
            cell(11, 1, "두정역"),
            cell(11, 2, "08:00"),
            cell(11, 3, "10:10"),
            cell(12, 1, "대학"),
            cell(12, 2, "도착"),
            cell(12, 3, "도착"),
            cell(12, 4, "19:10"),
            cell(12, 5, "19:20"),
          ],
          merges: [],
        },
      ],
      tables: [],
    };

    const routes = parseStructuredWorkbook(weekend);
    const route = routes.find((r) => r.route.route_name === "일학습병행대학 천안시내");
    expect(route).toBeDefined();
    expect(route!.target).toBe("shuttle");
    expect(route!.route.route_info.map((trip) => trip.name)).toEqual([
      "1회(등교)",
      "2회(등교)",
      "3회(하교)",
      "4회(하교)",
    ]);
    for (const trip of route!.route.route_info)
      expect(trip.running_days).toEqual(["SAT"]);
  });
});
