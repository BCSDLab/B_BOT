import {query} from "../config/mysql";
import {MemberType, Team, Track} from "../models/mention";

export interface BcsdMember {
    name: string,
    slack_id: string,
    team_name: Team,
    track_name: Track,
    member_type: MemberType
}

export async function getAllMembers(): Promise<BcsdMember[]> {
    let sql = `SELECT
                    m.slack_id AS slack_id,
                    GROUP_CONCAT(DISTINCT m.name ORDER BY m.name) AS names,
                    GROUP_CONCAT(DISTINCT t.name ORDER BY t.name) AS team_names,
                    GROUP_CONCAT(DISTINCT tr.name ORDER BY tr.name) AS track_names,
                    GROUP_CONCAT(DISTINCT m.member_type ORDER BY m.member_type) AS member_types
                FROM
                    member m
                        LEFT JOIN team_map tm ON m.id = tm.member_id
                        LEFT JOIN team t ON tm.team_id = t.id
                        LEFT JOIN track tr ON m.track_id = tr.id
                WHERE
                    m.slack_id IS NOT NULL
                  AND m.is_deleted = 0
                GROUP BY
                    m.slack_id;`
    return await query(sql).then((result) => result.rows);
}

export async function getMentionTargetMembers(team: Team, track: Track, memberType: MemberType): Promise<string[]> {
    let members: BcsdMember[] = await getAllMembers();

    let tracks: string[] = [];
    if (track === 'client') {
        tracks = ['Android', 'FrontEnd', 'iOS'];
    }

    const filtered: BcsdMember[] = members.filter((member) =>
        (team === 'all' || member.team_name === team) &&
        (track === 'all' || (track === 'client' ? tracks.includes(member.track_name) : member.track_name === track)) &&
        (memberType === 'all' || member.member_type === memberType)
    );

    return filtered.map(member => `<@${member.slack_id}>`);
}
