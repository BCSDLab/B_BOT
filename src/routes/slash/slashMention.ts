import express from 'express';
import { boltApp } from '../../config/boltApp';

const slashMentionRouter = express.Router();

boltApp.command('/멘션', async ({ command, ack, respond }) => {
    // Acknowledge command request
    await ack();
  
    await respond(`${command.text}`);
  });


export default slashMentionRouter