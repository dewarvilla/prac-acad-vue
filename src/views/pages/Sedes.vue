<script setup>
import { ref, reactive, computed, onMounted, watch, onBeforeUnmount } from 'vue';
import { useToast } from 'primevue/usetoast';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';

const toast = useToast();
const auth = useAuthStore();
const hasPerm = (perm) => auth.hasPermission(perm);

// -------------------------
// Tabla base
// -------------------------
const tableUid = `sed-${Math.random().toString(36).slice(2)}`;
const products = ref([]);
const selected = ref([]);
const loading = ref(false);

const allSelected = computed(() => selected.value.length > 0 && selected.value.length === products.value.length);
const someSelected = computed(() => selected.value.length > 0 && selected.value.length < products.value.length);

function toggleAll(e) {
    if (e.checked) selected.value = [...products.value];
    else selected.value = [];
}

const page = ref(1);
const rows = ref(10);
const total = ref(0);
const sortField = ref('nombre');
const sortOrder = ref(1);

// -------------------------
// Permisos
// -------------------------
const canViewSedes = computed(() => hasPerm('sedes.view'));
const canCreateSedes = computed(() => hasPerm('sedes.create'));
const canEditSedes = computed(() => hasPerm('sedes.edit'));
const canDeleteSedes = computed(() => hasPerm('sedes.delete'));
const canAccessModule = computed(() => canViewSedes.value);

// -------------------------
// Endpoints
// -------------------------
const API_SED = '/sedes';

// -------------------------
// Search debounce
// -------------------------
const search = ref('');
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
let typingTimer = null;
let activeCtrl = null;

// -------------------------
// Helpers
// -------------------------
function s(v) {
    return v == null ? '' : String(v);
}

function estadoLabel(v) {
    return v ? 'Activa' : 'Inactiva';
}

function estadoSeverity(v) {
    return v ? 'success' : 'danger';
}

function formatCoord(value, digits = 7) {
    if (value == null || value === '') return '—';
    const n = Number(value);
    if (Number.isNaN(n)) return String(value);
    return n.toFixed(digits);
}

// -------------------------
// Sort mapping
// -------------------------
const SORT_MAP = {
    id: 'id',
    nombre: 'nombre',
    direccion: 'direccion',
    activa: 'activa',
    created_at: 'created_at',
    updated_at: 'updated_at'
};

function mapSort(uiField, order, map) {
    if (!uiField) return undefined;
    const apiField = map[uiField];
    if (!apiField) return undefined;
    return `${order === -1 ? '-' : ''}${apiField}`;
}

const sortParam = computed(() => mapSort(sortField.value, sortOrder.value, SORT_MAP));

function buildParams({ force = false } = {}) {
    const params = {
        per_page: Number(rows.value) || 10,
        page: Number(page.value) || 1
    };

    if (sortParam.value) params.sort = sortParam.value;

    const raw = s(search.value).trim();
    if (raw.length > 0 && (force || raw.length >= MIN_CHARS)) {
        params.q = raw;
    }

    return params;
}

// -------------------------
// Fetch principal
// -------------------------
async function getProducts(opts = {}) {
    const { signal, force = false } = opts;

    if (!canAccessModule.value) {
        products.value = [];
        total.value = 0;
        return;
    }

    loading.value = true;

    try {
        const { data } = await api.get(API_SED, {
            params: buildParams({ force }),
            signal
        });

        if (Array.isArray(data)) {
            products.value = data;
            total.value = data.length;
        } else {
            products.value = data?.data ?? [];
            total.value = Number(data?.meta?.total ?? products.value.length);

            if (data?.meta?.current_page) page.value = Number(data.meta.current_page);
            if (data?.meta?.per_page) rows.value = Number(data.meta.per_page);
        }
    } catch (e) {
        const canceled = e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError';

        if (!canceled) {
            const status = e?.response?.status;
            const msg = e?.response?.data?.message || e.message;
            toast.add({
                severity: 'error',
                summary: 'Error al cargar',
                detail: `[${status ?? 'ERR'}] ${msg}`,
                life: 6500
            });
            products.value = [];
            total.value = 0;
        }
    } finally {
        if (!opts.signal?.aborted) loading.value = false;
    }
}

