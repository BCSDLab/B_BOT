import { auth } from "google-auth-library";
import { SpacesServiceClient } from "@google-apps/meet";

export const GOOGLE_MEET_KEY = "google-meet-refresh-token";

export async function createSpace(refreshToken: string) {
  const meetClient = new SpacesServiceClient({
    authClient: auth.fromJSON({
      type: 'authorized_user',
      client_id: import.meta.env.GOOGLE_CLIENT_ID,
      client_secret: import.meta.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
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
async function removeSpace(refreshToken: string, name: string) {
  const meetClient = new SpacesServiceClient({
    authClient: auth.fromJSON({
      type: 'authorized_user',
      client_id: import.meta.env.GOOGLE_CLIENT_ID,
      client_secret: import.meta.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });
  // Construct request
  const request: any = {
    name,
  };

  // Run request
  return await meetClient.endActiveConference(request);
}

interface CreateMeetingParams {
  ts?: string;
}

type Meeting = {
  meeting: string;
  ts: string;
  timestamp: number;
};

export async function createMeeting() {
  const storage = useStorage("kvStorage");
  const meetings = await storage.get<Meeting[] | undefined>("current-meeting");
  const refreshToken = await storage.get<string>(GOOGLE_MEET_KEY);
  const [response] = await createSpace(refreshToken);
  return response;
}

export async function saveMeeting(meeting: Omit<Meeting, "timestamp">) {
  const storage = useStorage("kvStorage");
  const meetings = await storage.get<Meeting[] | undefined>("current-meeting");

  await storage.set<Meeting[]>("current-meeting", [
    ...(meetings ?? []).filter((m) => m.timestamp + 1000 * 60 * 60 * 24 > Date.now()),
    {
      ...meeting,
      timestamp: Date.now(),
    }
  ])
}

interface RemoveMeetingParams {
  ts?: string;
  text: string;
}

const MEET_NAME_REGEX = /{[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}}/g;

export async function removeMeeting({
  text,
}: RemoveMeetingParams) {

  const storage = useStorage("kvStorage");
  const meetings = await storage.get<Meeting[]>("current-meeting");
  const refreshToken = await storage.get<string>(GOOGLE_MEET_KEY);
  const meetName = text.match(MEET_NAME_REGEX);
  if (!meetName) {
    return;
  }
  await removeSpace(refreshToken, meetName[0]);
  const meetingInfo = meetings.find((m) => m.meeting === meetName[0]);
  if (!meetingInfo) {
    return;
  }
  await storage.set<Meeting[]>("current-meeting", meetings.filter((m) => m.meeting !== meetName[0]));
  return meetingInfo
}