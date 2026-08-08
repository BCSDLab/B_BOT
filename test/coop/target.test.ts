import { describe, expect, it } from "vitest";
import CHANNEL_ID from "@/constant/CHANNEL_ID.json";
import {
  coopTargetLabel,
  isCoopProduction,
  resolveCoopTarget,
} from "~/services/coop/target";

describe("생협 반영 대상", () => {
  it("등록되지 않은 채널은 거절하고 생협 전용 사유를 보여준다", () => {
    const result = resolveCoopTarget(CHANNEL_ID.채팅방);
    expect(result.ok).toBe(false);
    expect(result.target).toBeUndefined();
    expect(result.reason).toContain("생협 반영 대상");
  });

  it("작업용 채널은 프로덕션으로 해석하지 않는다", () => {
    const result = resolveCoopTarget(CHANNEL_ID.sprint_ai_코인_업무자동화);
    expect(result.target?.env).not.toBe("prod");
    if (!result.ok) expect(result.reason).toContain("스테이지");
  });

  it("생협 전용 환경 이름과 프로덕션 여부를 제공한다", () => {
    expect(coopTargetLabel("stage")).toBe("스테이지");
    expect(coopTargetLabel("prod")).toBe("프로덕션");
    expect(isCoopProduction("stage")).toBe(false);
    expect(isCoopProduction("prod")).toBe(true);
  });
});
