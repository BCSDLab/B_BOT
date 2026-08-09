import { beforeEach, describe, expect, it, vi } from "vitest";

// 락은 실제 Postgres에 붙는다. 여기서는 항상 통과시킨다 —
// 잠금 자체는 test/koin/detectLock.test.ts가 실제 DB로 확인한다.
vi.mock("~/services/koin/detectLock", () => ({
  acquireDetectLock: vi.fn(async () => ({ ok: true })),
  releaseDetectLock: vi.fn(async () => undefined),
}));


const fetchBusArticle = vi.fn();
const collectBusSpreadsheets = vi.fn();
const downloadBusNoticeFile = vi.fn();
const saveBusDetected = vi.fn(async () => "detected-token");
const loadBusDetected = vi.fn();
const dropBusDetected = vi.fn(async () => undefined);
vi.mock("~/services/bus/detected", () => ({
  fetchBusArticle: (...args: unknown[]) => (fetchBusArticle as (...a: unknown[]) => unknown)(...args),
  collectBusSpreadsheets: (...args: unknown[]) =>
    (collectBusSpreadsheets as (...a: unknown[]) => unknown)(...args),
  downloadBusNoticeFile: (...args: unknown[]) =>
    (downloadBusNoticeFile as (...a: unknown[]) => unknown)(...args),
  saveBusDetected: (...args: unknown[]) => (saveBusDetected as (...a: unknown[]) => unknown)(...args),
  loadBusDetected: (...args: unknown[]) => (loadBusDetected as (...a: unknown[]) => unknown)(...args),
  dropBusDetected: (...args: unknown[]) => (dropBusDetected as (...a: unknown[]) => unknown)(...args),
}));

const createBusJob = vi.fn(async () => undefined);
vi.mock("~/services/bus/jobStore", () => ({
  createBusJob: (...args: unknown[]) => (createBusJob as (...a: unknown[]) => unknown)(...args),
}));

