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
    "0 9,18 * * *": "crawl:clarity",
  },
});