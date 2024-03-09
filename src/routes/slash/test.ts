import express from 'express';
import { boltApp } from '../../config/boltApp';
import { makeEvent } from '../../config/makeEvent';

const slashTestRouter = express.Router();

slashTestRouter.post('/', async (req, res) => {
  
  await boltApp.client.chat.postMessage({
    channel: 'C06JWD4UQJW',
    text: JSON.stringify(req)
  })

  const event = makeEvent(req, res);
  
  boltApp.processEvent(event);

  res.status(200).send();
})

boltApp.event('slash', async (args) => {
  await boltApp.client.chat.postMessage({
    channel: 'C06JWD4UQJW',
    text: '테스트' + JSON.stringify(args)
  })
})

boltApp.command('/test', async (args) => {
  await boltApp.client.chat.postMessage({
    channel: 'C06JWD4UQJW',
    text: '테스트 서버 멀쩡함' + JSON.stringify(args)
  })
})

export default slashTestRouter;