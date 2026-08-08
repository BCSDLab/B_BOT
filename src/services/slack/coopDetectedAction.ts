import type { BlockAction } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import {
  collectCoopImages,
  downloadCoopNoticeImage,
  dropDetectedCoop,
  fetchCoopArticle,
  guessCoopSemester,
  loadDetectedCoop,
  saveDetectedCoop,
  type CoopNoticeImage,
} from "~/services/coop/detected";
import {
  buildRegularCoopResultBlocks,
  convertRegularCoopToReview,
  extractVacationCoopImage,
} from "~/services/coop/pipeline";
import { linkCoopThread } from "~/services/coop/reviewStore";
import { createCoopJob } from "~/services/coop/jobStore";
import {
  coopTargetLabel,
  resolveCoopTarget,
  type CoopKoinEnv,
} from "~/services/coop/target";
import { savePendingCoopVacation } from "~/services/coop/vacationStore";

const MAX_CHOICES = 4;
const ARTICLE_URL = (articleId: number) => `https://koreatech.in/articles/${articleId}`;

const section = (text: string) => [
  { type: "section" as const, text: { type: "mrkdwn" as const, text } },
];

function shorten(name: string): string {
  return name.length > 28 ? `${name.slice(0, 27)}…` : name;
}

async function replaceOriginal(
  responseUrl: string | undefined,
  text: string,
  blocks: ReturnType<typeof section>,
) {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ replace_original: true, text, blocks }),
  });
}

async function runCoopConversion({
  client,
  channel,
  ts,
  actor,
  image,
  year,
  termName,
  env,
}: {
  client: WebClient;
  channel: string;
  ts: string | undefined;
  actor: string;
  image: CoopNoticeImage;
  year: number;
  termName: "1학기" | "2학기" | "하계방학" | "동계방학";
  env: CoopKoinEnv;
}) {
  await client.chat.update({
    channel,
    ts,
    text: "생협 운영시간 변환 중",
    blocks: section(`:hourglass_flowing_sand: *${year} ${termName} 생협 운영시간* 변환 중…\n${coopTargetLabel(env)} · ${image.name}\n작업자: <@${actor}>`),
  });

  try {
    const buffer = await downloadCoopNoticeImage(image);
    if (termName === "하계방학" || termName === "동계방학") {
      const season = termName.startsWith("하계") ? "하계" : "동계";
      const raw = await extractVacationCoopImage({
        image: buffer,
        mimeType: image.mimeType,
        fileName: image.name,
      });
      await savePendingCoopVacation(channel, ts ?? "", {
        env,
        year,
        season,
        fileName: image.name,
        requesterId: actor,
        raw,
      });
      await client.chat.update({
        channel,
        ts,
        text: "방학 시작일 입력 대기",
        blocks: section([
          `:calendar: *${year} ${season} 운영시간을 읽었습니다.*`,
          `전체 기간: ${raw.fromDate} - ${raw.toDate}`,
          "",
          "이 메시지의 스레드에 방학 시작일을 입력해주세요.",
          "예) `!학기구분 2026-07-18`",
        ].join("\n")),
      });
      return;
    }
    const target = { env, year, termName, fileName: image.name };
    const outcome = await convertRegularCoopToReview(buffer, image.mimeType, target);
    await linkCoopThread(channel, ts ?? "", outcome.token);
    await createCoopJob({
      token: outcome.token,
      channelId: channel,
      threadTs: ts ?? "",
      year,
      term: termName,
      sourceFile: image.name,
      shopCount: outcome.shopCount,
      targetEnv: env,
    });
    await client.chat.update({
      channel,
      ts,
      text: `${year} ${termName} 생협 운영시간 변환 완료 · ${outcome.shopCount}개`,
      blocks: buildRegularCoopResultBlocks(outcome, target, actor),
    });
  } catch (error) {
    await client.chat.update({
      channel,
      ts,
      text: "생협 운영시간 변환 실패",
      blocks: [
        ...section(`:x: *변환 실패*\n${error instanceof Error ? error.message : "알 수 없는 오류입니다"}`),
        { type: "context", elements: [{ type: "mrkdwn", text: `${image.name} · 작업자: <@${actor}>` }] },
      ],
    });
  }
}

export const COOP_DETECTED_ACTION_IDS = [
  "coop:detected",
  "coop:detected_ignore",
  "coop:detected_start",
  "coop:detected_start_1",
  "coop:detected_start_2",
  "coop:detected_start_3",
] as const;

