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
const tableUid = `aux-${Math.random().toString(36).slice(2)}`;
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
const sortField = ref('acuerdo');
const sortOrder = ref(1);

// -------------------------
// Permisos
// -------------------------
const canViewAuxilios = computed(() => hasPerm('auxilios.view'));
const canCreateAuxilios = computed(() => hasPerm('auxilios.create'));
const canEditAuxilios = computed(() => hasPerm('auxilios.edit'));
const canDeleteAuxilios = computed(() => hasPerm('auxilios.delete'));
const canAccessModule = computed(() => canViewAuxilios.value);

// -------------------------
// Endpoints
// -------------------------
const API_AUX = '/auxilios';

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
function estadoLabel(v) {
    return v ? 'Activo' : 'Inactivo';
}

function estadoSeverity(v) {
    return v ? 'success' : 'danger';
}

function formatFixed(value, digits = 6) {
    if (value == null || value === '') return '—';
    const n = Number(value);
    if (Number.isNaN(n)) return String(value);
    return n.toFixed(digits);
}

function formatDate(value) {
    return value || '—';
}

function s(v) {
    return v == null ? '' : String(v);
}

// -------------------------
// Sort mapping
// -------------------------
const SORT_MAP = {
    id: 'id',
    acuerdo: 'acuerdo',
    vigente_desde: 'vigente_desde',
    vigente_hasta: 'vigente_hasta',
    tasa_docente_cordoba_pernocta: 'tasa_docente_cordoba_pernocta',
    tasa_docente_fuera_pernocta: 'tasa_docente_fuera_pernocta',
    factor_sin_pernocta: 'factor_sin_pernocta',
    umbral_km_fuera: 'umbral_km_fuera',
    tasa_estudiante: 'tasa_estudiante',
    estado: 'estado',
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
        const { data } = await api.get(API_AUX, {
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
        const reqs = selected.value.map((r) => api.get(`${API_AUX}/${r.id}`));
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
    acuerdo: '',
    vigente_desde: '',
    vigente_hasta: '',
    tasa_docente_cordoba_pernocta: null,
    tasa_docente_fuera_pernocta: null,
    factor_sin_pernocta: 0.5,
    umbral_km_fuera: 70,
    tasa_estudiante: null,
    estado: true
});

const product = ref(defaults());

const errors = reactive({
    acuerdo: '',
    vigente_desde: '',
    vigente_hasta: '',
    tasa_docente_cordoba_pernocta: '',
    tasa_docente_fuera_pernocta: '',
    factor_sin_pernocta: '',
    umbral_km_fuera: '',
    tasa_estudiante: '',
    estado: ''
});

const touched = reactive({
    acuerdo: false,
    vigente_desde: false,
    vigente_hasta: false,
    tasa_docente_cordoba_pernocta: false,
    tasa_docente_fuera_pernocta: false,
    factor_sin_pernocta: false,
    umbral_km_fuera: false,
    tasa_estudiante: false,
    estado: false
});

const rules = {
    acuerdo: [(v) => !!s(v).trim() || 'Requerido.'],
    vigente_desde: [(v) => !!s(v).trim() || 'Requerido.'],
    vigente_hasta: [(v) => !v || !product.value.vigente_desde || String(v) >= String(product.value.vigente_desde) || 'Debe ser mayor o igual a vigente desde.'],
    tasa_docente_cordoba_pernocta: [(v) => (v !== null && v !== '') || 'Requerido.', (v) => Number(v) >= 0 || 'Debe ser mayor o igual a 0.'],
    tasa_docente_fuera_pernocta: [(v) => (v !== null && v !== '') || 'Requerido.', (v) => Number(v) >= 0 || 'Debe ser mayor o igual a 0.'],
    factor_sin_pernocta: [(v) => (v !== null && v !== '') || 'Requerido.', (v) => Number(v) >= 0 || 'Debe ser mayor o igual a 0.', (v) => Number(v) <= 1 || 'Debe ser menor o igual a 1.'],
    umbral_km_fuera: [(v) => (v !== null && v !== '') || 'Requerido.', (v) => Number.isInteger(Number(v)) || 'Debe ser un entero.', (v) => Number(v) >= 0 || 'Debe ser mayor o igual a 0.', (v) => Number(v) <= 9999 || 'Debe ser menor o igual a 9999.'],
    tasa_estudiante: [(v) => (v !== null && v !== '') || 'Requerido.', (v) => Number(v) >= 0 || 'Debe ser mayor o igual a 0.'],
    estado: []
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

    if (f === 'vigente_desde' && touched.vigente_hasta) {
        validateField('vigente_hasta');
    }
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
        acuerdo: row.acuerdo ?? '',
        vigente_desde: row.vigente_desde ?? '',
        vigente_hasta: row.vigente_hasta ?? '',
        tasa_docente_cordoba_pernocta: row.tasa_docente_cordoba_pernocta != null ? Number(row.tasa_docente_cordoba_pernocta) : null,
        tasa_docente_fuera_pernocta: row.tasa_docente_fuera_pernocta != null ? Number(row.tasa_docente_fuera_pernocta) : null,
        factor_sin_pernocta: row.factor_sin_pernocta != null ? Number(row.factor_sin_pernocta) : 0.5,
        umbral_km_fuera: row.umbral_km_fuera != null ? Number(row.umbral_km_fuera) : 70,
        tasa_estudiante: row.tasa_estudiante != null ? Number(row.tasa_estudiante) : null,
        estado: !!row.estado
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
    acuerdo: 'acuerdo',
    vigente_desde: 'vigente_desde',
    vigente_hasta: 'vigente_hasta',
    tasa_docente_cordoba_pernocta: 'tasa_docente_cordoba_pernocta',
    tasa_docente_fuera_pernocta: 'tasa_docente_fuera_pernocta',
    factor_sin_pernocta: 'factor_sin_pernocta',
    umbral_km_fuera: 'umbral_km_fuera',
    tasa_estudiante: 'tasa_estudiante',
    estado: 'estado'
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

    const fields = ['acuerdo', 'vigente_desde', 'vigente_hasta', 'tasa_docente_cordoba_pernocta', 'tasa_docente_fuera_pernocta', 'factor_sin_pernocta', 'umbral_km_fuera', 'tasa_estudiante'];

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
        acuerdo: s(product.value.acuerdo).trim(),
        vigente_desde: product.value.vigente_desde,
        vigente_hasta: product.value.vigente_hasta || null,
        tasa_docente_cordoba_pernocta: product.value.tasa_docente_cordoba_pernocta,
        tasa_docente_fuera_pernocta: product.value.tasa_docente_fuera_pernocta,
        factor_sin_pernocta: product.value.factor_sin_pernocta,
        umbral_km_fuera: product.value.umbral_km_fuera,
        tasa_estudiante: product.value.tasa_estudiante,
        estado: !!product.value.estado
    };

    try {
        saving.value = true;

        if (product.value.id) {
            await api.patch(`${API_AUX}/${product.value.id}`, payload);
            toast.add({
                severity: 'success',
                summary: 'Actualizado',
                detail: 'El auxilio fue actualizado correctamente.',
                life: 3500
            });
        } else {
            await api.post(API_AUX, payload);
            toast.add({
                severity: 'success',
                summary: 'Creado',
                detail: 'El auxilio fue creado correctamente.',
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
            severity: status === 409 ? 'warn' : 'error',
            summary: status === 409 ? 'Conflicto de vigencia' : 'No se pudo guardar',
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
        await api.delete(`${API_AUX}/${current.value.id}`);
        products.value = products.value.filter((x) => x.id !== current.value.id);
        toast.add({ severity: 'success', summary: 'Eliminado', life: 2500 });
        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.message || e.message;
        toast.add({
            severity: status === 409 ? 'warn' : 'error',
            summary: status === 409 ? 'No se puede eliminar' : 'No se pudo eliminar',
            detail: `[${status ?? 'ERR'}] ${msg}`,
            life: 5000
        });
    } finally {
        deleteProductDialog.value = false;
        current.value = null;
    }
}

const bulkDeleteDialog = ref(false);
const canBulkDelete = computed(() => canDeleteAuxilios.value && selected.value.length > 0);

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
        await api.post(`${API_AUX}/bulk-delete`, { ids });

        const set = new Set(ids);
        products.value = products.value.filter((x) => !set.has(x.id));
        selected.value = [];

        toast.add({
            severity: 'success',
            summary: `Eliminados (${ids.length})`,
            life: 2500
        });

        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.message || e.message;
        toast.add({
            severity: status === 409 ? 'warn' : 'error',
            summary: status === 409 ? 'No se puede eliminar' : 'Error al eliminar',
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
                <h2 class="text-lg font-semibold m-0">Auxilios</h2>
            </div>
        </div>

        <div v-if="!canAccessModule" class="p-4 border rounded bg-surface-50 text-surface-700">No tienes permisos para ver este módulo.</div>

        <template v-else>
            <Toolbar class="mb-3">
                <template #start>
                    <div class="flex items-center gap-2 shrink-0">
                        <Button v-if="canCreateAuxilios" label="Crear" icon="pi pi-plus" @click="openNew" />
                        <Button v-if="canDeleteAuxilios" label="Borrar" icon="pi pi-trash" :disabled="!canBulkDelete" @click="confirmBulkDelete" />
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
                                    id="auxSearch"
                                    name="auxSearch"
                                    v-model.trim="search"
                                    role="searchbox"
                                    placeholder="Buscar por acuerdo…"
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
                tableStyle="width: 100%; min-width: 1050px;"
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

                <Column field="acuerdo" header="Acuerdo" sortable style="min-width: 18rem; max-width: 28rem">
                    <template #body="{ data }">
                        <span class="block overflow-hidden text-ellipsis whitespace-nowrap" v-tooltip.top="data.acuerdo">
                            {{ data.acuerdo }}
                        </span>
                    </template>
                </Column>

                <Column field="tasa_docente_cordoba_pernocta" header="Tasa docente" sortable style="min-width: 12rem">
                    <template #body="{ data }">
                        {{ formatFixed(data.tasa_docente_cordoba_pernocta) }}
                    </template>
                </Column>

                <Column field="tasa_estudiante" header="Tasa estudiante" sortable style="min-width: 12rem">
                    <template #body="{ data }">
                        {{ formatFixed(data.tasa_estudiante) }}
                    </template>
                </Column>

                <Column field="factor_sin_pernocta" header="Factor sin pernocta" sortable style="min-width: 12rem">
                    <template #body="{ data }">
                        {{ formatFixed(data.factor_sin_pernocta) }}
                    </template>
                </Column>

                <Column field="estado" header="Estado" sortable style="width: 10rem; max-width: 10rem">
                    <template #body="{ data }">
                        <Tag :value="estadoLabel(data.estado)" :severity="estadoSeverity(data.estado)" />
                    </template>
                </Column>
                <Column :exportable="false" headerStyle="width:9rem">
                    <template #body="{ data }">
                        <Button v-if="canEditAuxilios" icon="pi pi-pencil" rounded text class="mr-1" @click.stop="editProduct(data)" />
                        <Button v-if="canDeleteAuxilios" icon="pi pi-trash" rounded text severity="danger" @click.stop="confirmDeleteProduct(data)" />
                    </template>
                </Column>
            </DataTable>

            <Dialog v-model:visible="productDialog" :header="product.id ? 'Editar auxilio' : 'Crear auxilio'" :style="{ width: '44rem' }" :modal="true">
                <div class="flex flex-col gap-4" @keydown.capture="onFormKeyCapture">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="flex flex-col gap-2 md:col-span-2">
                            <label for="acuerdo">Acuerdo</label>
                            <InputText id="acuerdo" name="acuerdo" v-model.trim="product.acuerdo" :invalid="showError('acuerdo')" @blur="onBlur('acuerdo')" @keydown.space.stop />
                            <small v-if="showError('acuerdo')" class="text-red-500">{{ errors.acuerdo }}</small>
                        </div>

                        <div class="flex flex-col gap-2">
                            <label for="vigente_desde">Vigente desde</label>
                            <input id="vigente_desde" v-model="product.vigente_desde" type="date" class="p-inputtext p-component w-full" :class="{ 'p-invalid': showError('vigente_desde') }" @blur="onBlur('vigente_desde')" />
                            <small v-if="showError('vigente_desde')" class="text-red-500">{{ errors.vigente_desde }}</small>
                        </div>

                        <div class="flex flex-col gap-2">
                            <label for="vigente_hasta">Vigente hasta</label>
                            <input id="vigente_hasta" v-model="product.vigente_hasta" type="date" class="p-inputtext p-component w-full" :class="{ 'p-invalid': showError('vigente_hasta') }" @blur="onBlur('vigente_hasta')" />
                            <small v-if="showError('vigente_hasta')" class="text-red-500">{{ errors.vigente_hasta }}</small>
                        </div>

                        <div class="flex flex-col gap-2">
                            <label for="tasa_docente_cordoba_pernocta">Tasa docente Córdoba pernocta</label>
                            <InputNumber
                                id="tasa_docente_cordoba_pernocta"
                                v-model="product.tasa_docente_cordoba_pernocta"
                                mode="decimal"
                                :min="0"
                                :step="0.000001"
                                :maxFractionDigits="6"
                                :useGrouping="false"
                                class="w-full"
                                inputClass="w-full"
                                :invalid="showError('tasa_docente_cordoba_pernocta')"
                                @blur="onBlur('tasa_docente_cordoba_pernocta')"
                            />
                            <small v-if="showError('tasa_docente_cordoba_pernocta')" class="text-red-500">{{ errors.tasa_docente_cordoba_pernocta }}</small>
                        </div>

                        <div class="flex flex-col gap-2">
                            <label for="tasa_docente_fuera_pernocta">Tasa docente fuera pernocta</label>
                            <InputNumber
                                id="tasa_docente_fuera_pernocta"
                                v-model="product.tasa_docente_fuera_pernocta"
                                mode="decimal"
                                :min="0"
                                :step="0.000001"
                                :maxFractionDigits="6"
                                :useGrouping="false"
                                class="w-full"
                                inputClass="w-full"
                                :invalid="showError('tasa_docente_fuera_pernocta')"
                                @blur="onBlur('tasa_docente_fuera_pernocta')"
                            />
                            <small v-if="showError('tasa_docente_fuera_pernocta')" class="text-red-500">{{ errors.tasa_docente_fuera_pernocta }}</small>
                        </div>

                        <div class="flex flex-col gap-2">
                            <label for="factor_sin_pernocta">Factor sin pernocta</label>
                            <InputNumber
                                id="factor_sin_pernocta"
                                v-model="product.factor_sin_pernocta"
                                mode="decimal"
                                :min="0"
                                :max="1"
                                :step="0.000001"
                                :maxFractionDigits="6"
                                :useGrouping="false"
                                class="w-full"
                                inputClass="w-full"
                                :invalid="showError('factor_sin_pernocta')"
                                @blur="onBlur('factor_sin_pernocta')"
                            />
                            <small v-if="showError('factor_sin_pernocta')" class="text-red-500">{{ errors.factor_sin_pernocta }}</small>
                        </div>

                        <div class="flex flex-col gap-2">
                            <label for="umbral_km_fuera">Umbral km fuera</label>
                            <InputNumber
                                id="umbral_km_fuera"
                                v-model="product.umbral_km_fuera"
                                mode="decimal"
                                :min="0"
                                :step="1"
                                :maxFractionDigits="0"
                                :useGrouping="false"
                                class="w-full"
                                inputClass="w-full"
                                :invalid="showError('umbral_km_fuera')"
                                @blur="onBlur('umbral_km_fuera')"
                            />
                            <small v-if="showError('umbral_km_fuera')" class="text-red-500">{{ errors.umbral_km_fuera }}</small>
                        </div>

                        <div class="flex flex-col gap-2">
                            <label for="tasa_estudiante">Tasa estudiante</label>
                            <InputNumber
                                id="tasa_estudiante"
                                v-model="product.tasa_estudiante"
                                mode="decimal"
                                :min="0"
                                :step="0.000001"
                                :maxFractionDigits="6"
                                :useGrouping="false"
                                class="w-full"
                                inputClass="w-full"
                                :invalid="showError('tasa_estudiante')"
                                @blur="onBlur('tasa_estudiante')"
                            />
                            <small v-if="showError('tasa_estudiante')" class="text-red-500">{{ errors.tasa_estudiante }}</small>
                        </div>

                        <div class="flex items-center gap-3 mt-2">
                            <Checkbox id="estado" v-model="product.estado" :binary="true" />
                            <label for="estado">Activo</label>
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
                    ¿Seguro que quieres eliminar el auxilio <b>{{ current?.acuerdo }}</b
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
                                    {{ d.acuerdo }}
                                </div>
                            </div>

                            <div class="flex flex-wrap items-center gap-2 sm:justify-end">
                                <Tag :value="estadoLabel(d.estado)" :severity="estadoSeverity(d.estado)" />
                            </div>
                        </div>

                        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <div class="text-sm font-semibold mb-1">Vigente desde</div>
                                <div class="border rounded-md p-2 break-words">
                                    {{ formatDate(d.vigente_desde) }}
                                </div>
                            </div>

                            <div>
                                <div class="text-sm font-semibold mb-1">Vigente hasta</div>
                                <div class="border rounded-md p-2 break-words">
                                    {{ formatDate(d.vigente_hasta) }}
                                </div>
                            </div>

                            <div>
                                <div class="text-sm font-semibold mb-1">Tasa docente Córdoba pernocta</div>
                                <div class="border rounded-md p-2 break-words">
                                    {{ formatFixed(d.tasa_docente_cordoba_pernocta) }}
                                </div>
                            </div>

                            <div>
                                <div class="text-sm font-semibold mb-1">Tasa docente fuera pernocta</div>
                                <div class="border rounded-md p-2 break-words">
                                    {{ formatFixed(d.tasa_docente_fuera_pernocta) }}
                                </div>
                            </div>

                            <div>
                                <div class="text-sm font-semibold mb-1">Tasa estudiante</div>
                                <div class="border rounded-md p-2 break-words">
                                    {{ formatFixed(d.tasa_estudiante) }}
                                </div>
                            </div>

                            <div>
                                <div class="text-sm font-semibold mb-1">Factor sin pernocta</div>
                                <div class="border rounded-md p-2 break-words">
                                    {{ formatFixed(d.factor_sin_pernocta) }}
                                </div>
                            </div>

                            <div>
                                <div class="text-sm font-semibold mb-1">Umbral km fuera</div>
                                <div class="border rounded-md p-2 break-words">
                                    {{ d.umbral_km_fuera ?? '—' }}
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
