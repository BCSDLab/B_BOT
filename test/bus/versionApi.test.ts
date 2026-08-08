import { afterEach, describe, expect, it, vi } from "vitest";
import { updateVersionViaAdminApi } from "~/services/bus/workflow";
import { getBusAdminAuth } from "~/services/bus/adminAuth";

vi.mock("~/services/bus/adminAuth", () => ({
  getBusAdminAuth: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(getBusAdminAuth).mockReset();
});

describe("버스 버전 Admin API", () => {
  it("현재 version을 보존해 title과 content를 PUT 한다", async () => {
    vi.mocked(getBusAdminAuth).mockResolvedValue({
      baseUrl: "https://api.stage.koreatech.in",
      accessToken: "admin-token",
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: "2026.1" })))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await updateVersionViaAdminApi({
      type: "shuttle_bus_timetable",
      title: "정규학기",
      content: "2026-03-02~2026-06-19",
    });

    expect(fetch).toHaveBeenNthCalledWith(1, "https://api.stage.koreatech.in/admin/version/shuttle_bus_timetable", {
      headers: {
        Authorization: "Bearer admin-token",
        "Content-Type": "application/json",
      },
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "https://api.stage.koreatech.in/admin/version/shuttle_bus_timetable", {
      method: "PUT",
      headers: {
        Authorization: "Bearer admin-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "2026.1",
        title: "정규학기",
        content: "2026-03-02~2026-06-19",
      }),
    });
  });

  it("현재 version 조회 실패 시 PUT 하지 않는다", async () => {
    vi.mocked(getBusAdminAuth).mockResolvedValue({
      baseUrl: "https://api.stage.koreatech.in",
      accessToken: "admin-token",
    });
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);

    await expect(
      updateVersionViaAdminApi({
        type: "shuttle_bus_timetable",
        title: "정규학기",
        content: "2026-03-02~2026-06-19",
      }),
    ).rejects.toThrow("Version Admin API GET failed: 404");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
