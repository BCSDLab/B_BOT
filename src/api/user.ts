import {boltApp} from "../config/boltApp";

export const getClientUserList = async () => {
    return await boltApp.client.users.list()!;
}

export const getChannelList = async () => {
    return await boltApp.client.conversations.list()!;
}
