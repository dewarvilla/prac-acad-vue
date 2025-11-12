import { createApp } from 'vue';
import App from './App.vue';
import router from './router';

import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';

import Aura from '@primeuix/themes/aura';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';

import '@/assets/styles.scss';
import 'leaflet/dist/leaflet.css';

const app = createApp(App);

// Pinia + persistencia
const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);
app.use(pinia);

// Router
app.use(router);

// PrimeVue & servicios
app.use(PrimeVue, {
    theme: { preset: Aura, options: { darkModeSelector: '.app-dark' } }
});
app.use(ToastService);
app.use(ConfirmationService);

app.mount('#app');
