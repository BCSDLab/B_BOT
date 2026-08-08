import { createHash, randomUUID } from "node:crypto";
import { getBusAdminAuth } from "./adminAuth";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { BUS_API_TARGETS, busConfig } from "./config";
import type {
  BusConversion,
  BusJob,
  BusRoute,
  BusVersionUpdate,
  JobState,
} from "./types";
import { normalizeTime, stableJson, validateConversion } from "./validation";
import { analyseExcel, analyseXlsx } from "./excelAnalyzer";
import { renderBusReviewHtml } from "./review";
import { convertExcelDeterministically } from "./deterministicConversion";
import { applyBusPatchesToConversions, type BusPatch } from "./patch";
import { sendStatus } from "./slack";
import { saveBusReviewPage } from "./reviewLink";
import type { WebClient } from "@slack/web-api";

const KEYWORDS = ["버스 시간표", "통학버스", "셔틀버스"];
const EXTENSIONS = new Set([".xls", ".xlsx", ".csv"]);
const MAX_BYTES = 20 * 1024 * 1024;
const sha256 = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
const now = () => new Date().toISOString();
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const attachmentExtension = (url: string) =>
  extname(new URL(url).pathname).toLowerCase();

/**
 * `A(B)` → { name: "A", detail: "B" }. 괄호가 없으면 detail은 null.
 * route_name에서 sub_name을, node_info/route_info의 name에서 detail을 뽑는다.
 */
function splitParen(text: string): { name: string; detail: string | null } {
  const match = text.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (match) return { name: match[1].trim(), detail: match[2].trim() };
  return { name: text, detail: null };
}

/**
 * Admin API가 정의한 필드만 남긴다. running_days 같은 검수 전용 필드는 보내지 않는다.
 * route_name과 정류장/회차 이름에서 괄호 안 내용을 분리해 sub_name/detail로 보낸다.
 */
const toAdminRoute = (route: BusRoute) => {
  const { name: routeName, detail: subName } = splitParen(route.route_name);
  return {
    region: route.region,
    route_type: route.route_type,
    route_name: routeName,
    sub_name: subName,
    node_info: route.node_info.map((node) => splitParen(node.name)),
    route_info: route.route_info.map((trip) => ({
      ...splitParen(trip.name),
      arrival_time: trip.arrival_time,
    })),
  };
};

