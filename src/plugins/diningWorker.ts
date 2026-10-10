import { enabledWorkerEnvs, runDiningWorker } from "~/services/dining/worker";

// 로컬에서 운영과 같은 토큰으로 돌면 배포된 삐봇의 작업을 가로채므로 기본값은 꺼짐이다.
export default defineNitroPlugin((nitroApp) => {
  const envs = enabledWorkerEnvs(import.meta.env.DINING_WORKER_ENVS);
  if (envs.length === 0) return;

  const controller = new AbortController();
  nitroApp.hooks.hook("close", () => controller.abort());

  for (const env of envs) {
    runDiningWorker(env, controller.signal).catch((error) => {
      console.error(`[dining:${env}] 워커 중단`, error);
    });
  }
});
