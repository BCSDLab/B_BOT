import type { CoopAdminAuth } from "./adminApi";
import type { CoopKoinTarget } from "./target";

interface CoopAdminLoginResponse {
  token: string;
}

export async function getCoopAdminAuth(target: CoopKoinTarget): Promise<CoopAdminAuth> {
  const response = await $fetch<CoopAdminLoginResponse>("admin/user/login", {
    baseURL: target.baseUrl,
    method: "POST",
    body: {
      email: target.email,
      password: target.password,
    },
  });
  if (typeof response.token !== "string" || response.token.length === 0) {
    throw new Error("KOIN 관리자 로그인 응답에 액세스 토큰이 없습니다.");
  }
  return { baseUrl: target.baseUrl, accessToken: response.token };
}
