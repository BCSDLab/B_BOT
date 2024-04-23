import express from 'express';
import mysql from 'mysql2';
const eventRouter = express.Router();

const pool = mysql.createPool({
  host: '43.202.254.112',
  port: 3306,
  user: 'testid',
  password: 'test01!',
  database: 'testDB'
});

const getConn = async() => {
  return await pool.getConnection(async (conn) => conn);
};

export default eventRouter;