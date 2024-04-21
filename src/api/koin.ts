import { koinApiClient } from "../config/apiClient";

export const getKoinShops = () => {
  return koinApiClient.get<{
    count: number;
    shops: Array<{name: string}>;
  }>('/shops');
}