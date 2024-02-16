import { boltApp } from "../config/boltApp";

export const getClientUserList = async () => {
  const usersList = await boltApp.client.users.list()!;
  return usersList;
}