const linkBusThread = vi.fn(async () => undefined);
vi.mock("~/services/bus/reviewStore", () => ({
  linkBusThread: (...args: unknown[]) => (linkBusThread as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("~/services/koin/target", () => ({
  resolveTarget: (channel: string) =>
    channel === "C-unknown"
      ? { ok: false, reason: "이 채널은 버스 반영 대상이 아닙니다." }
      : { ok: true, target: { env: "stage", label: "스테이지", baseUrl: "https://api.stage.koreatech.in" } },
  labelOf: (env: string) => (env === "prod" ? "프로덕션" : "스테이지"),
}));

const convertBusToReview = vi.fn();
const buildReviewApprovalBlocks = vi.fn(() => [{ type: "section", text: { type: "mrkdwn", text: "검토" } }]);
vi.mock("~/services/bus/pipeline", () => ({
  convertBusToReview: (...args: unknown[]) => (convertBusToReview as (...a: unknown[]) => unknown)(...args),
  buildReviewApprovalBlocks: (...args: unknown[]) =>
    (buildReviewApprovalBlocks as (...a: unknown[]) => unknown)(...args),
}));

function client() {
  const postMessage = vi.fn().mockResolvedValue({ ts: "999.001" });
  const update = vi.fn().mockResolvedValue({ ok: true });
  return { chat: { postMessage, update } };
}

const button = (value: unknown, actionId: string) => ({
  type: "button" as const,
  action_id: actionId,
  value: JSON.stringify(value),
});

const body = (overrides = {}) => ({
  channel: { id: "C1" },
  user: { id: "U1" },
  response_url: "https://hooks.slack.test/response",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  createBusJob.mockResolvedValue(undefined);
  linkBusThread.mockResolvedValue(undefined);
  buildReviewApprovalBlocks.mockReturnValue([{ type: "section", text: { type: "mrkdwn", text: "검토" } }]);
  saveBusDetected.mockResolvedValue("detected-token");
});

describe("bus:detected_ignore", () => {
  it("게시글을 조회하지 않고 원본 메시지를 넘어감으로 바꾼다", async () => {
    const { handleBusDetectedAction } = await import("~/services/slack/busDetectedAction");
    const mock = client();

    await handleBusDetectedAction(
      mock as never,
      body() as never,
      button({ article_id: 1 }, "bus:detected_ignore") as never,
    );

    expect(fetchBusArticle).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "https://hooks.slack.test/response",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("bus:detected", () => {
  it("채널이 반영 대상이 아니면 게시글을 조회하지 않는다", async () => {
    const { handleBusDetectedAction } = await import("~/services/slack/busDetectedAction");
    const mock = client();

    await handleBusDetectedAction(
      mock as never,
      body({ channel: { id: "C-unknown" } }) as never,
      button({ article_id: 1 }, "bus:detected") as never,
    );

    expect(fetchBusArticle).not.toHaveBeenCalled();
  });

  it("첨부가 없으면 변환을 시도하지 않고 안내한다", async () => {
    fetchBusArticle.mockResolvedValue({ title: "버스 시간표 변경 안내", url: "https://koreatech.in/articles/1", attachments: [] });
    collectBusSpreadsheets.mockReturnValue([]);
    const { handleBusDetectedAction } = await import("~/services/slack/busDetectedAction");
    const mock = client();

    await handleBusDetectedAction(
      mock as never,
      body() as never,
      button({ article_id: 1 }, "bus:detected") as never,
    );

    expect(convertBusToReview).not.toHaveBeenCalled();
    expect(mock.chat.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "버스 시간표 첨부 없음" }),
    );
  });

  it("첨부를 찾으면 다운로드해서 변환하고 검토 요청을 올린다", async () => {
    fetchBusArticle.mockResolvedValue({ title: "버스 시간표 변경 안내", url: "https://koreatech.in/articles/1", attachments: [{}] });
    collectBusSpreadsheets.mockReturnValue([{ name: "시간표.xlsx", url: "https://koreatech.in/f/1" }]);
    downloadBusNoticeFile.mockResolvedValue(Buffer.from("zip"));
    convertBusToReview.mockResolvedValue({
      token: "t1",
      reviewUrl: "https://bot.example/bus-review/t1",
      routeCount: 12,
      issueCount: 0,
      semesterTypes: ["REGULAR"],
    });
    const { handleBusDetectedAction } = await import("~/services/slack/busDetectedAction");
    const mock = client();

    await handleBusDetectedAction(
      mock as never,
      body() as never,
      button({ article_id: 1 }, "bus:detected") as never,
    );

    expect(downloadBusNoticeFile).toHaveBeenCalledWith({
      name: "시간표.xlsx",
      url: "https://koreatech.in/f/1",
    });
    expect(convertBusToReview).toHaveBeenCalledWith(
      Buffer.from("zip"),
      ".xlsx",
      expect.objectContaining({ env: "stage", fileName: "시간표.xlsx" }),
    );
    expect(createBusJob).toHaveBeenCalledWith(
      expect.objectContaining({ token: "t1", channelId: "C1", routeCount: 12, targetEnv: "stage" }),
    );
    expect(linkBusThread).toHaveBeenCalledWith("C1", "999.001", "t1");
    expect(mock.chat.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "버스 시간표 변환 완료 · 12개" }),
    );
  });

  it("변환에 실패하면 실패 메시지로 남긴다", async () => {
    fetchBusArticle.mockResolvedValue({ title: "공지", url: "https://koreatech.in/articles/1", attachments: [{}] });
    collectBusSpreadsheets.mockReturnValue([{ name: "시간표.xlsx", url: "https://koreatech.in/f/1" }]);
    downloadBusNoticeFile.mockRejectedValue(new Error("첨부 파일을 받지 못했습니다"));
    const { handleBusDetectedAction } = await import("~/services/slack/busDetectedAction");
    const mock = client();

    await handleBusDetectedAction(
      mock as never,
      body() as never,
      button({ article_id: 1 }, "bus:detected") as never,
    );

    expect(createBusJob).not.toHaveBeenCalled();
    expect(mock.chat.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "버스 시간표 변환 실패" }),
    );
  });

  it("시간표 첨부가 여럿이면 바로 변환하지 않고 고르게 한다", async () => {
    fetchBusArticle.mockResolvedValue({ title: "공지", url: "https://koreatech.in/articles/1", attachments: [{}, {}] });
    collectBusSpreadsheets.mockReturnValue([
      { name: "정규학기.xlsx", url: "https://koreatech.in/f/1" },
      { name: "계절학기.xlsx", url: "https://koreatech.in/f/2" },
    ]);
    const { handleBusDetectedAction } = await import("~/services/slack/busDetectedAction");
    const mock = client();

    await handleBusDetectedAction(
      mock as never,
      body() as never,
      button({ article_id: 1 }, "bus:detected") as never,
    );

    expect(convertBusToReview).not.toHaveBeenCalled();
    expect(saveBusDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "stage",
        articleId: 1,
        files: [
          { name: "정규학기.xlsx", url: "https://koreatech.in/f/1" },
          { name: "계절학기.xlsx", url: "https://koreatech.in/f/2" },
        ],
      }),
    );
    expect(mock.chat.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "변환할 파일을 골라주세요" }),
    );
  });
});

