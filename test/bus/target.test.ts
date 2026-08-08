import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import CHANNEL_ID from "@/constant/CHANNEL_ID.json";
import { busLabelOf, isBusProduction, resolveBusTarget } from "~/services/bus/target";

// 환경별 설정 유무에 따라 결과가 갈리는 테스트라, 로컬 .env·CI 환경에 기대지 않고
// 값을 직접 고정한다.
beforeEach(() => {
  vi.stubEnv("KOIN_STAGE_API_BASE_URL", "https://api.stage.koreatech.in");
  vi.stubEnv("KOIN_PROD_API_BASE_URL", "https://api.koreatech.in");
  vi.stubEnv("KOIN_ADMIN_EMAIL", "admin@example.com");
  vi.stubEnv("KOIN_ADMIN_PASSWORD", "password");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("버스 대상 코인 결정", () => {
  it("등록되지 않은 채널에서는 아무것도 하지 않는다", () => {
    // 기본값을 두면 실수로 프로덕션에 들어간다. 되돌릴 API가 없다.
    for (const channel of ["C_아무거나", CHANNEL_ID.채팅방, CHANNEL_ID.삐봇요청_test, ""]) {
      const result = resolveBusTarget(channel);
      expect(result.ok).toBe(false);
      expect(result.target).toBeUndefined();
    }
  });

  it("어느 채널에서 실행해야 하는지 알려준다", () => {
    const result = resolveBusTarget(CHANNEL_ID.채팅방);
    expect(result.reason).toContain(CHANNEL_ID.코인_이벤트알림_stage);
    expect(result.reason).toContain(CHANNEL_ID.코인_이벤트알림);
  });

  it("스테이지 채널과 운영 채널이 다른 환경으로 간다", () => {
    const stage = resolveBusTarget(CHANNEL_ID.코인_이벤트알림_stage);
    const prod = resolveBusTarget(CHANNEL_ID.코인_이벤트알림);

    expect(stage.target?.env).toBe("stage");
    expect(prod.target?.env).toBe("prod");
  });

  it("설정이 없는 환경은 반쯤 열어두지 않는다", () => {
    // baseUrl만 있고 계정이 없는 상태로 붙으면 엉뚱한 곳에 401을 던진다.
    vi.stubEnv("KOIN_ADMIN_PASSWORD", "");
    const prod = resolveBusTarget(CHANNEL_ID.코인_이벤트알림);

    expect(prod.ok).toBe(false);
    expect(prod.target).toBeUndefined();
    expect(prod.reason).toMatch(/설정/);
  });

  it("작업용 채널은 스테이지로만 간다", () => {
    // 개발 중 확인용이라 열어두되, 실수로 프로덕션에 닿지 않게 한다.
    const sprint = resolveBusTarget(CHANNEL_ID.sprint_ai_코인_업무자동화);

    expect(sprint.target?.env).toBe("stage");
  });

  it("사람에게 보여줄 이름과 위험 표시", () => {
    expect(busLabelOf("stage")).toBe("스테이지");
    expect(busLabelOf("prod")).toBe("프로덕션");
    expect(isBusProduction("prod")).toBe(true);
    expect(isBusProduction("stage")).toBe(false);
  });
});
