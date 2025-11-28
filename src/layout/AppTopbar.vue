<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { useLayout } from '@/layout/composables/layout';
import AppConfigurator from './AppConfigurator.vue';
import NotificationsBell from '@/components/NotificationsBell.vue';

import { api, ensureCsrf } from '@/api';
import { useAuthStore } from '@/stores/auth';

const { toggleMenu, toggleDarkMode, isDarkTheme } = useLayout();

const router = useRouter();
const auth = useAuthStore();

const loggingOut = ref(false);

const handleLogout = async () => {
    if (loggingOut.value) return;
    loggingOut.value = true;

    try {
        await ensureCsrf();
        await api.post('/logout');
    } catch (e) {
        console.error('Error al cerrar sesión', e);
    } finally {
        if (typeof auth.logout === 'function') {
            auth.logout();
        } else if (typeof auth.$reset === 'function') {
            auth.$reset();
        }

        loggingOut.value = false;

        router.push('/auth/login');
    }
};

const goProfile = () => {
    router.push({ name: 'profile' });
};
</script>

<template>
    <div class="layout-topbar">
        <div class="layout-topbar-logo-container">
            <button class="layout-menu-button layout-topbar-action" @click="toggleMenu">
                <i class="pi pi-bars"></i>
            </button>

            <router-link to="/" class="layout-topbar-logo">
                <span>UNICOR</span>
            </router-link>
        </div>

        <div class="layout-topbar-actions">
            <div class="layout-config-menu">
                <button type="button" class="layout-topbar-action" @click="toggleDarkMode">
                    <i :class="['pi', { 'pi-moon': isDarkTheme, 'pi-sun': !isDarkTheme }]"></i>
                </button>

                <div class="relative">
                    <button
                        v-styleclass="{
                            selector: '@next',
                            enterFromClass: 'hidden',
                            enterActiveClass: 'animate-scalein',
                            leaveToClass: 'hidden',
                            leaveActiveClass: 'animate-fadeout',
                            hideOnOutsideClick: true
                        }"
                        type="button"
                        class="layout-topbar-action layout-topbar-action-highlight"
                    >
                        <i class="pi pi-palette"></i>
                    </button>
                    <AppConfigurator />
                </div>
            </div>

            <button
                class="layout-topbar-menu-button layout-topbar-action"
                v-styleclass="{
                    selector: '@next',
                    enterFromClass: 'hidden',
                    enterActiveClass: 'animate-scalein',
                    leaveToClass: 'hidden',
                    leaveActiveClass: 'animate-fadeout',
                    hideOnOutsideClick: true
                }"
            >
                <i class="pi pi-ellipsis-v"></i>
            </button>

            <div class="layout-topbar-menu hidden lg:block">
                <div class="layout-topbar-menu-content">
                    <NotificationsBell class="layout-topbar-action" />

                    <div class="relative">
                        <button
                            type="button"
                            class="layout-topbar-action"
                            v-styleclass="{
                                selector: '@next',
                                enterFromClass: 'hidden',
                                enterActiveClass: 'animate-scalein',
                                leaveToClass: 'hidden',
                                leaveActiveClass: 'animate-fadeout',
                                hideOnOutsideClick: true
                            }"
                        >
                            <i class="pi pi-user"></i>
                            <span>Profile</span>
                        </button>

                        <div class="absolute right-0 mt-2 w-44 bg-surface-0 border rounded shadow-md py-1 text-sm hidden">
                            <button type="button" class="w-full text-left px-3 py-2 hover:bg-surface-100 flex items-center gap-2" @click="goProfile">
                                <i class="pi pi-id-card text-xs"></i>
                                <span>Mi perfil</span>
                            </button>

                            <button type="button" class="w-full text-left px-3 py-2 hover:bg-surface-100 flex items-center gap-2 text-red-600" :disabled="loggingOut" @click="handleLogout">
                                <i class="pi pi-sign-out text-xs"></i>
                                <span v-if="!loggingOut">Cerrar sesión</span>
                                <span v-else>Saliendo…</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
