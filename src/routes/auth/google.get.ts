export default defineEventHandler(async (event) => {
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  // Get the Google Client ID from the env
  authorizationUrl.searchParams.set("client_id", import.meta.env.GOOGLE_CLIENT_ID)
  // Add your own callback URL
  authorizationUrl.searchParams.set("redirect_uri", import.meta.env.GOOGLE_REDIRECT_URI);
  authorizationUrl.searchParams.set("prompt", "consent")
  authorizationUrl.searchParams.set("response_type", "code")
  authorizationUrl.searchParams.set("scope", "https://www.googleapis.com/auth/meetings.space.created email profile")
  authorizationUrl.searchParams.set("access_type", "offline")
  setResponseStatus(event, 302);
  appendHeader(event, "Location", authorizationUrl.toString());
  // Redirect the user to Google Login
  return null;
});