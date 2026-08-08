import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/services/coop/adminApi", () => ({
  applyCoopTimetable: vi.fn(async () => 17),
}));

vi.mock("~/services/coop/jobStore", () => ({
  cancelCoopJob: vi.fn(async () => true),
  claimCoopJob: vi.fn(async () => ({ ok: true })),
  finishCoopJob: vi.fn(async () => undefined),
}));

vi.mock("~/services/coop/reviewStore", () => ({
  loadCoopReview: vi.fn(async () => ({
    html: "<html></html>",
    request: { coop_shops: [] },
    conversion: {
      semester: "26-1학기",
      fromDate: "2026-03-03",
      toDate: "2026-06-19",
      request: { coop_shops: [] },
      shops: [],
      excludedShops: [],
      issues: [],
    },
    meta: {
      env: "stage",
      year: 2026,
      termName: "1학기",
      sourceFileName: "시설물-운영시간.png",
      shopCount: 11,
      blockingCount: 0,
      createdAt: "2026-08-08T00:00:00.000Z",
    },
  })),
}));

vi.mock("~/services/coop/koinAuth", () => ({
  getCoopAdminAuth: vi.fn(async () => ({
    baseUrl: "https://api.stage.example.com",
    accessToken: "token",
  })),
}));

vi.mock("~/services/coop/target", () => ({
  coopTargetLabel: vi.fn(() => "스테이지"),
  resolveCoopTargetByEnv: vi.fn(() => ({
    ok: true,
    target: {
      env: "stage",
      label: "스테이지",
      baseUrl: "https://api.stage.example.com",
      email: "admin@example.com",
      password: "password",
    },
  })),
}));

import { applyCoopTimetable } from "~/services/coop/adminApi";
import {
  cancelCoopJob,
  claimCoopJob,
  finishCoopJob,
} from "~/services/coop/jobStore";
import { handleCoopApplyAction } from "~/services/slack/coopApplyAction";

function client() {
  return {
    chat: {
      update: vi.fn(async () => ({})),
      postEphemeral: vi.fn(async () => ({})),
    },
  };
}

const body = {
  channel: { id: "C1" },
  user: { id: "U1" },
  message: { ts: "100.1" },
};

describe("생협 반영 Slack 액션", () => {
  beforeEach(() => vi.clearAllMocks());

  it("반영 권한을 획득한 뒤 저장된 검수 데이터로 Admin API를 호출한다", async () => {
    const slack = client();
    await handleCoopApplyAction(slack as never, body as never, {
      type: "button",
      action_id: "coop:apply",
      value: JSON.stringify({ token: "a".repeat(32) }),
    } as never);

    expect(claimCoopJob).toHaveBeenCalledWith("a".repeat(32), "U1");
    expect(applyCoopTimetable).toHaveBeenCalledWith(
      {
        semester: "26-1학기",
        from_date: "2026-03-03",
        to_date: "2026-06-19",
      },
      { coop_shops: [] },
      expect.objectContaining({ accessToken: "token" }),
    );
    expect(finishCoopJob).toHaveBeenCalledWith(
      "a".repeat(32),
      "APPLIED",
      { semesterId: 17 },
    );
    expect(slack.chat.update).toHaveBeenLastCalledWith(expect.objectContaining({
      text: "생협 반영 완료",
      blocks: expect.arrayContaining([expect.objectContaining({ type: "section" })]),
    }));
  });

  it("취소 버튼은 대기 작업만 취소한다", async () => {
    const slack = client();
    await handleCoopApplyAction(slack as never, body as never, {
      type: "button",
      action_id: "coop:cancel",
      value: JSON.stringify({ token: "a".repeat(32) }),
    } as never);

    expect(cancelCoopJob).toHaveBeenCalledWith("a".repeat(32), "U1");
    expect(applyCoopTimetable).not.toHaveBeenCalled();
    expect(slack.chat.update).toHaveBeenCalledWith(expect.objectContaining({
      text: "생협 반영 취소됨",
    }));
  });
});