async function all(): Promise<BusJob[]> {
  const path = busConfig().stateDbPath;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
async function withStateLock<T>(operation: () => Promise<T>): Promise<T> {
  const lockPath = `${busConfig().stateDbPath}.lock`;
  await mkdir(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        return await operation();
      } finally {
        await handle.close();
        await unlink(lockPath).catch(() => undefined);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let age: number;
      try {
        age = Date.now() - (await stat(lockPath)).mtimeMs;
      } catch (statError) {
        // Another process may release the lock between open() and stat().
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw statError;
      }
      if (age > 30_000) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error("bus workflow state is busy");
}

async function save(jobs: BusJob[]) {
  const path = busConfig().stateDbPath;
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(jobs, null, 2), "utf8");
  await rename(tmp, path);
}
export async function getJob(id: string) {
  return (await all()).find((j) => j.id === id);
}
async function update(id: string, mutate: (job: BusJob) => void) {
  return withStateLock(async () => {
    const jobs = await all();
    const job = jobs.find((candidate) => candidate.id === id);
    if (!job) throw new Error("job not found");
    mutate(job);
    job.updated_at = now();
    await save(jobs);
    return job;
  });
}
function transition(job: BusJob, state: JobState) {
  job.state = state;
  job.state_version++;
}

export async function registerCandidate(
  input: Omit<
    BusJob,
    "id" | "state" | "state_version" | "created_at" | "updated_at"
  >,
) {
  if (!KEYWORDS.some((word) => input.article_title.includes(word)))
    return undefined;
  if (!EXTENSIONS.has(attachmentExtension(input.attachment_url)))
    return undefined;
  if (!/^[a-f0-9]{64}$/i.test(input.source_hash))
    throw new Error("source_hash must be SHA-256");
  return withStateLock(async () => {
    const jobs = await all();
    const existing = jobs.find(
      (job) =>
        job.domain === "BUS" &&
        job.article_id === input.article_id &&
        job.source_hash === input.source_hash,
    );
    if (existing) return existing;
    const job: BusJob = {
      ...input,
      id: randomUUID(),
      domain: "BUS",
      state: "START_PENDING",
      state_version: 1,
      created_at: now(),
      updated_at: now(),
    };
    jobs.push(job);
    await save(jobs);
    return job;
  });
}

async function attachment(job: BusJob) {
  const attachmentUrl = new URL(job.attachment_url);
  const headers =
    attachmentUrl.hostname === "files.slack.com"
      ? { Authorization: `Bearer ${import.meta.env.SLACK_BOT_TOKEN}` }
      : undefined;
  const response = await fetch(attachmentUrl, { headers });
  if (!response.ok)
    throw new Error(`attachment download failed: ${response.status}`);
  const headerSize = Number(response.headers.get("content-length") ?? 0);
  if (headerSize > MAX_BYTES) throw new Error("attachment exceeds 20MiB");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error("attachment exceeds 20MiB");
  if (sha256(buffer) !== job.source_hash)
    throw new Error("attachment hash mismatch");
  return buffer;
}
async function sourceContext(buffer: Buffer, extension: string) {
  if (extension === ".csv")
    return buffer
      .toString("utf8")
      .split(/\r?\n/)
      .map((line, index) => ({
        row: index + 1,
        cells: line.split(",").map(normalizeTime),
      }));
  // These packages are optional runtime adapters so production can use the parser
  // best suited to its deployment image while the workflow itself stays portable.
  if (extension === ".xlsx") return analyseXlsx(buffer);
  if (extension === ".xls") return analyseExcel(buffer);
  throw new Error("unsupported attachment extension");
}
async function convert(
  context: unknown,
  job: BusJob,
): Promise<BusConversion[]> {
  if (!context || typeof context !== "object" || !("sheets" in context))
    throw new Error("현재 deterministic 변환은 Excel 파일만 지원합니다.");
  const conversions = convertExcelDeterministically(
    context as ReturnType<typeof analyseExcel>,
  ).map(validateConversion);
  if (job.revision_note) {
    for (const conversion of conversions) {
      conversion.warnings.push(
        `검수자 수정 요청: ${job.revision_note} (자동 변경 없이 재검수 필요)`,
      );
    }
  }
  return conversions;
}
function artifactPath(job: BusJob, ...segments: string[]) {
  return join(busConfig().artifactRoot, job.id, ...segments);
}
async function writeArtifacts(job: BusJob, conversions: BusConversion[]) {
  const payloadPath = artifactPath(job, "conversion", "payload.json");
  const reviewPath = artifactPath(job, "review", "index.html");
  await mkdir(dirname(payloadPath), { recursive: true });
  await mkdir(dirname(reviewPath), { recursive: true });
  await writeFile(
    payloadPath,
    JSON.stringify(
      conversions.length === 1 ? conversions[0] : conversions,
      null,
      2,
    ),
  );
  for (const conversion of conversions) {
    const semester = conversion.payloads[0].semester_type.toLowerCase();
    const semesterPath = artifactPath(
      job,
      "conversion",
      semester,
      "payload.json",
    );
    await mkdir(dirname(semesterPath), { recursive: true });
    await writeFile(semesterPath, JSON.stringify(conversion, null, 2));
  }
  const html = renderBusReviewHtml(job.id, conversions);
  await writeFile(reviewPath, html);
  return saveBusReviewPage(html, conversions, job.review_token);
}
export async function runConversion(id: string) {
  const job = await update(id, (j) => {
    if (!["START_PENDING", "REVISION_REQUESTED", "FAILED"].includes(j.state))
      throw new Error("job cannot be converted in its current state");
    transition(j, "CONVERTING");
  });
  try {
    const extension = attachmentExtension(job.attachment_url);
    const context = await sourceContext(await attachment(job), extension);
    const conversions = await convert(context, job);
    const { url, token } = await writeArtifacts(job, conversions);
    return update(id, (j) => {
      j.conversions = conversions;
      j.payload_hash = sha256(
        stableJson(conversions.flatMap((conversion) => conversion.payloads)),
      );
      j.review_url = url;
      j.review_token = token;
      j.error = undefined;
      transition(j, "REVIEW_PENDING");
    });
  } catch (error) {
    await update(id, (j) => {
      j.error = errorMessage(error);
      transition(j, "FAILED");
    });
    throw error;
  }
}
export async function requestRevision(id: string, note?: string) {
  return update(id, (job) => {
    if (job.state === "REVIEW_PENDING") {
      job.revision_note = note?.trim() || undefined;
      transition(job, "REVISION_REQUESTED");
      return;
    }
    if (job.state !== "REVISION_REQUESTED") {
      throw new Error("job is not awaiting revision");
    }
    if (!note?.trim()) throw new Error("revision note is required");
    job.revision_note = note.trim();
  });
}
export async function publish(id: string, payloadHash: string) {
  const config = busConfig();
  const job = await update(id, (current) => {
    if (current.state !== "REVIEW_PENDING")
      throw new Error("job is not awaiting review");
    if (current.payload_hash !== payloadHash || !current.conversions?.length)
      throw new Error("payload hash mismatch");
    transition(current, "PUBLISHING");
  });
  try {
    const { baseUrl, accessToken } = await getBusAdminAuth();
    const base = baseUrl.replace(/\/$/, "");
    for (const p of job.conversions.flatMap(
      (conversion) => conversion.payloads,
    )) {
      const target = BUS_API_TARGETS[p.target];
      const bodyKeys = Object.keys(p.body);
      if (bodyKeys.length !== 1 || bodyKeys[0] !== target.bodyKey)
        throw new Error(`${p.target} Admin API body_key configuration mismatch`);
      const url = new URL(base + target.path);
      url.searchParams.set("semester_type", p.semester_type);
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          [target.bodyKey]: Object.values(p.body)[0].map(toAdminRoute),
        }),
      });
      if (!response.ok) {
        const detail = await response
          .text()
          .then((text) => text.slice(0, 300))
          .catch(() => "");
        throw new Error(
          `${p.target} Admin API failed: ${response.status}${detail ? `\n${detail}` : ""}`,
        );
      }
    }
    const versionSchedules = job.conversions.map((conversion) => {
      const [start] = conversion.version_update.content.split("~");
      const scheduled = new Date(`${start}T00:05:00+09:00`);
      scheduled.setDate(scheduled.getDate() - 1);
      return {
        version_update: conversion.version_update,
        scheduled_at: scheduled.toISOString(),
      };
    });
    return update(id, (j) => {
      j.version_schedules = versionSchedules;
      transition(j, "VERSION_SCHEDULED");
    });
  } catch (error) {
    await update(id, (j) => {
      j.error = errorMessage(error);
      transition(j, "FAILED");
    });
    throw error;
  }
}
/** Updates the current timetable version exclusively through the Admin Version API. */
export async function updateVersionViaAdminApi(
  version: BusVersionUpdate,
): Promise<void> {
  const { baseUrl, accessToken } = await getBusAdminAuth();
  const versionUrl = new URL(
    `/admin/version/${version.type}`,
    baseUrl,
  ).toString();
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  const currentResponse = await fetch(versionUrl, { headers });
  if (!currentResponse.ok)
    throw new Error(`Version Admin API GET failed: ${currentResponse.status}`);
  const current = (await currentResponse.json()) as { version?: unknown };
  if (typeof current.version !== "string" || !current.version)
    throw new Error("Version Admin API GET response does not contain version");

  const updateResponse = await fetch(versionUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      version: current.version,
      title: version.title,
      content: version.content,
    }),
  });
  if (!updateResponse.ok)
    throw new Error(`Version Admin API PUT failed: ${updateResponse.status}`);
}

