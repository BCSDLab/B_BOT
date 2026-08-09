import type { BlockAction } from "@slack/bolt";
import type { KnownBlock, WebClient } from "@slack/web-api";
import {
  collectBusSpreadsheets,
  downloadBusNoticeFile,
  dropBusDetected,
  fetchBusArticle,
  loadBusDetected,
  saveBusDetected,
} from "~/services/bus/detected";
import type { BusNoticeFile } from "~/services/bus/detected";
import { createBusJob } from "~/services/bus/jobStore";
import { buildReviewApprovalBlocks, convertBusToReview } from "~/services/bus/pipeline";
import { linkBusThread } from "~/services/bus/reviewStore";
import { acquireDetectLock, releaseDetectLock } from "~/services/koin/detectLock";
import { labelOf, resolveTarget } from "~/services/koin/target";
import type { KoinEnv } from "~/services/koin/target";
import type { BlockActionSetting } from "./type";

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

/** 버튼이 너무 많으면 읽히지 않는다. 넘치면 파일을 직접 올리는 편이 낫다(lecture와 동일). */
const MAX_CHOICES = 4;

/** 버튼 글자가 길면 잘려서 무엇인지 알 수 없다. */
function shorten(name: string): string {
  return name.length > 28 ? `${name.slice(0, 27)}…` : name;
}

/**
 * 고른 파일을 내려받아 변환하고 검토 링크까지 올린다.
 * 첨부가 하나일 때와 골랐을 때가 여기서 만난다.
 */
async function runConversion({
  client,
  channel,
  ts,
  actor,
  env,
  label,
  file,
  articleId,
}: {
  client: WebClient;
  channel: string;
  ts: string;
  actor: string;
  env: KoinEnv;
  label: string;
  file: BusNoticeFile;
  articleId: number;
}) {
  const conversionTarget = { env, fileName: file.name };

  await client.chat.update({
    channel,
    ts,
    text: "버스 시간표 변환 중",
    blocks: section(
      `:hourglass_flowing_sand: *버스 시간표* 변환 중…\n${label} · ${file.name}`,
    ),
  });

  // 이 게시글의 원본 버튼은 락을 잡은 직후 이미 갈아끼웠다(위 호출부의 replaceOriginal).
  // 그러니 여기서부터는 성공하든 실패하든 다시 눌릴 방법이 없다 — 결과와 무관하게
  // 항상 풀어준다. 안 풀면 취소하거나 실패해도 30분 동안 같은 게시글의 새 알림이 막힌다.
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
      targetEnv: env,
    });
    await linkBusThread(channel, ts, outcome.token);

    await client.chat.update({
      channel,
      ts,
      text: `버스 시간표 변환 완료 · ${outcome.routeCount}개`,
      blocks: buildReviewApprovalBlocks(outcome, conversionTarget, actor),
    });
  } catch (error) {
    await client.chat.update({
      channel,
      ts,
      text: "버스 시간표 변환 실패",
      blocks: section(
        `:x: *변환 실패*\n${
          error instanceof Error ? error.message : "알 수 없는 오류입니다"
        }\n${file.name} · 요청: <@${actor}>`,
      ),
    });
  } finally {
    await releaseDetectLock("bus", channel, articleId);
  }
}

