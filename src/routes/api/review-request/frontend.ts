import express from 'express';
import { getClientUserList } from '../../../api/user';
import { boltApp } from '../../../config/boltApp';
import { channels } from '../../../const/channel';

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

    if(!writerMember) throw new Error('작성자를 찾을 수 없습니다!');
    if(mentionList.length === 0) throw new Error('리뷰어를 찾을 수 없습니다!');

    const writerMentionString = `<@${writerMember?.id}>`;
    const mentionString = mentionList.map((member) => `<@${member.id}>`).join(', ');

    boltApp.client.chat.postMessage({
      channel: channels.FE_깃헙_채널_ID,
      text: `리뷰어로 할당되었습니다! :blob-wave:\n
- 리뷰하러 가기 >> [click](<${pullRequestLink}>)\n
- 담당자 : ${writerMentionString}\n
- 리뷰어 : ${mentionString}`,
    });

    res.status(200).send('OK');
  } catch (error) {

    res.status(500).send(`Error: ${error}`);
  }
});

export default frontendReviewMenotionRouter;