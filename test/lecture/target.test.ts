import { describe, expect, it } from "vitest";
import CHANNEL_ID from "@/constant/CHANNEL_ID.json";
import { isProduction, labelOf, resolveTarget } from "~/services/lecture/target";

describe("대상 코인 결정", () => {
  it("등록되지 않은 채널에서는 아무것도 하지 않는다", () => {
    // 기본값을 두면 실수로 프로덕션에 들어간다. 되돌릴 API가 없다.
    for (const channel of ["C_아무거나", CHANNEL_ID.채팅방, CHANNEL_ID.삐봇요청_test, ""]) {
      const result = resolveTarget(channel);
      expect(result.ok).toBe(false);
      expect(result.target).toBeUndefined();
    }
  });

  it("어느 채널에서 실행해야 하는지 알려준다", () => {
    const result = resolveTarget(CHANNEL_ID.채팅방);
    expect(result.reason).toContain(CHANNEL_ID.코인_이벤트알림_stage);
    expect(result.reason).toContain(CHANNEL_ID.코인_이벤트알림);
  });

  it("스테이지 채널과 운영 채널이 다른 환경으로 간다", () => {
    // 설정이 없으면 target이 비지만, 어느 환경으로 판정했는지는 사유에 드러난다.
    const stage = resolveTarget(CHANNEL_ID.코인_이벤트알림_stage);
    const prod = resolveTarget(CHANNEL_ID.코인_이벤트알림);

    expect(stage.target?.env ?? stage.reason).not.toEqual(prod.target?.env ?? prod.reason);
  });

  it("설정이 없는 환경은 반쯤 열어두지 않는다", () => {
    // baseUrl만 있고 계정이 없는 상태로 붙으면 엉뚱한 곳에 401을 던진다.
    const prod = resolveTarget(CHANNEL_ID.코인_이벤트알림);
    if (!prod.ok) {
      expect(prod.target).toBeUndefined();
      expect(prod.reason).toMatch(/설정/);
    }
  });

  it("사람에게 보여줄 이름과 위험 표시", () => {
    expect(labelOf("stage")).toBe("스테이지");
    expect(labelOf("prod")).toBe("프로덕션");
    expect(isProduction("prod")).toBe(true);
    expect(isProduction("stage")).toBe(false);
  });
});
