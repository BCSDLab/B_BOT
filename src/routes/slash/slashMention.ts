import express from 'express';
import { boltApp } from '../../config/boltApp';

const slashMentionRouter = express.Router();

//연결 테스트
slashMentionRouter.post('/', (req, res) => {
  res.send({
    message: 'slash mention test',
  })
})

export default slashMentionRouter