import mysql, {QueryResult} from "mysql2";
import dotenv from "dotenv";

dotenv.config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(<string>process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

export const getConn = async () => {
    return pool.promise().getConnection();
};

export interface ResultSet {
    rows: any,
    fields: any,
}

export const query = async function (query: string, values?: any[]): Promise<ResultSet> {
    let conn = await getConn();
    let [rows, fields] = await conn.query(query, values);
    conn.release();
    return {rows, fields};
}
