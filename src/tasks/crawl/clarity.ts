import { WebClient } from "@slack/web-api";
import CHANNEL_ID from "@/constant/CHANNEL_ID.json";
import { sendSlackBlock } from "~/utils/slackFunction";

const CLARITY_DATA_KEY = "CLARITY_LIST";
const CLARITY_DATA_PREFIX = "CLARITY_DATA_";

interface ClarityData {
  date: number;
  /**
   * @example { deadClickCount: { "/" : [ 1, 2 ] }
   * "/"에서 두 세션 중 한 번 "빠른 클릭"이 감지됨.
  */
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
    const now = Date.now();
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
      const normalizedResult = normalizeMetrics(result);
      const data = await storage.get<number[]>(CLARITY_DATA_KEY);
      await storage.set(CLARITY_DATA_KEY, [
        ...(data ?? []),
        now
      ]);
      await storage.set(`${CLARITY_DATA_PREFIX}${now}`, {
        date: now,
        result: normalizedResult
      } satisfies ClarityData);
      const previousData = await storage.get<ClarityData | null>(`${CLARITY_DATA_PREFIX}${data[data.length -1]}`);
      if (!previousData) {
        return {
          result: "success"
        };
      }
      const blocks = createScriptErrorMessageText(
        {
          date: now,
          result: normalizedResult,
        },
        previousData
      );
      if (blocks.length === 0) {
        return {
          result: "success"
        };
      
      }
      await sendSlackBlock({
        client: slackWebClient,
        channel: CHANNEL_ID.코인_오류_front_end,
        blocks,
        unfurlLinks: false,
      });
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

interface Information {
  sessionsCount: number;
  sessionsWithMetricPercentage: number;
  sessionWithoutMetricPercentage: number;
  pagesViews: number;
  subTotal: number;
  Url: string;
}
interface Metrics {
  metricName: string;
  information: Information[];
}

function normalizeMetrics(metrics: Metrics[]): ClarityData["result"] {
  const result: ClarityData["result"] = {};
  for(const metric of metrics) {
    if (metric.metricName === "DeadClickCount") {
      result.deadClickCount = normalizeInformation(metric.information);
    }

    if (metric.metricName === "QuickbackClick") {
      result.quickBackCount = normalizeInformation(metric.information);
    }

    if (metric.metricName === "RageClickCount") {
      result.rageClickCount = normalizeInformation(metric.information);
    }

    if (metric.metricName === "ScriptErrorCount") {
      result.scriptErrorCount = normalizeInformation(metric.information);
    }
  }
  return result;
}
function normalizeInformation(informations: Information[]) {
  const map = new Map<string, [number, number]>();
  for (const info of informations) {
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
				"text": `${(new Date(date)).toLocaleString("ko-kr")}의 *코인 웹사이트 측정치*입니다! [참고](https://learn.microsoft.com/en-us/clarity/insights/semantic-metrics)`
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
        "text": `*${metricsKeyToKorean[key]}*: ${currentPercent.toFixed(2)}% ${previousClarityInfo ? valueDiffString : ""}\n
        ${currentValue.slice(0, 3).map(([url, count], index) => `${index + 1}. *${url}*: ${count[0]}번`).join("\n")}
        `
      }
    });
  }
  return blocks;
}

function createScriptErrorMessageText(clarityInfo: ClarityData, previousClarityInfo: ClarityData) {
  const { date, result } = clarityInfo;
  const blocks = [];
  const scriptErrorResult = result.scriptErrorCount;
  for (const scriptErrorCountInfo of scriptErrorResult) {
    const errorCount = scriptErrorCountInfo[1][0];
    if (errorCount === 0) {
      continue;
    }
    const previousErrorCount = previousClarityInfo.result.scriptErrorCount.find((info) => info[0] === scriptErrorCountInfo[0])?.[1][0] ?? 0;
    const errorCountDiff = errorCount - previousErrorCount;
    if (errorCountDiff > 0) {
      blocks.push({
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": `*\`${scriptErrorCountInfo[0]}\`*에서 ${errorCountDiff}번이 증가했습니다.\n`
        }
      });
    }
  }
  if (blocks.length === 0) {
    return [];
  }
  blocks.unshift(
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": `코인에 새로운 에러가 발생했습니다! 만약 세션을 보고 싶으시다면 관리자를 불러주세요(현 관리자 이름: ${import.meta.env.ADMIN_NAME}).`
			}
		},
		{
			"type": "divider"
		},
  )
  return blocks;
}
