export default defineNitroConfig({
  srcDir: 'src',
  compatibilityDate: '2025-03-01',
  experimental: {
    tasks: true,
  },
  storage: {
    kvStorage: {
      drive: 'fs',
      base: './.data/kv',
    }
  },
  scheduledTasks: {
    "0 9,18 * * *": "crawl:clarity",
  },
});