import express from 'express';
import mysql from 'mysql2';
import dotenv from 'dotenv';
import { error } from 'console';

dotenv.config();

const eventRouter = express.Router();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(<string>process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

const getConn = async() => {
  return pool.promise().getConnection();
};

eventRouter.get('/', async (req, res) => {
  const conn = await getConn();
  const query = 'SELECT * FROM jobs';
  let [rows, fields] = await conn.query(query, []);
  conn.release();

  res.send({
    message: rows,
  });
})

eventRouter.post('/', async(req, res) => {
  const conn = await getConn();
  const query = 'INSERT INTO bcsdlab.team (id, is_deleted) VALUES (?, ?)';
  let queryResult = conn.query(query, [5, 0]);
  queryResult.then((result) => {
    res.send({
      message: result
    })
  }).catch((error) => {
    res.send({
      message: error
    })
  })
})

eventRouter.delete('/', async(req, res) => {
  const conn = await getConn();
  const query = 'DELETE FROM bcsdlab.team WHERE id = ?';
  let queryResult = conn.query(query, []);
  queryResult.then((result) => {
    res.send({
      message: result
    })
  }).catch((error) => {
    res.send({
      message: error
    })
  })
})
export default eventRouter;