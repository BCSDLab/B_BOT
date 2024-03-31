import { apiClient } from "../config/apiClient";

interface PRThreadInfo {
  pullRequestLink: string, 
  reviewers: string[], 
  writer: string,
  ts: string,
}

export const getPRThreadInfo = ({ pullRequestLink }: { pullRequestLink: string }) => {
  return apiClient.get<Omit<PRThreadInfo, 'pullRequestLink'>>(`/b-bot/pull-request/thread?pullRequestLink=${pullRequestLink}`);
}

export const postPRThreadInfo = ({ pullRequestLink, reviewers, writer, ts }: PRThreadInfo) => {
  return apiClient.post<void>('/b-bot/pull-request/thread', {
    pullRequestLink,
    reviewers,
    writer,
    ts,
  });
}