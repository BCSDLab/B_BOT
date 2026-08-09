/** 섹션 블록 한 장. 안내 문구가 대부분이라 매번 적지 않는다. */
export const notice = (mrkdwn: string) => [
  { type: "section" as const, text: { type: "mrkdwn" as const, text: mrkdwn } },
];