function scheduleFetch() {
    const raw = s(search.value).trim();
    if (raw.length === 0 || raw.length < MIN_CHARS) return;

    if (typingTimer) clearTimeout(typingTimer);
    if (activeCtrl) {
        activeCtrl.abort();
        activeCtrl = null;
    }

    typingTimer = setTimeout(() => {
        activeCtrl = new AbortController();
        getProducts({ signal: activeCtrl.signal }).finally(() => (activeCtrl = null));
    }, DEBOUNCE_MS);
}

watch(search, () => {
    page.value = 1;
    const raw = s(search.value).trim();

    if (raw.length === 0) {
        if (activeCtrl) {
            activeCtrl.abort();
            activeCtrl = null;
        }
        if (typingTimer) clearTimeout(typingTimer);
        getProducts();
    } else if (raw.length >= MIN_CHARS) {
        scheduleFetch();
    }
});

function onPage(e) {
    page.value = Number(e.page) + 1;
    rows.value = Number(e.rows);
    getProducts();
}

function onSort(e) {
    sortField.value = e.sortField;
    sortOrder.value = e.sortOrder;
    page.value = 1;
    getProducts();
}

function forceFetch() {
    if (typingTimer) clearTimeout(typingTimer);
    if (activeCtrl) {
        activeCtrl.abort();
        activeCtrl = null;
    }
    page.value = 1;
    getProducts({ force: true });
}

function clearSearch() {
    search.value = '';
    page.value = 1;
    if (typingTimer) clearTimeout(typingTimer);
    if (activeCtrl) {
        activeCtrl.abort();
        activeCtrl = null;
    }
    getProducts();
}

// -------------------------
// Detalles
// -------------------------
const detailsDialog = ref(false);
const detailsLoading = ref(false);
const details = ref([]);

async function openDetails() {
    if (!selected.value.length) return;

    detailsLoading.value = true;
    details.value = [];

    try {
        const reqs = selected.value.map((r) => api.get(`${API_SED}/${r.id}`));
        const results = await Promise.allSettled(reqs);

        details.value = results
            .filter((r) => r.status === 'fulfilled')
            .map((r) => r.value.data?.data ?? r.value.data)
            .filter(Boolean);
    } finally {
        detailsDialog.value = true;
        detailsLoading.value = false;
    }
}

// -------------------------
// Form / CRUD
// -------------------------
const productDialog = ref(false);

const defaults = () => ({
    id: null,
    nombre: '',
    direccion: '',
    latitud: '',
    longitud: '',
    activa: true
});

const product = ref(defaults());

const errors = reactive({
    nombre: '',
    direccion: '',
    latitud: '',
    longitud: '',
    activa: ''
});

const touched = reactive({
    nombre: false,
    direccion: false,
    latitud: false,
    longitud: false,
    activa: false
});

const rules = {
    nombre: [(v) => !!s(v).trim() || 'Requerido.'],
    direccion: [],
    latitud: [(v) => !!s(v).trim() || 'Requerido.', (v) => !Number.isNaN(Number(v)) || 'Debe ser numérica.', (v) => Number(v) >= -90 || 'Debe ser mayor o igual a -90.', (v) => Number(v) <= 90 || 'Debe ser menor o igual a 90.'],
    longitud: [(v) => !!s(v).trim() || 'Requerido.', (v) => !Number.isNaN(Number(v)) || 'Debe ser numérica.', (v) => Number(v) >= -180 || 'Debe ser mayor o igual a -180.', (v) => Number(v) <= 180 || 'Debe ser menor o igual a 180.'],
    activa: []
};

function resetValidation() {
    Object.keys(errors).forEach((k) => (errors[k] = ''));
    Object.keys(touched).forEach((k) => (touched[k] = false));
}

function validateField(f) {
    errors[f] = '';
    for (const test of rules[f] || []) {
        const ok = test(product.value[f]);
        if (ok !== true) {
            errors[f] = ok;
            break;
        }
    }
    return !errors[f];
}

