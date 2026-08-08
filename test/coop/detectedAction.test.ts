import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/services/coop/detected", () => ({
  collectCoopImages: vi.fn(() => [{
    name: "2026-1학기.png",
    url: "https://portal.koreatech.ac.kr/file?id=1",
    mimeType: "image/png",
  }]),
  downloadCoopNoticeImage: vi.fn(async () => new ArrayBuffer(4)),
  dropDetectedCoop: vi.fn(async () => undefined),
  fetchArticle: vi.fn(async () => ({
    title: "2026학년도 1학기 생협 운영시간 안내",
    url: "https://koreatech.in/articles/123",
    attachments: [],
  })),
  guessRegularCoopSemester: vi.fn(() => ({ year: 2026, termName: "1학기" })),
  loadDetectedCoop: vi.fn(async () => null),
  saveDetectedCoop: vi.fn(async () => "a".repeat(32)),
}));

vi.mock("~/services/coop/pipeline", () => ({
  convertRegularCoopToReview: vi.fn(async () => ({
    token: "b".repeat(32),
    reviewUrl: "https://bot.example.com/review/token",
    shopCount: 11,
    excludedCount: 3,
    blockingCount: 0,
    infoCount: 0,
  })),
  buildRegularCoopResultBlocks: vi.fn(() => [{
    type: "section",
    text: { type: "mrkdwn", text: "변환 완료" },
  }]),
}));

vi.mock("~/services/coop/reviewStore", () => ({
  linkCoopThread: vi.fn(async () => undefined),
}));

import {
  collectCoopImages,
  downloadCoopNoticeImage,
  fetchArticle,
  saveDetectedCoop,
} from "~/services/coop/detected";
import { convertRegularCoopToReview } from "~/services/coop/pipeline";
import { linkCoopThread } from "~/services/coop/reviewStore";
import { handleCoopDetectedAction } from "~/services/slack/coopDetectedAction";

function slackClient() {
  return {
    chat: {
      postMessage: vi.fn(async () => ({ ts: "100.1" })),
      update: vi.fn(async () => ({})),
    },
  };
}

describe("생협 공지 감지 Slack 액션", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("예를 누르면 게시글 이미지를 기존 변환 파이프라인에 연결한다", async () => {
    const client = slackClient();
    await handleCoopDetectedAction(client as never, {
      channel: { id: "C1" },
      user: { id: "U1" },
    } as never, {
      type: "button",
      action_id: "coop:detected",
      value: JSON.stringify({ article_id: 123 }),
    } as never);

    expect(fetchArticle).toHaveBeenCalledWith(123);
    expect(downloadCoopNoticeImage).toHaveBeenCalledWith(expect.objectContaining({ name: "2026-1학기.png" }));
    expect(convertRegularCoopToReview).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      "image/png",
      { year: 2026, termName: "1학기", fileName: "2026-1학기.png" },
    );
    expect(linkCoopThread).toHaveBeenCalledWith("C1", "100.1", "b".repeat(32));
    expect(client.chat.update).toHaveBeenLastCalledWith(expect.objectContaining({
      channel: "C1",
      ts: "100.1",
      text: expect.stringContaining("변환 완료"),
    }));
  });

  it("아니요를 누르면 원본 감지 메시지를 종료 상태로 바꾼다", async () => {
    const client = slackClient();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    await handleCoopDetectedAction(client as never, {
      channel: { id: "C1" },
      user: { id: "U1" },
      response_url: "https://hooks.slack.com/actions/1",
    } as never, {
      type: "button",
      action_id: "coop:detected_ignore",
      value: JSON.stringify({ article_id: 123 }),
    } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/actions/1",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("replace_original"),
      }),
    );
    expect(client.chat.postMessage).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("이미지가 여럿이면 변환하지 않고 선택 버튼을 보여준다", async () => {
    vi.mocked(collectCoopImages).mockReturnValueOnce([
      { name: "운영시간.png", url: "https://portal.koreatech.ac.kr/file?id=1", mimeType: "image/png" },
      { name: "참고.jpg", url: "https://portal.koreatech.ac.kr/file?id=2", mimeType: "image/jpeg" },
    ]);
    const client = slackClient();
    await handleCoopDetectedAction(client as never, {
      channel: { id: "C1" },
      user: { id: "U1" },
    } as never, {
      type: "button",
      action_id: "coop:detected",
      value: JSON.stringify({ article_id: 123 }),
    } as never);

    expect(saveDetectedCoop).toHaveBeenCalledWith(expect.objectContaining({
      articleId: 123,
      year: 2026,
      termName: "1학기",
      images: expect.arrayContaining([expect.objectContaining({ name: "운영시간.png" })]),
    }));
    expect(downloadCoopNoticeImage).not.toHaveBeenCalled();
    expect(JSON.stringify(client.chat.update.mock.calls.at(-1)?.[0])).toContain("coop:detected_start_1");
  });
});
