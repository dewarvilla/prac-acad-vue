import axios from 'axios';

const API_HOST = import.meta.env.VITE_API_HOST ?? 'http://localhost:8000';
const API_BASE = import.meta.env.VITE_API_BASE ?? `${API_HOST}/api/v1`;

const commonConfig = {
    withCredentials: false,
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

const attachBearer = (config) => {
    try {
        const token = window.localStorage.getItem('token');
        if (token) config.headers.Authorization = `Bearer ${token}`;
    } catch {}
    return config;
};

http.interceptors.request.use(attachBearer);
api.interceptors.request.use(attachBearer);

// ====== 401 handler ======
const onReject = (err) => {
    const status = err?.response?.status;

    if (status === 401 && window.location.pathname !== '/auth/login') {
        try {
            window.localStorage.removeItem('token');
            window.localStorage.removeItem('me');
        } catch {}
        window.location.href = '/auth/login';
    }

    return Promise.reject(err);
};

http.interceptors.response.use((r) => r, onReject);
api.interceptors.response.use((r) => r, onReject);

export function setToken(token) {
    window.localStorage.setItem('token', token);
}

export function clearToken() {
    window.localStorage.removeItem('token');
}