function onBlur(f) {
    touched[f] = true;
    validateField(f);
}

function showError(f) {
    return touched[f] && !!errors[f];
}

function openNew() {
    product.value = defaults();
    resetValidation();
    productDialog.value = true;
}

function editProduct(row) {
    product.value = {
        id: row.id ?? null,
        nombre: row.nombre ?? '',
        direccion: row.direccion ?? '',
        latitud: row.latitud != null ? String(row.latitud) : '',
        longitud: row.longitud != null ? String(row.longitud) : '',
        activa: !!row.activa
    };

    resetValidation();
    productDialog.value = true;
}

const saving = ref(false);

function flattenValidationErrors(errs) {
    if (!errs || typeof errs !== 'object') return [];
    return Object.values(errs).flat().filter(Boolean);
}

function summarizeValidationErrors(errs) {
    const msgs = flattenValidationErrors(errs);
    if (!msgs.length) return null;
    const first = msgs[0];
    const more = msgs.length - 1;
    return more > 0 ? `${first} (y ${more} más)` : first;
}

const SERVER_TO_FORM = {
    nombre: 'nombre',
    direccion: 'direccion',
    latitud: 'latitud',
    longitud: 'longitud',
    activa: 'activa'
};

function applyServerFieldErrors(serverErrors) {
    Object.keys(errors).forEach((k) => (errors[k] = ''));
    Object.keys(touched).forEach((k) => (touched[k] = false));

    if (!serverErrors) return;

    for (const [serverKey, msgs] of Object.entries(serverErrors)) {
        const formKey = SERVER_TO_FORM[serverKey];
        if (!formKey) continue;
        errors[formKey] = Array.isArray(msgs) ? (msgs[0] ?? '') : String(msgs ?? '');
        touched[formKey] = true;
    }
}

async function saveProduct() {
    if (saving.value) return;

    const fields = ['nombre', 'latitud', 'longitud'];

    fields.forEach((f) => {
        touched[f] = true;
        validateField(f);
    });

    const ok = fields.every((f) => !errors[f]);
    if (!ok) {
        toast.add({
            severity: 'warn',
            summary: 'No se pudo guardar',
            detail: 'Revisa los campos obligatorios.',
            life: 4500
        });
        return;
    }

    const payload = {
        nombre: s(product.value.nombre).trim(),
        direccion: s(product.value.direccion).trim() || null,
        latitud: s(product.value.latitud).trim(),
        longitud: s(product.value.longitud).trim(),
        activa: !!product.value.activa
    };

    try {
        saving.value = true;

        if (product.value.id) {
            await api.patch(`${API_SED}/${product.value.id}`, payload);
            toast.add({
                severity: 'success',
                summary: 'Actualizada',
                detail: 'La sede fue actualizada correctamente.',
                life: 3500
            });
        } else {
            await api.post(API_SED, payload);
            toast.add({
                severity: 'success',
                summary: 'Creada',
                detail: 'La sede fue creada correctamente.',
                life: 3500
            });
        }

        productDialog.value = false;
        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        const msg = data?.message || data?.error || e.message;

        if (status === 422) {
            applyServerFieldErrors(data?.errors);
            toast.add({
                severity: 'warn',
                summary: 'No se pudo guardar',
                detail: summarizeValidationErrors(data?.errors) || msg || 'Los datos enviados son inválidos.',
                life: 6500
            });
            return;
        }

        toast.add({
            severity: 'error',
            summary: 'No se pudo guardar',
            detail: `[${status ?? 'ERR'}] ${msg}`,
            life: 7000
        });
    } finally {
        saving.value = false;
    }
}

// -------------------------
// Delete individual + bulk
// -------------------------
const deleteProductDialog = ref(false);
const current = ref(null);

function confirmDeleteProduct(row) {
    current.value = { ...row };
    deleteProductDialog.value = true;
}

