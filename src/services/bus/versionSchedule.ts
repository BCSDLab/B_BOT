import type { WebClient } from "@slack/web-api";
import { updateBusVersionViaAdminApi } from "./adminApi";
import {
  findBusJobsWithPendingVersionSchedules,
  setBusVersionSchedules,
  type BusVersionSchedule,
} from "./jobStore";
import { getBusAdminAuth } from "./koinAuth";
import { resolveBusTargetByEnv, type BusKoinEnv } from "./target";
import type { BusConversion } from "./types";

/**
 * 사이트에 노출되는 버전 문구는 적용 전날 00:05(KST)에 바뀌어야 한다. 시간표
 * Admin API PUT은 승인 즉시 나가지만, 이 문구가 미리 바뀌면 아직 오지 않은
 * 학기를 안내하게 되므로 하루 앞당겨 예약해둔다.
 */
export function computeBusVersionSchedules(conversions: BusConversion[]): BusVersionSchedule[] {
  return conversions.map((conversion) => {
    const [start] = conversion.version_update.content.split("~");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start.trim())) {
      throw new Error(
        `version_update.content 형식이 올바르지 않습니다: ${conversion.version_update.content}`,
      );
    }
    const scheduledAt = new Date(
      new Date(`${start.trim()}T00:05:00+09:00`).getTime() - 86_400_000,
    );
    return { version_update: conversion.version_update, scheduled_at: scheduledAt.toISOString() };
  });
}

/**
 * 예약 시각이 지난 버전 갱신을 실제로 반영한다. 5분 간격 크론(`bus:versionUpdate`)이
 * 이 함수를 부른다. 한 작업 안의 스케줄은 순서대로 처리하고, 하나가 실패하면
 * 그 뒤는 다음 주기로 미룬다 — 순서가 뒤바뀌어 반영되면 안 된다.
 */
export async function runDueBusVersionUpdates(client?: WebClient): Promise<void> {
  for (const job of await findBusJobsWithPendingVersionSchedules()) {
    const schedules = job.version_schedules;
    let changed = false;

    for (const schedule of schedules) {
      if (schedule.completed_at) continue;
      if (new Date(schedule.scheduled_at) > new Date()) continue;

      const resolved = resolveBusTargetByEnv(job.target_env as BusKoinEnv);
      if (!resolved.target) break; // 설정이 없으면 다음 주기에 다시 시도한다.

      try {
        const auth = await getBusAdminAuth(resolved.target);
        await updateBusVersionViaAdminApi(schedule.version_update, auth);
        schedule.completed_at = new Date().toISOString();
        changed = true;
      } catch {
        // 이번 주기는 여기서 멈추고 다음 주기에 재시도한다. 뒤 스케줄은 건드리지 않는다.
        break;
      }
    }

    const allDone = schedules.length > 0 && schedules.every((s) => s.completed_at);
    if (allDone) {
      if (client) {
        await client.chat.postMessage({
          channel: job.channel_id,
          thread_ts: job.thread_ts,
          text: `버스 시간표 버전 갱신 ${schedules.length}건이 모두 완료되었습니다.`,
        });
      }
      // 완료됐으면 비워서 다음 주기에 다시 집히지 않게 한다.
      await setBusVersionSchedules(job.token, []);
    } else if (changed) {
      await setBusVersionSchedules(job.token, schedules);
    }
  }
}
