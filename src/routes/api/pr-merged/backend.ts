import express from 'express';
import {boltApp} from '../../../config/boltApp';
import {channels} from '../../../const/channel';
import {getPRThreadInfo} from '../../../api/internal';
import {getAllMembers} from "../../../utils/member";

const backendPRMergedRouter = express.Router();

interface RequestBody {
    pullRequestLink: string,
}

backendPRMergedRouter.post<any, any, any, RequestBody>('/', async (req, res) => {
    try {
        const {pullRequestLink} = req.body;

        const {data: {reviewers, ts, writer}} = await getPRThreadInfo({pullRequestLink});
        const userList = await getAllMembers()

        const mentionList = userList.filter((member) => reviewers.some((reviewer) => member.name == reviewer && member.track_name === "BackEnd"));
        const writerMember = userList.find((member) => member.name === writer && member.track_name === "BackEnd");

        const writerMentionString = writerMember ? `<@${writerMember.slack_id}>` : writer;
        const mentionString = mentionList.map((member) => `<@${member.slack_id}>`).join(', ');

        await boltApp.client.chat.update({
            ts,
            channel: channels.backend_github,
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

export default backendPRMergedRouter;
