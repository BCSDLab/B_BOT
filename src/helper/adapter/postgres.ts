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
