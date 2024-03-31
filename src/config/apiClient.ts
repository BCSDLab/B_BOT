import axios from "axios";

const BASE_PATH = process.env.API_PATH!;

export const apiClient = axios.create({
  baseURL: BASE_PATH,
  headers: {
    'Content-Type': 'application/json',
  },
});