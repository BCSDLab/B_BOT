import express from 'express';
import { boltApp } from '../../config/boltApp';
import { makeEvent } from '../../config/makeEvent';

const slashTestRouter = express.Router();

slashTestRouter.post<any, any, {channel_id: string}>('/', async (req, res) => {
  await boltApp.client.chat.postMessage({
    channel: 'C06JWD4UQJW',
    text: JSON.stringify(req.body)
  })
})

boltApp.command('/test', async ({ client, command }) => {
  client.chat.postMessage({
    channel: command.channel_id,
    text: '테스트 서버 멀쩡함'
  })
})

export default slashTestRouter;