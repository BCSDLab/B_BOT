import type { Pool } from "pg";
import { query } from "~/helper/adapter/postgres";

/** 저장된 스레드가 없으면 null을 반환한다. 같은 PR에 대해 가장 최근 스레드(ts)를 쓴다. */
export async function getPRThreadTs(pool: Pool, pullRequestLink: string): Promise<string | null> {
  const result = await query(
    pool,
    `SELECT ts FROM pr_thread WHERE pr_link = $1 ORDER BY id DESC LIMIT 1`,
    [pullRequestLink],
  );
  return result.rows[0]?.ts ?? null;
}

interface SavePRThreadParams {
  pool: Pool;
  pullRequestLink: string;
  reviewers: string[];
  writer: string;
  ts: string;
}

/** 리뷰어별로 한 행씩 저장한다(기존 마이그레이션 데이터와 동일한 구조). */
export async function savePRThread({ pool, pullRequestLink, reviewers, writer, ts }: SavePRThreadParams) {
  await Promise.all(
    reviewers.map((reviewer) =>
      query(
        pool,
        `INSERT INTO pr_thread (pr_link, ts, reviewer, writer) VALUES ($1, $2, $3, $4)`,
        [pullRequestLink, ts, reviewer, writer],
      ),
    ),
  );
}
