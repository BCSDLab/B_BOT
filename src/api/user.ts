import {boltApp} from "../config_old/boltApp";

export const getClientUserList = async () => {
    return await boltApp.client.users.list()!;
}

export const getChannelList = async () => {
    return await boltApp.client.conversations.list()!;
}
