import axios from 'axios';

export const api = axios.create({
    baseURL: import.meta.env.VITE_API_HOST || 'http://127.0.0.1:8000',
    withCredentials: true,
    xsrfCookieName: 'XSRF-TOKEN',
    xsrfHeaderName: 'X-XSRF-TOKEN'
});

api.interceptors.response.use(
    (res) => res,
    (err) => {
        if (err?.response?.status === 401 && window.location.pathname !== '/auth/login') {
            window.localStorage.removeItem('me');
            window.location.href = '/auth/login';
        }
        return Promise.reject(err);
    }
);
