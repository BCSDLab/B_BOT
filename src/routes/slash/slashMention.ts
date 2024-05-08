import express from 'express';
import {boltApp} from '../../config/boltApp';
import {MemberType, Team, Track} from '../../models/mention';
import {BCSD_ACTIVE_MEMBER_LIST, MEMBER_TYPES_LOWERCASE, TRACK_NAME_MAPPER, TRACKS_LOWERCASE} from '../../const/track';
import {getClientUserList} from '../../api/user';
import {match} from 'ts-pattern';
import findMentionMessage from '../../utils/findMentionMessage';
import {query, ResultSet} from "../../config/mysql";

const slashMentionRouter = express.Router();

const 그룹맨션_callback_id = 'group_mention';

boltApp.shortcut('group_mention', async ({ack, client, context, respond, shortcut, body}) => {
    try {
        await ack();
        if (shortcut.type !== 'message_action') return;

        // 모달 열기
        await client.views.open({
            trigger_id: body.trigger_id,
            view: {
                ...그룹맨션_모달_뷰,
                private_metadata: JSON.stringify({
                    channel_id: shortcut.channel.id,
                    ts: shortcut.message.ts,
                    userId: shortcut.user.id
                })
            },
        });
    } catch (error) {
        respond(`에러 발생: ${error}`);
    }
});

boltApp.command('/멘션', async ({ack, client, respond, command}) => {
    try {
        await ack();

        await client.views.open({
            trigger_id: command.trigger_id,
            view: {
                ...그룹맨션_모달_뷰,
                private_metadata: JSON.stringify({
                    channel_id: command.channel_id,
                    ts: command.message_ts,
                    userId: command.user_id
                }),
            },
        });
    } catch (error) {
        respond(`에러 발생: ${error}`);
    }
});

boltApp.view({callback_id: 그룹맨션_callback_id, type: 'view_submission'}, async ({ack, view, client, respond}) => {
    try {
        await ack();
        const track = view['state']['values']['track']['track_select']['selected_option']?.value as Track;
        const team = view['state']['values']['team']['team_select']['selected_option']?.value as Team;
        const memberType = view['state']['values']['member_type']['member_type_select']['selected_option']?.value as MemberType;

        const {channel_id, ts, userId} = JSON.parse(view['private_metadata']);
        const selectedMember = await getMentionTargetMembers(team, track, memberType);

        if (selectedMember.length > 0) {
            let trackText = `${track === 'all' ? '' : `${track}트랙`} `;
            let teamText = `${team === 'all' ? '' : `${team}팀`} `;
            let memberTypeText = `${memberType === 'all' ? '' : `${memberType.toLowerCase()}`} `;

            await client.chat.postMessage({
                channel: channel_id,
                text: `<@${userId}>님의 ${teamText}${trackText}${memberTypeText}단체멘션!\n${selectedMember.join(', ')}\n확인 부탁드립니다 :dancing_toad:`,
                thread_ts: ts,
            });
        } else {
            await client.chat.postMessage({
                channel: channel_id,
                text: '해당하는 인원이 없습니다.',
                thread_ts: ts,
            });
        }
    } catch (error) {
        await respond(`에러 발생: ${error}`);
    }
});

export interface BcsdMember {
    name: string,
    slack_id: string,
    team_name: Team,
    track_name: Track,
    member_type: MemberType
}

async function getMentionTargetMembers(team: Team, track: Track, memberType: MemberType): Promise<string[]> {
    let sql = `SELECT m.name        AS name,
                       m.slack_id    AS slack_id,
                       t.name        AS team_name,
                       tr.name       AS track_name,
                       m.member_type AS member_type
                FROM member m
                         LEFT JOIN team_map tm ON m.id = tm.member_id
                         LEFT JOIN team t ON tm.team_id = t.id
                         LEFT JOIN track tr ON m.track_id = tr.id
                WHERE m.slack_id IS NOT NULL
                  AND m.is_deleted = 0;`
    let members: BcsdMember[] = await query(sql).then((result) => result.rows);
    let filtered = members.filter((member: BcsdMember) =>
        (team === 'all' || member.team_name === team) &&
        (track === 'all' || member.track_name === track) &&
        (memberType === 'all' || member.member_type === memberType)
    );
    return members.map((member: BcsdMember) => `<@${member.slack_id}>`);
}

const 그룹맨션_모달_뷰 = {
    type: 'modal',
    callback_id: 그룹맨션_callback_id,
    title: {
        type: 'plain_text',
        text: '그룹 멘션',
    },
    blocks: [
        {
            type: 'section',
            block_id: 'track',
            text: {
                type: "mrkdwn",
                text: "어떤 트랙을 멘션할까요?"
            },
            accessory: {
                action_id: "track_select",
                type: "static_select",
                initial_option: {
                    text: {
                        type: "plain_text",
                        text: "전체"
                    },
                    value: "all"
                },
                options: [
                    {
                        text: {
                            type: "plain_text",
                            text: "전체"
                        },
                        value: "all"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "클라이언트"
                        },
                        value: "client"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "FrontEnd"
                        },
                        value: "FrontEnd"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "BackEnd"
                        },
                        value: "BackEnd"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "Android"
                        },
                        value: "Android"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "UI/UX"
                        },
                        value: "UI/UX"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "Game"
                        },
                        value: "Game"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "iOS"
                        },
                        value: "iOS"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "Product Manager"
                        },
                        value: "PM"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "Data Analyst"
                        },
                        value: "Data"
                    }
                ]
            },
        },
        {
            type: 'section',
            block_id: 'team',
            text: {
                type: "mrkdwn",
                text: "어떤 팀을 멘션할까요?"
            },
            accessory: {
                action_id: "team_select",
                type: "static_select",
                initial_option: {
                    text: {
                        type: "plain_text",
                        text: "전체"
                    },
                    value: "all"
                },
                options: [
                    {
                        text: {
                            type: "plain_text",
                            text: "전체"
                        },
                        value: "all"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "Business Team"
                        },
                        value: "Business"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "Campus Team"
                        },
                        value: "Campus"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "User Team"
                        },
                        value: "User"
                    },
                ]
            },
        },
        {
            type: 'section',
            block_id: 'member_type',
            text: {
                type: "mrkdwn",
                text: "비기너, 레귤러, 멘토 중 누굴 멘션할까요?"
            },
            accessory: {
                action_id: "member_type_select",
                type: "static_select",
                initial_option: {
                    text: {
                        type: "plain_text",
                        text: "Regular"
                    },
                    value: "REGULAR"
                },
                options: [
                    {
                        text: {
                            type: "plain_text",
                            text: "전체"
                        },
                        value: "all"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "Mentor"
                        },
                        value: "MENTOR"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "Regular"
                        },
                        value: "REGULAR"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "Beginner"
                        },
                        value: "BEGINNER"
                    },
                ]
            },
        },
    ],
    submit: {
        type: 'plain_text',
        text: 'Submit',
    },
} as any;

export default slashMentionRouter