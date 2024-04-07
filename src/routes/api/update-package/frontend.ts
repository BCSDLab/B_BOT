import express from 'express';
import { boltApp } from '../../../config/boltApp';
import { channels } from '../../../const/channel';
import { 패키지명 } from '../../../const/repository';

const frontendUpdatePackageRouter = express.Router();

interface RequestBody { 
  pullRequestLink: string, 
  pullRequestTitle: string,
  repositoryName: keyof typeof 패키지명;
}

frontendUpdatePackageRouter.post<any, any, any, RequestBody>('/', async (req, res) => {
  try {
    const { pullRequestLink, pullRequestTitle, repositoryName } = req.body;
    const packageName = 패키지명[repositoryName];

    if(!packageName) {
      boltApp.client.chat.postMessage({
        channel: channels.삐봇요청_test,
        text: `패키지가 배포되었지만, 패키지 이름을 찾을 수 없어요., ${repositoryName}, ${packageName}, ${pullRequestLink}, ${pullRequestTitle}`,
        unfurl_links: true,
      });

      res.status(500).send(`패키지가 배포되었지만, 패키지 이름을 찾을 수 없어요., ${repositoryName}, ${packageName}, ${pullRequestLink}, ${pullRequestTitle}`);
    }

    boltApp.client.chat.postMessage({
      channel: channels.삐봇요청_test,
      text: `\`${패키지명}\` 패키지가 업데이트됐어요!`,
      unfurl_links: true,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `
\`${패키지명}\` 패키지가 업데이트됐어요!
각 서비스 확인해서 업데이트 부탁드려요 :meow_cookie:
 • <${pullRequestLink}|${pullRequestTitle}>`
          },
        },
      ]
    });

    res.status(200).send('OK');
  } catch (error) {

    res.status(500).send(`Error: ${error}`);
  }
});

export default frontendUpdatePackageRouter;