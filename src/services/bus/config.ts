import type { BusTarget } from "./types";

export interface BusConfig {
  stateDbPath: string;
  artifactRoot: string;
}

/**
 * Swagger 스펙으로 고정된 Admin API 경로·body 루트 키.
 * 베이스 URL은 KOIN_API_BASE_URL(getBusAdminAuth)을 사용한다.
 */
export const BUS_API_TARGETS: Record<
  BusTarget,
  { path: string; bodyKey: string }
> = {
  commuting: {
    path: "/admin/bus/commuting/timetable",
    bodyKey: "commuting_bus_timetables",
  },
  shuttle: {
    path: "/admin/bus/shuttle/timetable",
    bodyKey: "shuttle_bus_timetables",
  },
};

function optionalString(value: string | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Runtime-only configuration. Keep every secret in the deployment environment. */
export function busConfig(): BusConfig {
  return {
    stateDbPath:
      optionalString(import.meta.env.BUS_WORKFLOW_STATE_DB_PATH) ??
      ".data/bus-workflow/jobs.json",
    artifactRoot:
      optionalString(import.meta.env.BUS_WORKFLOW_ARTIFACT_ROOT) ??
      ".data/bus-workflow/update-jobs",
  };
}
