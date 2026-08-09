import {
  collectExcelAttachments,
  downloadNoticeFile,
  dropDetected,
  fetchArticle,
  guessSemester,
  loadDetected,
  saveDetected,
} from "~/services/lecture/detected";
import type { AttachmentFile } from "~/services/lecture/detected";
import { createJob } from "~/services/lecture/jobStore";
import { acquireDetectLock, releaseDetectLock } from "~/services/koin/detectLock";
import { labelOf, resolveTarget } from "~/services/koin/target";
import type { KoinEnv } from "~/services/koin/target";
import { buildResultBlocks, convertToReview } from "~/services/lecture/pipeline";
import { linkThread } from "~/services/lecture/reviewStore";
import { notice } from "./notice";
import type { BlockActionSetting } from "./type";

/**
 * 버튼이 달린 원본 메시지를 갈아끼운다.
 *
 * `chat.update`를 쓰지 않는 건 배치가 **웹훅으로** 올린 메시지이기 때문이다.
 * 작성자가 봇 토큰이 아니라 `cant_update_message`로 거절당한다.
 * 버튼 클릭에 딸려 오는 response_url은 그 제약이 없다.
 */
async function replaceOriginal(
  responseUrl: string | undefined,
  text: string,
  blocks: Parameters<typeof updateSlack>[0]["blocks"],
) {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ replace_original: true, text, blocks }),
  });
}

/** 버튼이 너무 많으면 읽히지 않는다. 넘치면 명령어로 직접 올리는 편이 낫다. */
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
  client, channel, ts, actor, env, file, year, term,
}: {
  client: Parameters<BlockActionSetting["handler"]>[0]["client"];
  channel: string;
  ts: string | undefined;
  actor: string;
  env: KoinEnv;
  file: AttachmentFile;
  year: number;
  term: string;
}) {
  const target = { env, year, termName: term, fileName: file.name };

  await updateSlack({
    client, channel, ts,
    text: "변환 중",
    blocks: [{ type: "section", text: { type: "mrkdwn",
      text: `:hourglass_flowing_sand: *${year} ${term}* 변환 중…\n${labelOf(env)} · ${file.name}\n작업자: <@${actor}>` } }],
  });

  try {
    const buffer = await downloadNoticeFile(file.url);
    const outcome = await convertToReview(buffer, target);

    // 이 메시지 스레드에 온 수정 요청이 어느 변환 건인지 찾을 수 있게 해둔다.
    await linkThread(channel, ts ?? "", outcome.token);
    await createJob({
      token: outcome.token,
      channelId: channel,
      threadTs: ts ?? "",
      year,
      term,
      sourceFile: file.name,
      lectureCount: outcome.lectureCount,
      targetEnv: env,
    });

    await updateSlack({
      client, channel, ts,
      text: `${year} ${term} 변환 완료 · ${outcome.lectureCount}건`,
      blocks: buildResultBlocks(outcome, target, actor),
    });
  } catch (error) {
    await updateSlack({
      client, channel, ts,
      text: "변환 실패",
      blocks: [
        { type: "section", text: { type: "mrkdwn",
          text: `:x: *변환 실패*\n${error instanceof Error ? error.message : "알 수 없는 오류입니다"}` } },
        { type: "context", elements: [{ type: "mrkdwn",
          text: `${file.name} · 작업자: <@${actor}>` }] },
      ],
    });
  }
}

