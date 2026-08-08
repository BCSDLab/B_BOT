interface ImportMetaEnv {
  // Vite
  readonly DEV: boolean;

  readonly SLACK_BOT_TOKEN: string;
  readonly SLACK_BOT_SIGNING_SECRET: string;
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
  readonly ADMIN_NAME: string;
  readonly KOIN_API_BASE_URL: string;
  readonly KOIN_ADMIN_EMAIL: string;
  readonly KOIN_ADMIN_PASSWORD: string;
  readonly KOIN_STAGE_API_BASE_URL?: string;
  readonly KOIN_STAGE_ADMIN_EMAIL?: string;
  readonly KOIN_STAGE_ADMIN_PASSWORD?: string;
  readonly KOIN_PROD_API_BASE_URL?: string;
  readonly KOIN_PROD_ADMIN_EMAIL?: string;
  readonly KOIN_PROD_ADMIN_PASSWORD?: string;
  readonly OLLAMA_BASE_URL?: string;
  readonly OLLAMA_GEN_MODEL?: string;
  readonly ANTHROPIC_API_KEY?: string;
  readonly OPENAI_API_KEY?: string;
  readonly OPENAI_MODEL?: string;
  readonly LECTURE_LLM_PROVIDER?: "openai" | "anthropic";
  readonly NOTION_TOKEN?: string;
  readonly GDRIVE_FOLDER_IDS?: string;
}
interface ImportMeta {
  env: ImportMetaEnv;
}
