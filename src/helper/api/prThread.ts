import type { Pool } from "pg";
import { query } from "~/helper/adapter/postgres";

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
