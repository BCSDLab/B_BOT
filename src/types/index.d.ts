interface ImportMetaEnv {
  readonly SLACK_BOT_TOKEN: string;
  readonly SLACK_BOT_SIGNING_SECRET: string;
  readonly SLACK_APP_TOKEN: string;
  readonly DB_HOST: string;
  readonly DB_PORT: string;
  readonly DB_USER: string;
  readonly DB_PASSWORD: string;
  readonly DB_NAME: string;
  readonly NITRO_APP_BASE_URL: string;
}
interface ImportMeta {
  env: ImportMetaEnv;
}