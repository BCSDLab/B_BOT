import { describe, expect, it } from "vitest";
import { buildBusPatchBlocks } from "~/services/bus/pipeline";
import type { BusPatchPlan } from "~/services/bus/patch";

describe("버스 수정 미리보기", () => {
  it("같은 노선명이 여러 학기에 있을 수 있어 학기를 함께 보여준다", () => {
    const plan: BusPatchPlan = {
      patches: [
        {
          semester: "SEASONAL",
          target: "commuting",
          region: "천안",
          routeType: "등교",
          routeName: "터미널/천안역",
          kind: "running_days",
          tripName: "1회",
          before: "운행일 없음",
          after: "월,화,수,목,금",
          rawValue: "월화수목금",
          days: ["MON", "TUE", "WED", "THU", "FRI"],
        },
      ],
      problems: [],
    };

    const blocks = buildBusPatchBlocks(plan, "p1", "U1");
    const text = JSON.stringify(blocks);

    expect(text).toContain("계절학기 천안 등교");
    expect(text).not.toMatch(/^• 천안 등교/);
  });

  it("period 수정도 어느 학기의 적용 기간인지 보여준다", () => {
    const plan: BusPatchPlan = {
      patches: [
        {
          semester: "VACATION",
          target: "commuting",
          region: "",
          routeType: "",
          routeName: "",
          kind: "period",
          before: "2026-07-13~2026-08-30",
          after: "2026-07-14~2026-08-30",
          rawValue: "2026-07-14~2026-08-30",
          value: "2026-07-14~2026-08-30",
        },
      ],
      problems: [],
    };

    const blocks = buildBusPatchBlocks(plan, "p1", "U1");
    expect(JSON.stringify(blocks)).toContain("방학기간 적용 기간");
  });
});
