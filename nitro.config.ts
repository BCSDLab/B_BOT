import path from "node:path";

export default defineNitroConfig({
  srcDir: 'src',
  serveStatic: true,
  compatibilityDate: '2025-03-01',
  experimental: {
    tasks: true,
  },
  alias: {
    // For json import.
    "@/constant": path.resolve(__dirname, "src/constant"),
  },
  storage: {
    kvStorage: {
      driver: 'fs',
      base: './.data/kv',
    }
  },
  scheduledTasks: {
    // "0 9 * * *": "crawl:clarity",
    "0 18 * * *": "sync:github", // 매일 03:00 KST GitHub README 재색인
    "30 18 * * 1": "sync:notion", // 매주 월 03:30 KST Notion 루트 트리 크롤(인수인계 문서)
    "0 19 * * *": "sync:gdrive", // 매일 04:00 KST Google Docs 증분 색인
  },
});