describe("bus:detected_start", () => {
  it("고른 파일로 변환하고 검토 요청을 올린다", async () => {
    loadBusDetected.mockResolvedValue({
      target: "stage",
      articleId: 1,
      articleTitle: "공지",
      articleUrl: "https://koreatech.in/articles/1",
      files: [
        { name: "정규학기.xlsx", url: "https://koreatech.in/f/1" },
        { name: "계절학기.xlsx", url: "https://koreatech.in/f/2" },
      ],
    });
    downloadBusNoticeFile.mockResolvedValue(Buffer.from("zip"));
    convertBusToReview.mockResolvedValue({
      token: "t1",
      reviewUrl: "https://bot.example/bus-review/t1",
      routeCount: 5,
      issueCount: 0,
      semesterTypes: ["SEASONAL"],
    });
    const { handleBusDetectedAction } = await import("~/services/slack/busDetectedAction");
    const mock = client();

    await handleBusDetectedAction(
      mock as never,
      body({ message: { ts: "999.001" } }) as never,
      button({ token: "detected-token", fileIndex: 1 }, "bus:detected_start_1") as never,
    );

    expect(dropBusDetected).toHaveBeenCalledWith("detected-token");
    expect(downloadBusNoticeFile).toHaveBeenCalledWith({
      name: "계절학기.xlsx",
      url: "https://koreatech.in/f/2",
    });
    expect(createBusJob).toHaveBeenCalledWith(
      expect.objectContaining({ token: "t1", routeCount: 5, targetEnv: "stage" }),
    );
    expect(mock.chat.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "버스 시간표 변환 완료 · 5개" }),
    );
  });

  it("만료됐거나 이미 처리된 알림이면 변환하지 않는다", async () => {
    loadBusDetected.mockResolvedValue(null);
    const { handleBusDetectedAction } = await import("~/services/slack/busDetectedAction");
    const mock = client();

    await handleBusDetectedAction(
      mock as never,
      body({ message: { ts: "999.001" } }) as never,
      button({ token: "detected-token", fileIndex: 0 }, "bus:detected_start") as never,
    );

    expect(convertBusToReview).not.toHaveBeenCalled();
    expect(mock.chat.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "만료됨" }),
    );
  });
});

describe("bus:detected_ignore (파일 선택 중 취소)", () => {
  it("token이 실려 있으면 저장해둔 후보를 지운다", async () => {
    const { handleBusDetectedAction } = await import("~/services/slack/busDetectedAction");
    const mock = client();

    await handleBusDetectedAction(
      mock as never,
      body() as never,
      button({ token: "detected-token" }, "bus:detected_ignore") as never,
    );

    expect(dropBusDetected).toHaveBeenCalledWith("detected-token");
  });
});
