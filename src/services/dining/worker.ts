import { WebClient } from "@slack/web-api";
import CHANNEL_ID from "@/constant/CHANNEL_ID.json";
import type { KoinEnv } from "~/services/koin/target";
import { deliver } from "./deliver";
import { claimDelivery, DiningApiError, reportDeliveryResult, resolveDiningAuth, type DiningApiAuth } from "./diningApi";
import type { DeliveryJob, DeliveryOutcome } from "./types";

const TARGET: Record<KoinEnv, { channelId?: string; adminUrl?: string }> = {
  stage: {
    channelId: CHANNEL_ID.코인_품절제보알림_stage,
    adminUrl: "https://admin.stage.koreatech.in/sold-out-report",
  },
  prod: {
    channelId: CHANNEL_ID.코인_품절제보알림,
    adminUrl: "https://admin.koreatech.in/sold-out-report",
  },
};

export function envOfChannel(channelId: string): KoinEnv | undefined {
  return (Object.keys(TARGET) as KoinEnv[]).find((env) => TARGET[env].channelId === channelId);
}

const IDLE_MS = 5_000;
const ALERT_AFTER_FAILURES = 6;

export function enabledWorkerEnvs(value: string | undefined): KoinEnv[] {
  const names = (value ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  return (["stage", "prod"] as const).filter((env) => names.includes(env));
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { data?: { error?: string } }).data?.error;
    return code ? `${error.message} (${code})` : error.message;
  }
  return String(error);
}

const wakers = new Map<KoinEnv, () => void>();
const pendingWakes = new Set<KoinEnv>();

export function wakeDiningWorker(env: KoinEnv): void {
  const wake = wakers.get(env);
  if (wake) {
    wake();
  } else {
    pendingWakes.add(env);
  }
}

export function waitForWork(env: KoinEnv, signal: AbortSignal, ms = IDLE_MS): Promise<void> {
  if (pendingWakes.delete(env) || signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      wakers.delete(env);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    wakers.set(env, done);
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function report(job: DeliveryJob, outcome: DeliveryOutcome, auth: DiningApiAuth, env: KoinEnv) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await reportDeliveryResult(job.delivery_id, job.attempt_token, outcome, auth);
      return;
    } catch (error) {
      if (error instanceof DiningApiError) {
        console.error(`[dining:${env}] 결과 통보 거절 delivery=${job.delivery_id} ${outcome}`, describeError(error));
        return;
      }
      if (attempt === 3) {
        console.error(`[dining:${env}] 결과 통보 실패 delivery=${job.delivery_id} ${outcome}`, describeError(error));
        return;
      }
      await sleep(1_000);
    }
  }
}

async function trackFailure(
  job: DeliveryJob,
  outcome: DeliveryOutcome,
  failures: Map<string, number>,
  env: KoinEnv,
  logClient: WebClient,
) {
  if (outcome === "SUCCEEDED") {
    failures.delete(job.delivery_id);
    return;
  }
  const count = (failures.get(job.delivery_id) ?? 0) + 1;
  failures.set(job.delivery_id, count);
  if (count !== ALERT_AFTER_FAILURES) return;

  await logClient.chat.postMessage({
    channel: CHANNEL_ID.삐봇_log,
    text: `:warning: [식단 품절 제보 · ${env}] 제보 #${job.report.report_id} 전송이 ${count}번 연속 실패했습니다. 서버 로그에서 delivery=${job.delivery_id}를 확인해주세요.`,
  }).catch((error: unknown) => console.error(`[dining:${env}] 실패 알림 전송 실패`, describeError(error)));
}

export async function runDiningWorker(env: KoinEnv, signal: AbortSignal): Promise<void> {
  const auth = resolveDiningAuth(env);
  if (!auth) {
    console.warn(`[dining:${env}] 주소나 서비스 토큰이 없어 워커를 시작하지 않습니다.`);
    return;
  }
  const { channelId, adminUrl } = TARGET[env];
  if (!channelId) {
    console.warn(`[dining:${env}] 전송할 채널이 정해지지 않아 워커를 시작하지 않습니다.`);
    return;
  }

  const token = import.meta.env.SLACK_BOT_TOKEN;
  const slack = new WebClient(token, { retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 10_000 });
  const logClient = new WebClient(token);
  const failures = new Map<string, number>();

  console.log(`[dining:${env}] 워커 시작`);
  while (!signal.aborted) {
    let job: DeliveryJob | null;
    try {
      job = await claimDelivery(auth);
    } catch (error) {
      console.error(`[dining:${env}] claim 실패`, describeError(error));
      await sleep(IDLE_MS, signal);
      continue;
    }
    if (!job) {
      await waitForWork(env, signal);
      continue;
    }

    const outcome = await deliver(job, { env, channelId, adminUrl, slack: slack.chat }).catch((error: unknown) => {
      console.error(`[dining:${env}] 전송 실패 report=${job.report.report_id} delivery=${job.delivery_id}`, describeError(error));
      return "FAILED" as const;
    });

    await report(job, outcome, auth, env);
    await trackFailure(job, outcome, failures, env, logClient);
  }
  console.log(`[dining:${env}] 워커 종료`);
}
