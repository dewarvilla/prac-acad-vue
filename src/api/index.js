import axios from 'axios';

const API_HOST = import.meta.env.VITE_API_HOST || 'http://localhost:8000';
const API_BASE = import.meta.env.VITE_API_BASE || `${API_HOST}/api/v1`;

export const http = axios.create({
    baseURL: API_HOST,
    withCredentials: true,
    xsrfCookieName: 'XSRF-TOKEN',
    xsrfHeaderName: 'X-XSRF-TOKEN',
    headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json'
    }
});

export const api = axios.create({
    baseURL: API_BASE,
    withCredentials: true,
    xsrfCookieName: 'XSRF-TOKEN',
    xsrfHeaderName: 'X-XSRF-TOKEN',
    headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json'
    }
});

function getXsrfFromCookie() {
    const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

const attachCsrfHeader = (config) => {
    const token = getXsrfFromCookie();
    if (token) {
        config.headers['X-XSRF-TOKEN'] = token;
    }
    return config;
};

http.interceptors.request.use(attachCsrfHeader);
api.interceptors.request.use(attachCsrfHeader);

export async function ensureCsrf() {
    await http.get('/sanctum/csrf-cookie', { withCredentials: true });
}

const onReject = (err) => {
    if (err?.response?.status === 401 && window.location.pathname !== '/auth/login') {
        window.localStorage.removeItem('me');
        window.location.href = '/auth/login';
    }
    return Promise.reject(err);
};

http.interceptors.response.use((r) => r, onReject);
api.interceptors.response.use((r) => r, onReject);
