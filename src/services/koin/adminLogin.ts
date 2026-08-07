interface KoinAdminLoginResponse {
  token: string;
}

export async function loginKoinAdmin(): Promise<string> {
  const baseURL = import.meta.env.KOIN_API_BASE_URL;
  const email = import.meta.env.KOIN_ADMIN_EMAIL;
  const password = import.meta.env.KOIN_ADMIN_PASSWORD;

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
