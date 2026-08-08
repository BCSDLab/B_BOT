import type { BlockAction } from "@slack/bolt";
import type { KnownBlock, WebClient } from "@slack/web-api";
import { applyCoopTimetable, applyCoopTimetables } from "~/services/coop/adminApi";
import {
  cancelCoopJob,
  claimCoopJob,
  finishCoopJob,
} from "~/services/coop/jobStore";
import { loadCoopReview } from "~/services/coop/reviewStore";
import { getCoopAdminAuth } from "~/services/coop/koinAuth";
import { coopTargetLabel, resolveCoopTargetByEnv } from "~/services/coop/target";

const section = (text: string) => [
  { type: "section" as const, text: { type: "mrkdwn" as const, text } },
];

async function update(
  client: WebClient,
  channel: string,
  ts: string | undefined,
  text: string,
  blocks: KnownBlock[],
) {
  await client.chat.update({ channel, ts, text, blocks });
}

export const COOP_APPLY_ACTION_IDS = ["coop:apply", "coop:cancel"] as const;

export async function handleCoopApplyAction(
  client: WebClient,
  body: BlockAction,
  action: BlockAction["actions"][number],
) {
  if (action.type !== "button" || !body.channel) return;
  const { token } = JSON.parse(action.value ?? "{}") as { token?: string };
  if (!token) return;

  const channel = body.channel.id;
  const ts = body.message?.ts;
  const actor = body.user.id;
  const appliedSemesterIds: number[] = [];

  if (action.action_id === "coop:cancel") {
    if (!(await cancelCoopJob(token, actor))) {
      await client.chat.postEphemeral({
        channel,
        user: actor,
        text: "이미 반영됐거나 진행 중이라 취소할 수 없습니다.",
      });
      return;
    }
    await update(
      client,
      channel,
      ts,
      "생협 반영 취소됨",
      section(`:no_entry_sign: *생협 반영을 취소했습니다.*\n<@${actor}>`),
    );
    return;
  }

  const claim = await claimCoopJob(token, actor);
  if (!claim.ok) {
    await client.chat.postEphemeral({
      channel,
      user: actor,
      text: claim.reason ?? "지금은 반영할 수 없습니다.",
    });
    return;
  }

  try {
    const stored = await loadCoopReview(token);
    if (!stored) {
      await finishCoopJob(token, "FAILED", { error: "검토 링크 만료" });
      await update(client, channel, ts, "생협 검토 링크 만료", section(
        ":x: 생협 검토 링크가 만료됐습니다. 이미지를 다시 변환해주세요.",
      ));
      return;
    }

    const conversions = stored.periods?.map((period) => period.conversion)
      ?? [stored.conversion];
    const blockingCount = conversions.reduce((count, conversion) =>
      count + conversion.issues.filter((issue) => issue.severity === "blocking").length, 0);
    if (blockingCount > 0) {
      throw new Error(`확인이 필요한 항목 ${blockingCount}건을 먼저 수정해주세요.`);
    }
    if (conversions.some(({ semester, fromDate, toDate }) => !semester || !fromDate || !toDate)) {
      throw new Error("학기 이름 또는 운영 기간이 비어 있습니다. 검토 페이지에서 확인해주세요.");
    }

    await update(client, channel, ts, "생협 반영 중", section(
      `:hourglass_flowing_sand: *생협 운영시간 반영 중…* ${stored.meta.shopCount}개\n` +
      `${coopTargetLabel(stored.meta.env)} · 작업자: <@${actor}>`,
    ));

    const resolved = resolveCoopTargetByEnv(stored.meta.env);
    if (!resolved.target) {
      throw new Error(resolved.reason ?? "대상 환경을 찾지 못했습니다.");
    }
    const auth = await getCoopAdminAuth(resolved.target);
    if (stored.periods) {
      await applyCoopTimetables(stored.periods.map((period) => ({
        semester: {
          semester: period.conversion.semester,
          from_date: period.conversion.fromDate,
          to_date: period.conversion.toDate,
        },
        timetable: period.request,
      })), auth, (semesterId) => appliedSemesterIds.push(semesterId));
    } else {
      const { semester, fromDate, toDate } = stored.conversion;
      const semesterId = await applyCoopTimetable({
        semester,
        from_date: fromDate,
        to_date: toDate,
      }, stored.request, auth);
      appliedSemesterIds.push(semesterId);
    }
    await finishCoopJob(token, "APPLIED", stored.periods
      ? { semesterId: appliedSemesterIds[0], semesterIds: appliedSemesterIds }
      : { semesterId: appliedSemesterIds[0] });

    await update(client, channel, ts, "생협 반영 완료", [
      ...section(
        `:white_check_mark: *${stored.meta.year} ${stored.meta.termName} 생협 반영 완료*\n` +
        `${coopTargetLabel(stored.meta.env)} · 매장 *${stored.meta.shopCount}개* · 학기 ID ${appliedSemesterIds.join(", ")}`,
      ),
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `작업자: <@${actor}> · ${stored.meta.sourceFileName}` }],
      },
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류입니다";
    const partial = appliedSemesterIds.length > 0
      ? `\n:warning: 먼저 처리된 학기 ID: ${appliedSemesterIds.join(", ")} · 재시도하면 같은 데이터로 다시 갱신합니다.`
      : "";
    await finishCoopJob(token, "FAILED", {
      error: `${message}${partial}`,
      semesterId: appliedSemesterIds[0],
      semesterIds: appliedSemesterIds,
    });
    await update(client, channel, ts, "생협 반영 실패", [
      ...section(`:x: *생협 반영 실패*\n${message}${partial}`),
      {
        type: "actions",
        elements: [{
          type: "button",
          text: { type: "plain_text", text: "다시 시도", emoji: true },
          action_id: "coop:apply",
          value: JSON.stringify({ token }),
        }],
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `작업자: <@${actor}> · 원인을 해결한 뒤 눌러주세요.` }],
      },
    ]);
  }
}
