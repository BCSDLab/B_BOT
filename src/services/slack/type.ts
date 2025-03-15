import type { WebClient } from "@slack/web-api";
import type { SlackShortcut, ViewSubmitAction } from '@slack/bolt';

interface Message {
  channel: string;
  user: string;
  ts: string;
  text: string;
}

interface User {
  id: string;
  name: string;
}

interface ShortcutHandlerParams {
  client: WebClient;
  shortcut: SlackShortcut;
  [key: string]: any;
}

export interface ShortcutSetting {
  key: string;
  handler: (
    args: ShortcutHandlerParams,
  ) => Promise<void>;
}

interface ViewActionHandlerParams {
  client: WebClient;
  action: ViewSubmitAction;
  [key: string]: any;
}

export interface ViewActionSetting {
  actionId: string;
  handler: (
    args: ViewActionHandlerParams,
  ) => Promise<void>;
}

export interface Command {
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  api_app_id: string;
}
interface CommandHandlerParams {
  client: WebClient;
  command: Command;
  [key: string]: any;
}
export interface CommandSetting {
  command: string;
  handler: (
    args: CommandHandlerParams,
  ) => Promise<void>;
}

interface MessageHandlerParams extends Message {
  client: WebClient;
  [key: string]: any;
}

export interface MessageSetting {
  regex: string | RegExp;
  handler: (
    args: MessageHandlerParams,
  ) => Promise<void>;
}

export interface MentionMetadata {
  channel: string;
  thread_ts: string;
  user_id: string;
}
export interface GroupMentionMetadata {
  channel: string;
  thread_ts: string;
  user_id: string;
}
