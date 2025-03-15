import { WebClient } from "@slack/web-api";
import CHANNEL_ID from "@/constant/CHANNEL_ID.json";

const CLARITY_DATA_KEY = "CLARITY_DATA";

interface ClarityData {
  date: number;
  result: Record<string, [string, [number, number]][]>;
}

export default defineTask({
  meta: {
    name: "crawl:clarity",
    description: "Crawl Clarity Data",
  },
  async run({
    payload: {
      scheduledTime
    },
    context,
  }) {
    console.log("Crawl Clarity Data");
    // https://github.com/nitrojs/nitro/issues/1974
    // Task Hook is not implemented.
    const slackWebClient = new WebClient(import.meta.env.SLACK_BOT_TOKEN);
    try {
      const storage = useStorage("kvStorage");
      const result = await $fetch<Metrics[]>("https://www.clarity.ms/export-data/api/v1/project-live-insights",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${import.meta.env.CLARITY_TOKEN}`,
          },
          params: {
            numOfDays: 1,
            dimension1: "URL",
          }
        }
      );
      const normailzedResult = normalizeMetrics(result);
      const data = await storage.get<ClarityData[]>(CLARITY_DATA_KEY);
      await storage.set(CLARITY_DATA_KEY, [
        ...(data ?? []),
        {
          date: scheduledTime,
          result: normailzedResult,
        },
      ]);
      await sendSlackBlock({
        client: slackWebClient,
        channel: CHANNEL_ID.코인_오류_front_end,
        blocks: createMessageBlock(
          {
            date: Number(scheduledTime),
            result: normailzedResult,
          },
          data[data.length - 1]
        ),
        unfurl_links: false,
      })
    } catch (e) {
      console.error(e);
      return {
        result: "failed"
      }
    }

    return {
      result: "success"
    }
  }
});

interface Infomation {
  sessionsCount: number;
  sessionsWithMetricPercentage: number;
  sessionWithoutMetricPercentage: number;
  pagesViews: number;
  subTotal: number;
  Url: string;
}
interface Metrics {
  metricName: string;
  information: Infomation[];
}

function normalizeMetrics(metrics: Metrics[]): ClarityData["result"] {
  const result: ClarityData["result"] = {};
  for(const metric of metrics) {
    if (metric.metricName === "DeadClickCount") {
      result.deadClickCount = normalizeInfomation(metric.information);
    }

    if (metric.metricName === "QuickbackClick") {
      result.quickBackCount = normalizeInfomation(metric.information);
    }

    if (metric.metricName === "RageClickCount") {
      result.scriptErrorCount = normalizeInfomation(metric.information);
    }

    if (metric.metricName === "ScriptErrorCount") {
      result.scriptErrorCount = normalizeInfomation(metric.information);
    }
  }
  return result;
}
function normalizeInfomation(infomations: Infomation[]) {
  const map = new Map<string, [number, number]>();
  for (const info of infomations) {
    const urlInstance = new URL(info.Url);
    const pathname = urlInstance.pathname;
    const count = Number(info.pagesViews);
    const totalSessionCount = Number(info.sessionsCount);
    const previousCount = map.get(pathname) ?? [0, 0];
    map.set(pathname, [previousCount[0] + count, previousCount[1] + totalSessionCount]);
  }

  return Array.from(map.entries()).sort((a, b) => b[1][0] - a[1][0]);
}

const metricsKeyToKorean = {
  deadClickCount: "빠른 클릭",
  quickBackCount: "빠른 뒤로가기",
  scriptErrorCount: "스크립트 오류",
  rageClickCount: "클릭으로 인식한 범위 클릭",
}

function createMessageBlock(clarityInfo: ClarityData, previousClarityInfo: ClarityData | undefined) {
  const { date, result } = clarityInfo;
  const blocks = [
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": `${(new Date(date)).toLocaleString("ko-kr")}의 *코인 웹사이트 측정치*입니다!`
			}
		},
		{
			"type": "divider"
		},
  ];
  for (let i = 0; i < Object.keys(result).length; i++) {
    const key = Object.keys(result)[i];
    const previousTotal = previousClarityInfo?.result[key].reduce((acc, [, [count, totalCount]]) => [acc[0] + count, acc[1] + totalCount], [0, 0]);
    const currentValue = result[key];
    const currentTotal = currentValue.reduce((acc, [, [count, totalCount]]) => [acc[0] + count, acc[1] + totalCount], [0, 0]);
    const currentPercent = (currentTotal[0] / currentTotal[1]) * 100;
    const previousPercent = (previousTotal[0] / previousTotal[1]) * 100;
    const valueDiff = currentPercent - previousPercent;
    const valueDiffString = valueDiff > 0 ? `(🔼 ${valueDiff.toFixed(2)}%)` : `(🔽 ${valueDiff.toFixed(2)}%)`;
    blocks.push({
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": `*${metricsKeyToKorean[key]}*: ${currentPercent}% ${previousClarityInfo ? valueDiffString : ""}\n
        ${currentValue.slice(0, 3).map(([url, count], index) => `\t${index + 1}. *${url}*: ${count[0]}번`).join("\n")}
        `
      }
    });
  }
  return blocks;
}