/** 배치가 올린 감지 알림에서 시작하는 흐름. */
export const lectureDetectedActions: BlockActionSetting[] = [
  {
    /**
     * 배치가 올린 감지 알림의 `예`.
     *
     * 배치가 아는 건 **이 action_id와 `article_id` 하나**뿐이다. 첨부·학기·경고 문구는
     * 전부 여기서 만든다. 되돌릴 수 없는 작업을 막는 장치가 두 레포로 흩어지면,
     * 한쪽만 고쳤을 때 나머지 한쪽은 옛날 그대로 남는다.
     */
    actionId: "lecture:detected",
    async handler({ client, body, action }) {
      if (action.type !== "button" || !body.channel) return;

      const { article_id: articleId } = JSON.parse(action.value ?? "{}") as {
        article_id?: number;
      };
      const channel = body.channel.id;
      const actor = body.user.id;
      const responseUrl = body.response_url;
      if (!articleId) return;

      // 어느 코인에 반영할지는 채널로 정한다. 배치는 웹훅을 고르는 것으로 이미 답했다.
      const resolved = resolveTarget(channel, "강의");
      if (!resolved.ok || !resolved.target) {
        await replaceOriginal(responseUrl, "대상 아님", notice(`:x: ${resolved.reason}`));
        return;
      }
      const env = resolved.target.env;

      // 버튼을 지우는 것만으로는 두 번 눌리는 걸 막지 못한다. 원본을 갈아끼우기 전에
      // 잠근다 — 변환이 두 번 돌면 검토 링크와 [반영] 버튼이 둘씩 생기고,
      // 그 둘은 토큰이 달라 반영 락에도 걸리지 않는다.
      const lock = await acquireDetectLock("lecture", channel, articleId, actor);
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

      // 배치 메시지는 여기서 역할이 끝난다. 이후 갱신은 봇이 올린 메시지에서 한다.
      await replaceOriginal(responseUrl, "진행합니다", notice(
        `:white_check_mark: *강의 업데이트를 진행합니다.* · ${labelOf(env)}\n<@${actor}>`,
      ));

      const posted = await client.chat.postMessage({
        channel,
        text: "게시글 확인 중",
        blocks: notice(`:hourglass_flowing_sand: 게시글을 확인하고 있습니다…`),
      });
      const ts = posted.ts;
      if (!ts) {
        // ts가 없으면 이후 갱신도, 스레드 연결도 할 수 없다. 빈 문자열로 이어가면
        // 다음 변환이 같은 스레드 키를 덮어써서 `!수정`이 엉뚱한 건에 붙는다.
        await releaseDetectLock("lecture", channel, articleId);
        throw new Error("메시지를 올리지 못해 진행할 수 없습니다.");
      }

      const say = (text: string, mrkdwn: string) =>
        updateSlack({ client, channel, ts, text, blocks: notice(mrkdwn) });

      let article: Awaited<ReturnType<typeof fetchArticle>>;
      try {
        article = await fetchArticle(articleId);
      } catch (error) {
        await releaseDetectLock("lecture", channel, articleId);
        await say("게시글 조회 실패",
          `:x: *게시글을 읽지 못했습니다.*\n${error instanceof Error ? error.message : ""}`);
        return;
      }

      const files = collectExcelAttachments(article.attachments);
      if (files.length === 0) {
        await releaseDetectLock("lecture", channel, articleId);
        await say("첨부 없음", [
          ":grey_question: *엑셀 첨부를 찾지 못했습니다.*",
          `<${article.url ?? ""}|${article.title ?? `게시글 ${articleId}`}>`,
          "파일을 직접 올리고 `!강의반영 2026 여름학기`로 실행해주세요.",
        ].join("\n"));
        return;
      }

      // 학기를 모르면 진행하지 않는다. 엉뚱한 학기에 넣으면 되돌릴 수 없다.
      const semester = guessSemester(article.title ?? "");
      if (!semester) {
        await releaseDetectLock("lecture", channel, articleId);
        await say("학기를 지정해주세요", [
          ":grey_question: *제목에서 학기를 읽지 못했습니다.*",
          "엑셀을 내려받아 `!강의반영 2026 여름학기`처럼 직접 올려주세요.",
          ...files.map((file) => `<${file.url}|${file.name}>`),
        ].join("\n"));
        return;
      }

      // 엑셀이 여럿이면 사람이 고른다. 편람 외에 폐강강좌·시간표가 함께 붙는다.
      if (files.length > 1) {
        const token = await saveDetected({
          target: env,
          articleId,
          articleTitle: article.title ?? `게시글 ${articleId}`,
          articleUrl: article.url ?? "",
          files,
          ...semester,
        });

        await updateSlack({
          client, channel, ts,
          text: "변환할 파일을 골라주세요",
          blocks: [
            ...notice([
              `:page_facing_up: *${semester.year} ${semester.term}* · ${labelOf(env)}`,
              `엑셀 첨부가 *${files.length}개* 입니다. 변환할 파일을 골라주세요.`,
              "",
              ...files.slice(0, MAX_CHOICES).map((file, i) => `${i + 1}. ${file.name}`),
            ].join("\n")),
            { type: "actions", elements: [
              ...files.slice(0, MAX_CHOICES).map((file, index) => ({
                type: "button" as const,
                text: { type: "plain_text" as const, text: shorten(file.name), emoji: true },
                style: index === 0 ? ("primary" as const) : undefined,
                action_id: `lecture:detected_start${index === 0 ? "" : `_${index}`}`,
                value: JSON.stringify({ token, fileIndex: index }),
              })),
              {
                type: "button" as const,
                text: { type: "plain_text" as const, text: "아니요", emoji: true },
                action_id: "lecture:detected_ignore",
                value: JSON.stringify({ token }),
              },
            ] },
          ],
        });
        return;
      }

      await runConversion({
        client, channel, ts, actor,
        env, file: files[0], ...semester,
      });
    },
  },
  // 엑셀이 여럿일 때 고른 파일로 이어간다. 버튼마다 action_id가 달라야 해서 나눠 둔다.
  ...[0, 1, 2, 3].map((slot) => ({
    actionId: slot === 0 ? "lecture:detected_start" : `lecture:detected_start_${slot}`,
    async handler({ client, body, action }: Parameters<BlockActionSetting["handler"]>[0]) {
      if (action.type !== "button" || !body.channel) return;

      const { token, fileIndex = 0 } = JSON.parse(action.value ?? "{}") as {
        token?: string;
        fileIndex?: number;
      };
      const channel = body.channel.id;
      const ts = body.message?.ts;
      const actor = body.user.id;
      if (!token) return;

      const notice = await loadDetected(token);
      const file = notice?.files[fileIndex];
      if (!notice || !file || !notice.year || !notice.term) {
        await updateSlack({
          client, channel, ts,
          text: "만료됨",
          blocks: [{ type: "section", text: { type: "mrkdwn",
            text: ":x: 이미 처리했거나 만료된 알림입니다." } }],
        });
        return;
      }

      // 먼저 지운다. 두 명이 눌러 두 번 변환하면 검토 링크가 둘이 된다.
      await dropDetected(token);

      await runConversion({
        client, channel, ts, actor,
        env: notice.target, file, year: notice.year, term: notice.term,
      });
    },
  })),
  {
    actionId: "lecture:detected_ignore",
    async handler({ client, body, action }) {
      if (action.type !== "button" || !body.channel) return;

      const { token } = JSON.parse(action.value ?? "{}") as { token?: string };
      if (token) {
        await dropDetected(token);
      }

      // 배치가 웹훅으로 올린 메시지일 수 있어 response_url로 바꾼다.
      await replaceOriginal(body.response_url, "무시함",
        notice(`:no_entry_sign: *이 공지는 넘어갑니다.*\n<@${body.user.id}>`));
    },
  },
];