export async function handleCoopDetectedAction(
  client: WebClient,
  body: BlockAction,
  action: BlockAction["actions"][number],
) {
  if (action.type !== "button" || !body.channel) return;
  const channel = body.channel.id;
  const actor = body.user.id;

  if (action.action_id === "coop:detected_ignore") {
    const { token } = JSON.parse(action.value ?? "{}") as { token?: string };
    if (token) await dropDetectedCoop(token);
    await replaceOriginal(
      body.response_url,
      "생협 공지를 넘어갑니다.",
      section(`:no_entry_sign: *이 생협 공지는 넘어갑니다.*\n<@${actor}>`),
    );
    return;
  }

  if (action.action_id.startsWith("coop:detected_start")) {
    const { token, fileIndex = 0 } = JSON.parse(action.value ?? "{}") as {
      token?: string;
      fileIndex?: number;
    };
    if (!token) return;
    const detected = await loadDetectedCoop(token);
    const image = detected?.images[fileIndex];
    if (!detected || !image) {
      await client.chat.update({
        channel,
        ts: body.message?.ts,
        text: "만료됨",
        blocks: section(":x: 이미 처리했거나 만료된 생협 알림입니다."),
      });
      return;
    }
    await dropDetectedCoop(token);
    await runCoopConversion({
      client,
      channel,
      ts: body.message?.ts,
      actor,
      image,
      year: detected.year,
      termName: detected.termName,
      env: detected.env,
    });
    return;
  }

  const { article_id: articleId } = JSON.parse(action.value ?? "{}") as {
    article_id?: number;
  };
  if (!articleId) return;

  const resolved = resolveCoopTarget(channel);
  if (!resolved.target) {
    await replaceOriginal(
      body.response_url,
      "생협 반영 대상 채널이 아닙니다.",
      section(`:x: ${resolved.reason ?? "반영 대상을 찾지 못했습니다."}`),
    );
    return;
  }
  const env = resolved.target.env;

  await replaceOriginal(
    body.response_url,
    "생협 업데이트를 진행합니다.",
    section(`:white_check_mark: *생협 업데이트를 진행합니다.* · ${coopTargetLabel(env)}\n<@${actor}>`),
  );
  const posted = await client.chat.postMessage({
    channel,
    text: "생협 게시글 확인 중",
    blocks: section(":hourglass_flowing_sand: 생협 게시글을 확인하고 있습니다…"),
  });
  const ts = posted.ts;
  const say = (text: string, mrkdwn: string) => client.chat.update({
    channel,
    ts,
    text,
    blocks: section(mrkdwn),
  });

  let article: Awaited<ReturnType<typeof fetchCoopArticle>>;
  try {
    article = await fetchCoopArticle(articleId);
  } catch (error) {
    await say("생협 게시글 조회 실패", `:x: *게시글을 읽지 못했습니다.*\n${error instanceof Error ? error.message : ""}`);
    return;
  }

  const articleUrl = article.url || ARTICLE_URL(articleId);
  const images = collectCoopImages(article.attachments);
  if (images.length === 0) {
    await say("생협 이미지 첨부 없음", [
      ":grey_question: *지원하는 이미지 첨부를 찾지 못했습니다.*",
      `<${articleUrl}|${article.title ?? `게시글 ${articleId}`}>`,
      "이미지를 직접 올리고 `!생협반영 2026 1학기`로 실행해주세요.",
    ].join("\n"));
    return;
  }

  const semester = guessCoopSemester(article.title ?? "");
  if (!semester) {
    await say("생협 학기를 확인해주세요", [
      ":grey_question: *제목에서 학기를 읽지 못했습니다.*",
      "이미지를 직접 올리고 `!생협반영 2026 1학기` 또는 `!생협반영 2026 하계방학`처럼 학기를 지정해주세요.",
      ...images.map((image) => `<${image.url}|${image.name}>`),
    ].join("\n"));
    return;
  }

  if (images.length > 1) {
    const token = await saveDetectedCoop({
      env,
      articleId,
      articleTitle: article.title ?? `게시글 ${articleId}`,
      articleUrl,
      images,
      ...semester,
    });
    await client.chat.update({
      channel,
      ts,
      text: "변환할 생협 이미지를 골라주세요",
      blocks: [
        ...section([
          `:frame_with_picture: *${semester.year} ${semester.termName} 생협 운영시간*`,
          `이미지 첨부가 *${images.length}개*입니다. 변환할 파일을 골라주세요.`,
          "",
          ...images.slice(0, MAX_CHOICES).map((image, index) => `${index + 1}. ${image.name}`),
        ].join("\n")),
        {
          type: "actions",
          elements: [
            ...images.slice(0, MAX_CHOICES).map((image, index) => ({
              type: "button" as const,
              text: { type: "plain_text" as const, text: shorten(image.name), emoji: true },
              style: index === 0 ? ("primary" as const) : undefined,
              action_id: `coop:detected_start${index === 0 ? "" : `_${index}`}`,
              value: JSON.stringify({ token, fileIndex: index }),
            })),
            {
              type: "button" as const,
              text: { type: "plain_text" as const, text: "아니요", emoji: true },
              action_id: "coop:detected_ignore",
              value: JSON.stringify({ token }),
            },
          ],
        },
      ],
    });
    return;
  }

  await runCoopConversion({
    client,
    channel,
    ts,
    actor,
    image: images[0],
    env,
    ...semester,
  });
}
