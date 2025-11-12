import axios from 'axios';

const API_HOST = import.meta.env.VITE_API_HOST;
const API_BASE = import.meta.env.VITE_API_BASE;

export const http = axios.create({
    baseURL: API_HOST,
    withCredentials: true,
    xsrfCookieName: 'XSRF-TOKEN',
    xsrfHeaderName: 'X-XSRF-TOKEN',
    withXSRFToken: true
});

export const api = axios.create({
    baseURL: API_BASE,
    withCredentials: true,
    xsrfCookieName: 'XSRF-TOKEN',
    xsrfHeaderName: 'X-XSRF-TOKEN',
    withXSRFToken: true
});

const onReject = (err) => {
    if (err?.response?.status === 401 && window.location.pathname !== '/auth/login') {
        window.localStorage.removeItem('me');
        window.location.href = '/auth/login';
    }
    return Promise.reject(err);
};
http.interceptors.response.use((r) => r, onReject);
api.interceptors.response.use((r) => r, onReject);
