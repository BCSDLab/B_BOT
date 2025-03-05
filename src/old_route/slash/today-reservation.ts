import express from 'express';
import {boltApp} from '../../config_old/boltApp';

const todayReservationRouter = express.Router();


boltApp.command('/동방', async ({ack, client, respond, command}) => {
    try {
        await ack();

        await respond({
            response_type: 'in_channel',
            text: '현재 동아리방 예약은...'
        });
    } catch (error) {
        respond(`에러 발생: ${error}`);
    }
});

export default todayReservationRouter;
