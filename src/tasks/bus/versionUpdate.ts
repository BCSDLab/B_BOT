import { WebClient } from "@slack/web-api";
import { runDueVersionUpdates } from "~/services/bus/workflow";

export default defineTask({
  meta: {
    name: "bus:versionUpdate",
    description: "Apply due bus timetable version updates",
  },
  async run() {
    const client = new WebClient(import.meta.env.SLACK_BOT_TOKEN);
    await runDueVersionUpdates(client);
    return { result: "ok" };
  },
});
