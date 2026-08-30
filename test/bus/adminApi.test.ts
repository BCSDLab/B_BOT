import { afterEach, describe, expect, it, vi } from "vitest";
import { submitBusTimetables } from "~/services/bus/adminApi";
import type { BusConversion } from "~/services/bus/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

const auth = { baseUrl: "https://api.stage.koreatech.in", accessToken: "koin-jwt" };

const conversion: BusConversion = {
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
  provenance: {},
  warnings: [],
};

describe("버스 timetable 반영", () => {
  it("KOIN 로그인 토큰으로 PUT 하고 running_days를 제거한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await submitBusTimetables([conversion], auth);

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
    // KOIN Admin API의 route_type은 ShuttleRouteType(순환/주중/주말)만 허용하고,
    // commuting 엔드포인트는 그중 "주중"만 통과시킨다. 내부 direction 라벨("등교")을
    // 그대로 보내면 "버스 노선 구분이 잘못되었습니다"로 거부된다.
    expect(route.route_type).toBe("주중");
  });

  it("shuttle 대상은 route_type을 순환으로 보낸다", async () => {
    const shuttleConversion: BusConversion = {
      ...conversion,
      payloads: [
        {
          target: "shuttle",
          semester_type: "REGULAR",
          body: {
            shuttle_bus_timetables: [
              {
                region: "청주",
                route_type: "셔틀",
                route_name: "청주 셔틀",
                node_info: [{ name: "터미널" }],
                route_info: [{ name: "1회", arrival_time: ["09:00"] }],
              },
            ],
          },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await submitBusTimetables([shuttleConversion], auth);

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [URL, RequestInit])[1].body));
    expect(body.shuttle_bus_timetables[0].route_type).toBe("순환");
  });

  it("토·일요일에만 도는 셔틀 노선은 route_type을 주말로 보낸다", async () => {
    const weekendConversion: BusConversion = {
      ...conversion,
      payloads: [
        {
          target: "shuttle",
          semester_type: "REGULAR",
          body: {
            shuttle_bus_timetables: [
              {
                region: "천안",
                route_type: "셔틀",
                route_name: "천안 셔틀(토요일, 일요일)",
                node_info: [{ name: "터미널" }],
                route_info: [
                  { name: "1회", arrival_time: ["09:00"], running_days: ["SAT", "SUN"] },
                ],
              },
            ],
          },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await submitBusTimetables([weekendConversion], auth);

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [URL, RequestInit])[1].body));
    expect(body.shuttle_bus_timetables[0].route_type).toBe("주말");
  });

  it("요일이 일부 회차만 평일이면(주말 전용 아님) route_type은 순환이다", async () => {
    const mixedConversion: BusConversion = {
      ...conversion,
      payloads: [
        {
          target: "shuttle",
          semester_type: "REGULAR",
          body: {
            shuttle_bus_timetables: [
              {
                region: "천안",
                route_type: "셔틀",
                route_name: "천안 셔틀",
                node_info: [{ name: "터미널" }],
                route_info: [
                  { name: "1회", arrival_time: ["09:00"], running_days: ["SAT", "SUN"] },
                  {
                    name: "2회",
                    arrival_time: ["10:00"],
                    running_days: ["MON", "TUE", "WED", "THU", "FRI"],
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await submitBusTimetables([mixedConversion], auth);

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [URL, RequestInit])[1].body));
    expect(body.shuttle_bus_timetables[0].route_type).toBe("순환");
  });

  it("실패 시 응답 본문을 오류 메시지에 담는다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: "INVALID_REQUEST_BODY", message: "잘못된 입력값" }),
          { status: 400 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitBusTimetables([conversion], auth)).rejects.toThrow(
      /commuting Admin API failed: 400\n.*잘못된 입력값/,
    );
  });

  it("두 번째 payload가 실패해도 첫 번째는 이미 반영된 채로 남는다", async () => {
    const shuttleConversion: BusConversion = {
      ...conversion,
      payloads: [
        {
          target: "shuttle",
          semester_type: "REGULAR",
          body: {
            shuttle_bus_timetables: [
              {
                region: "청주",
                route_type: "셔틀",
                route_name: "청주 셔틀",
                node_info: [{ name: "터미널" }],
                route_info: [{ name: "1회", arrival_time: ["09:00"] }],
              },
            ],
          },
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response("서버 오류", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const applied: string[] = [];

    await expect(
      submitBusTimetables([conversion, shuttleConversion], auth, ({ target, semesterType }) => {
        applied.push(`${target}/${semesterType}`);
      }),
    ).rejects.toThrow(/shuttle Admin API failed: 500/);

    // 각 PUT은 대상×학기 하나를 통째로 덮어써서, 앞선 성공은 재시도해도 안전하다.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0].toString()).toContain("/admin/bus/commuting/timetable");
    expect(fetchMock.mock.calls[1][0].toString()).toContain("/admin/bus/shuttle/timetable");
    expect(applied).toEqual(["commuting/REGULAR"]);
  });

  it("같은 지역·노선명의 통학 등교/하교는 한 문서로 합쳐서 보낸다", async () => {
    // KOIN commuting upsert 키는 (region, route_type, route_name, sub_name)인데
    // commuting route_type은 방향과 무관하게 "주중" 고정이다. 등교/하교를 별도
    // 문서로 보내면 키가 같아져 나중 것이 먼저 것을 덮어쓴다(DB에 하교만 남는
    // 버그의 원인) — 정류장 순서가 같으면 한 문서의 route_info로 합쳐야 한다.
    const bothDirections: BusConversion = {
      ...conversion,
      payloads: [
        {
          target: "commuting",
          semester_type: "REGULAR",
          body: {
            commuting_bus_timetables: [
              {
                region: "천안",
                route_type: "등교",
                route_name: "터미널",
                node_info: [{ name: "터미널" }, { name: "대학" }],
                route_info: [{ name: "등교", arrival_time: ["08:10", "08:50"] }],
              },
              {
                region: "천안",
                route_type: "하교",
                route_name: "터미널",
                node_info: [{ name: "터미널" }, { name: "대학" }],
                route_info: [{ name: "하교", arrival_time: ["18:50", "18:10"] }],
              },
            ],
          },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await submitBusTimetables([bothDirections], auth);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [URL, RequestInit])[1].body));
    expect(body.commuting_bus_timetables).toHaveLength(1);
    expect(body.commuting_bus_timetables[0].route_info).toEqual([
      { name: "등교", detail: null, arrival_time: ["08:10", "08:50"] },
      { name: "하교", detail: null, arrival_time: ["18:50", "18:10"] },
    ]);
  });

  it("정류장 순서가 정반대인 등교/하교도 순서를 맞춰 한 문서로 합친다", async () => {
    const reversedOrder: BusConversion = {
      ...conversion,
      payloads: [
        {
          target: "commuting",
          semester_type: "REGULAR",
          body: {
            commuting_bus_timetables: [
              {
                region: "세종",
                route_type: "등교",
                route_name: "세종",
                node_info: [{ name: "정류장A" }, { name: "대학" }],
                route_info: [{ name: "등교", arrival_time: ["08:00", "08:50"] }],
              },
              {
                region: "세종",
                route_type: "하교",
                route_name: "세종",
                // 원본에 별도로 실린 하교 표라 정류장 순서가 정반대다.
                node_info: [{ name: "대학" }, { name: "정류장A" }],
                route_info: [{ name: "하교", arrival_time: ["18:10", "18:30"] }],
              },
            ],
          },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await submitBusTimetables([reversedOrder], auth);

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [URL, RequestInit])[1].body));
    expect(body.commuting_bus_timetables).toHaveLength(1);
    // 등교 노선(정류장A→대학) 순서에 맞춰 하교의 도착시각도 반대로 뒤집는다.
    expect(body.commuting_bus_timetables[0].route_info).toEqual([
      { name: "등교", detail: null, arrival_time: ["08:00", "08:50"] },
      { name: "하교", detail: null, arrival_time: ["18:30", "18:10"] },
    ]);
  });

  it("정류장이 다른 노선은 이름이 같아도 합치지 않는다", async () => {
    const unrelated: BusConversion = {
      ...conversion,
      payloads: [
        {
          target: "commuting",
          semester_type: "REGULAR",
          body: {
            commuting_bus_timetables: [
              {
                region: "천안",
                route_type: "등교",
                route_name: "터미널",
                node_info: [{ name: "터미널" }, { name: "대학" }],
                route_info: [{ name: "등교", arrival_time: ["08:10", "08:50"] }],
              },
              {
                region: "천안",
                route_type: "하교",
                route_name: "터미널",
                node_info: [{ name: "터미널" }, { name: "두정역" }, { name: "대학" }],
                route_info: [{ name: "하교", arrival_time: ["18:10", "18:20", "18:50"] }],
              },
            ],
          },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await submitBusTimetables([unrelated], auth);

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [URL, RequestInit])[1].body));
    expect(body.commuting_bus_timetables).toHaveLength(2);
  });

  it("올바르지 않은 body_key면 보내기 전에 거부한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const broken = structuredClone(conversion) as BusConversion;
    // 스펙과 어긋난 body를 일부러 만든다.
    broken.payloads[0].body = { wrong_key: [] };

    await expect(submitBusTimetables([broken], auth)).rejects.toThrow(/body_key configuration mismatch/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
