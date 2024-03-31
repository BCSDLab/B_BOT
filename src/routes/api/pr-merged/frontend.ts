import express from 'express';
import { boltApp } from '../../../config/boltApp';
import { channels } from '../../../const/channel';
import { getPRThreadInfo } from '../../../api/internal';
import { getClientUserList } from '../../../api/user';

const frontendPRMergedRouter = express.Router();

interface RequestBody { 
  pullRequestLink: string, 
}

frontendPRMergedRouter.post<any, any, any, RequestBody>('/', async (req, res) => {
  try {
    const { pullRequestLink } = req.body;

    const { data: { reviewers, ts, writer }} = await getPRThreadInfo({ pullRequestLink });
    const userList = await getClientUserList();
    
    const mentionList = userList.members!.filter((member) => reviewers.some((reviewer) => member.profile!.display_name!.startsWith(reviewer)));
    const writerMember = userList.members!.find((member) => member.profile!.display_name!.startsWith(writer));

    const writerMentionString = writerMember ? `<@${writerMember?.id}>` : writer;
    const mentionString = mentionList.map((member) => `<@${member.id}>`).join(', ');

    boltApp.client.chat.update({
      ts,
      channel: channels.FE_깃헙_채널_ID,
      text: '리뷰어가 할당되었습니다! :blob-wave:',
      unfurl_links: true,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `
*리뷰 완료! 고생하셨습니다~ :raising_hands:*
 • ~리뷰하러 가기 >>~ <${pullRequestLink}|click>
 • 담당자 : ${writerMentionString}
 • 리뷰어 : ${mentionString}`,
          },
        },
      ]
    });

    res.status(200).send('OK');
  } catch (error) {

    res.status(500).send(`Error: ${error}`);
  }
});

export default frontendPRMergedRouter;