async function deleteProduct() {
    try {
        await api.delete(`${API_SED}/${current.value.id}`);
        products.value = products.value.filter((x) => x.id !== current.value.id);
        toast.add({ severity: 'success', summary: 'Eliminada', life: 2500 });
        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.message || e.message;
        toast.add({
            severity: 'error',
            summary: 'No se pudo eliminar',
            detail: `[${status ?? 'ERR'}] ${msg}`,
            life: 5000
        });
    } finally {
        deleteProductDialog.value = false;
        current.value = null;
    }
}

const bulkDeleteDialog = ref(false);
const canBulkDelete = computed(() => canDeleteSedes.value && selected.value.length > 0);

function confirmBulkDelete() {
    if (!canBulkDelete.value) {
        toast.add({
            severity: 'warn',
            summary: 'No se puede eliminar',
            detail: 'Selecciona uno o más registros.',
            life: 4500
        });
        return;
    }
    bulkDeleteDialog.value = true;
}

async function bulkDelete() {
    const ids = selected.value.map((r) => r.id);

    try {
        await api.post(`${API_SED}/bulk-delete`, { ids });

        const set = new Set(ids);
        products.value = products.value.filter((x) => !set.has(x.id));
        selected.value = [];

        toast.add({
            severity: 'success',
            summary: `Eliminadas (${ids.length})`,
            life: 2500
        });

        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.message || e.message;
        toast.add({
            severity: 'error',
            summary: 'Error al eliminar',
            detail: `[${status ?? 'ERR'}] ${msg}`,
            life: 6000
        });
    } finally {
        bulkDeleteDialog.value = false;
    }
}

// -------------------------
// UX / teclado
// -------------------------
function onFormKeyCapture(e) {
    if (e.key !== ' ') return;

    const t = e.target;
    const tag = (t.tagName || '').toUpperCase();
    const type = (t.type || '').toLowerCase();

    const isTextInput = tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type);
    const isEditable = isTextInput || tag === 'TEXTAREA' || t.isContentEditable;

    if (isEditable) return;
    if (tag === 'INPUT' && (type === 'checkbox' || type === 'radio')) return;

    e.preventDefault();
    e.stopPropagation();
}

function onSaveBtnKeydown(e) {
    if (e.key === ' ') e.preventDefault();
}

onBeforeUnmount(() => {
    if (typingTimer) clearTimeout(typingTimer);
    if (activeCtrl) activeCtrl.abort();
});

onMounted(async () => {
    await getProducts();
});
</script>

