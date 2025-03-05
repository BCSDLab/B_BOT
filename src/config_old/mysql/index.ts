import mysql from "mysql2";

const pool = mysql.createPool({
    host: import.meta.env.DB_HOST,
    port: Number(<string>import.meta.DB_PORT),
    user: import.meta.DB_USER,
    password: import.meta.DB_PASSWORD,
    database: import.meta.DB_NAME
});

const getConn = async () => {
    return pool.promise().getConnection();
};

export interface ResultSet {
    rows: any,
    fields: any,
}

export const query = async function (query: string, values?: any): Promise<ResultSet> {
    let conn = await getConn();
    let [rows, fields] = await conn.query(query, values);
    conn.release();
    return {rows, fields};
}
