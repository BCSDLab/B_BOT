import axios from "axios";

export const internalApiClient = axios.create({
    baseURL: "https://api.internal.bcsdlab.com",
    headers: {
        'Content-Type': 'application/json',
    },
});

export const koinApiClient = axios.create({
    baseURL: 'https://api.koreatech.in',
    headers: {
        'Content-Type': 'application/json',
    },
});