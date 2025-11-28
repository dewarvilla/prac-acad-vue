import AppLayout from '@/layout/AppLayout.vue';
import { useAuthStore } from '@/stores/auth';
import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: '/',
            component: AppLayout,
            meta: { requiresAuth: true },
            children: [
                { path: '', name: 'dashboard', component: () => import('@/views/Dashboard.vue') },

                { path: 'uikit/formlayout', name: 'formlayout', component: () => import('@/views/uikit/FormLayout.vue') },
                { path: 'uikit/input', name: 'input', component: () => import('@/views/uikit/InputDoc.vue') },
                { path: 'uikit/button', name: 'button', component: () => import('@/views/uikit/ButtonDoc.vue') },
                { path: 'uikit/table', name: 'table', component: () => import('@/views/uikit/TableDoc.vue') },
                { path: 'uikit/list', name: 'list', component: () => import('@/views/uikit/ListDoc.vue') },
                { path: 'uikit/tree', name: 'tree', component: () => import('@/views/uikit/TreeDoc.vue') },
                { path: 'uikit/panel', name: 'panel', component: () => import('@/views/uikit/PanelsDoc.vue') },
                { path: 'uikit/overlay', name: 'overlay', component: () => import('@/views/uikit/OverlayDoc.vue') },
                { path: 'uikit/media', name: 'media', component: () => import('@/views/uikit/MediaDoc.vue') },
                { path: 'uikit/message', name: 'message', component: () => import('@/views/uikit/MessagesDoc.vue') },
                { path: 'uikit/file', name: 'file', component: () => import('@/views/uikit/FileDoc.vue') },
                { path: 'uikit/menu', name: 'menu', component: () => import('@/views/uikit/MenuDoc.vue') },
                { path: 'uikit/charts', name: 'charts', component: () => import('@/views/uikit/ChartDoc.vue') },
                { path: 'uikit/misc', name: 'misc', component: () => import('@/views/uikit/MiscDoc.vue') },
                { path: 'uikit/timeline', name: 'timeline', component: () => import('@/views/uikit/TimelineDoc.vue') },

                { path: 'pages/empty', name: 'empty', component: () => import('@/views/pages/Empty.vue') },
                { path: 'pages/crud', name: 'crud', component: () => import('@/views/pages/Crud.vue') },
                { path: 'pages/salarios', name: 'salarios', component: () => import('@/views/pages/Salarios.vue') },
                { path: 'pages/catalogos', name: 'catalogos', component: () => import('@/views/pages/Catalogos.vue') },
                { path: 'pages/programaciones', name: 'programaciones', component: () => import('@/views/pages/Programaciones.vue') },
                { path: 'pages/creaciones', name: 'creaciones', component: () => import('@/views/pages/Creaciones.vue') },
                { path: 'pages/fechas', name: 'fechas', component: () => import('@/views/pages/Fechas.vue') },

                { path: 'documentation', name: 'documentation', component: () => import('@/views/pages/Documentation.vue') },
                { path: 'mapa', name: 'mapa', component: () => import('@/views/MapView.vue') }
            ]
        },

        // Públicas
        { path: '/landing', name: 'landing', component: () => import('@/views/pages/Landing.vue') },

        // Auth (solo invitados)
        { path: '/auth/login', name: 'login', meta: { guestOnly: true }, component: () => import('@/views/pages/auth/Login.vue') },
        { path: '/auth/access', name: 'accessDenied', meta: { guestOnly: true }, component: () => import('@/views/pages/auth/Access.vue') },
        { path: '/auth/error', name: 'error', meta: { guestOnly: true }, component: () => import('@/views/pages/auth/Error.vue') },

        // 404
        { path: '/pages/notfound', name: 'notfound', component: () => import('@/views/pages/NotFound.vue') },
        { path: '/:pathMatch(.*)*', redirect: '/pages/notfound' }
    ]
});

// Guard global
router.beforeEach(async (to) => {
    const auth = useAuthStore();

    if (to.name === 'login') return true;

    if (!auth.bootstrapped) {
        try {
            await auth.init();
        } catch {}
    }

    if (to.meta.requiresAuth && !auth.isAuthenticated) {
        return { name: 'login', query: { redirect: to.fullPath } };
    }

    if (to.meta.guestOnly && auth.isAuthenticated) {
        return { name: 'dashboard' };
    }

    return true;
});

export default router;
