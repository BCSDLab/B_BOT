interface ImportMetaEnv {
  // Vite
  readonly DEV: boolean;

  readonly SLACK_BOT_TOKEN: string;
  readonly SLACK_BOT_SIGNING_SECRET: string;
  readonly SLACK_APP_TOKEN: string;
  readonly CLARITY_TOKEN: string;
  readonly DB_HOST: string;
  readonly DB_PORT: string;
  readonly DB_USER: string;
  readonly DB_PASSWORD: string;
  readonly DB_NAME: string;
  readonly APP_BASE_URL: string;
  readonly GOOGLE_CLIENT_ID: string;
  readonly GOOGLE_CLIENT_SECRET: string;
  readonly GOOGLE_REDIRECT_URI?: string;
  readonly GOOGLE_PROJECT_ID: string;
  readonly CREDENTIALS_PATH: string;
}
interface ImportMeta {
  env: ImportMetaEnv;
}