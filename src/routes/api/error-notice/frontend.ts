import express from 'express';
import {boltApp} from '../../../config/boltApp';
import {channels} from '../../../const/channel';

const frontendErrorNoticeRouter = express.Router();

interface RequestBody {
    url: string,
    error: unknown,
}

frontendErrorNoticeRouter.post<any, any, any, RequestBody>('/', async (req, res) => {
    try {
        const {url, error} = req.body;

        let channel = channels.코인_오류_front_end;

        if (url.includes('stage.') || url.includes('localhost')) {
            channel = channels.코인_오류_front_end_stage;
        }

        await boltApp.client.chat.postMessage({
            channel,
            text: ':siren: 클라이언트 에러가 발생했어요 :siren:',
            unfurl_links: true,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `
:rotating_light: 클라이언트 에러가 발생했어요 :rotating_light:

url: \`${url}\`
error: 
\`\`\`${JSON.stringify(error)}\`\`\`
 `,
                    },
                },
            ]
        });

        res.status(200).send('OK');
    } catch (error) {

        res.status(500).send(`Error: ${error}`);
    }
});

export default frontendErrorNoticeRouter;
