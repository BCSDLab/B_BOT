import type { WebClient } from "@slack/web-api";
import type { OAuth2Client } from "google-auth-library";
import type { CommandSetting, MessageSetting } from "../type";

import { SpacesServiceClient } from "@google-apps/meet";

const SCOPES: string[] = ["https://www.googleapis.com/auth/meetings.space.created"];

async function createSpace(authClient: OAuth2Client) {
  const meetClient = new SpacesServiceClient({
    authClient: authClient as any,
  });
  // Construct request
  const request: any = {
    space: {
      config: {
        accessType: "OPEN",
      }
    }
  };

  // Run request
  return await meetClient.createSpace(request);
}
async function removeSpace(authClient: OAuth2Client, name: string) {
  const meetClient = new SpacesServiceClient({
    authClient: authClient as any,
  });
  // Construct request
  const request: any = {
    name,
  };

  // Run request
  return await meetClient.endActiveConference(request);
}

interface CreateMeetingParams {
  client: WebClient;
  googleClient: OAuth2Client;
  ts?: string;
  channel: string;
}

type Meeting = {
  meeting: string;
  ts: string;
  timestamp: number;
};

export async function createMeeting({
  client,
  googleClient,
  ts,
  channel,
}: CreateMeetingParams) {
  const storage = useStorage("kvStorage");
  const meetings = await storage.get<Meeting[]>("current-meeting");
  const [response] = await createSpace(googleClient);
  console.log(response);
  const result = await sendSlackText({
    client,
    threadTs: ts,
    channel,
    text: `회의를 생성하였습니다. ${response.meetingUri} 확인해주세요!`,
    unfurl_links: true,
  });
  const meetingInfo = {
    meeting: response.meetingCode,
    ts: ts //|| result.ts,
  };
  await storage.set<Meeting[]>("current-meeting", [
    ...meetings.filter((m) => m.timestamp + 1000 * 60 * 60 * 24 > Date.now()),
    {
      ...meetingInfo,
      timestamp: Date.now(),
    }
  ])
  return meetingInfo;
}

interface RemoveMeetingParams {
  client: WebClient;
  googleClient: OAuth2Client;
  ts?: string;
  channel: string;
  text: string;
}

const MEET_NAME_REGEX = /{[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}}/g;

async function removeMeeting({
  client,
  googleClient,
  channel,
  text,
}: RemoveMeetingParams) {

  const storage = useStorage("kvStorage");
  const meetings = await storage.get<Meeting[]>("current-meeting");
  const meetName = text.match(MEET_NAME_REGEX);
  if (!meetName) {
    return;
  }
  await removeSpace(googleClient, meetName[0]);
  const meetInfo = meetings.find((m) => m.meeting === meetName[0]);
  if (!meetInfo) {
    return;
  }
  await updateSlack({
    client,
    ts: meetInfo.ts,
    channel,
    text: "회의가 종료되었습니다. 다음에 만나요!",
  });
  await storage.set<Meeting[]>("current-meeting", meetings.filter((m) => m.meeting !== meetName[0]));
}

export const message: MessageSetting[] = [
  {
    regex: /(!회의생성|회의생성!|!회의 생성|회의 생성!|생성!)/,
    async handler({
      client,
      text,
      ts,
      channel,
      googleClient,
    }) {
      await createMeeting({
        client,
        googleClient,
        ts,
        channel,
      });
    }
  },
  {
    regex: /(!회의종료|회의종료!|!회의 종료|회의 종료!|종료!)/,
    async handler({
      client,
      text,
      channel,
      googleClient,
    }) {
      await removeMeeting({
        client,
        googleClient,
        channel,
        text,
      });
    }
  },
];

export const command: CommandSetting[] = [
  {
    command: "/회의생성",
    async handler({
      client,
      command,
      googleClient,
    }) {
      await createMeeting({
        client,
        googleClient,
        channel: command.channel_id,
      });
    },
  },
  {
    command: "/회의종료",
    async handler({
      client,
      command,
      googleClient,
    }) {
      await removeMeeting({
        client,
        googleClient,
        text: command.text,
        channel: command.channel_id,
      });
    }
  },
]