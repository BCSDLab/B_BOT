import * as fs from 'fs/promises';
import process from 'process';
import express from 'express';
import dotenv from 'dotenv';
import {authenticate} from '@google-cloud/local-auth';
import {auth, OAuth2Client} from 'google-auth-library';
import {SpacesServiceClient} from '@google-apps/meet';
import {boltApp} from '../../config/boltApp';

const meetingRouter = express.Router();
dotenv.config();

const SCOPES: string[] = ['https://www.googleapis.com/auth/meetings.space.created'];

const TOKEN_PATH: string = "/home/ubuntu/secret/token.json";
const CREDENTIALS_PATH: string = "/home/ubuntu/secret/credentials.json";

async function loadSavedCredentialsIfExist(): Promise<OAuth2Client | null> {
    try {
        const content: string = await fs.readFile(TOKEN_PATH, {encoding: 'utf8'});
        const credentials = JSON.parse(content);
        return auth.fromJSON(credentials) as OAuth2Client;
    } catch (err) {
        console.error(err);
        return null;
    }
}

async function saveCredentials(client: OAuth2Client): Promise<void> {
    const content: string = await fs.readFile(CREDENTIALS_PATH, {encoding: 'utf8'});
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload: string = JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}

async function authorize(): Promise<OAuth2Client> {
    let client: OAuth2Client | null = await loadSavedCredentialsIfExist();
    if (client) {
        return client;
    }
    client = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    }) as unknown as OAuth2Client;
    if (client.credentials) {
        await saveCredentials(client);
    }
    return client;
}

async function createSpace(authClient: OAuth2Client) {
    const meetClient = new SpacesServiceClient({
        authClient: authClient as any, // TODO: Remove the need for the cast.
    });
    // Construct request
    const request: any = {
        space: {
            config: {
                accessType: 'OPEN',
            }
        }
    };

    // Run request
    return await meetClient.createSpace(request);
}

boltApp.command('/회의생성', async ({ack, client, command, logger}) => {
    try {
        await ack();
        const response = await authorize().then(createSpace);
        logger.info(response[0].meetingUri, '로그입니다!!!', TOKEN_PATH, '크라단셜', CREDENTIALS_PATH);
        const authorization = await authorize();
        logger.info(authorization.credentials, '토큰입니다~!!');
        await boltApp.client.chat.postMessage({
            channel: command.channel_id,
            text: `회의를 생성하였습니다. ${response[0].meetingUri} 확인해주세요!`,
        })
    } catch (error) {
        logger.info(error, '에러입니다!!!', "process.cwd", process.cwd());
        logger.info(TOKEN_PATH, "토큰패스", CREDENTIALS_PATH, '로그입니다!!!')
        const errorMessage = error instanceof Error ? error.message : '';
        const errorStack = error instanceof Error ? error.stack : '';
        await client.chat.postMessage({
            text: `Error: ${errorMessage}\n${errorStack}`,
            channel: command.user_id,
        })
    }
});

boltApp.message(/^(!회의생성|회의생성!|!회의 생성|회의 생성!)$/, async ({event, client, logger}) => {
    try {
        const response = await authorize().then(createSpace);
        logger.info(response[0].meetingUri, '로그입니다!!!', TOKEN_PATH, '크라단셜', CREDENTIALS_PATH);
        const authorization = await authorize();
        logger.info(authorization.credentials, '토큰입니다~!!');
        await boltApp.client.chat.postMessage({
            ts: event.ts,
            channel: event.channel,
            text: `회의를 생성하였습니다. ${response[0].meetingUri} 확인해주세요!`,
            unfurl_links: true,
        })
    } catch (error) {
        logger.info(error, '에러입니다!!!', "process.cwd", process.cwd());
        logger.info(TOKEN_PATH, "토큰패스", CREDENTIALS_PATH, '로그입니다!!!')
        const errorMessage = error instanceof Error ? error.message : '';
        const errorStack = error instanceof Error ? error.stack : '';
        await client.chat.postMessage({
            text: `Error: ${errorMessage}\n${errorStack}`,
            channel: event.channel,
            ts: event.ts
        })
    }
})

export default meetingRouter;