/** Called by the scheduled worker after the bus timetable Admin APIs succeed. */
export async function runDueVersionUpdates(client?: WebClient) {
  for (const snapshot of await all()) {
    if (snapshot.state !== "VERSION_SCHEDULED") continue;
    for (const schedule of snapshot.version_schedules ?? []) {
      if (schedule.completed_at || new Date(schedule.scheduled_at) > new Date())
        continue;
      try {
        await updateVersionViaAdminApi(schedule.version_update);
        await update(snapshot.id, (job) => {
          const current = job.version_schedules?.find(
            (candidate) =>
              candidate.scheduled_at === schedule.scheduled_at &&
              candidate.version_update.title ===
                schedule.version_update.title &&
              candidate.version_update.content ===
                schedule.version_update.content,
          );
          if (!current) throw new Error("version schedule not found");
          current.completed_at = now();
        });
      } catch (error) {
        await update(snapshot.id, (job) => {
          job.error = errorMessage(error);
          transition(job, "FAILED");
        });
        break;
      }
    }

    const current = await getJob(snapshot.id);
    if (
      current?.state === "VERSION_SCHEDULED" &&
      current.version_schedules?.length &&
      current.version_schedules.every((schedule) => schedule.completed_at)
    ) {
      if (client && current.slack?.channel) {
        await sendStatus(
          client,
          current.slack.channel,
          `버스 시간표와 ${current.version_schedules.length}개 버전 갱신이 모두 완료되었습니다.`,
        );
      }
      await update(current.id, (job) => transition(job, "COMPLETED"));
    }
  }
}

