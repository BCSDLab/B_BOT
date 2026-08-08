import type pg from "pg";
import { createPool, query } from "~/helper/adapter/postgres";

export type CoopJobStatus = "PENDING" | "APPLYING" | "APPLIED" | "FAILED" | "CANCELLED";

const CLAIMABLE: CoopJobStatus[] = ["PENDING", "FAILED"];

export interface CoopJob {
  token: string;
  channel_id: string;
  thread_ts: string;
  year: number;
  term: string;
  source_file: string;
  shop_count: number;
  target_env: string;
  semester_id: number | null;
  status: CoopJobStatus;
  actor: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

let pool: pg.Pool | undefined;
function getPool(): pg.Pool {
  return (pool ??= createPool());
}

let schemaReady: Promise<void> | undefined;

export function ensureCoopJobSchema(): Promise<void> {
  return (schemaReady ??= (async () => {
    await query(
      getPool(),
      `CREATE TABLE IF NOT EXISTS coop_update_job (
         token       TEXT PRIMARY KEY,
         channel_id  TEXT NOT NULL,
         thread_ts   TEXT NOT NULL,
         year        INTEGER NOT NULL,
         term        TEXT NOT NULL,
         source_file TEXT NOT NULL,
         shop_count  INTEGER NOT NULL,
         target_env  TEXT NOT NULL,
         semester_id INTEGER,
         status      TEXT NOT NULL DEFAULT 'PENDING',
         actor       TEXT,
         error       TEXT,
         created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
         updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    await query(
      getPool(),
      `CREATE INDEX IF NOT EXISTS coop_update_job_thread_idx
         ON coop_update_job (channel_id, thread_ts)`,
    );
  })());
}

export async function createCoopJob(job: {
  token: string;
  channelId: string;
  threadTs: string;
  year: number;
  term: string;
  sourceFile: string;
  shopCount: number;
  targetEnv: string;
}): Promise<void> {
  await ensureCoopJobSchema();
  await query(
    getPool(),
    `INSERT INTO coop_update_job
       (token, channel_id, thread_ts, year, term, source_file, shop_count, target_env)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (token) DO NOTHING`,
    [
      job.token,
      job.channelId,
      job.threadTs,
      job.year,
      job.term,
      job.sourceFile,
      job.shopCount,
      job.targetEnv,
    ],
  );
}

export interface CoopClaimResult {
  ok: boolean;
  reason?: string;
}

export async function claimCoopJob(token: string, actor: string): Promise<CoopClaimResult> {
  await ensureCoopJobSchema();
  const claimed = await query(
    getPool(),
    `UPDATE coop_update_job
        SET status = 'APPLYING', actor = $2, error = NULL, updated_at = now()
      WHERE token = $1 AND status = ANY($3)
      RETURNING token`,
    [token, actor, CLAIMABLE],
  );
  if (claimed.rows.length > 0) return { ok: true };

  const current = await findCoopJob(token);
  if (!current) {
    return { ok: false, reason: "작업 기록을 찾지 못했습니다. 다시 변환해주세요." };
  }
  return {
    ok: false,
    reason: {
      APPLYING: `<@${current.actor}>님이 반영을 진행 중입니다.`,
      APPLIED: `이미 <@${current.actor}>님이 반영했습니다.`,
      CANCELLED: "취소된 작업입니다. 다시 변환해주세요.",
    }[current.status] ?? `지금은 반영할 수 없습니다 (${current.status}).`,
  };
}

export async function finishCoopJob(
  token: string,
  status: Extract<CoopJobStatus, "APPLIED" | "FAILED">,
  options: { error?: string; semesterId?: number } = {},
): Promise<void> {
  await query(
    getPool(),
    `UPDATE coop_update_job
        SET status = $2,
            error = $3,
            semester_id = COALESCE($4, semester_id),
            updated_at = now()
      WHERE token = $1`,
    [token, status, options.error ?? null, options.semesterId ?? null],
  );
}

export async function cancelCoopJob(token: string, actor: string): Promise<boolean> {
  await ensureCoopJobSchema();
  const result = await query(
    getPool(),
    `UPDATE coop_update_job
        SET status = 'CANCELLED', actor = $2, updated_at = now()
      WHERE token = $1 AND status = ANY($3)
      RETURNING token`,
    [token, actor, CLAIMABLE],
  );
  return result.rows.length > 0;
}

export async function findCoopJob(token: string): Promise<CoopJob | null> {
  await ensureCoopJobSchema();
  const result = await query(
    getPool(),
    `SELECT * FROM coop_update_job WHERE token = $1`,
    [token],
  );
  return result.rows[0] ?? null;
}
