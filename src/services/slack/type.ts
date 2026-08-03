import type { WebClient } from "@slack/web-api";
import type { BlockAction, SlackShortcut, ViewSubmitAction } from '@slack/bolt';

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

interface BlockActionHandlerParams {
  client: WebClient;
  body: BlockAction;
  /** 이번에 눌린 요소 하나. body.actions에 여러 개가 올 수 있어 따로 넘긴다. */
  action: BlockAction["actions"][number];
  [key: string]: any;
}

export interface BlockActionSetting {
  actionId: string;
  handler: (
    args: BlockActionHandlerParams,
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
  channel_id: string;
  thread_ts: string;
  user_id: string;
}
