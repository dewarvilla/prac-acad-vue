<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api';
import { useNotificationsStore } from '@/stores/notifications';

import Badge from 'primevue/badge';
import Button from 'primevue/button';
import Divider from 'primevue/divider';
import Popover from 'primevue/popover';
import ProgressSpinner from 'primevue/progressspinner';
import Tag from 'primevue/tag';

const LIST_CACHE_MS = 10000;

const router = useRouter();
const op = ref(null);

const notifs = useNotificationsStore();

const items = ref([]);
const loading = ref(false);
const lastFetchedAt = ref(0);
const lastUnreadMode = ref(true);

const unreadCount = computed(() => Number(notifs.unreadCount || 0));

const notifDisplay = computed(() => {
    const count = unreadCount.value;

    if (!count) return '';

    return count > 99 ? '99+' : String(count);
});

function normalizeList(data) {
    const list = Array.isArray(data) ? data : (data?.data ?? []);

    return list.map((item) => ({
        id: item.id,
        title: item.title ?? item.asunto ?? 'Notificacion',
        message: item.message ?? item.mensaje ?? item.body ?? item.descripcion ?? 'Tienes una notificacion pendiente.',
        url: item.url ?? null,
        kind: item.kind ?? null,
        module: item.module ?? null,
        created_at: item.created_at ?? item.createdAt ?? null,
        read_at: item.read_at ?? item.readAt ?? null
    }));
}

async function fetchNotifications({ onlyUnread = true, force = false } = {}) {
    const now = Date.now();

    if (!force && loading.value) return;

    if (!force && items.value.length > 0 && lastUnreadMode.value === onlyUnread && now - lastFetchedAt.value < LIST_CACHE_MS) {
        return;
    }

    loading.value = true;

    try {
        const { data } = await api.get('/notifications', {
            params: { per_page: 10, page: 1, unread: onlyUnread ? 1 : 0 }
        });

        items.value = normalizeList(data);
        lastFetchedAt.value = Date.now();
        lastUnreadMode.value = onlyUnread;
    } finally {
        loading.value = false;
    }
}

async function markAllRead() {
    await api.patch('/notifications/read-all');
    items.value = [];
    notifs.unreadCount = 0;
    lastFetchedAt.value = Date.now();
}

function resolveNotificationUrl(notification) {
    return notification?.url ?? null;
}

async function openNotification(notification) {
    const target = resolveNotificationUrl(notification);
    const wasUnread = !notification?.read_at;

    try {
        if (wasUnread) {
            await api.patch(`/notifications/${notification.id}/read`);
        }

        items.value = items.value.filter((item) => item.id !== notification.id);

        if (wasUnread) {
            notifs.unreadCount = Math.max(0, unreadCount.value - 1);
        }

        op.value?.hide?.();

        if (target) {
            await router.push(target);
        }
    } catch (error) {
        console.error('No se pudo abrir la notificacion', error);
    }
}

function onBellBtnClick(event) {
    op.value?.toggle?.(event);
    fetchNotifications({ onlyUnread: true });
}
</script>

<template>
    <div class="relative inline-flex">
        <button type="button" class="layout-topbar-action" aria-label="Notificaciones" @click="onBellBtnClick($event)">
            <i class="pi pi-bell"></i>
        </button>

        <span v-if="notifDisplay" class="absolute -top-1 -right-1">
            <Badge :value="notifDisplay" />
        </span>

        <Popover ref="op" :style="{ width: '360px', maxWidth: '90vw' }">
            <div class="flex items-center justify-between gap-2 mb-2">
                <div class="flex items-center gap-2">
                    <i class="pi pi-bell text-surface-600" />
                    <div class="font-semibold">Notificaciones</div>
                    <Tag v-if="unreadCount > 0" :value="`${unreadCount} nuevas`" severity="info" />
                </div>

                <Button v-if="unreadCount > 0" type="button" label="Marcar todo" icon="pi pi-check" size="small" text @click="markAllRead" />
            </div>

            <Divider class="my-2" />

            <div v-if="loading" class="flex items-center justify-center py-6">
                <ProgressSpinner style="width: 28px; height: 28px" strokeWidth="4" />
            </div>

            <div v-else-if="!items.length" class="py-6 text-center text-surface-600">
                <div class="text-base font-medium">No tienes notificaciones</div>
                <div class="text-sm mt-1">Cuando tengas solicitudes o alertas apareceran aqui.</div>
            </div>

            <div v-else class="flex flex-col gap-2">
                <button v-for="notification in items" :key="notification.id" type="button" class="w-full text-left p-2 rounded border hover:bg-surface-50 transition" @click="openNotification(notification)">
                    <div class="font-medium truncate">
                        {{ notification.title }}
                    </div>
                    <div class="text-sm text-surface-600 mt-0.5">
                        {{ notification.message }}
                    </div>
                </button>
            </div>
        </Popover>
    </div>
</template>
