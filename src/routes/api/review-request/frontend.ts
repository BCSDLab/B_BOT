import express from 'express';
import { getClientUserList } from '../../../api/user';
import { boltApp } from '../../../config/boltApp';
import { channels } from '../../../const/channel';
import { postPRThreadInfo } from '../../../api/internal';

const frontendReviewMenotionRouter = express.Router();

interface RequestBody { 
  pullRequestLink: string, 
  reviewers: string[], 
  writer: string 
}

frontendReviewMenotionRouter.post<any, any, any, RequestBody>('/', async (req, res) => {
  try {
    const { pullRequestLink, reviewers, writer } = req.body;

    const userList = await getClientUserList();
    const mentionList = userList.members!.filter((member) => reviewers.some((reviewer) => member.profile!.display_name!.startsWith(reviewer)));
    const writerMember = userList.members!.find((member) => member.profile!.display_name!.startsWith(writer));

    if(mentionList.length === 0) throw new Error('리뷰어를 찾을 수 없습니다!');

    const writerMentionString = writerMember ? `<@${writerMember?.id}>` : writer;
    const mentionString = mentionList.map((member) => `<@${member.id}>`).join(', ');

    const result = await boltApp.client.chat.postMessage({
      channel: channels.frontend_github,
      text: '리뷰어가 할당되었습니다! :blob-wave:',
      unfurl_links: true,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `
*리뷰어가 할당되었습니다! :blob-wave:*
 • 리뷰하러 가기 >> <${pullRequestLink}|click>
 • 담당자 : ${writerMentionString}
 • 리뷰어 : ${mentionString}`,
          },
        },
      ]
    });

    if(result.ts) {
      await postPRThreadInfo({
        ts: result.ts,
        pullRequestLink,
        reviewers,
        writer
      })
    } 

    res.status(200).send('OK');
  } catch (error) {

    res.status(500).send(`Error: ${error}`);
  }
});

export default frontendReviewMenotionRouter;