/** Terminal decision for the first Slack approval. A cancelled job cannot be resumed. */
export async function cancelJob(id: string) {
  return update(id, (job) => {
    if (job.state !== "START_PENDING")
      throw new Error("job is no longer awaiting start approval");
    transition(job, "CANCELLED");
  });
}

/** Binds the Slack thread that owns approval/revision messages to a job. */
export async function bindSlackThread(id: string, channel: string, ts: string) {
  return update(id, (job) => {
    job.slack = { channel, ts };
  });
}

/** Finds the job whose approval/revision thread this is. `!수정`의 조회 수단이다. */
export async function findJobByThread(
  channel: string,
  ts: string,
): Promise<BusJob | undefined> {
  return (await all()).find((job) => job.slack?.channel === channel && job.slack?.ts === ts);
}

/**
 * 검수 중 요청한 수정을 파싱된 conversions에 적용한다. 검증·상태 전이·검수 페이지
 * 갱신까지 한 번에, 파일 락 아래에서 처리해 두 번 적용되는 일을 막는다.
 */
export async function applyBusPatches(
  id: string,
  patches: BusPatch[],
  note: string,
  expectedHash: string,
) {
  const updated = await update(id, (job) => {
    if (!["REVIEW_PENDING", "REVISION_REQUESTED"].includes(job.state))
      throw new Error("job is not under review");
    if (job.payload_hash !== expectedHash) throw new Error("payload hash mismatch");
    if (!job.conversions?.length) throw new Error("job has no conversions");
    const next = applyBusPatchesToConversions(job.conversions, patches);
    for (const conversion of next) validateConversion(conversion);
    job.conversions = next;
    job.payload_hash = sha256(
      stableJson(next.flatMap((conversion) => conversion.payloads)),
    );
    job.revision_note = note;
    if (job.state === "REVISION_REQUESTED") transition(job, "REVIEW_PENDING");
  });
  return updateArtifacts(id, updated.conversions ?? []);
}

/** 검수 페이지와 artifact를 수정 후 상태로 다시 쓴다. 같은 검수 링크가 유지된다. */
async function updateArtifacts(id: string, conversions: BusConversion[]) {
  const job = await getJob(id);
  if (!job) throw new Error("job not found");
  const { url } = await writeArtifacts(job, conversions);
  return update(id, (j) => {
    j.review_url = url;
  });
}
