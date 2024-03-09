import express from 'express';
import { boltApp } from '../../config/boltApp';
import { makeEvent } from '../../config/makeEvent';

const slashTestRouter = express.Router();

slashTestRouter.post('/', async (req, res) => {
  
  await boltApp.client.chat.postMessage({
    channel: 'C06JWD4UQJW',
    text: JSON.stringify(req.body)
  })

  res.status(200).send({ "hi": "hi" });
})

// boltApp.command('/test', async (args) => {
//   await boltApp.client.chat.postMessage({
//     channel: 'C06JWD4UQJW',
//     text: '테스트 서버 멀쩡함' + JSON.stringify(args)
//   })
// })

export default slashTestRouter;