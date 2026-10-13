import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  clearMemberCache,
  filterMentionTargets,
  getAllMembers,
  MemberSourceError,
  mentionByName,
  toBcsdMembers,
  type BcsdMember,
} from "~/utils/member";
import { getPRThread, markPRThreadMerged } from "~/helper/api/prThread";

const serviceMember = (overrides: Record<string, unknown>) => ({
  id: 1,
  name: "홍길동",
  slackId: "U1",
  githubId: null,
  track: "FRONTEND",
  memberType: "REGULAR",
  clubActive: true,
  academicStatus: "ENROLLED",
  ...overrides,
});

describe("toBcsdMembers", () => {
  it("인터널 트랙 코드를 모달 값으로 바꾸고 Slack ID 없는 멤버는 뺀다", () => {
    const members = toBcsdMembers([
      serviceMember({ track: "IOS", slackId: "U1" }),
      serviceMember({ track: "SECURITY", slackId: "U2", clubActive: false }),
      serviceMember({ track: "UNKNOWN", slackId: "U3" }),
      serviceMember({ slackId: null }),
    ] as never);

    expect(members.map((m) => [m.slack_id, m.track_name, m.is_active])).toEqual([
      ["U1", "iOS", true],
      ["U2", "Security", false],
      ["U3", null, true],
    ]);
  });
});

const member = (overrides: Partial<BcsdMember>): BcsdMember => ({
  name: "홍길동",
  slack_id: "U1",
  github_id: null,
  track_name: "FrontEnd",
  member_type: "REGULAR",
  is_active: true,
  ...overrides,
});

describe("filterMentionTargets", () => {
  const members = [
    member({ slack_id: "U1", track_name: "FrontEnd" }),
    member({ slack_id: "U2", track_name: "iOS", member_type: "MENTOR" }),
    member({ slack_id: "U3", track_name: "BackEnd", is_active: false }),
    member({ slack_id: "U4", track_name: null }),
  ];

  it("client는 안드로이드·프론트·iOS를 묶는다", () => {
    expect(filterMentionTargets(members, { track: "client", memberType: "all", isActive: "all" })).toEqual([
      "<@U1>",
      "<@U2>",
    ]);
  });

  it("활동 여부와 구분으로 거른다", () => {
    expect(filterMentionTargets(members, { track: "all", memberType: "REGULAR", isActive: "inactive" })).toEqual([
      "<@U3>",
    ]);
    expect(filterMentionTargets(members, { track: "all", memberType: "all", isActive: "active" })).toEqual([
      "<@U1>",
      "<@U2>",
      "<@U4>",
    ]);
  });
});

describe("mentionByName", () => {
  it("동명이인은 활동 중인 멤버를 고르고, 없으면 이름을 그대로 쓴다", () => {
    const members = [
      member({ name: "이현수", slack_id: "U_OLD", is_active: false }),
      member({ name: "이현수", slack_id: "U_NOW", is_active: true }),
      member({ name: "이현수", slack_id: "U_BACK", track_name: "BackEnd" }),
    ];
    expect(mentionByName(members, "이현수", "FrontEnd")).toBe("<@U_NOW>");
    expect(mentionByName(members, "김없음", "FrontEnd")).toBe("김없음");
  });
});

describe("getAllMembers", () => {
  beforeEach(() => {
    clearMemberCache();
    vi.stubEnv("INTERNAL_API_BASE_URL", "https://internal.example.com/");
    vi.stubEnv("INTERNAL_SERVICE_TOKEN", "service-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("Bearer 토큰으로 서비스 API를 읽고 60초 동안 다시 부르지 않는다", async () => {
    const fetchMock = vi.fn(async () => Response.json({ members: [serviceMember({})] }));
    vi.stubGlobal("fetch", fetchMock);

    await getAllMembers();
    const members = await getAllMembers();

    expect(members).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://internal.example.com/v1/service/members");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer service-token");
  });

  it("실패를 빈 명단으로 삼키지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(getAllMembers()).rejects.toBeInstanceOf(MemberSourceError);
  });

  it("토큰이 없으면 요청하지 않고 실패한다", async () => {
    vi.stubEnv("INTERNAL_SERVICE_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getAllMembers()).rejects.toBeInstanceOf(MemberSourceError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("pr_thread", () => {
  const poolReturning = (rows: unknown[]) => {
    const queryMock = vi.fn(async () => ({ rows, fields: [] }));
    return { pool: { query: queryMock } as unknown as Pool, queryMock };
  };

  it("가장 최근 스레드의 리뷰어·작성자를 모은다", async () => {
    const { pool } = poolReturning([
      { ts: "2.0", reviewer: "박성주", writer: "이준영" },
      { ts: "2.0", reviewer: "이지현", writer: "이준영" },
      { ts: "1.0", reviewer: "옛리뷰어", writer: "이준영" },
    ]);
    expect(await getPRThread(pool, "https://github.com/x/pull/1")).toEqual({
      ts: "2.0",
      reviewers: ["박성주", "이지현"],
      writer: "이준영",
    });
  });

  it("스레드가 없으면 null", async () => {
    const { pool } = poolReturning([]);
    expect(await getPRThread(pool, "https://github.com/x/pull/1")).toBeNull();
  });

  it("머지 상태로 바꾼다", async () => {
    const { pool, queryMock } = poolReturning([]);
    await markPRThreadMerged(pool, "https://github.com/x/pull/1");
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("status = 'merged'"), [
      "https://github.com/x/pull/1",
    ]);
  });
});
