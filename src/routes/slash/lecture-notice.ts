
import express from 'express';

const lectureNoticeRouter = express.Router();

lectureNoticeRouter.post('/', (req, res) => {
  res.send({
    message: 'Hello, World!',
  })
})

export default lectureNoticeRouter