import CHANNEL_ID from "@/constant/CHANNEL_ID.json";

/**
 * 어느 코인에 반영할지는 **명령어를 실행한 채널**로 정한다.
 *
 * 사람이 매번 적게 하면 언젠가 빠뜨리고, 빠뜨렸을 때 기본값이 무엇이든 절반은 틀린다.
 * 채널은 이미 나뉘어 있으니 그걸 쓴다.
 *
 * 등록되지 않은 채널에서는 아무것도 하지 않는다. **기본값을 두지 않는 게 핵심이다** —
 * 어느 쪽인지 모르면 진행하지 않는다. 프로덕션은 되돌릴 API가 없다.
 */
export type KoinEnv = "stage" | "prod";

export interface KoinTarget {
  env: KoinEnv;
  /** 사람에게 보여줄 이름. 메시지·검토 페이지에 그대로 쓴다. */
  label: string;
  baseUrl: string;
  email: string;
  password: string;
}

const CHANNEL_ENV: Record<string, KoinEnv> = {
  [CHANNEL_ID.코인_이벤트알림_stage]: "stage",
  [CHANNEL_ID.코인_이벤트알림]: "prod",
};

const LABEL: Record<KoinEnv, string> = { stage: "스테이지", prod: "프로덕션" };

/**
 * 환경별 계정이 없으면 공용 계정으로 떨어진다.
 * 스테이지와 프로덕션이 같은 어드민 계정을 쓰는 경우가 있어서다.
 */
function credentials(env: KoinEnv) {
  const prefix = env === "prod" ? "KOIN_PROD" : "KOIN_STAGE";
  const env_ = import.meta.env as unknown as Record<string, string | undefined>;
  const pick = (key: string) => env_[`${prefix}_${key}`] ?? env_[`KOIN_${key}`];

  return {
    baseUrl: pick("API_BASE_URL"),
    email: pick("ADMIN_EMAIL"),
    password: pick("ADMIN_PASSWORD"),
  };
}

export interface ResolveResult {
  ok: boolean;
  target?: KoinTarget;
  /** 거절 사유. 사람에게 그대로 보여준다. */
  reason?: string;
}

export function resolveTarget(channelId: string): ResolveResult {
  const env = CHANNEL_ENV[channelId];
  if (!env) {
    return {
      ok: false,
      reason: [
        "이 채널은 강의 반영 대상이 아닙니다.",
        `<#${CHANNEL_ID.코인_이벤트알림_stage}> 또는 <#${CHANNEL_ID.코인_이벤트알림}>에서 실행해주세요.`,
      ].join(" "),
    };
  }

  // 설정이 없는 환경을 반쯤 열어두면 엉뚱한 곳에 붙는다.
  return resolveTargetByEnv(env);
}

/** 이미 정해진 환경으로 붙을 때. 변환 시점의 대상이 반영 시점에도 그대로여야 한다. */
export function resolveTargetByEnv(env: KoinEnv): ResolveResult {
  const { baseUrl, email, password } = credentials(env);
  if (!baseUrl || !email || !password) {
    return { ok: false, reason: `${LABEL[env]} 어드민 설정이 서버에 없습니다.` };
  }
  return { ok: true, target: { env, label: LABEL[env], baseUrl, email, password } };
}

export const isProduction = (env: KoinEnv) => env === "prod";
export const labelOf = (env: KoinEnv) => LABEL[env];
