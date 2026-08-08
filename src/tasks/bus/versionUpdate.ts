import { WebClient } from "@slack/web-api";
import { runDueBusVersionUpdates } from "~/services/bus/versionSchedule";

let running = false;

export default defineTask({
  meta: {
    name: "bus:versionUpdate",
    description: "Apply due bus timetable version updates",
  },
  async run() {
    // 5분 간격 스케줄이 이전 실행이 끝나기 전에 또 시작되면 같은 일정을
    // 중복 전송할 수 있다. 겹치는 실행은 건너뛴다.
    if (running) return { result: "skipped" };
    running = true;
    const client = new WebClient(import.meta.env.SLACK_BOT_TOKEN);
    try {
      await runDueBusVersionUpdates(client);
      return { result: "ok" };
    } catch (error) {
      return {
        result: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      running = false;
    }
  },
});
