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
  warnings: ["천안 천안역: 종착 도착시각을 읽을 수 없어 하교 자동 생성을 건너뜁니다."],
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
    expect(html).toContain("하교 자동 생성을 건너뜁니다");
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
    expect(html).toContain("개 노선");
    expect(html).toContain("warning-panel");
  });

  it("running_days가 없는 회차는 운행요일 미지정으로 표시하고 확인 필요 필터에 포함한다", () => {
    const html = renderBusReviewHtml("job-1", [cleanConversion]);
    expect(html).toContain("운행요일 미지정");
    expect(html).toContain("<small class=\"missing\" title=\"Slack에서 !수정 으로 운행요일을 지정하세요\">");
    expect(html).toContain('class="route no-days"');
    expect(html).toContain('route.classList.contains("no-days")');
    expect(html).toContain("운행요일미지정");
  });

  it("running_days가 있으면 미지정 표시를 하지 않는다", () => {
    const html = renderBusReviewHtml("job-1", [conversion]);
    expect(html).not.toContain("운행요일 미지정");
    expect(html).not.toContain('class="route no-days"');
  });

  it("카운터는 경고 패널을 세지 않고 노선 카드만 센다", () => {
    const html = renderBusReviewHtml("job-1", [conversion]);
    expect(html).toContain('querySelectorAll("#groups .route"));');
    expect(html).toContain('querySelectorAll("#groups .warning-panel"));');
    expect(html).not.toContain(
      'querySelectorAll("#groups .route, #groups .warning-panel"));',
    );
  });

  it("하교 자동계산 경고는 해당 지역·방향 노선만 확인 필요로 표시한다", () => {
    const base = {
      payloads: [{
        target: "commuting" as const,
        semester_type: "REGULAR" as const,
        body: { commuting_bus_timetables: [
          { region: "천안", route_type: "등교", route_name: "천안역", node_info: [{ name: "천안역" }], route_info: [{ name: "1회", arrival_time: ["08:10"] }] },
          { region: "천안", route_type: "하교", route_name: "천안역", node_info: [{ name: "대학" }], route_info: [{ name: "1회", arrival_time: ["18:10"] }] },
          { region: "세종", route_type: "등교", route_name: "세종", node_info: [{ name: "세종시청" }], route_info: [{ name: "1회", arrival_time: ["08:30"] }] },
        ] },
      }],
      version_update: { type: "shuttle_bus_timetable" as const, title: "정규학기" as const, content: "2026-03-02~2026-06-19" },
      provenance: {},
      warnings: ["천안 하교는 등교 노선 역순(18:10 출발)으로 자동 계산해 추가했습니다."],
    };
    const html = renderBusReviewHtml("job-1", [base]);
    const issueSections = [...html.matchAll(/<section class="route issue[^"]*" data-search="([^"]*)"/g)].map((m) => m[1]);
    expect(issueSections).toEqual([
      "commuting regular 천안 하교 천안역 운행요일미지정",
    ]);
  });
});
