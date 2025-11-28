<script setup>
import FloatingConfigurator from '@/components/FloatingConfigurator.vue';
import { useAuthStore } from '@/stores/auth';
import { useRoute, useRouter } from 'vue-router';
import { ref, computed } from 'vue';
import { useToast } from 'primevue/usetoast';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const toast = useToast();

const email = ref('');
const password = ref('');
const remember = ref(false);

const canSubmit = computed(() => email.value.trim().length > 3 && password.value.length >= 1 && !auth.loading);

async function onSubmit(e) {
    e?.preventDefault?.();
    if (!canSubmit.value) return;

    try {
        await auth.login(email.value.trim(), password.value);
        const redirect = (route.query.redirect && String(route.query.redirect)) || '/';
        router.replace(redirect);
    } catch {
        toast.add({
            severity: 'error',
            summary: 'Error de autenticación',
            detail: auth.error || 'No fue posible iniciar sesión',
            life: 4000
        });
    }
}
</script>

<template>
    <FloatingConfigurator />

    <div class="bg-surface-50 dark:bg-surface-950 flex items-center justify-center min-h-screen min-w-[100vw] overflow-hidden">
        <div class="flex flex-col items-center justify-center">
            <div style="border-radius: 56px; padding: 0.3rem; background: linear-gradient(180deg, var(--primary-color) 10%, rgba(33, 150, 243, 0) 30%)">
                <form class="w-full bg-surface-0 dark:bg-surface-900 py-20 px-8 sm:px-20" style="border-radius: 53px" @submit="onSubmit">
                    <div class="text-center mb-8">
                        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Escudo_Universidad_de_C%C3%B3rdoba.png/960px-Escudo_Universidad_de_C%C3%B3rdoba.png" alt="Logo" class="mx-auto mb-4" style="height: 3.5rem" />
                        <path
                            fill-rule="evenodd"
                            clip-rule="evenodd"
                            d="M17.1637 19.2467C17.1566 19.4033 17.1529 19.561 17.1529 19.7194C17.1529 25.3503 21.7203 29.915 27.3546 29.915C32.9887 29.915 37.5561 25.3503 37.5561 19.7194C37.5561 19.5572 37.5524 19.3959 37.5449 19.2355C38.5617 19.0801 39.5759 18.9013 40.5867 18.6994L40.6926 18.6782C40.7191 19.0218 40.7326 19.369 40.7326 19.7194C40.7326 27.1036 34.743 33.0896 27.3546 33.0896C19.966 33.0896 13.9765 27.1036 13.9765 19.7194C13.9765 19.374 13.9896 19.0316 14.0154 18.6927L14.0486 18.6994C15.0837 18.9062 16.1223 19.0886 17.1637 19.2467ZM33.3284 11.4538C31.6493 10.2396 29.5855 9.52381 27.3546 9.52381C25.1195 9.52381 23.0524 10.2421 21.3717 11.4603C20.0078 11.3232 18.6475 11.1387 17.2933 10.907C19.7453 8.11308 23.3438 6.34921 27.3546 6.34921C31.36 6.34921 34.9543 8.10844 37.4061 10.896C36.0521 11.1292 34.692 11.3152 33.3284 11.4538ZM43.826 18.0518C43.881 18.6003 43.9091 19.1566 43.9091 19.7194C43.9091 28.8568 36.4973 36.2642 27.3546 36.2642C18.2117 36.2642 10.8 28.8568 10.8 19.7194C10.8 19.1615 10.8276 18.61 10.8816 18.0663L7.75383 17.4411C7.66775 18.1886 7.62354 18.9488 7.62354 19.7194C7.62354 30.6102 16.4574 39.4388 27.3546 39.4388C38.2517 39.4388 47.0855 30.6102 47.0855 19.7194C47.0855 18.9439 47.0407 18.1789 46.9536 17.4267L43.826 18.0518ZM44.2613 9.54743L40.9084 10.2176C37.9134 5.95821 32.9593 3.1746 27.3546 3.1746C21.7442 3.1746 16.7856 5.96385 13.7915 10.2305L10.4399 9.56057C13.892 3.83178 20.1756 0 27.3546 0C34.5281 0 40.8075 3.82591 44.2613 9.54743Z"
                            fill="var(--primary-color)"
                        />
                        <div class="text-surface-900 dark:text-surface-0 text-3xl font-medium mb-2">Bienvenido</div>
                        <span class="text-muted-color font-medium">Inicia sesión para continuar</span>
                    </div>

                    <div class="max-w-[30rem] mx-auto w-full">
                        <div class="mb-8">
                            <label for="email1" class="block text-surface-900 dark:text-surface-0 text-xl font-medium mb-2">Email</label>
                            <InputText id="email1" type="email" inputmode="email" autocomplete="username" placeholder="correo@dominio.com" class="w-full" v-model="email" :invalid="auth.error && !email" />
                        </div>

                        <div class="mb-4">
                            <div class="mb-4">
                                <label for="password1" class="block text-surface-900 dark:text-surface-0 font-medium text-xl mb-2"> Contraseña </label>
                                <Password inputId="password1" v-model="password" placeholder="••••••••" :toggleMask="true" fluid :feedback="false" autocomplete="current-password" :invalid="auth.error && !password" />
                            </div>
                        </div>
                        <!-- 
                        <div class="flex items-center justify-between mt-2 mb-4 gap-8">
                            <div class="flex items-center">
                                <Checkbox v-model="remember" inputId="rememberme1" binary class="mr-2" />
                                <label for="rememberme1">Recordarme</label>
                            </div>
                            <RouterLink to="/auth/access" class="font-medium no-underline ml-2 text-right cursor-pointer text-primary">¿Olvidaste tu contraseña?</RouterLink>
                        </div>
 -->
                        <Message v-if="auth.error" severity="error" class="mb-4" :closable="false">
                            {{ auth.error }}
                        </Message>

                        <Button type="submit" label="Ingresar" class="w-full" :loading="auth.loading" :disabled="!canSubmit" icon="pi pi-sign-in" />
                    </div>
                </form>
            </div>
        </div>
    </div>
</template>

<style scoped>
.pi-eye,
.pi-eye-slash {
    transform: scale(1.6);
    margin-right: 1rem;
}
</style>
