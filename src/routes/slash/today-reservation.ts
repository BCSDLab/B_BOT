import express from 'express';
import { boltApp } from '../../config/boltApp';
import { MemberType, Team, Track } from '../../models/mention';
import { BCSD_ACTIVE_MEMBER_LIST } from '../../const/track';
import { getClientUserList } from '../../api/user';
import { match } from 'ts-pattern';
import { MEMBER_TYPES_LOWERCASE, TRACKS_LOWERCASE, TRACK_NAME_MAPPER} from '../../const/track';
import findMentionMessage from '../../utils/findMentionMessage';

const todayReservationRouter = express.Router();


boltApp.command('/동방', async ({ ack, client, respond, command }) => {
  try {
    await ack();

    // client.chat.postMessage({
    //   channel: channel_id,
    //   text: '현재 동아리방 예약은...',
    //   thread_ts: ts,
    // });

    await respond({
      response_type: 'in_channel',
      text: '현재 동아리방 예약은...'
    });
  } catch (error) {
    respond(`에러 발생: ${error}`);
  }
});

export default todayReservationRouter;