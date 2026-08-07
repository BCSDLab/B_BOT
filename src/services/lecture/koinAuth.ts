import type { KoinAdminAuth } from "./adminApi";

/**
 * 어드민 API 인증 정보.
 *
 * 토큰 발급은 `feat/add-koin-admin-login`의 `loginKoinAdmin()`이 담당한다.
 * 그 브랜치가 머지되면 이 함수 본문만 아래로 바꾸면 된다.
 *
 *   const accessToken = await loginKoinAdmin();
 *   return { baseUrl: import.meta.env.KOIN_API_BASE_URL, accessToken };
 *
 * 그 전까지는 반영 버튼을 눌러도 여기서 막힌다. 인증 없이 요청을 보내
 * 401을 받느니, 무엇이 없어서 안 되는지 그대로 말하는 편이 낫다.
 */
export async function getKoinAdminAuth(): Promise<KoinAdminAuth> {
  throw new Error(
    "어드민 로그인이 아직 연결되지 않았습니다. (feat/add-koin-admin-login 머지 후 사용 가능)",
  );
}
