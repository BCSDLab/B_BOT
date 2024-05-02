import express from 'express';
import {boltApp} from '../../config/boltApp';
import {syncMembers} from "../member/bcsdMember";

const slashMemberRouter = express.Router();

boltApp.command('/사용자동기화', async ({ack, client, respond, command}) => {
    try {
        await syncMembers();
    } catch (error) {
        respond(`에러 발생: ${error}`);
    }

    await client.chat.postMessage({
        channel: command.channel_id,
        text: '해당하는 인원이 없습니다.',
        thread_ts: command.message_ts
    });
});

export default slashMemberRouter