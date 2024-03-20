// Assuming the necessary type definitions exist or you are willing to create them.
import * as fs from 'fs/promises';
import * as path from 'path';
import process from 'process';
import express from 'express';
import { authenticate } from '@google-cloud/local-auth';
import { OAuth2Client, auth } from 'google-auth-library';
// This import assumes @google-apps/meet exists and has TypeScript definitions.
// If not, you'd need to provide appropriate types or declarations.
import { SpacesServiceClient } from '@google-apps/meet';
import { boltApp } from '../../config/boltApp';

const meetingRouter = express.Router();

// If modifying these scopes, delete token.json.
const SCOPES: string[] = ['https://www.googleapis.com/auth/meetings.space.created'];

// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH: string = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH: string = path.join(process.cwd(), 'credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist(): Promise<OAuth2Client | null> {
  try {
    const content: string = await fs.readFile(TOKEN_PATH, { encoding: 'utf8' });
    const credentials = JSON.parse(content);
    return auth.fromJSON(credentials) as OAuth2Client;
  } catch (err) {
    console.error(err);
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client: OAuth2Client): Promise<void> {
  const content: string = await fs.readFile(CREDENTIALS_PATH, { encoding: 'utf8' });
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

/**
 * Load or request authorization to call APIs.
 *
 * @return {Promise<OAuth2Client>}
 */
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
/**
 * Creates a new meeting space.
 * @param {OAuth2Client} authClient An authorized OAuth2 client.
 */
async function createSpace(authClient: OAuth2Client) {
  const meetClient = new SpacesServiceClient({ 
    authClient: authClient as any, // TODO: Remove the need for the cast.
  });
  // Construct request
  const request = {
    // Details of the request
  };

  // Run request
  const response = await meetClient.createSpace(request);
  return response;
}

boltApp.command('/회의생성', async ({ack, client, command, logger }) => {
  try {
    await ack();
    const response = await authorize().then(createSpace);
    await boltApp.client.chat.postMessage({
      channel: command.channel_id,
      text: `회의를 생성하였습니다. ${response[0].meetingUri} 확인해주세요!`,
    })
    logger.info(response[0].meetingUri)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '';
    const errorStack = error instanceof Error ? error.stack : '';
    client.chat.postMessage({
      text: `Error: ${errorMessage}\n${errorStack}`,
      channel: command.user_id,
    })
  }
});

export default meetingRouter;