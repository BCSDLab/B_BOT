import express from 'express';
import { boltApp } from '../../config/boltApp';
import { makeEvent } from '../../config/makeEvent';

const slashTestRouter = express.Router();
slashTestRouter.use(express.urlencoded());

slashTestRouter.post('/', async (req, res) => {
  try {
    await boltApp.client.chat.postMessage({
      channel: 'C06JWD4UQJW',
      text: JSON.stringify(req.body)
    })

    const event = makeEvent(req, res);
    
    boltApp.processEvent(event);

    res.status(200).send();
  } catch (error) {
    res.status(500).send({error, req});
  }
})

boltApp.command('/test', async (args) => {
  await boltApp.client.chat.postMessage({
    channel: 'C06JWD4UQJW',
    text: '테스트 서버 멀쩡함',
  })
})

export default slashTestRouter;