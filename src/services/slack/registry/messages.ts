import { messages as busMessages } from "~/services/slack/features/bus/messages";
import { messages as coopMessages } from "~/services/slack/features/coop/messages";
import { messages as funMessages } from "~/services/slack/features/fun";
import { messages as googleMeetMessages } from "~/services/slack/features/googleMeet";
import { messages as lectureMessages } from "~/services/slack/features/lecture/messages";
import { messages as ragMessages } from "~/services/slack/features/rag";
import type { MessageSetting } from "~/services/slack/types";

/**
 * 메시지 핸들러 등록표. **여기에는 구현을 두지 않는다.**
 *
 * 맞는 핸들러는 전부 이 순서대로 돈다. 순서가 의미를 가진다 — `!수정`은 강의 핸들러가
 * 버스·생협보다 먼저 와야 스레드 주인을 가린다. 순서는 `test/slack/registry.test.ts`가 고정한다.
 */
export const messageFunctionList: MessageSetting[] = [
  ...ragMessages,
  ...funMessages,
  ...googleMeetMessages,
  ...lectureMessages,
  ...coopMessages,
  ...busMessages,
];
