import { getPRThreadInfo } from "~/helper/api/prThread";

export default defineEventHandler(async (event) => {
  const data = await getPRThreadInfo("https://github.com/BCSDLab/KOIN_WEB_RECODE/pull/122");

  return {
    message: data,
  };
});