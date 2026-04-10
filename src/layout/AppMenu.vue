<script setup>
import { useAuthStore } from '@/stores/auth';
import { computed } from 'vue';

import AppMenuItem from './AppMenuItem.vue';

const auth = useAuthStore();

const model = computed(() => [
    {
        label: 'Home',
        items: [{ label: 'Dashboard', icon: 'pi pi-fw pi-home', to: '/' }]
    },
    ...(auth.menu ?? [])
]);
</script>

<template>
    <ul class="layout-menu">
        <template v-for="(item, i) in model" :key="item.label ?? i">
            <app-menu-item v-if="!item.separator" :item="item" :index="i"></app-menu-item>
            <li v-else class="menu-separator"></li>
        </template>
    </ul>
</template>

<style lang="scss" scoped></style>
