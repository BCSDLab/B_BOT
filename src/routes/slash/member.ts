import express from 'express';
import {boltApp} from '../../config/boltApp';
import {syncMembers} from "../member/bcsdMember";

const slashMemberRouter = express.Router();

boltApp.command('/사용자동기화', async ({ack, client, respond, command}) => {
    try {
        await ack();
        let resultCount = await syncMembers();
        await client.chat.postMessage({
            channel: command.channel_id,
            text: `${resultCount}명 동기화 완료`,
            thread_ts: command.message_ts
        });
    } catch (error) {
        await respond(`에러 발생: ${error}`);
    }
});

export default slashMemberRouter