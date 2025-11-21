import { api, ensureCsrf } from '@/api';
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
                const raw = localStorage.getItem('me');
                this.me = raw ? JSON.parse(raw) : null;
            } catch {
                this.me = null;
            }
        },

        saveToStorage() {
            try {
                if (this.me) {
                    localStorage.setItem('me', JSON.stringify(this.me));
                } else {
                    localStorage.removeItem('me');
                }
            } catch {}
        },

        setMe(me) {
            this.me = me;
            this.saveToStorage();
        },

        async login(email, password) {
            this.loading = true;
            this.error = '';

            try {
                await ensureCsrf();
                await api.post('/login', { email, password });
                const { data } = await api.get('/me');
                this.setMe(data);
            } catch (e) {
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
            } catch (e) {
                this.setMe(null);
                throw e;
            } finally {
                this.loading = false;
                this.bootstrapped = true;
            }
        },

        async logout() {
            try {
                await ensureCsrf(true);
                await api.post('/logout');
            } catch {
            } finally {
                this.setMe(null);
            }
        },

        async init() {
            this.loadFromStorage();

            try {
                await this.fetchMe();
            } catch {}
        }
    }
});
