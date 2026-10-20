import pg from "pg";

// 봇 Postgres 연결 풀. 환경변수 DB_* 재사용(값은 봇 Postgres로 교체).
export function createPool(): pg.Pool {
  return new pg.Pool({
    host: import.meta.env.DB_HOST,
    port: Number(import.meta.env.DB_PORT),
    user: import.meta.env.DB_USER,
    password: import.meta.env.DB_PASSWORD,
    database: import.meta.env.DB_NAME,
  });
}

let sharedPool: pg.Pool | undefined;

/** 봇 전체가 함께 쓰는 풀. 모듈마다 풀을 만들면 연결 수만 늘어난다. */
export function getPool(): pg.Pool {
  return (sharedPool ??= createPool());
}

export async function closePool(): Promise<void> {
  await sharedPool?.end();
  sharedPool = undefined;
}

/**
 * 스키마 준비를 처음 한 번만 돌린다. 이 레포엔 마이그레이션 도구가 없어 첫 사용 때 만든다.
 * 실패하면 캐시를 비운다. 실패한 Promise를 들고 있으면 일시적인 DB 오류 한 번으로
 * 재시작 전까지 모든 호출이 막힌다.
 */
export function ensureOnce(setup: () => Promise<void>): () => Promise<void> {
  let ready: Promise<void> | undefined;
  return () =>
    (ready ??= setup().catch((error) => {
      ready = undefined;
      throw error;
    }));
}

export interface ResultSet {
  rows: any;
  fields: any;
}

// 파라미터 바인딩은 $1, $2 ... (pg). values 없으면 정적 쿼리.
export async function query(
  pool: pg.Pool,
  text: string,
  values?: any[],
): Promise<ResultSet> {
  const res = await pool.query(text, values);
  return { rows: res.rows, fields: res.fields };
}
