import {query, ResultSet} from "../../config/mysql";
import {getClientUserList} from "../../api/user";

export interface SyncResult {
    updatedMember: Awaited<ResultSet>[];
    updatedImages: Awaited<ResultSet>[]
}

export const syncMembers = async function (): Promise<SyncResult> {

    let userList = await getClientUserList();
    const updatePromises: Promise<ResultSet> [] = [];
    const updateImagePromises: Promise<ResultSet> [] = [];

    userList.members!.forEach(member => {
        let email = member.profile!.email; // 이메일 추출
        let slackId = member.id; // 슬랙 ID 추출
        const sql = 'UPDATE member SET slack_id = ? WHERE email = ?';
        updatePromises.push(query(sql, [slackId, email]));

        let imageUrl = member.profile!.image_original; // 이메일 추출
        const imageSql = 'UPDATE member SET profile_image_url = ? WHERE slack_id = ?';
        updateImagePromises.push(query(sql, [slackId, slackId]));
    });

    const results = await Promise.all(updatePromises);
    results.reduce((acc: number, result: ResultSet) => {
        return acc + result.rows.affectedRows;
    }, 0);

    const resultsImage = await Promise.all(updateImagePromises);
    resultsImage.reduce((acc: number, result: ResultSet) => {
        return acc + result.rows.affectedRows;
    }, 0);

    return {updatedImages: results, updatedMember: resultsImage}
};
