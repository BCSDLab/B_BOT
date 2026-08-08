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
});
