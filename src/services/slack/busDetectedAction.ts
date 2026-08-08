import type { BlockAction } from "@slack/bolt";
import type { KnownBlock, WebClient } from "@slack/web-api";
import {
  collectBusSpreadsheets,
  downloadBusNoticeFile,
  fetchBusArticle,
} from "~/services/bus/detected";
import { createBusJob } from "~/services/bus/jobStore";
import { buildReviewApprovalBlocks, convertBusToReview } from "~/services/bus/pipeline";
import { linkBusThread } from "~/services/bus/reviewStore";
import { resolveBusTarget } from "~/services/bus/target";

const ARTICLE_URL = (articleId: number) => `https://koreatech.in/articles/${articleId}`;

const section = (text: string): KnownBlock[] => [
  { type: "section", text: { type: "mrkdwn", text } },
];

/** 배치가 웹훅으로 올린 메시지일 수 있어 response_url로 바꾼다(coop/lecture와 동일). */
async function replaceOriginal(
  responseUrl: string | undefined,
  text: string,
  blocks: KnownBlock[],
) {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ replace_original: true, text, blocks }),
  });
}

export const BUS_DETECTED_ACTION_IDS = ["bus:detected", "bus:detected_ignore"] as const;

/**
 * 배치가 올린 감지 알림의 "확인"/"넘어가기".
 *
 * 배치가 아는 건 이 action_id와 `article_id` 하나뿐이다(coop:detected/lecture:detected와
 * 동일한 계약). 첨부 조회·변환·오류 문구는 전부 여기서 만든다.
 */
export async function handleBusDetectedAction(
  client: WebClient,
  body: BlockAction,
  action: BlockAction["actions"][number],
) {
  if (action.type !== "button" || !body.channel) return;
  const channel = body.channel.id;
  const actor = body.user.id;

  if (action.action_id === "bus:detected_ignore") {
    await replaceOriginal(
      body.response_url,
      "버스 공지를 넘어갑니다.",
      section(`:no_entry_sign: *이 버스 공지는 넘어갑니다.*\n<@${actor}>`),
    );
    return;
  }

  const { article_id: articleId } = JSON.parse(action.value ?? "{}") as {
    article_id?: number;
  };
  if (!articleId) return;

  // 어느 코인에 반영할지는 채널로 정한다. 배치는 웹훅을 고르는 것으로 이미 답했다.
  const resolved = resolveBusTarget(channel);
  if (!resolved.target) {
    await replaceOriginal(
      body.response_url,
      "버스 반영 대상 채널이 아닙니다.",
      section(`:x: ${resolved.reason ?? "반영 대상을 찾지 못했습니다."}`),
    );
    return;
  }
  const target = resolved.target;

  await replaceOriginal(
    body.response_url,
    "버스 시간표 업데이트를 진행합니다.",
    section(`:white_check_mark: *버스 시간표 업데이트를 진행합니다.* · ${target.label}\n<@${actor}>`),
  );

  const posted = await client.chat.postMessage({
    channel,
    text: "버스 게시글 확인 중",
    blocks: section(":hourglass_flowing_sand: 버스 게시글을 확인하고 있습니다…"),
  });
  const ts = posted.ts as string;
  const say = (text: string, mrkdwn: string) =>
    client.chat.update({ channel, ts, text, blocks: section(mrkdwn) });

  let article: Awaited<ReturnType<typeof fetchBusArticle>>;
  try {
    article = await fetchBusArticle(articleId);
  } catch (error) {
    await say(
      "버스 게시글 조회 실패",
      `:x: *게시글을 읽지 못했습니다.*\n${error instanceof Error ? error.message : ""}`,
    );
    return;
  }

  const articleUrl = article.url || ARTICLE_URL(articleId);
  const files = collectBusSpreadsheets(article.attachments);
  if (files.length === 0) {
    await say(
      "버스 시간표 첨부 없음",
      [
        ":grey_question: *지원하는 시간표 파일 첨부를 찾지 못했습니다.*",
        `<${articleUrl}|${article.title ?? `게시글 ${articleId}`}>`,
        "파일을 직접 올리고 `!버스반영`으로 실행해주세요.",
      ].join("\n"),
    );
    return;
  }

  const file = files[0];
  const conversionTarget = { env: target.env, fileName: file.name };

  await client.chat.update({
    channel,
    ts,
    text: "버스 시간표 변환 중",
    blocks: section(
      `:hourglass_flowing_sand: *버스 시간표* 변환 중…\n${target.label} · ${file.name}`,
    ),
  });

  try {
    const bytes = await downloadBusNoticeFile(file);
    const extension = `.${file.name.split(".").pop()?.toLowerCase()}`;
    const outcome = await convertBusToReview(bytes, extension, conversionTarget);

    // 반영 권한을 한 명만 갖게 하려면 상태가 DB에 있어야 한다. job 행이 없는데
    // 스레드부터 묶으면, 여기서 실패했을 때 스레드가 막다른 곳이 된다.
    await createBusJob({
      token: outcome.token,
      channelId: channel,
      threadTs: ts,
      sourceFile: file.name,
      routeCount: outcome.routeCount,
      semesterTypes: outcome.semesterTypes,
      targetEnv: target.env,
    });
    await linkBusThread(channel, ts, outcome.token);

    await client.chat.update({
      channel,
      ts,
      text: `버스 시간표 변환 완료 · ${outcome.routeCount}개`,
      blocks: buildReviewApprovalBlocks(outcome, conversionTarget, actor),
    });
  } catch (error) {
    await say(
      "버스 시간표 변환 실패",
      `:x: *변환 실패*\n${error instanceof Error ? error.message : "알 수 없는 오류입니다"}\n${file.name} · 요청: <@${actor}>`,
    );
  }
}
