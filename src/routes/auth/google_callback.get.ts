import { GOOGLE_MEET_KEY } from "~/services/slack/domain/googleMeet";

interface Token {
  access_token: string;
  refresh_token: string;
}

export default defineEventHandler(async (event) => {
  const code = new URL(event.node.req.url, 'http://localhost').searchParams.get('code')
  if (!code) return event.respondWith(new Response());
  const storage = useStorage("kvStorage");
  const tokenEndpoint = new URL('https://accounts.google.com/o/oauth2/token')
  tokenEndpoint.searchParams.set('code', code)
  tokenEndpoint.searchParams.set('grant_type', 'authorization_code')
  // Get the Google Client ID from the env
  tokenEndpoint.searchParams.set('client_id', import.meta.env.GOOGLE_CLIENT_ID)
  // Get the Google Secret from the env
  tokenEndpoint.searchParams.set('client_secret', import.meta.env.GOOGLE_CLIENT_SECRET)
  // Add your own callback URL
  tokenEndpoint.searchParams.set('redirect_uri', import.meta.env.GOOGLE_REDIRECT_URI);
  const tokenResponse = await $fetch<Token>(tokenEndpoint.origin + tokenEndpoint.pathname, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tokenEndpoint.searchParams.toString(),
  });
  const refreshToken = tokenResponse.refresh_token;

  if (refreshToken) {
    await storage.set(GOOGLE_MEET_KEY, refreshToken);
    return "OK";
  }
  return "Failed";
});