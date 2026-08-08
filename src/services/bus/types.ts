export const BUS_TARGETS = ["commuting", "shuttle"] as const;
export const SEMESTER_TYPES = ["REGULAR", "SEASONAL", "VACATION"] as const;
export const ARRIVAL_MARKERS = [
  "도착",
  "정차",
  "미정차",
  "하차",
  "미하차",
  "승하차",
  "종점",
] as const;

export type BusTarget = (typeof BUS_TARGETS)[number];
export type SemesterType = (typeof SEMESTER_TYPES)[number];
export type ArrivalTime = string | null;
export interface BusRoute {
  region: string;
  route_type: string;
  route_name: string;
  node_info: Array<{ name: string }>;
  route_info: Array<{
    name: string;
    arrival_time: ArrivalTime[];
    running_days?: Array<"MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN">;
  }>;
}
export interface BusPayload {
  target: BusTarget;
  semester_type: SemesterType;
  body: Record<string, BusRoute[]>;
}
export interface BusVersionUpdate {
  type: "shuttle_bus_timetable";
  title: "정규학기" | "계절학기" | "방학기간";
  content: string;
}
export interface BusConversion {
  payloads: BusPayload[];
  version_update: BusVersionUpdate;
  provenance: Record<string, unknown>;
  warnings: unknown[];
}
export type JobState =
  | "START_PENDING"
  | "CONVERTING"
  | "REVIEW_PENDING"
  | "PUBLISHING"
  | "VERSION_SCHEDULED"
  | "COMPLETED"
  | "REVISION_REQUESTED"
  | "FAILED"
  | "CANCELLED";
export interface BusJob {
  id: string;
  domain: "BUS";
  article_id: string;
  article_url: string;
  article_title: string;
  attachment_url: string;
  source_hash: string;
  state: JobState;
  state_version: number;
  payload_hash?: string;
  conversions?: BusConversion[];
  review_url?: string;
  /** 검수 페이지 토큰. 수정 반영 때 같은 링크에 덮어쓰기 위해 남긴다. */
  review_token?: string;
  revision_note?: string;
  version_schedules?: Array<{
    version_update: BusVersionUpdate;
    scheduled_at: string;
    completed_at?: string;
  }>;
  slack?: { channel: string; ts: string };
  error?: string;
  created_at: string;
  updated_at: string;
}
