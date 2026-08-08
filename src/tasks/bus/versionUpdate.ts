import { WebClient } from "@slack/web-api";
import { runDueBusVersionUpdates } from "~/services/bus/versionSchedule";

// 이전 실행이 아직 안 끝났는데 다음 주기가 도는 경우, 오래된 실행을 그대로 두고
// 쌓아두기보다 새 실행이 이전 걸 취소하고 대신한다 — 처리 대상(예약 목록)은
// 매번 새로 조회하므로 최신 실행 하나만 살아있으면 충분하다.
let currentRun: AbortController | undefined;

export default defineTask({
  meta: {
    name: "bus:versionUpdate",
    description: "Apply due bus timetable version updates",
  },
  async run() {
    currentRun?.abort();
    const controller = new AbortController();
    currentRun = controller;

    console.log("[bus:versionUpdate] 시작");
    const client = new WebClient(import.meta.env.SLACK_BOT_TOKEN);
    try {
      await runDueBusVersionUpdates(client, controller.signal);
      if (controller.signal.aborted) {
        console.log("[bus:versionUpdate] 다음 실행에 밀려 취소됨");
        return { result: "cancelled" };
      }
      console.log("[bus:versionUpdate] 완료");
      return { result: "ok" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[bus:versionUpdate] 실패:", message);
      return { result: "error", message };
    } finally {
      if (currentRun === controller) currentRun = undefined;
    }
  },
});
