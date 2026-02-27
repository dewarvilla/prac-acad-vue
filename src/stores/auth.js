import { api } from '@/api';
import { defineStore } from 'pinia';

export const useAuthStore = defineStore('auth', {
    state: () => ({
        me: null,
        loading: false,
        error: '',
        bootstrapped: false
    }),

    getters: {
        isAuthenticated: (s) => !!s.me,

        roles: (s) => s.me?.roles ?? [],
        permissions: (s) => s.me?.permissions ?? [],

        hasRole: (s) => (role) => (s.me?.roles ?? []).includes(role),
        hasPermission: (s) => (perm) => (s.me?.permissions ?? []).includes(perm)
    },

    actions: {
        loadFromStorage() {
            try {
                const rawMe = localStorage.getItem('me');
                this.me = rawMe ? JSON.parse(rawMe) : null;
            } catch {
                this.me = null;
            }
        },

        saveToStorage() {
            try {
                if (this.me) localStorage.setItem('me', JSON.stringify(this.me));
                else localStorage.removeItem('me');
            } catch {}
        },

        setMe(me) {
            this.me = me;
            this.saveToStorage();
        },

        setToken(token) {
            try {
                if (token) localStorage.setItem('token', token);
                else localStorage.removeItem('token');
            } catch {}
        },

        async login(email, password) {
            this.loading = true;
            this.error = '';

            try {
                const { data } = await api.post('/login', { email, password });

                this.setToken(data.token);

                const me = await this.fetchMe();
                return me;
            } catch (e) {
                this.setToken(null);
                this.setMe(null);
                this.error = e?.response?.data?.message || 'Error de autenticación';
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
                this.setMe(data);
                return data;
            } catch (e) {
                this.setToken(null);
                this.setMe(null);
                throw e;
            } finally {
                this.loading = false;
                this.bootstrapped = true;
            }
        },

        async logout() {
            try {
                await api.post('/logout');
            } catch {
            } finally {
                this.setToken(null);
                this.setMe(null);
            }
        },

        async init() {
            this.loadFromStorage();

            const token = localStorage.getItem('token');
            if (!token) {
                this.bootstrapped = true;
                return;
            }

            try {
                await this.fetchMe();
            } catch {}
        }
    }
});
