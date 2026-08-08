import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Nitro는 import.meta.env를 process.env로 채우지만 vitest는 그렇지 않다.
  // 테스트에서도 같은 코드가 돌게 .env의 이 접두사를 노출한다.
  envPrefix: ["VITE_", "ANTHROPIC_", "OPENAI_", "LECTURE_", "COOP_"],
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
      // nitro.config.ts의 alias와 맞춘다.
      "@/constant": fileURLToPath(new URL("./src/constant", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
