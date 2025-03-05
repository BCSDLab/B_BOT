import {koinApiClient} from "../config_old/apiClient";

export const getKoinShops = () => {
    return koinApiClient.get<{
        count: number;
        shops: Array<{ name: string }>;
    }>('/shops');
}