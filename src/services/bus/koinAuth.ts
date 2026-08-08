import { loginKoinAdmin } from "~/services/koin/adminLogin";
import type { BusKoinTarget } from "./target";

export interface BusAdminAuth {
  baseUrl: string;
  accessToken: string;
}

/**
 * 어드민 API 인증 정보.
 *
 * 토큰은 매번 새로 받는다. 버스 반영은 파일 하나당 한 번이라 캐시할 이유가 없고,
 * 만료된 토큰을 들고 있다 401을 받는 쪽이 더 번거롭다.
 *
 * 어느 코인에 붙을지는 호출자가 정한다 — 채널로 이미 정해져 있다.
 */
export async function getBusAdminAuth(target: BusKoinTarget): Promise<BusAdminAuth> {
  return {
    baseUrl: target.baseUrl,
    accessToken: await loginKoinAdmin({
      baseURL: target.baseUrl,
      email: target.email,
      password: target.password,
    }),
  };
}
