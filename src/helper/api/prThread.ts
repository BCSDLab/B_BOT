import BASE_URL from "@/constant/BASE_URL.json";
interface PRThreadInfo {
  pullRequestLink: string;
}

interface GetPRThreadInfoRequest {
  pullRequestLink: string;
}

export const getPRThreadInfo = async (pullRequestLink :string) => {
  return $fetch<PRThreadInfo>('b-bot/pull-request/thread', {
    baseURL: BASE_URL.INTERAL_BASE_URL,
    method: 'GET',
    query: {
      pullRequestLink,
    }
  });
}

interface PostPRThreadInfoRequest {
  pullRequestLink: string;
  reviewers: string[];
  writer: string;
  ts: string;
}

export const postPRThreadInfo = async ({
  pullRequestLink,
  reviewers,
  writer,
  ts,
}: PostPRThreadInfoRequest) => {
  return $fetch<PRThreadInfo>('b-bot/pull-request/thread', {
    baseURL: BASE_URL.INTERAL_BASE_URL,
    method: 'POST',
    body: {
      pullRequestLink,
      reviewers,
      writer,
      ts,
    }
  });
}