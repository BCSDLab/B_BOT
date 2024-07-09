import express from 'express';
import {boltApp} from '../../../config/boltApp';
import {channels} from '../../../const/channel';
import {postPRThreadInfo} from '../../../api/internal';
import {BcsdMember, getAllMembers} from "../../../utils/member";

const backendReviewMentionRouter = express.Router();

interface RequestBody {
    pullRequestLink: string,
    reviewers: string[],
    writer: string
}

// github action 상에서 랜덤 리뷰어가 지정되어 API로 내려온다.
backendReviewMentionRouter.post<any, any, any, RequestBody>('/', async (req, res) => {
    try {
        const {pullRequestLink, reviewers, writer} = req.body;

        const userList: BcsdMember[] = await getAllMembers();
        const mentionList = userList.filter((member) => reviewers.some((reviewer) => member.name == reviewer && member.track_name === "BackEnd"));
        const writerMember = userList.find((member) => member.name === writer);

        if (mentionList.length === 0) {
            throw new Error('리뷰어를 찾을 수 없습니다!');
        }

        const writerMentionString = writerMember ? `<@${writerMember.slack_id}>` : writer;
        const mentionString = mentionList.map((member) => `<@${member.slack_id}>`).join(', ');

        const result = await boltApp.client.chat.postMessage({
            channel: channels.backend_github,
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

        if (result.ts) {
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

export default backendReviewMentionRouter;
