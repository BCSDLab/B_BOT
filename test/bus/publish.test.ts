import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publish } from "~/services/bus/workflow";
import { getBusAdminAuth } from "~/services/bus/adminAuth";

vi.mock("~/services/bus/adminAuth", () => ({
  getBusAdminAuth: vi.fn(),
}));

let tempDir = "";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(getBusAdminAuth).mockReset();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
});

const job = {
  id: "job-1",
  state: "REVIEW_PENDING",
  state_version: 3,
  payload_hash: "payload-hash",
  source_hash: "source-hash",
  conversions: [
    {
      payloads: [
        {
          target: "commuting",
          semester_type: "REGULAR",
          body: {
            commuting_bus_timetables: [
              {
                region: "천안",
                route_type: "등교",
                route_name: "천안역 (터미널 경유)",
                node_info: [{ name: "터미널" }, { name: "대학(본교)" }],
                route_info: [
                  {
                    name: "1회",
                    running_days: ["MON", "TUE", "WED", "THU", "FRI"],
                    arrival_time: ["08:10", "08:50"],
                  },
                ],
              },
            ],
          },
        },
      ],
      version_update: {
        type: "shuttle_bus_timetable",
        title: "정규학기",
        content: "2026-03-02~2026-06-19",
      },
    },
  ],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function stateFile() {
  tempDir = mkdtempSync(join(tmpdir(), "bus-publish-test-"));
  process.env.BUS_WORKFLOW_STATE_DB_PATH = join(tempDir, "jobs.json");
  writeFileSync(join(tempDir, "jobs.json"), JSON.stringify([job], null, 2));
}

describe("버스 timetable publish", () => {
  it("KOIN 로그인 토큰으로 PUT 하고 running_days를 제거한다", async () => {
    stateFile();
    vi.mocked(getBusAdminAuth).mockResolvedValue({
      baseUrl: "https://api.stage.koreatech.in",
      accessToken: "koin-jwt",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await publish("job-1", "payload-hash");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toContain("/admin/bus/commuting/timetable");
    expect(url.searchParams.get("semester_type")).toBe("REGULAR");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer koin-jwt");

    const body = JSON.parse(String(init.body));
    expect(Object.keys(body)).toEqual(["commuting_bus_timetables"]);
    const route = body.commuting_bus_timetables[0];
    // 검수 전용 필드는 전송하지 않는다.
    expect(route.route_info[0]).not.toHaveProperty("running_days");
    expect(route).not.toHaveProperty("running_days");
    // 괄호 안 내용을 sub_name/detail로 분리한다.
    expect(route.route_name).toBe("천안역");
    expect(route.sub_name).toBe("터미널 경유");
    expect(route.node_info[0]).toEqual({ name: "터미널", detail: null });
    expect(route.node_info[1]).toEqual({ name: "대학", detail: "본교" });
    expect(route.route_info[0]).toEqual({ name: "1회", detail: null, arrival_time: ["08:10", "08:50"] });
  });

  it("실패 시 응답 본문을 오류 메시지에 담는다", async () => {
    stateFile();
    vi.mocked(getBusAdminAuth).mockResolvedValue({
      baseUrl: "https://api.stage.koreatech.in",
      accessToken: "koin-jwt",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: "INVALID_REQUEST_BODY", message: "잘못된 입력값" }),
          { status: 400 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(publish("job-1", "payload-hash")).rejects.toThrow(
      /commuting Admin API failed: 400\n.*잘못된 입력값/,
    );
  });

  it("올바르지 않은 body_key면 보내기 전에 거부한다", async () => {
    stateFile();
    vi.mocked(getBusAdminAuth).mockResolvedValue({
      baseUrl: "https://api.stage.koreatech.in",
      accessToken: "koin-jwt",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // conversions의 body 루트 키가 스펙과 어긋난 payload면 보내기 전에 잡는다.
    const path = join(tempDir, "jobs.json");
    const jobs = JSON.parse(readFileSync(path, "utf8"));
    jobs[0].conversions[0].payloads[0].body = { wrong_key: [] };
    writeFileSync(path, JSON.stringify(jobs, null, 2));

    await expect(publish("job-1", "payload-hash")).rejects.toThrow(/body_key configuration mismatch/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
