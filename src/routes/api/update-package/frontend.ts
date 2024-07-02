import express from 'express';
import {boltApp} from '../../../config/boltApp';
import {channels} from '../../../const/channel';
import {패키지명} from '../../../const/repository';

const frontendUpdatePackageRouter = express.Router();

interface RequestBody {
    pullRequestLink: string,
    pullRequestTitle: string,
    repositoryName: keyof typeof 패키지명;
    version: string;
}

frontendUpdatePackageRouter.post<any, any, any, RequestBody>('/', async (req, res) => {
    try {
        const {pullRequestLink, pullRequestTitle, repositoryName, version} = req.body;
        const packageName = 패키지명[repositoryName];

        if (!packageName) {
            await boltApp.client.chat.postMessage({
                channel: channels.트랙_front_end,
                text: `패키지가 배포되었지만, 패키지 이름을 찾을 수 없어요., ${repositoryName}, ${packageName}, ${pullRequestLink}, ${pullRequestTitle}, ${version}`,
                unfurl_links: true,
            });

            res.status(500).send(`패키지가 배포되었지만, 패키지 이름을 찾을 수 없어요., ${repositoryName}, ${packageName}, ${pullRequestLink}, ${pullRequestTitle}, ${version}`);
        }

        await boltApp.client.chat.postMessage({
            channel: channels.트랙_front_end,
            text: `\`${packageName}\` 패키지가 업데이트됐어요!`,
            unfurl_links: true,
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "plain_text",
                        text: `${packageName} 패키지가 업데이트됐어요!`,
                        emoji: true
                    }
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `
서비스별 확인 후 업데이트 부탁드려요 :meow_cookie:
 • <${pullRequestLink}|${pullRequestTitle}>`
                    },
                },
                {
                    type: "section",
                    text: {
                        type: "plain_text",
                        text: `yarn add ${packageName}@^${version}`,
                        emoji: true
                    }
                }
            ]
        });

        res.status(200).send('OK');
    } catch (error) {

        res.status(500).send(`Error: ${error}`);
    }
});

export default frontendUpdatePackageRouter;
