export default defineEventHandler(async (event) => {
  const memeber = await getAllDistinctMembers(event.context.pool);

  return memeber;
})