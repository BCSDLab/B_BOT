import { Auth } from 'googleapis';


const SCOPES: string[] = ['https://www.googleapis.com/auth/meetings.space.created'];
// const TOKEN_PATH: string = "/home/ubuntu/secret/token.json";

// async function loadSavedCredentialsIfExist() {
//   try {
//     const content: string = await fs.readFile(TOKEN_PATH, {encoding: 'utf8'});
//     const credentials = JSON.parse(content);
//     return auth.fromJSON(credentials);
//   } catch (err) {
//     console.error(err);
//     return null;
//   }
// }
// async function saveCredentials(client: OAuth2Client): Promise<void> {
//   const content: string = await fs.readFile(import.meta.env.CREDENTIALS_PATH, { encoding: 'utf8' });
//   const keys = JSON.parse(content);
//   const key = keys.installed || keys.web;
//   const payload: string = JSON.stringify({
//     type: 'authorized_user',
//     client_id: import.meta.env.GOOGLE_CLIENT_ID,
//     client_secret: import.meta.env.GOOGLE_CLIENT_SECRET,
//     refresh_token: client.credentials.refresh_token,
//   });
//   await fs.writeFile(TOKEN_PATH, payload);
// }

// export async function authorize() {
//   let client: any = await loadSavedCredentialsIfExist();
//   if (client) {
//     return client as ReturnType<typeof auth.fromJSON>;
//   }
//     client = await authenticate({
//       scopes: SCOPES,
//       keyfilePath: import.meta.env.CREDENTIALS_PATH,
//     }) as any;
//     if (client.credentials) {
//       console.log(client.credentials);
//       await saveCredentials(client);
//     }
//     return client;
// }

export async function initGoogleMeetClient() {
  const auth = new Auth.GoogleAuth({
    keyFile: import.meta.env.CREDENTIALS_PATH,
    scopes: SCOPES,
  });
  return auth.getClient();
}
