import axios from "axios";

const BASE_PATH = process.env.API_PATH!;

export const apiClient = axios.create({
  baseURL: "https://api.internal.bcsdlab.com",
  headers: {
    'Content-Type': 'application/json',
  },
});