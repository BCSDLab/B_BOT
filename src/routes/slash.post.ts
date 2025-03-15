import { commands } from "~/services/slack/command";
import type { Command } from "~/services/slack/type";

export default defineEventHandler(async (event) => {
  if (!getHeader(event, "content-type").includes("application/x-www-form-urlencoded")) {
    throw createError({
      statusCode: 400,
      statusMessage: "Bad Request",
    });
  }
  const body = await readBody<Command>(event);
  const targetCommand = commands.find((command) => command.command === body.command);

  if (!targetCommand) {
    throw createError({
      statusCode: 400,
      statusMessage: "Bad Request",
    });
  }

  await targetCommand.handler({
    client: event.context.slackWebClient,
    command: body,
    googleClient: event.context.googleClient,
  });
});