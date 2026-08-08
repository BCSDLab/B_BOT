import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyBusPatches, bindSlackThread, findJobByThread, getJob, runConversion } from "~/services/bus/workflow";
import type { BusJob } from "~/services/bus/types";

vi.mock("~/services/bus/reviewLink", () => ({
  saveBusReviewPage: vi.fn(async () => ({ url: "https://example.com/bus-review/abc", token: "abc" })),
}));

let tempDir = "";
let stateDbPath = "";

const job = (over: Partial<BusJob> = {}): BusJob => ({
  id: "job-1",
  domain: "BUS",
  article_id: "article-1",
  article_url: "https://example.com/1",
  article_title: "버스 시간표",
  attachment_url: "https://files.slack.com/1.xls",
  source_hash: "a".repeat(64),
  state: "REVIEW_PENDING",
  state_version: 3,
  payload_hash: "old-hash",
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
                route_name: "천안역",
                node_info: [{ name: "터미널" }, { name: "대학(본교)" }],
                route_info: [
                  { name: "1회", arrival_time: ["08:10", "08:50"] },
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
      provenance: {},
      warnings: [],
    },
  ],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

function withStateFile(over: Partial<BusJob> = {}) {
  tempDir = mkdtempSync(join(tmpdir(), "bus-workflow-test-"));
  stateDbPath = join(tempDir, "jobs.json");
  process.env.BUS_WORKFLOW_STATE_DB_PATH = stateDbPath;
  writeFileSync(stateDbPath, JSON.stringify([job(over)], null, 2));
}

afterEach(() => {
  delete process.env.BUS_WORKFLOW_STATE_DB_PATH;
  vi.unstubAllGlobals();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
});

describe("버스 수정 워크플로", () => {
  it("스레드 바인딩으로 job을 찾는다", async () => {
    withStateFile({ slack: { channel: "C1", ts: "1700000000.000001" } });

    expect(await findJobByThread("C1", "1700000000.000001")).toMatchObject({ id: "job-1" });
    expect(await findJobByThread("C1", "1700000000.999999")).toBeUndefined();
    expect(await findJobByThread("C2", "1700000000.000001")).toBeUndefined();
  });

  it("수정 적용 후 검수 상태로 돌아온다", async () => {
    withStateFile({ state: "REVISION_REQUESTED", state_version: 4 });

    const updated = await applyBusPatches(
      "job-1",
      [
        {
          semester: "REGULAR",
          target: "commuting",
          region: "천안",
          routeType: "등교",
          routeName: "천안역",
          kind: "arrival_time",
          tripName: "1회",
          stopName: "터미널",
          before: "08:10",
          after: "08:05",
          rawValue: "08:05",
          value: "08:05",
        },
      ],
      "터미널 08:05로",
      "old-hash",
    );

    expect(updated.state).toBe("REVIEW_PENDING");
    expect(updated.state_version).toBe(5);
    expect(updated.payload_hash).not.toBe("old-hash");
    expect(updated.revision_note).toBe("터미널 08:05로");
    const route = (updated.conversions![0].payloads[0].body.commuting_bus_timetables as never)[0] as {
      route_info: Array<{ arrival_time: (string | null)[] }>;
    };
    expect(route.route_info[0].arrival_time[0]).toBe("08:05");
  });

  it("검수 중이 아니면 거부한다", async () => {
    withStateFile({ state: "COMPLETED" });

    await expect(
      applyBusPatches(
        "job-1",
        [
          {
            semester: "REGULAR",
            target: "commuting",
            region: "천안",
            routeType: "등교",
            routeName: "천안역",
            kind: "arrival_time",
            tripName: "1회",
            stopName: "터미널",
            before: "08:10",
            after: "08:05",
            rawValue: "08:05",
            value: "08:05",
          },
        ],
        "터미널 08:05로",
        "old-hash",
      ),
    ).rejects.toThrow(/not under review/);
  });

  it("예상 해시와 다르면 적용하지 않는다", async () => {
    withStateFile();

    await expect(
      applyBusPatches(
        "job-1",
        [
          {
            semester: "REGULAR",
            target: "commuting",
            region: "천안",
            routeType: "등교",
            routeName: "천안역",
            kind: "route_name",
            before: "천안역",
            after: "천안역1",
            rawValue: "천안역1",
            value: "천안역1",
          },
        ],
        "이름 바꿔",
        "stale-hash",
      ),
    ).rejects.toThrow(/payload hash mismatch/);
  });

  it("bindSlackThread로 바인딩을 바꾼 뒤 다시 찾는다", async () => {
    withStateFile();
    await bindSlackThread("job-1", "C9", "1800000000.000001");

    expect(await findJobByThread("C9", "1800000000.000001")).toMatchObject({ id: "job-1" });
  });

  it("FAILED 상태에서 변환 재시도를 허용하고, 실패하면 FAILED로 남는다", async () => {
    withStateFile({ state: "FAILED", state_version: 5, error: "이전 실패" });
    // 첨부 다운로드가 실패하도록 만든다.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );

    await expect(runConversion("job-1")).rejects.toThrow(/attachment download failed/);

    const after = await getJob("job-1");
    expect(after?.state).toBe("FAILED");
    expect(after?.state_version).toBeGreaterThan(5);
  });

  it("COMPLETED 상태에서 변환 재시도는 거부하고 상태를 바꾸지 않는다", async () => {
    withStateFile({ state: "COMPLETED", state_version: 5 });

    await expect(runConversion("job-1")).rejects.toThrow(/cannot be converted/);

    const after = await getJob("job-1");
    expect(after?.state).toBe("COMPLETED");
    expect(after?.state_version).toBe(5);
  });
});
