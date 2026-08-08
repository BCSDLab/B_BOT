import CHANNEL_ID from "@/constant/CHANNEL_ID.json";
import { fileNameOf, parseDetected, saveDetected } from "~/services/lecture/detected";
import { labelOf } from "~/services/lecture/target";

const CHANNEL_BY_ENV = {
  stage: CHANNEL_ID.코인_이벤트알림_stage,
  prod: CHANNEL_ID.코인_이벤트알림,
} as const;

/**
 * 배치가 강의 공지를 감지하면 부른다.
 *
 * 다른 /api 라우트에는 인증이 없지만 여기엔 둔다. 이 요청 하나가 프로덕션 강의
 * 데이터 변경까지 이어질 수 있어서다. 키가 없으면 통과시키지 않는다.
 */
export default defineEventHandler(async (event) => {
  const expected = import.meta.env.LECTURE_DETECT_API_KEY;
  if (!expected || getHeader(event, "x-api-key") !== expected) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const parsed = parseDetected(await readBody(event));
  if (!parsed.notice) {
    throw createError({ statusCode: 400, statusMessage: parsed.reason ?? "Bad Request" });
  }

  const notice = parsed.notice;
  const token = await saveDetected(notice);
  const channel = CHANNEL_BY_ENV[notice.target];

  const lines = [
    `*${notice.year} ${notice.term}* 강의 공지가 올라왔습니다.`,
    `대상: ${labelOf(notice.target)}`,
  ];
  if (notice.noticeTitle) {
    lines.push(
      notice.noticeUrl ? `<${notice.noticeUrl}|${notice.noticeTitle}>` : notice.noticeTitle,
    );
  }

  const posted = await event.context.slackWebClient.chat.postMessage({
    channel,
    text: `${notice.year} ${notice.term} 강의 공지 감지`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "변환 시작", emoji: true },
            style: "primary",
            action_id: "lecture:detected_start",
            value: JSON.stringify({ token }),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "무시", emoji: true },
            action_id: "lecture:detected_ignore",
            value: JSON.stringify({ token }),
          },
        ],
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: fileNameOf(notice) }],
      },
    ],
  });

  return { ok: true, channel, ts: posted.ts };
});
