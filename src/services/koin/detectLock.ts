import type pg from "pg";
import { createPool, query } from "~/helper/adapter/postgres";

/**
 * 감지 알림의 `예`를 한 번만 통과시킨다.
 *
 * 지금까지 이 버튼을 막는 건 `response_url`로 원본 메시지를 갈아끼우는 것뿐이었다.
 * 그건 락이 아니라 경쟁이다. 두 사람이 거의 동시에 누르거나 한 사람이 두 번 누르면
 * 둘 다 통과하고, 변환이 두 번 돌아 **검토 링크와 [반영] 버튼이 둘씩 생긴다.**
 *
 * 반영 락(`jobLock`)은 토큰 단위라 여기서 갈라진 두 건 사이에서는 아무 일도 하지 않는다.
 * 그대로 두면 같은 학기가 두 번 들어가고, 지울 API가 없다.
 *
 * 조건부 INSERT 한 번으로 잡는다. 조회 후 삽입하면 그 사이에 끼어들 수 있다.
 */
const STALE_MINUTES = 30;

let pool: pg.Pool | undefined;
function getPool(): pg.Pool {
  return (pool ??= createPool());
}

let schemaReady: Promise<void> | undefined;

function ensureSchema(): Promise<void> {
  return (schemaReady ??= (async () => {
    await query(
      getPool(),
      `CREATE TABLE IF NOT EXISTS detect_lock (
         scope      TEXT NOT NULL,
         channel_id TEXT NOT NULL,
         article_id BIGINT NOT NULL,
         actor      TEXT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         PRIMARY KEY (scope, channel_id, article_id)
       )`,
    );
  })());
}

export interface DetectLockResult {
  ok: boolean;
  /** 이미 누군가 진행 중일 때, 누구인지. 누른 사람에게만 보여준다. */
  actor?: string;
}

/**
 * `scope`는 도메인 이름(`lecture` · `bus` · `coop`). 같은 게시글이라도 도메인이 다르면
 * 서로 막지 않는다.
 *
 * 30분이 지난 잠금은 빼앗는다. 변환 도중 프로세스가 죽으면 아무도 다시 누를 수 없게
 * 되는데, 그건 막으려던 것보다 나쁘다.
 */
export async function acquireDetectLock(
  scope: string,
  channel: string,
  articleId: number,
  actor: string,
): Promise<DetectLockResult> {
  await ensureSchema();

  const claimed = await query(
    getPool(),
    `INSERT INTO detect_lock (scope, channel_id, article_id, actor)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (scope, channel_id, article_id) DO UPDATE
        SET actor = EXCLUDED.actor, created_at = now()
      WHERE detect_lock.created_at < now() - ($5 || ' minutes')::interval
     RETURNING actor`,
    [scope, channel, articleId, actor, String(STALE_MINUTES)],
  );

  if (claimed.rows.length > 0) {
    return { ok: true };
  }

  const current = await query(
    getPool(),
    `SELECT actor FROM detect_lock
      WHERE scope = $1 AND channel_id = $2 AND article_id = $3`,
    [scope, channel, articleId],
  );
  return { ok: false, actor: current.rows[0]?.actor };
}

/**
 * 변환을 시작하지 못하고 끝난 경우에만 푼다(첨부 없음·조회 실패 등).
 *
 * 변환이 시작된 뒤에는 풀지 않는다. 그때부터는 검토 링크가 이미 있어서, 다시 누르면
 * 같은 게시글로 두 번째 변환이 생긴다. 프로세스가 죽은 경우는 위의 30분이 처리한다.
 */
export async function releaseDetectLock(
  scope: string,
  channel: string,
  articleId: number,
): Promise<void> {
  await query(
    getPool(),
    `DELETE FROM detect_lock WHERE scope = $1 AND channel_id = $2 AND article_id = $3`,
    [scope, channel, articleId],
  );
}
