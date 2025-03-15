import mysql from "mysql2/promise";

export async function createPool() {
  return mysql.createPool({
    host: import.meta.env.DB_HOST,
    port: Number(<string>import.meta.env.DB_PORT),
    user: import.meta.env.DB_USER,
    password: import.meta.env.DB_PASSWORD,
    database: import.meta.env.DB_NAME
  });
}

export interface ResultSet {
  rows: any;
  fields: any;
}

export async function query (connection: mysql.PoolConnection, query: string, values?: any): Promise<ResultSet> {
    const [rows, fields] = await connection.query(query, values);
    connection.release();
    return {rows, fields};
}
