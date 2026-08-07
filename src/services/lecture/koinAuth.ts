import { loginKoinAdmin } from "~/services/koin/adminLogin";
import type { KoinAdminAuth } from "./adminApi";

/**
 * 어드민 API 인증 정보.
 *
 * 토큰은 매번 새로 받는다. 강의 반영은 학기당 한 번이라 캐시할 이유가 없고,
 * 만료된 토큰을 들고 있다 401을 받는 쪽이 더 번거롭다.
 */
export async function getKoinAdminAuth(): Promise<KoinAdminAuth> {
  const baseUrl = import.meta.env.KOIN_API_BASE_URL;
  if (!baseUrl) {
    throw new Error("KOIN_API_BASE_URL이 설정되지 않았습니다.");
  }

  return { baseUrl, accessToken: await loginKoinAdmin() };
}
