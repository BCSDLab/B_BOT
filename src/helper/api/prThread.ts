import BASE_URL from "@/constant/BASE_URL.json";
interface PRThreadInfo {
  pullRequestLink: string;
  reviewers: string[];
  writer: string;
  ts: string;
}

interface GetPRThreadInfoRequest {
  organization: string;
  repository: string;
  pullRequestNumber: number;
}

export const getPRThreadInfo = ({
  organization,
  repository,
  pullRequestNumber,
}: GetPRThreadInfoRequest) => {
  return $fetch('b-bot/pull-request/thread', {
    baseURL: import.meta.
  })
}