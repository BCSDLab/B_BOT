import express from 'express';
import {boltApp} from '../../config_old/boltApp';
import {makeEvent} from '../../config_old/makeEvent';

const DAY_OF_THE_WEEK = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일']

const lectureNoticeRouter = express.Router();
// application/x-www-form-urlencoded 요청을 처리하는 미들웨어
lectureNoticeRouter.use(express.urlencoded({extended: true}));

// application/json 요청을 처리하는 미들웨어
lectureNoticeRouter.use(express.json());

lectureNoticeRouter.post('/', (req, res) => {
    const event = makeEvent(req, res);

    boltApp.processEvent(event);
});

let threadChannelId = '';

/**
 * command - '/'명령을 처리하기 위해 사용
 * ack - 명령 수신확인 메서드, body - 수신한 데이터
 */
boltApp.command('/강의공지', async ({ack, client, command, logger}) => {
    await ack();

    try {
        threadChannelId = command.channel_id;
        // 모달 열기

        const result = await client.views.open({
            trigger_id: command.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'lecture_notice',
                title: {
                    type: 'plain_text',
                    text: '강의 공지내용',
                },
                blocks: [
                    {
                        type: 'input',
                        block_id: 'content',
                        label: {
                            type: 'plain_text',
                            text: '강의 공지 내용',
                        },
                        element: {
                            type: 'plain_text_input',
                            action_id: 'content_input',
                            placeholder: {
                                type: 'plain_text',
                                text: '강의 공지에 대한 내용을 작성해주세요!',
                            },
                            multiline: true,
                        },
                    },
                    {
                        type: 'input',
                        block_id: 'location',
                        label: {
                            type: 'plain_text',
                            text: '강의 장소',
                        },
                        element: {
                            type: 'plain_text_input',
                            action_id: 'location_input',
                            placeholder: {
                                type: 'plain_text',
                                text: '강의 장소는 어디인가요?',
                            },
                        },
                    },
                    {
                        type: 'input',
                        block_id: 'time',
                        label: {
                            type: 'plain_text',
                            text: '강의 시간',
                        },
                        element: {
                            type: 'static_select',
                            action_id: 'time_dropdown',
                            placeholder: {
                                type: 'plain_text',
                                text: '강의 시간은 몇시인가요?',
                            },
                            options: Array.from({length: 24}).map((_, index) => ({
                                text: {
                                    type: 'plain_text',
                                    text: `${index}시`,
                                },
                                value: `${index}시`,
                            })),
                        },
                    },
                    {
                        type: 'input',
                        block_id: 'day',
                        label: {
                            type: 'plain_text',
                            text: '강의 요일',
                        },
                        element: {
                            type: 'static_select',
                            action_id: 'day_dropdown',
                            placeholder: {
                                type: 'plain_text',
                                text: '강의 요일은 언제인가요?',
                            },
                            options: DAY_OF_THE_WEEK.map((element,) => ({
                                text: {
                                    type: 'plain_text',
                                    text: element,
                                },
                                value: element,
                            })),
                        },
                    },
                    {
                        type: 'input',
                        block_id: 'checkbox_block',
                        optional: true,
                        label: {
                            type: 'plain_text',
                            text: '온라인 진행 여부',
                        },
                        element: {
                            type: 'checkboxes',
                            action_id: 'checkbox_input',
                            options: [
                                {
                                    text: {
                                        type: 'plain_text',
                                        text: '온라인',
                                    },
                                    value: 'option',
                                },
                            ],
                        },
                    },
                ],
                submit: {
                    type: 'plain_text',
                    text: 'Submit',
                },
            },
        });

        logger.info(result);
    } catch (error) {
        client.chat.postMessage({
            text: error as string,
            channel: command.channel_id,
        });
    }
});

boltApp.view(
    {callback_id: 'lecture_notice', type: 'view_submission'},
    async ({ack, view, client}) => {
        try {
            await ack();

            // await client.chat.postMessage({
            // 	channel: channels.삐봇요청_채널_ID,
            // 	text: '강의 공지가 등록되었습니다. 곧 공지 올라옵니다.',
            // });
            const content = view['state']['values']['content']['content_input']['value'];
            const location =
                view['state']['values']['location']['location_input']['value'];
            const day = view['state']['values']['day']['day_dropdown']['selected_option'];
            const time = view['state']['values']['time']['time_dropdown']['selected_option'];
            const online =
                view['state']['values']['checkbox_block']['checkbox_input'];

            // 스레드에 멘션
            await client.chat.postMessage({
                channel: threadChannelId,
                text: `*비기너 강의 공지*\n${content}\n*장소*: ${location}\n*요일*: ${day?.text.text}\n*시간*: ${time?.text.text}\n*온라인여부*: ${online ? '온라인' : '오프라인'}\n`,
            });
        } catch (error) {
            client.chat.postMessage({
                text: error as string,
                channel: threadChannelId,
            });
        }
    }
);

export default lectureNoticeRouter;
