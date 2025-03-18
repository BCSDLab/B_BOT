import type { Pool } from "mysql2/promise";
import { query } from "~/helper/adapter/mysql";

export type Track =
  'FrontEnd'
  | 'BackEnd'
  | 'Android'
  | 'Design'
  | 'Game'
  | 'iOS'
  | 'PS'
  | 'DevOps'
  | 'Data'
  | 'PM'
  | 'client'
  | 'all';

export type Team = 'Business' | 'Campus' | 'User' | 'TrackLeader' | 'Branding' | 'all';

export type MemberType = 'BEGINNER' | 'REGULAR' | 'MENTOR' | 'all';

export interface BcsdMember {
  name: string;
  slack_id: string;
  team_name: Team;
  track_name: Track;
  member_type: MemberType;
}
export type TrackMember = Omit<BcsdMember, 'team_name'>;
export async function getAllMembers(pool: Pool): Promise<BcsdMember[]> {
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
  return await query(pool, sql).then((result) => result.rows);
}

export async function getAllDistinctMembers(pool: Pool): Promise<TrackMember[]> {
  let members: BcsdMember[] = await getAllMembers(pool);
  const n = new Set<string>();
  let distinctMembers: TrackMember[] = members.map(member => {
    if (!n.has(member.slack_id)) {
      n.add(member.slack_id)
      return {
        name: member.name,
        slack_id: member.slack_id,
        track_name: member.track_name,
        member_type: member.member_type
      };
    }
  }).filter((member): member is TrackMember => member !== undefined);
  return distinctMembers;
}

interface GetMentionTargetMembers {
  pool: Pool;
  team: Team;
  track: Track;
  memberType: MemberType;
}

export async function getMentionTargetMembers({
  pool,
  team,
  track,
  memberType,
}: GetMentionTargetMembers): Promise<string[]> {
  let members: BcsdMember[] = await getAllMembers(pool);


  let tracks: string[] = [];
  if (track === 'client') {
    tracks = ['Android', 'FrontEnd', 'iOS'];
  }

  const setForFilter = new Set<string>();
  const result: string[] = [];
  for (const member of members) {
    if (
      !((team === 'all' || member.team_name === team) &&
        (track === 'all' || (track === 'client' ? tracks.includes(member.track_name) : member.track_name === track)) &&
        (memberType === 'all' || member.member_type === memberType))
    ) {
      continue;
    }
    if (!setForFilter.has(member.slack_id)) {
      setForFilter.add(member.slack_id);
      result.push(`<@${member.slack_id}>`);
    }
  }
  return result;
}