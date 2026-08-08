import CHANNEL_ID from "@/constant/CHANNEL_ID.json";
import {
  fetchArticle,
  guessSemester,
  parseDetected,
  collectExcelAttachments,
  saveDetected,
} from "~/services/lecture/detected";
import { labelOf, resolveTargetByEnv } from "~/services/lecture/target";

/** 버튼이 너무 많으면 읽히지 않는다. 넘치면 명령어로 직접 올리는 편이 낫다. */
const MAX_CHOICES = 4;

/** 버튼 글자가 길면 잘려서 무엇인지 알 수 없다. */
function shorten(name: string): string {
  return name.length > 28 ? `${name.slice(0, 27)}…` : name;
}

const CHANNEL_BY_ENV = {
  stage: CHANNEL_ID.코인_이벤트알림_stage,
  prod: CHANNEL_ID.코인_이벤트알림,
} as const;

/**
 * 배치가 강의 공지를 감지하면 부른다. 넘기는 건 게시글 번호 하나다.
 * 첨부파일과 학기는 여기서 코인 API로 알아낸다 — 배치가 그걸 알 필요가 없다.
 */
export default defineEventHandler(async (event) => {
  const parsed = parseDetected(await readBody(event));
  if (!parsed.request) {
    throw createError({ statusCode: 400, statusMessage: parsed.reason ?? "Bad Request" });
  }
  const request = parsed.request;

  const resolved = resolveTargetByEnv(request.target);
  if (!resolved.target) {
    throw createError({ statusCode: 400, statusMessage: resolved.reason ?? "Bad Request" });
  }

  const article = await fetchArticle(resolved.target.baseUrl, request.articleId);
  const files = collectExcelAttachments(article.attachments);
  if (files.length === 0) {
    throw createError({ statusCode: 422, statusMessage: "게시글에 엑셀 첨부가 없습니다." });
  }

  // 제목에서 못 읽으면 사람이 지정하게 한다. 엉뚱한 학기에 넣으면 되돌릴 수 없다.
  const semester =
    request.year && request.term
      ? { year: request.year, term: request.term }
      : guessSemester(article.title ?? "");

  const token = await saveDetected({
    ...request,
    year: semester?.year,
    term: semester?.term,
    articleTitle: article.title ?? `게시글 ${request.articleId}`,
    articleUrl: article.url ?? "",
    files,
  });

  const title = article.url
    ? `<${article.url}|${article.title}>`
    : (article.title ?? `게시글 ${request.articleId}`);

  const lines = [
    "*강의 공지가 올라왔어요.*",
    title,
    `대상: ${labelOf(request.target)}`,
    semester
      ? `학기: *${semester.year} ${semester.term}*`
      : ":warning: 제목에서 학기를 읽지 못했습니다.",
  ];

  // 엑셀이 여럿이면 어느 걸 변환할지 사람이 고른다. 조용히 하나를 집으면
  // 엉뚱한 파일을 변환하고도 아무도 모른다.
  if (files.length > 1) {
    lines.push("", `엑셀 첨부가 *${files.length}개* 입니다. 변환할 파일을 골라주세요.`);
  }

  const fileButtons = files.slice(0, MAX_CHOICES).map((file, index) => ({
    type: "button" as const,
    text: {
      type: "plain_text" as const,
      text: files.length > 1 ? shorten(file.name) : "예",
      emoji: true,
    },
    style: index === 0 ? ("primary" as const) : undefined,
    action_id: `lecture:detected_start${index === 0 ? "" : `_${index}`}`,
    value: JSON.stringify({ token, fileIndex: index }),
  }));

  const posted = await event.context.slackWebClient.chat.postMessage({
    channel: CHANNEL_BY_ENV[request.target],
    text: `강의 공지 감지 · ${article.title ?? request.articleId}`,
    unfurlLinks: false,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
      {
        type: "actions",
        elements: [
          ...fileButtons,
          {
            type: "button",
            text: { type: "plain_text", text: "아니요", emoji: true },
            action_id: "lecture:detected_ignore",
            value: JSON.stringify({ token }),
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: files
              .slice(0, MAX_CHOICES)
              .map((file, index) => `${index + 1}. ${file.name}`)
              .join("\n"),
          },
        ],
      },
    ],
  });

  return { ok: true, channel: posted.channel, ts: posted.ts };
});
