import { api, http } from '@/api';
import { defineStore } from 'pinia';

export const useAuthStore = defineStore('auth', {
    state: () => ({
        me: null,
        loading: false,
        error: '',
        bootstrapped: false
    }),
    getters: {
        isAuthenticated: (s) => !!s.me
    },
    actions: {
        loadFromStorage() {
            const raw = localStorage.getItem('me');
            this.me = raw ? JSON.parse(raw) : null;
        },
        saveToStorage() {
            if (this.me) localStorage.setItem('me', JSON.stringify(this.me));
            else localStorage.removeItem('me');
        },
        async csrf() {
            await http.get('/sanctum/csrf-cookie');
        },
        async login(email, password) {
            this.loading = true;
            this.error = '';
            try {
                await this.csrf();
                await api.post('/login', { email, password });
                const { data } = await api.get('/me');
                this.me = data;
                this.saveToStorage();
            } catch (e) {
                this.error = e?.response?.data?.message || 'Error de autenticación';
                this.me = null;
                this.saveToStorage();
                throw e;
            } finally {
                this.loading = false;
            }
        },
        async fetchMe() {
            this.loading = true;
            this.error = '';
            try {
                const { data } = await api.get('/me');
                this.me = data;
                this.saveToStorage();
            } catch (e) {
                this.me = null;
                this.saveToStorage();
                throw e;
            } finally {
                this.loading = false;
                this.bootstrapped = true;
            }
        },
        async logout() {
            try {
                await api.post('/logout');
            } catch {}
            this.me = null;
            this.saveToStorage();
        },
        async init() {
            this.loadFromStorage();
            try {
                await this.fetchMe();
            } catch {}
        }
    }
});
