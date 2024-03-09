
import express from 'express';
import { boltApp } from '../../config/boltApp';
import { makeEvent } from '../../config/makeEvent';

const lectureNoticeRouter = express.Router();

lectureNoticeRouter.post('/', (req, res) => {
  const event = makeEvent(req, res);
  
  boltApp.processEvent(event);
})

export default lectureNoticeRouter