import { describe, expect, it } from "vitest";
import { renderBusReviewHtml } from "~/services/bus/review";

const conversion = {
  payloads: [{
    target: "commuting" as const,
    semester_type: "REGULAR" as const,
    body: { commuting_bus_timetables: [{
      region: "천안",
      route_type: "등교",
      route_name: "천안역",
      node_info: [{ name: "천안역" }, { name: "대학" }],
      route_info: [{ name: "1회", running_days: ["MON" as const], arrival_time: ["08:10", "08:50"] }],
    }] },
  }],
  version_update: { type: "shuttle_bus_timetable" as const, title: "정규학기" as const, content: "2026-03-02~2026-06-19" },
  provenance: {},
  warnings: ["천안역 노선 확인 필요"],
};

const cleanConversion = {
  payloads: [{
    target: "shuttle" as const,
    semester_type: "SEASONAL" as const,
    body: { shuttle_bus_timetables: [
      { region: "청주", route_type: "셔틀", route_name: "청주 셔틀", node_info: [{ name: "터미널" }], route_info: [{ name: "1회", arrival_time: ["09:00"] }] },
      { region: "청주", route_type: "셔틀", route_name: "청주 셔틀", node_info: [{ name: "대학" }], route_info: [{ name: "2회", arrival_time: ["18:00"] }] },
    ] },
  }],
  version_update: { type: "shuttle_bus_timetable" as const, title: "계절학기" as const, content: "2026-06-22~2026-07-10" },
  provenance: {},
  warnings: [],
};

const warnedCleanConversion = {
  ...cleanConversion,
  warnings: ["청주 셔틀 노선 확인 필요"],
};

describe("버스 검수 HTML", () => {
  it("강의 검수와 같은 전체·확인 필요 필터 구조를 제공한다", () => {
    const html = renderBusReviewHtml("job-1", [conversion]);
    expect(html).toContain("전체");
    expect(html).toContain("확인 필요");
    expect(html).toContain('id="f-all"');
    expect(html).toContain('id="f-issue"');
    expect(html).toContain('class="route issue"');
    expect(html).toContain("노선 확인 필요");
    expect(html).toContain("천안역");
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("running_days를 한글로 표기한다", () => {
    const html = renderBusReviewHtml("job-1", [conversion]);
    expect(html).toContain("<small>월</small>");
    expect(html).not.toContain("<small>MON</small>");
  });

  it("경고가 있는 경우에만 확인 필요 타일을 강조한다", () => {
    expect(renderBusReviewHtml("job-1", [conversion])).toContain(
      'class="tile warn"',
    );
    expect(renderBusReviewHtml("job-1", [cleanConversion])).not.toContain(
      'class="tile warn"',
    );
  });

  it("영향 범위를 학기별 변환 단위로 센다", () => {
    const html = renderBusReviewHtml("job-1", [conversion, warnedCleanConversion]);
    expect(html).toContain("영향 범위: 1개 노선");
    expect(html).toContain("영향 범위: 2개 노선");
  });

  it("확인 필요 필터는 경고가 있는 항목만 남긴다", () => {
    const html = renderBusReviewHtml("job-1", [conversion]);
    expect(html).toContain("개 항목");
    expect(html).toContain("warning-panel");
  });
});
