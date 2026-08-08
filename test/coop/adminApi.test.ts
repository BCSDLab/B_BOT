import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyCoopTimetable,
  CoopAdminApiError,
  createCoopSemester,
  updateCoopTimetable,
} from "~/services/coop/adminApi";

const auth = { baseUrl: "https://api.stage.example.com/", accessToken: "token" };
const semester = {
  semester: "26-1학기",
  from_date: "2026-03-03",
  to_date: "2026-06-19",
};
const timetable = {
  coop_shops: [{
    coop_shop_info: {
      name: "세탁소",
      phone: "041-552-1489",
      location: "학생회관 2층",
    },
    operation_hours: [{
      day_of_week: "평일",
      open_time: "11:30",
      close_time: "18:30",
    }],
  }],
};

describe("생협 Admin API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("학기 생성, 조회, 시간표 업데이트 순서로 호출한다", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json([{
        id: 17,
        ...semester,
        is_applied: false,
      }]))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(applyCoopTimetable(semester, timetable, auth)).resolves.toBe(17);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["https://api.stage.example.com/admin/coopshop/semesters", "POST"],
      ["https://api.stage.example.com/admin/coopshop/semesters", "GET"],
      ["https://api.stage.example.com/admin/coopshop/timetable/17", "PUT"],
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual(semester);
    expect(JSON.parse(fetchMock.mock.calls[2][1]?.body as string)).toEqual(timetable);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer token" });
    }
  });

  it("이미 생성된 동일 학기는 조회와 업데이트를 계속한다", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(
        { code: "DUPLICATE_SEMESTER", message: "이미 존재하는 학기입니다." },
        { status: 409 },
      ))
      .mockResolvedValueOnce(Response.json([{ id: 17, ...semester, is_applied: false }]))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(applyCoopTimetable(semester, timetable, auth)).resolves.toBe(17);
  });

  it("시간표 전송 직전에 조식·중식·석식을 표준 타입으로 보정한다", async () => {
    const request = {
      coop_shops: [{
        coop_shop_info: {
          name: "학생식당",
          phone: "041-560-1278",
          location: "학생회관 2층",
        },
        operation_hours: [
          { type: "조식", day_of_week: "평일", open_time: "08:00", close_time: "09:30" },
          { type: "중식", day_of_week: "평일", open_time: "11:30", close_time: "13:30" },
          { type: "석식", day_of_week: "평일", open_time: "17:30", close_time: "18:30" },
        ],
      }],
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await updateCoopTimetable(17, request, auth);

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.coop_shops[0].operation_hours.map((hour: { type: string }) => hour.type))
      .toEqual(["아침", "점심", "저녁"]);
    expect(request.coop_shops[0].operation_hours.map((hour) => hour.type))
      .toEqual(["조식", "중식", "석식"]);
  });

  it("다른 원인의 409는 학기 생성 실패로 처리한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(
      { code: "OVERLAPPING_SEMESTER_DATE_RANGE" },
      { status: 409 },
    ));

    await expect(createCoopSemester(semester, auth)).rejects.toMatchObject({
      stage: "semester_create",
      status: 409,
    });
  });

  it("같은 이름의 기존 학기 기간이 다르면 업데이트하지 않는다", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ code: "DUPLICATE_SEMESTER" }, { status: 409 }))
      .mockResolvedValueOnce(Response.json([{
        id: 17,
        ...semester,
        to_date: "2026-06-20",
        is_applied: false,
      }]));

    await expect(applyCoopTimetable(semester, timetable, auth)).rejects.toEqual(
      expect.objectContaining<Partial<CoopAdminApiError>>({ stage: "semester_lookup", status: 409 }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("조회 결과에 학기가 없으면 업데이트하지 않는다", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json([]));

    await expect(applyCoopTimetable(semester, timetable, auth)).rejects.toMatchObject({
      stage: "semester_lookup",
      status: 404,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
