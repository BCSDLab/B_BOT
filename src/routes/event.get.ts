import { getPRThreadTs } from "~/helper/api/prThread";

export default defineEventHandler(async (event) => {
  const ts = await getPRThreadTs(event.context.sqlPool, "https://github.com/BCSDLab/KOIN_WEB_RECODE/pull/122");

  return {
    message: ts,
  };
});