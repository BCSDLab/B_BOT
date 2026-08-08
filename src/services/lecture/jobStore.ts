import type pg from "pg";
import { createPool, query } from "~/helper/adapter/postgres";

/**
 * 강의 반영 작업의 상태.
 *
 * 반영을 두 번 하면 손으로 지워야 한다(수정·삭제 API가 없다). 그동안 중복 방어를
 * 프로세스 메모리에 두고 있었는데, 배포할 때마다 풀려서 사실상 없는 것과 같았다.
 * DB에 두면 재시작해도 남고, 누가 언제 무엇을 반영했는지도 함께 남는다.
 */
export type JobStatus = "PENDING" | "APPLYING" | "APPLIED" | "FAILED" | "CANCELLED";

/** 반영을 다시 시도할 수 있는 상태. 실패는 원인을 고치고 다시 누를 수 있어야 한다. */
const CLAIMABLE: JobStatus[] = ["PENDING", "FAILED"];

export interface LectureJob {
  token: string;
  channel_id: string;
  thread_ts: string;
  year: number;
  term: string;
  source_file: string;
  lecture_count: number;
  target_env: string | null;
  status: JobStatus;
  actor: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

let pool: pg.Pool | undefined;
function getPool(): pg.Pool {
  return (pool ??= createPool());
}

// 이 레포에는 마이그레이션 도구가 없다. 첫 사용 때 한 번 만들고 넘어간다.
let schemaReady: Promise<void> | undefined;

export function ensureSchema(): Promise<void> {
  return (schemaReady ??= (async () => {
    await query(
      getPool(),
      `CREATE TABLE IF NOT EXISTS lecture_update_job (
         token         TEXT PRIMARY KEY,
         channel_id    TEXT NOT NULL,
         thread_ts     TEXT NOT NULL,
         year          INTEGER NOT NULL,
         term          TEXT NOT NULL,
         source_file   TEXT NOT NULL,
         lecture_count INTEGER NOT NULL,
         status        TEXT NOT NULL DEFAULT 'PENDING',
         actor         TEXT,
         error         TEXT,
         created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
         updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    // 이미 만들어진 테이블에도 붙는다. 어디에 반영했는지는 나중에 꼭 필요해진다.
    await query(
      getPool(),
      `ALTER TABLE lecture_update_job ADD COLUMN IF NOT EXISTS target_env TEXT`,
    );
    await query(
      getPool(),
      `CREATE INDEX IF NOT EXISTS lecture_update_job_thread_idx
         ON lecture_update_job (channel_id, thread_ts)`,
    );
  })());
}

export async function createJob(job: {
  token: string;
  channelId: string;
  threadTs: string;
  year: number;
  term: string;
  sourceFile: string;
  lectureCount: number;
  targetEnv: string;
}): Promise<void> {
  await ensureSchema();
  await query(
    getPool(),
    `INSERT INTO lecture_update_job
       (token, channel_id, thread_ts, year, term, source_file, lecture_count, target_env)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (token) DO NOTHING`,
    [
      job.token,
      job.channelId,
      job.threadTs,
      job.year,
      job.term,
      job.sourceFile,
      job.lectureCount,
      job.targetEnv,
    ],
  );
}

export interface ClaimResult {
  ok: boolean;
  /** 가져가지 못한 이유. 누른 사람에게만 보여준다. */
  reason?: string;
}

/**
 * 반영 권한을 한 명만 갖게 한다.
 *
 * 조회 후 갱신하면 그 사이에 다른 사람이 끼어들 수 있다. 조건부 UPDATE 한 번으로
 * 상태를 바꾸고, 바뀐 행이 없으면 이미 누군가 가져간 것이다.
 */
export async function claimJob(token: string, actor: string): Promise<ClaimResult> {
  await ensureSchema();
  const claimed = await query(
    getPool(),
    `UPDATE lecture_update_job
        SET status = 'APPLYING', actor = $2, error = NULL, updated_at = now()
      WHERE token = $1 AND status = ANY($3)
      RETURNING token`,
    [token, actor, CLAIMABLE],
  );

  if (claimed.rows.length > 0) {
    return { ok: true };
  }

  const current = await findJob(token);
  if (!current) {
    return { ok: false, reason: "작업 기록을 찾지 못했습니다. 다시 변환해주세요." };
  }

  return {
    ok: false,
    reason:
      {
        APPLYING: `<@${current.actor}>님이 반영을 진행 중입니다.`,
        APPLIED: `이미 <@${current.actor}>님이 반영했습니다.`,
        CANCELLED: "취소된 작업입니다. 다시 변환해주세요.",
      }[current.status as string] ?? `지금은 반영할 수 없습니다 (${current.status}).`,
  };
}

export async function finishJob(
  token: string,
  status: Extract<JobStatus, "APPLIED" | "FAILED">,
  error?: string,
): Promise<void> {
  await query(
    getPool(),
    `UPDATE lecture_update_job
        SET status = $2, error = $3, updated_at = now()
      WHERE token = $1`,
    [token, status, error ?? null],
  );
}

/** 취소는 아직 아무도 반영하지 않았을 때만. 진행 중인 걸 가로채지 않는다. */
export async function cancelJob(token: string, actor: string): Promise<boolean> {
  await ensureSchema();
  const result = await query(
    getPool(),
    `UPDATE lecture_update_job
        SET status = 'CANCELLED', actor = $2, updated_at = now()
      WHERE token = $1 AND status = ANY($3)
      RETURNING token`,
    [token, actor, CLAIMABLE],
  );
  return result.rows.length > 0;
}

export async function findJob(token: string): Promise<LectureJob | null> {
  await ensureSchema();
  const result = await query(
    getPool(),
    `SELECT * FROM lecture_update_job WHERE token = $1`,
    [token],
  );
  return result.rows[0] ?? null;
}
