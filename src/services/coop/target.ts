import CHANNEL_ID from "@/constant/CHANNEL_ID.json";

export type CoopKoinEnv = "stage" | "prod";

export interface CoopKoinTarget {
  env: CoopKoinEnv;
  label: string;
  baseUrl: string;
  email: string;
  password: string;
}

const CHANNEL_ENV: Record<string, CoopKoinEnv> = {
  [CHANNEL_ID.코인_이벤트알림_stage]: "stage",
  [CHANNEL_ID.코인_이벤트알림]: "prod",
  [CHANNEL_ID.sprint_ai_코인_업무자동화]: "stage",
};

const LABEL: Record<CoopKoinEnv, string> = {
  stage: "스테이지",
  prod: "프로덕션",
};

function credentials(env: CoopKoinEnv) {
  const env_ = import.meta.env as unknown as Record<string, string | undefined>;
  const read = (key: string) => {
    const value = env_[key]?.trim().replace(/\/+$/, "");
    return value === "" ? undefined : value;
  };

  return {
    baseUrl: read(env === "prod" ? "KOIN_PROD_API_BASE_URL" : "KOIN_STAGE_API_BASE_URL"),
    email: read("KOIN_ADMIN_EMAIL"),
    password: read("KOIN_ADMIN_PASSWORD"),
  };
}

export interface CoopResolveResult {
  ok: boolean;
  target?: CoopKoinTarget;
  reason?: string;
}

export function resolveCoopTarget(channelId: string): CoopResolveResult {
  const env = CHANNEL_ENV[channelId];
  if (!env) {
    return {
      ok: false,
      reason: [
        "이 채널은 생협 반영 대상이 아닙니다.",
        `<#${CHANNEL_ID.코인_이벤트알림_stage}> 또는 <#${CHANNEL_ID.코인_이벤트알림}>에서 실행해주세요.`,
      ].join(" "),
    };
  }
  return resolveCoopTargetByEnv(env);
}

export function resolveCoopTargetByEnv(env: CoopKoinEnv): CoopResolveResult {
  const { baseUrl, email, password } = credentials(env);
  if (!baseUrl || !email || !password) {
    return { ok: false, reason: `${LABEL[env]} 생협 어드민 설정이 서버에 없습니다.` };
  }
  return { ok: true, target: { env, label: LABEL[env], baseUrl, email, password } };
}

export const isCoopProduction = (env: CoopKoinEnv) => env === "prod";
export const coopTargetLabel = (env: CoopKoinEnv) => LABEL[env];
