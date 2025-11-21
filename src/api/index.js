import axios from 'axios';

const API_HOST = import.meta.env.VITE_API_HOST ?? 'http://localhost:8000';
const API_BASE = import.meta.env.VITE_API_BASE ?? `${API_HOST}/api/v1`;

const commonConfig = {
    withCredentials: true,
    xsrfCookieName: 'XSRF-TOKEN',
    xsrfHeaderName: 'X-XSRF-TOKEN',
    headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json'
    }
};

export const http = axios.create({
    baseURL: API_HOST,
    ...commonConfig
});

export const api = axios.create({
    baseURL: API_BASE,
    ...commonConfig
});

let csrfLoaded = false;

export async function ensureCsrf(force = false) {
    if (csrfLoaded && !force) return;
    await http.get('/sanctum/csrf-cookie', { withCredentials: true });
    csrfLoaded = true;
}

function getXsrfFromCookie() {
    if (typeof document === 'undefined') return null;
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

const onReject = (err) => {
    const status = err?.response?.status;

    if (status === 401 && window.location.pathname !== '/auth/login') {
        try {
            window.localStorage.removeItem('me');
        } catch {}
        window.location.href = '/auth/login';
    }

    return Promise.reject(err);
};

http.interceptors.response.use((r) => r, onReject);
api.interceptors.response.use((r) => r, onReject);
