import { loginKoinAdmin } from "~/services/koin/adminLogin";

export interface BusAdminAuth {
  baseUrl: string;
  accessToken: string;
}

/**
 * TODO: Lecture와 공통 로직으로 통합
 */
export async function getBusAdminAuth(): Promise<BusAdminAuth> {
  const baseUrl = import.meta.env.KOIN_API_BASE_URL;
  const email = import.meta.env.KOIN_ADMIN_EMAIL;
  const password = import.meta.env.KOIN_ADMIN_PASSWORD;
  if (!baseUrl || !email || !password) {
    throw new Error("KOIN 관리자 API 자격증명이 설정되지 않았습니다.");
  }

  return {
    baseUrl,
    accessToken: await loginKoinAdmin({ baseURL: baseUrl, email, password }),
  };
}
