import express from 'express';
import { boltApp } from '../../config/boltApp';
import { makeEvent } from '../../config/makeEvent';

const slashTestRouter = express.Router();

slashTestRouter.post('/', (req, res) => {
  const event = makeEvent(req, res);
  
  boltApp.processEvent(event);
})

boltApp.command('/test', async ({ client, command }) => {
  client.chat.postMessage({
    channel: command.channel_id,
    text: '테스트 서버 멀쩡함'
  })
})

export default slashTestRouter;