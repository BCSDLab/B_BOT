interface KoinAdminLoginResponse {
  token: string;
}

/** 환경(스테이지·프로덕션)마다 다른 계정으로 부를 수 있게 인자를 받는다. 없으면 기존대로 env를 쓴다. */
export async function loginKoinAdmin(config?: {
  baseURL: string;
  email: string;
  password: string;
}): Promise<string> {
  const baseURL = config?.baseURL ?? import.meta.env.KOIN_API_BASE_URL;
  const email = config?.email ?? import.meta.env.KOIN_ADMIN_EMAIL;
  const password = config?.password ?? import.meta.env.KOIN_ADMIN_PASSWORD;

  const response = await $fetch<KoinAdminLoginResponse>("admin/user/login", {
    baseURL,
    method: "POST",
    body: {
      email,
      password,
    }
  });

  if (typeof response.token !== "string" || response.token.length === 0) {
    throw new Error("KOIN 관리자 로그인 응답에 액세스 토큰이 없습니다.");
  }

  return response.token;
}
