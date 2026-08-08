import { describe, expect, it, vi } from "vitest";
import { sendReviewApproval, sendStatus } from "~/services/bus/slack";

function client() {
  const postMessage = vi.fn().mockResolvedValue({ ok: true });
  return { chat: { postMessage } };
}

const job = {
  id: "job-1",
  state: "REVIEW_PENDING",
  state_version: 2,
  source_hash: "source-hash",
  slack: { channel: "C1", ts: "111.222" },
  conversions: [],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("버스 Slack 알림", () => {
  it("검수 요청은 job에 묶인 스레드로 보낸다", async () => {
    const mock = client();
    await sendReviewApproval(mock as never, "C1", job as never);

    expect(mock.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C1",
        thread_ts: "111.222",
        text: "버스 시간표 검수",
      }),
    );
  });

  it("스레드 바인딩이 없으면 채널에 보낸다", async () => {
    const mock = client();
    const unbound = { ...job, slack: undefined };
    await sendReviewApproval(mock as never, "C1", unbound as never);

    expect(mock.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C1" }),
    );
    expect(mock.chat.postMessage.mock.calls[0][0]).not.toHaveProperty("thread_ts");
  });

  it("상태 메시지는 주어진 스레드로 보낸다", async () => {
    const mock = client();
    await sendStatus(mock as never, "C1", "완료", "111.222");

    expect(mock.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C1", thread_ts: "111.222", text: "완료" }),
    );
  });

  it("스레드가 없으면 상태 메시지는 채널에 보낸다", async () => {
    const mock = client();
    await sendStatus(mock as never, "C1", "완료");

    expect(mock.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C1", text: "완료" }),
    );
  });
});
