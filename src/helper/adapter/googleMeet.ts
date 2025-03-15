import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import open from "open";
import { type JWTInput, OAuth2Client } from 'google-auth-library';


const SCOPES: string[] = ['https://www.googleapis.com/auth/meetings.space.created'];
const TOKEN_PATH: string = "/home/ubuntu/secret/token.json";

export async function initGoogleMeetClient() {
  const storage = useStorage("kvStorage");
  let token = await storage.get<JWTInput | undefined>("google-auth-token");

  if (!(typeof token === "object") || !token.refresh_token) {
    // DEPRECATED.
    const content: string = await fs.readFile(TOKEN_PATH, {encoding: 'utf8'});
    token = JSON.parse(content);
  }
  const client = new OAuth2Client(token);
  if (client.credentials) {
    await saveToken(client);
  } else {
    const redirectUri = new URL(import.meta.env.GOOGLE_REDIRECT_URI?.[0] ?? 'http://localhost');
    new Promise((resolve, reject) => {
      const server = createServer(async (req, res) => {
        try {
          const url = new URL(req.url!, 'http://localhost:3000');
          if (url.pathname !== redirectUri.pathname) {
            res.end('Invalid callback URL');
            return;
          }
          const searchParams = url.searchParams;
          if (searchParams.has('error')) {
            res.end('Authorization rejected.');
            reject(new Error(searchParams.get('error')!));
            return;
          }
          if (!searchParams.has('code')) {
            res.end('No authentication code provided.');
            reject(new Error('Cannot read authentication code.'));
            return;
          }
  
          const code = searchParams.get('code');
          const {tokens} = await client.getToken({
            code: code!,
            redirect_uri: redirectUri.toString(),
          });
          client.credentials = tokens;
          resolve(client);
          res.end('Authentication successful! Please return to the console.');
        } catch (e) {
          reject(e);
        } finally {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (server as any).destroy();
        }
      });
  
      let listenPort = 0;
  
      server.listen(listenPort, () => {
        const address = server.address();
        if (isAddressInfo(address)) {
          redirectUri.port = String(address.port);
        }
        const scopes = SCOPES;
        // open the browser to the authorize url to start the workflow
        const authorizeUrl = client.generateAuthUrl({
          redirect_uri: redirectUri.toString(),
          access_type: 'offline',
          scope: scopes.join(' '),
        });
        open(authorizeUrl, {wait: false}).then(cp => cp.unref());
      });
      server.close();
    });
  }
  return client;
}

function isAddressInfo(addr: string | AddressInfo | null): addr is AddressInfo {
  return (addr as AddressInfo).port !== undefined;
}

async function saveToken(client: OAuth2Client): Promise<void> {
  const storage = useStorage("kvStorage");
    const token = await storage.get<JWTInput>("google-auth-token");
    const rawPayload = {
      type: 'authorized_user',
      client_id: token.client_id ?? import.meta.env.GOOGLE_CLIENT_ID,
      client_secret: token.client_secret ?? import.meta.env.GOOGLE_CLIENT_SECRET,
      refresh_token: client.credentials.refresh_token,
    }
    await storage.set("google-auth-token", rawPayload);
}