import {internalApiClient} from "../config_old/apiClient";

interface PRThreadInfo {
    pullRequestLink: string,
    reviewers: string[],
    writer: string,
    ts: string,
}

export const getPRThreadInfo = ({pullRequestLink}: { pullRequestLink: string }) => {
    return internalApiClient.get<Omit<PRThreadInfo, 'pullRequestLink'>>(`/b-bot/pull-request/thread?pullRequestLink=${pullRequestLink}`);
}

export const postPRThreadInfo = ({pullRequestLink, reviewers, writer, ts}: PRThreadInfo) => {
    return internalApiClient.post<void>('/b-bot/pull-request/thread', {
        pullRequestLink,
        reviewers,
        writer,
        ts,
    });
}