export const BUS_DETECTED_ACTION_IDS = [
  "bus:detected",
  "bus:detected_ignore",
  "bus:detected_start",
  "bus:detected_start_1",
  "bus:detected_start_2",
  "bus:detected_start_3",
] as const;

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
    // 파일을 여럿 중에 고르다가 "아니요"를 누른 경우엔 값에 token이 실려 온다.
    // 배치가 웹훅으로 올린 최초 메시지의 "넘어가기"엔 token이 없다 — 그땐 아직
    // 락을 잡기 전이라 풀 것도 없다.
    const { token } = JSON.parse(action.value ?? "{}") as { token?: string };
    if (token) {
      const notice = await loadBusDetected(token);
      await dropBusDetected(token);
      if (notice) {
        await releaseDetectLock("bus", channel, notice.articleId);
      }
    }
    await replaceOriginal(
      body.response_url,
      "버스 공지를 넘어갑니다.",
      section(`:no_entry_sign: *이 버스 공지는 넘어갑니다.*\n<@${actor}>`),
    );
    return;
  }

  // 파일이 여럿이라 고른 경우. 버튼마다 action_id가 달라야 해서 접미사로 나눈다.
  if (action.action_id.startsWith("bus:detected_start")) {
    const { token, fileIndex = 0 } = JSON.parse(action.value ?? "{}") as {
      token?: string;
      fileIndex?: number;
    };
    const ts = body.message?.ts;
    if (!token || !ts) return;

    const notice = await loadBusDetected(token);
    const file = notice?.files[fileIndex];
    if (!notice || !file) {
      await client.chat.update({
        channel,
        ts,
        text: "만료됨",
        blocks: section(":x: 이미 처리했거나 만료된 알림입니다."),
      });
      return;
    }

    // 먼저 지운다. 두 명이 눌러 두 번 변환하면 검토 링크가 둘이 된다.
    await dropBusDetected(token);
    await runConversion({
      client,
      channel,
      ts,
      actor,
      env: notice.target,
      label: labelOf(notice.target),
      file,
      articleId: notice.articleId,
    });
    return;
  }

  const { article_id: articleId } = JSON.parse(action.value ?? "{}") as {
    article_id?: number;
  };
  if (!articleId) return;

  // 어느 코인에 반영할지는 채널로 정한다. 배치는 웹훅을 고르는 것으로 이미 답했다.
  const resolved = resolveTarget(channel, "버스");
  if (!resolved.target) {
    await replaceOriginal(
      body.response_url,
      "버스 반영 대상 채널이 아닙니다.",
      section(`:x: ${resolved.reason ?? "반영 대상을 찾지 못했습니다."}`),
    );
    return;
  }
  const target = resolved.target;

  // 버튼을 지우는 것만으로는 두 번 눌리는 걸 막지 못한다. 원본을 갈아끼우기 전에
  // 잠근다 — 변환이 두 번 돌면 검토 링크와 반영 버튼이 둘씩 생기고,
  // 그 둘은 토큰이 달라 반영 락에도 걸리지 않는다.
  const lock = await acquireDetectLock("bus", channel, articleId, actor);
  if (!lock.ok) {
    await client.chat.postEphemeral({
      channel,
      user: actor,
      text: lock.actor
        ? `<@${lock.actor}>님이 이미 이 공지를 진행 중입니다.`
        : "이미 진행 중인 공지입니다.",
    });
    return;
  }

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
  const ts = posted.ts;
  if (!ts) {
    // ts가 없으면 이후 갱신도, 스레드 연결도 할 수 없다.
    await releaseDetectLock("bus", channel, articleId);
    throw new Error("메시지를 올리지 못해 진행할 수 없습니다.");
  }
  const say = (text: string, mrkdwn: string) =>
    client.chat.update({ channel, ts, text, blocks: section(mrkdwn) });

  let article: Awaited<ReturnType<typeof fetchBusArticle>>;
  try {
    article = await fetchBusArticle(articleId);
  } catch (error) {
    await releaseDetectLock("bus", channel, articleId);
    await say(
      "버스 게시글 조회 실패",
      `:x: *게시글을 읽지 못했습니다.*\n${error instanceof Error ? error.message : ""}`,
    );
    return;
  }

  const articleUrl = article.url || ARTICLE_URL(articleId);
  const files = collectBusSpreadsheets(article.attachments);
  if (files.length === 0) {
    await releaseDetectLock("bus", channel, articleId);
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

  // 시간표 파일이 여럿이면 사람이 고른다. 정규학기·계절학기가 따로 붙는 공지가 있다.
  if (files.length > 1) {
    const token = await saveBusDetected({
      target: target.env,
      articleId,
      articleTitle: article.title ?? `게시글 ${articleId}`,
      articleUrl,
      files,
    });

    await client.chat.update({
      channel,
      ts,
      text: "변환할 파일을 골라주세요",
      blocks: [
        ...section(
          [
            `:page_facing_up: *버스 시간표* · ${target.label}`,
            `시간표 첨부가 *${files.length}개* 입니다. 변환할 파일을 골라주세요.`,
            "",
            ...files.slice(0, MAX_CHOICES).map((f, i) => `${i + 1}. ${f.name}`),
          ].join("\n"),
        ),
        {
          type: "actions",
          elements: [
            ...files.slice(0, MAX_CHOICES).map((f, index) => ({
              type: "button" as const,
              text: { type: "plain_text" as const, text: shorten(f.name), emoji: true },
              style: index === 0 ? ("primary" as const) : undefined,
              action_id: `bus:detected_start${index === 0 ? "" : `_${index}`}`,
              value: JSON.stringify({ token, fileIndex: index }),
            })),
            {
              type: "button" as const,
              text: { type: "plain_text" as const, text: "아니요", emoji: true },
              action_id: "bus:detected_ignore",
              value: JSON.stringify({ token }),
            },
          ],
        },
      ],
    });
    return;
  }

  await runConversion({
    client,
    channel,
    ts,
    actor,
    env: target.env,
    label: target.label,
    file: files[0],
    articleId,
  });
}

/** 버스 공지 감지. 등록표는 `blockAction.ts`가 모으기만 한다. */
export const busDetectedActions: BlockActionSetting[] = BUS_DETECTED_ACTION_IDS.map((actionId) => ({
  actionId,
  async handler({ client, body, action }) {
    await handleBusDetectedAction(client, body, action);
  },
}));
