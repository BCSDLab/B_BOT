import { describe, expect, it } from "vitest";
import {
  applyCoopPatches,
  buildCoopPatchBlocks,
  resolveCoopPatch,
} from "~/services/coop/patch";
import type { RegularConversionResult } from "~/services/coop/types";

const conversion = (): RegularConversionResult => ({
  semester: "26-1학기",
  fromDate: "2026-03-03",
  toDate: "",
  excludedShops: [],
  issues: [{
    code: "invalid_date",
    severity: "blocking",
    shop: "",
    detail: "운영 기간을 해석하지 못했습니다.",
  }],
  request: { coop_shops: [] },
  shops: [
    {
      source: {
        groupLabel: "복지관",
        shopLabel: "식당",
        phone: "560-1778",
        remark: "능수관",
        operationHours: [{
          dayLabel: "평일",
          type: "점심",
          openTime: "11:40",
          closeTime: "13:30",
          rawText: "11:40 - 13:30",
        }],
      },
      baseline: {
        id: 1,
        name: "복지관식당",
        phone: "041-560-1778",
        location: "복지관 2층",
        remarks: "능수관",
        opens: [],
      },
      admin: {
        coop_shop_info: {
          name: "복지관식당",
          phone: "041-560-1778",
          location: "복지관 2층",
          remark: "능수관",
        },
        operation_hours: [{
          type: "점심",
          day_of_week: "평일",
          open_time: "11:40",
          close_time: "13:30",
        }],
      },
    },
  ],
});

describe("생협 파싱 데이터 수정", () => {
  it("누락된 토요일 미운영을 새 운영시간으로 추가한다", () => {
    const result = conversion();
    const problems: string[] = [];
    const patch = resolveCoopPatch({
      shop: "복지관식당",
      day: "토요일",
      type: "",
      field: "operation_hours",
      value: "미운영",
    }, result, problems);

    expect(problems).toEqual([]);
    expect(patch).toEqual(expect.objectContaining({ before: "(없음)", after: "미운영" }));
    const updated = applyCoopPatches(result, [patch!]);
    expect(updated.request.coop_shops[0].operation_hours).toContainEqual({
      type: "점심",
      day_of_week: "토요일",
      open_time: "미운영",
      close_time: "미운영",
    });
  });

  it("잘못 읽힌 운영시간과 종료일을 고치고 차단 이슈를 제거한다", () => {
    const result = conversion();
    const problems: string[] = [];
    const hour = resolveCoopPatch({
      shop: "복지관 식당",
      day: "평일",
      type: "점심",
      field: "operation_hours",
      value: "11:40 - 13:40",
    }, result, problems);
    const date = resolveCoopPatch({
      shop: "",
      day: "",
      type: "",
      field: "to_date",
      value: "2026-06-19",
    }, result, problems);

    const updated = applyCoopPatches(result, [hour!, date!]);
    expect(updated.toDate).toBe("2026-06-19");
    expect(updated.shops[0].admin.operation_hours[0].close_time).toBe("13:40");
    expect(updated.issues).not.toContainEqual(expect.objectContaining({ code: "invalid_date" }));
  });

  it("수정 적용 전에 변경 전후와 확인 버튼을 보여준다", () => {
    const blocks = buildCoopPatchBlocks({
      patches: [{
        field: "to_date",
        shopName: "",
        dayOfWeek: "",
        type: "",
        before: "",
        after: "2026-06-19",
        value: "2026-06-19",
      }],
      problems: [],
    }, "a".repeat(32), "U1");
    const json = JSON.stringify(blocks);
    expect(json).toContain("운영 종료일");
    expect(json).toContain("coop:patch_apply");
    expect(json).toContain("coop:patch_cancel");
  });
});