<template>
    <div class="card">
        <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
                <h2 class="text-lg font-semibold m-0">Sedes</h2>
            </div>
        </div>

        <div v-if="!canAccessModule" class="p-4 border rounded bg-surface-50 text-surface-700">No tienes permisos para ver este módulo.</div>

        <template v-else>
            <Toolbar class="mb-3">
                <template #start>
                    <div class="flex items-center gap-2 shrink-0">
                        <Button v-if="canCreateSedes" label="Crear" icon="pi pi-plus" @click="openNew" />
                        <Button v-if="canDeleteSedes" label="Borrar" icon="pi pi-trash" :disabled="!canBulkDelete" @click="confirmBulkDelete" />
                        <Button label="Detalles" icon="pi pi-list" :disabled="!selected.length" @click="openDetails" />
                    </div>
                </template>

                <template #center />

                <template #end>
                    <div class="flex items-center gap-3 w-full justify-end">
                        <form role="search" class="min-w-0 w-full sm:w-80 md:w-[26rem]" @submit.prevent="forceFetch">
                            <IconField class="w-full p-input-icon-left relative">
                                <InputIcon :class="loading ? 'pi pi-spinner pi-spin' : 'pi pi-search'" />
                                <InputText
                                    id="sedSearch"
                                    name="sedSearch"
                                    v-model.trim="search"
                                    role="searchbox"
                                    placeholder="Escribe para buscar..."
                                    class="w-full h-10 leading-10 pr-8"
                                    autocomplete="off"
                                    @keydown.enter.prevent="forceFetch"
                                    @keydown.esc.prevent="clearSearch"
                                />
                                <button v-if="search" type="button" class="absolute right-3 top-1/2 -translate-y-1/2" @click="clearSearch" aria-label="Limpiar búsqueda">X</button>
                            </IconField>
                        </form>
                    </div>
                </template>
            </Toolbar>

            <DataTable
                :value="products"
                dataKey="id"
                v-model:selection="selected"
                selectionMode="multiple"
                :loading="loading"
                :lazy="true"
                :paginator="true"
                :rows="Number(rows)"
                :totalRecords="Number(total)"
                :first="(Number(page) - 1) * Number(rows)"
                :sortField="sortField"
                :sortOrder="sortOrder"
                @page="onPage"
                @sort="onSort"
                :rowsPerPageOptions="[5, 10, 25, 50, 100]"
                currentPageReportTemplate="Mostrando desde {first} hasta {last} de {totalRecords}"
                emptyMessage="No hay registros"
                responsiveLayout="scroll"
                :scrollable="true"
                tableStyle="width: 100%; min-width: 900px;"
            >
                <Column headerStyle="width:3rem">
                    <template #headercheckbox>
                        <Checkbox
                            :inputId="tableUid + '-select-all'"
                            :name="tableUid + '-select-all'"
                            :aria-label="'Seleccionar todas las filas'"
                            :binary="true"
                            :modelValue="allSelected"
                            :indeterminate="someSelected && !allSelected"
                            @change="toggleAll"
                        />
                    </template>

                    <template #checkbox="{ data, index }">
                        <Checkbox v-model="selected" :value="data" :inputId="`${tableUid}-row-${index + 1}`" name="row-select" :aria-label="`Seleccionar fila ${index + 1}`" />
                    </template>
                </Column>

                <Column field="nombre" header="Nombre" sortable style="min-width: 20rem; max-width: 30rem">
                    <template #body="{ data }">
                        <span class="block overflow-hidden text-ellipsis whitespace-nowrap" v-tooltip.top="data.nombre">
                            {{ data.nombre }}
                        </span>
                    </template>
                </Column>

                <Column field="direccion" header="Dirección" sortable style="min-width: 24rem; max-width: 40rem">
                    <template #body="{ data }">
                        <span class="block overflow-hidden text-ellipsis whitespace-nowrap" v-tooltip.top="data.direccion || '—'">
                            {{ data.direccion || '—' }}
                        </span>
                    </template>
                </Column>

                <Column field="activa" header="Estado" sortable style="width: 12rem; max-width: 12rem">
                    <template #body="{ data }">
                        <Tag :value="estadoLabel(data.activa)" :severity="estadoSeverity(data.activa)" />
                    </template>
                </Column>

                <Column :exportable="false" headerStyle="width:9rem">
                    <template #body="{ data }">
                        <Button v-if="canEditSedes" icon="pi pi-pencil" rounded text class="mr-1" @click.stop="editProduct(data)" />
                        <Button v-if="canDeleteSedes" icon="pi pi-trash" rounded text severity="danger" @click.stop="confirmDeleteProduct(data)" />
                    </template>
                </Column>
            </DataTable>

            <Dialog v-model:visible="productDialog" :header="product.id ? 'Editar sede' : 'Crear sede'" :style="{ width: '42rem' }" :modal="true">
                <div class="flex flex-col gap-4" @keydown.capture="onFormKeyCapture">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="flex flex-col gap-2 md:col-span-2">
                            <label for="nombre">Nombre</label>
                            <InputText id="nombre" name="nombre" v-model.trim="product.nombre" :invalid="showError('nombre')" @blur="onBlur('nombre')" @keydown.space.stop />
                            <small v-if="showError('nombre')" class="text-red-500">{{ errors.nombre }}</small>
                        </div>

                        <div class="flex flex-col gap-2 md:col-span-2">
                            <label for="direccion">Dirección</label>
                            <InputText id="direccion" name="direccion" v-model.trim="product.direccion" :invalid="showError('direccion')" @blur="onBlur('direccion')" @keydown.space.stop />
                            <small v-if="showError('direccion')" class="text-red-500">{{ errors.direccion }}</small>
                        </div>

                        <div class="flex flex-col gap-2">
                            <label for="latitud">Latitud</label>
                            <InputText id="latitud" v-model.trim="product.latitud" inputmode="decimal" placeholder="Ej. 8.7918200" :invalid="showError('latitud')" @blur="onBlur('latitud')" />
                            <small v-if="showError('latitud')" class="text-red-500">{{ errors.latitud }}</small>
                        </div>

                        <div class="flex flex-col gap-2">
                            <label for="longitud">Longitud</label>
                            <InputText id="longitud" v-model.trim="product.longitud" inputmode="decimal" placeholder="Ej. -75.8621800" :invalid="showError('longitud')" @blur="onBlur('longitud')" />
                            <small v-if="showError('longitud')" class="text-red-500">{{ errors.longitud }}</small>
                        </div>

                        <div class="flex items-center gap-3 mt-2 md:col-span-2">
                            <Checkbox id="activa" v-model="product.activa" :binary="true" />
                            <label for="activa">Activa</label>
                        </div>
                    </div>
                </div>

                <template #footer>
                    <Button type="button" label="Guardar" icon="pi pi-check" :loading="saving" :disabled="saving" @click="saveProduct" @keydown="onSaveBtnKeydown" />
                    <Button type="button" label="Cancelar" icon="pi pi-times" text :disabled="saving" @click="productDialog = false" />
                </template>
            </Dialog>

            <Dialog v-model:visible="deleteProductDialog" header="Confirmar" :style="{ width: '28rem' }" :modal="true">
                <div>
                    ¿Seguro que quieres eliminar la sede <b>{{ current?.nombre }}</b
                    >?
                </div>
                <template #footer>
                    <Button label="No" icon="pi pi-times" text @click="deleteProductDialog = false" />
                    <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteProduct" />
                </template>
            </Dialog>

            <Dialog v-model:visible="bulkDeleteDialog" header="Confirmar eliminado" :style="{ width: '28rem' }" :modal="true">
                <div>
                    ¿Seguro que quieres eliminar <b>{{ selected.length }}</b> {{ selected.length === 1 ? 'registro' : 'registros' }}?
                </div>
                <template #footer>
                    <Button label="No" icon="pi pi-times" text @click="bulkDeleteDialog = false" />
                    <Button label="Sí" icon="pi pi-check" severity="danger" @click="bulkDelete" />
                </template>
            </Dialog>

            <Dialog v-model:visible="detailsDialog" header="Detalles" :modal="true" :breakpoints="{ '1024px': '70vw', '768px': '85vw', '560px': '95vw' }" :style="{ width: '52vw', maxWidth: '980px' }">
                <div v-if="detailsLoading" class="p-4">Cargando…</div>

                <div v-else class="p-3 sm:p-4">
                    <div v-for="d in details" :key="d.id" class="mb-4 border rounded-lg p-3 sm:p-4">
                        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                            <div class="min-w-0">
                                <div class="text-xs text-surface-500 break-words">Id: {{ d.id }}</div>
                                <div class="text-base font-semibold break-words leading-snug">
                                    {{ d.nombre }}
                                </div>
                                <div class="text-sm text-surface-600 break-words">
                                    {{ d.direccion || 'Sin dirección registrada' }}
                                </div>
                            </div>

                            <div class="flex flex-wrap items-center gap-2 sm:justify-end">
                                <Tag :value="estadoLabel(d.activa)" :severity="estadoSeverity(d.activa)" />
                            </div>
                        </div>

                        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <div class="text-sm font-semibold mb-1">Latitud</div>
                                <div class="border rounded-md p-2 break-words">
                                    {{ formatCoord(d.latitud) }}
                                </div>
                            </div>

                            <div>
                                <div class="text-sm font-semibold mb-1">Longitud</div>
                                <div class="border rounded-md p-2 break-words">
                                    {{ formatCoord(d.longitud) }}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <template #footer>
                    <Button label="Cerrar" icon="pi pi-times" text @click="detailsDialog = false" />
                </template>
            </Dialog>
        </template>
    </div>
</template>
