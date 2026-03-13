<script setup>
import { api } from '@/api';
import { useToast } from 'primevue/usetoast';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';

const API = '/fechas';
const toast = useToast();

const auth = useAuthStore();
const hasPerm = (perm) => auth.hasPermission(perm);

// -------------------------
// Permisos CRUD (Fechas)
// -------------------------
const canViewFechas = computed(() => hasPerm('fechas.view'));
const canCreateFechas = computed(() => hasPerm('fechas.create'));
const canEditFechas = computed(() => hasPerm('fechas.edit'));
const canDeleteFechas = computed(() => hasPerm('fechas.delete'));

const canAccessModule = computed(() => canViewFechas.value);

// -------------------------
// Tabla (server-side)
// -------------------------
const tableUid = `fech-${Math.random().toString(36).slice(2)}`;

const products = ref([]);
const selected = ref([]);
const loading = ref(false);

const page = ref(1);
const rows = ref(10);
const total = ref(0);

const sortField = ref('periodo');
const sortOrder = ref(1);

// Estado “seleccionar todo”
const allSelected = computed(() => selected.value.length > 0 && selected.value.length === products.value.length);
const someSelected = computed(() => selected.value.length > 0 && selected.value.length < products.value.length);
function toggleAll(e) {
    if (e.checked) selected.value = [...products.value];
    else selected.value = [];
}

// -------------------------
// Búsqueda única (debounce)
// -------------------------
const search = ref('');
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
let typingTimer = null;
let activeCtrl = null;

// Orden
const sortParam = computed(() => (!sortField.value ? undefined : `${sortOrder.value === -1 ? '-' : ''}${sortField.value}`));

// Params
function buildParams({ force = false } = {}) {
    const params = { per_page: +rows.value || 10, page: +page.value || 1 };
    if (sortParam.value) params.sort = sortParam.value;

    const raw = String(search.value || '').trim();
    if (raw.length > 0 && (force || raw.length >= MIN_CHARS)) params.q = raw;

    return params;
}

// -------------------------
// Helpers fecha (display)
// -------------------------
function ymd(v) {
    if (!v) return '—';
    if (typeof v === 'string') {
        // si ya viene YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
        const d = new Date(v);
        if (isNaN(d.getTime())) return '—';
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${d.getFullYear()}-${mm}-${dd}`;
    }
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

// -------------------------
// Fetch (con cancelación)
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
        const { data } = await api.get(API, { params: buildParams({ force }), signal });

        if (Array.isArray(data)) {
            products.value = data;
            total.value = data.length;
        } else {
            products.value = data.data ?? [];
            total.value = Number(data.meta?.total ?? products.value.length);
            if (data.meta?.current_page) page.value = Number(data.meta.current_page);
            if (data.meta?.per_page) rows.value = Number(data.meta.per_page);
        }
    } catch (e) {
        const canceled = e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError';
        if (!canceled) {
            const status = e?.response?.status;
            const msg = e?.response?.data?.message || e.message;
            toast.add({ severity: 'error', summary: 'Error al cargar', detail: `[${status ?? 'ERR'}] ${msg}`, life: 6000 });
            products.value = [];
            total.value = 0;
        }
    } finally {
        if (!opts.signal?.aborted) loading.value = false;
    }
}

function scheduleFetch() {
    const raw = String(search.value || '').trim();
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
    const raw = String(search.value || '').trim();

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

// DataTable events
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
// CRUD: crear/editar
// -------------------------
const productDialog = ref(false);
const submitted = ref(false);

const product = ref({
    id: null,
    periodo: '',
    fechaAperturaPreg: null,
    fechaCierreDocentePreg: null,
    fechaCierreJefeDepart: null,
    fechaCierreDecano: null,
    fechaAperturaPostg: null,
    fechaCierreDocentePostg: null,
    fechaCierreCoordinadorPostg: null,
    fechaCierreJefePostg: null
});

const errors = reactive({
    periodo: '',
    fechaAperturaPreg: '',
    fechaCierreDocentePreg: '',
    fechaCierreJefeDepart: '',
    fechaCierreDecano: '',
    fechaAperturaPostg: '',
    fechaCierreDocentePostg: '',
    fechaCierreCoordinadorPostg: '',
    fechaCierreJefePostg: ''
});
const touched = reactive({
    periodo: false,
    fechaAperturaPreg: false,
    fechaCierreDocentePreg: false,
    fechaCierreJefeDepart: false,
    fechaCierreDecano: false,
    fechaAperturaPostg: false,
    fechaCierreDocentePostg: false,
    fechaCierreCoordinadorPostg: false,
    fechaCierreJefePostg: false
});

const isEmpty = (v) => v === null || v === undefined || v === '';
const req = (v) => !isEmpty(v) || 'Requerido.';

const isDateLike = (v) => {
    if (v instanceof Date) return !isNaN(v.getTime());
    if (typeof v === 'string') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
        const d = new Date(`${v}T00:00:00`);
        return !isNaN(d.getTime());
    }
    return false;
};

const date = (v) => isDateLike(v) || 'Fecha inválida (use AAAA-MM-DD).';

const toTime = (v) => (v instanceof Date ? v.getTime() : new Date(`${v}T00:00:00`).getTime());
const gte = (a, b) => !isDateLike(a) || !isDateLike(b) || toTime(a) >= toTime(b);

const rules = {
    periodo: [req, (v) => /^\d{4}-(1|2)$/.test(String(v)) || 'Formato: AAAA-1 o AAAA-2'],
    // Pregrado
    fechaAperturaPreg: [req, date],
    fechaCierreDocentePreg: [req, date, (v) => gte(v, product.value.fechaAperturaPreg) || 'Debe ser ≥ apertura pregrado'],
    fechaCierreJefeDepart: [req, date, (v) => gte(v, product.value.fechaCierreDocentePreg) || 'Debe ser ≥ cierre docente pregrado'],
    fechaCierreDecano: [req, date, (v) => gte(v, product.value.fechaCierreJefeDepart) || 'Debe ser ≥ cierre jefe depart.'],
    // Postgrado
    fechaAperturaPostg: [req, date],
    fechaCierreDocentePostg: [req, date, (v) => gte(v, product.value.fechaAperturaPostg) || 'Debe ser ≥ apertura postgrado'],
    fechaCierreCoordinadorPostg: [req, date, (v) => gte(v, product.value.fechaCierreDocentePostg) || 'Debe ser ≥ cierre docente postgrado'],
    fechaCierreJefePostg: [req, date, (v) => gte(v, product.value.fechaCierreCoordinadorPostg) || 'Debe ser ≥ cierre coordinador postgrado']
};

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
function validateAll() {
    let ok = true;
    Object.keys(rules).forEach((f) => {
        touched[f] = true;
        if (!validateField(f)) ok = false;
    });
    return ok;
}
function resetValidation() {
    Object.keys(errors).forEach((k) => (errors[k] = ''));
    Object.keys(touched).forEach((k) => (touched[k] = false));
}

function toLocalDate(v) {
    if (!v) return null;
    if (v instanceof Date && !isNaN(v.getTime())) return v;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const d = new Date(`${v}T00:00:00`);
        return isNaN(d.getTime()) ? null : d;
    }
    if (typeof v === 'string') {
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }
    if (typeof v === 'number') {
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

function openNew() {
    product.value = {
        id: null,
        periodo: '',
        fechaAperturaPreg: null,
        fechaCierreDocentePreg: null,
        fechaCierreJefeDepart: null,
        fechaCierreDecano: null,
        fechaAperturaPostg: null,
        fechaCierreDocentePostg: null,
        fechaCierreCoordinadorPostg: null,
        fechaCierreJefePostg: null
    };
    resetValidation();
    productDialog.value = true;
}

function editProduct(row) {
    product.value = {
        id: row.id ?? null,
        periodo: row.periodo ?? '',

        // PREGRADO
        fechaAperturaPreg: toLocalDate(row.fechaAperturaPregrado ?? row.fecha_apertura_pregrado),
        fechaCierreDocentePreg: toLocalDate(row.fechaCierreDocentePregrado ?? row.fecha_cierre_docente_pregrado),
        fechaCierreJefeDepart: toLocalDate(row.fechaCierreJefeDepartamento ?? row.fecha_cierre_jefe_departamento),
        fechaCierreDecano: toLocalDate(row.fechaCierreDecano ?? row.fecha_cierre_decano),

        // POSTGRADO
        fechaAperturaPostg: toLocalDate(row.fechaAperturaPostgrado ?? row.fecha_apertura_postgrado),
        fechaCierreDocentePostg: toLocalDate(row.fechaCierreDocentePostgrado ?? row.fecha_cierre_docente_postgrado),
        fechaCierreCoordinadorPostg: toLocalDate(row.fechaCierreCoordinadorPostgrado ?? row.fecha_cierre_coordinador_postgrado),
        fechaCierreJefePostg: toLocalDate(row.fechaCierreJefePostgrado ?? row.fecha_cierre_jefe_postgrado)
    };

    resetValidation();
    productDialog.value = true;
}

const FIELD_MAP = {
    periodo: 'periodo',

    // PREGRADO
    fechaAperturaPreg: 'fecha_apertura_pregrado',
    fechaCierreDocentePreg: 'fecha_cierre_docente_pregrado',
    fechaCierreJefeDepart: 'fecha_cierre_jefe_departamento',
    fechaCierreDecano: 'fecha_cierre_decano',

    // POSTGRADO
    fechaAperturaPostg: 'fecha_apertura_postgrado',
    fechaCierreDocentePostg: 'fecha_cierre_docente_postgrado',
    fechaCierreCoordinadorPostg: 'fecha_cierre_coordinador_postgrado',
    fechaCierreJefePostg: 'fecha_cierre_jefe_postgrado'
};

function buildPayload() {
    const out = {};
    for (const [camel, snake] of Object.entries(FIELD_MAP)) {
        const v = product.value[camel];
        out[snake] = camel === 'periodo' ? v : v ? ymd(v) : null;
    }
    return out;
}

function applyServerErrors(errs = {}) {
    const snakeToCamel = Object.fromEntries(Object.entries(FIELD_MAP).map(([camel, snake]) => [snake, camel]));
    for (const [snake, msgs] of Object.entries(errs)) {
        const camel = snakeToCamel[snake] ?? snake;
        if (camel in errors) {
            errors[camel] = Array.isArray(msgs) ? String(msgs[0]) : String(msgs);
            touched[camel] = true;
        }
    }
}

async function saveProduct() {
    submitted.value = true;

    if (!validateAll()) {
        toast.add({ severity: 'warn', summary: 'Valida el formulario', detail: 'Corrige los campos marcados en rojo.', life: 3000 });
        return;
    }

    try {
        const payload = buildPayload();

        if (product.value.id) {
            await api.patch(`${API}/${product.value.id}`, payload);
            toast.add({ severity: 'success', summary: 'Actualizado', life: 2500 });
        } else {
            await api.post(API, payload);
            toast.add({ severity: 'success', summary: 'Creado', life: 2500 });
        }

        productDialog.value = false;
        await getProducts({ force: true });
    } catch (e) {
        if (e?.response?.status === 422) {
            applyServerErrors(e.response.data?.errors || {});
        }
        const detail = e?.response?.data?.message || e?.response?.data?.error || e.message;
        toast.add({ severity: 'error', summary: 'No se pudo guardar', detail: String(detail), life: 5000 });
    } finally {
        submitted.value = false;
    }
}

// -------------------------
// Borrado (individual + bulk)
// -------------------------
const deleteProductDialog = ref(false);
const current = ref(null);

function confirmDeleteProduct(row) {
    current.value = { ...row };
    deleteProductDialog.value = true;
}

async function deleteProduct() {
    try {
        await api.delete(`${API}/${current.value.id}`);

        products.value = products.value.filter((x) => x.id !== current.value.id);
        toast.add({ severity: 'success', summary: 'Eliminado', life: 2500 });

        await refreshAfterDelete(1);
    } catch (e) {
        toast.add({
            severity: 'error',
            summary: 'No se pudo eliminar',
            detail: String(e?.response?.data?.message || e.message),
            life: 5000
        });
    } finally {
        deleteProductDialog.value = false;
        current.value = null;
    }
}

const bulkDeleteDialog = ref(false);

function confirmBulkDelete() {
    if (!selected.value.length) return;
    bulkDeleteDialog.value = true;
}

async function bulkDelete() {
    const ids = selected.value.map((r) => r.id);

    try {
        await api.post(`${API}/bulk-delete`, { ids });

        const set = new Set(ids);
        products.value = products.value.filter((x) => !set.has(x.id));
        selected.value = [];

        toast.add({ severity: 'success', summary: `Eliminados (${ids.length})`, life: 2500 });

        await refreshAfterDelete(ids.length);
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

function refreshAfterDelete(deletedCount = 1) {
    total.value = Math.max(0, Number(total.value) - Number(deletedCount));

    const r = Number(rows.value) || 10;
    const totalPages = Math.max(1, Math.ceil(total.value / r));
    if (Number(page.value) > totalPages) page.value = totalPages;

    return getProducts({ force: true });
}

// -------------------------
// Lifecycle
// -------------------------
onMounted(() => getProducts());

onBeforeUnmount(() => {
    if (typingTimer) clearTimeout(typingTimer);
    if (activeCtrl) activeCtrl.abort();
});
</script>

<template>
    <div class="card">
        <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
                <h2 class="text-lg font-semibold m-0">Fechas</h2>
            </div>
        </div>

        <div v-if="!canAccessModule" class="p-4 border rounded bg-surface-50 text-surface-700">No tienes permisos para ver este módulo.</div>

        <template v-else>
            <Toolbar class="mb-3">
                <template #start>
                    <div class="flex items-center gap-2 shrink-0">
                        <Button v-if="canCreateFechas" label="Crear" icon="pi pi-plus" @click="openNew" />
                        <Button v-if="canDeleteFechas" label="Borrar" icon="pi pi-trash" :disabled="!selected.length" @click="confirmBulkDelete" />
                    </div>
                </template>

                <template #center />

                <template #end>
                    <form role="search" class="min-w-0 w-full sm:w-80 md:w-[26rem]" @submit.prevent="forceFetch">
                        <IconField class="w-full p-input-icon-left relative">
                            <InputIcon :class="loading ? 'pi pi-spinner pi-spin' : 'pi pi-search'" />
                            <InputText
                                id="fechSearch"
                                name="fechSearch"
                                v-model.trim="search"
                                role="searchbox"
                                placeholder="Escribe para buscar…"
                                class="w-full h-10 leading-10 pr-8"
                                autocomplete="off"
                                @keydown.enter.prevent="forceFetch"
                                @keydown.esc.prevent="clearSearch"
                            />
                            <button v-if="search" type="button" class="absolute right-3 top-1/2 -translate-y-1/2" @click="clearSearch" aria-label="Limpiar búsqueda">X</button>
                        </IconField>
                    </form>
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
                :rowsPerPageOptions="[5, 10, 25, 50]"
                currentPageReportTemplate="Mostrando desde {first} hasta {last} de {totalRecords}"
                emptyMessage="No hay registros"
                responsiveLayout="scroll"
                :scrollable="true"
                tableStyle="width: 100%; min-width: 1100px;"
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
                        <Checkbox v-model="selected" :value="data" :inputId="`${tableUid}-row-${index + 1}`" name="fech-row-select" :aria-label="`Seleccionar fila ${index + 1}`" />
                    </template>
                </Column>

                <Column field="periodo" header="Periodo" sortable style="width: 8rem; max-width: 8rem" />

                <Column field="fechaAperturaPregrado" header="Apertura Pregrado" sortable style="width: 12rem; max-width: 12rem">
                    <template #body="{ data }">{{ ymd(data.fechaAperturaPregrado ?? data.fecha_apertura_pregrado) }}</template>
                </Column>

                <Column field="fechaCierreDocentePregrado" header="Cierre Docente (Pregrado)" sortable style="width: 14rem; max-width: 14rem">
                    <template #body="{ data }">{{ ymd(data.fechaCierreDocentePregrado ?? data.fecha_cierre_docente_pregrado) }}</template>
                </Column>

                <Column field="fechaAperturaPostgrado" header="Apertura Postgrado" sortable style="width: 12rem; max-width: 12rem">
                    <template #body="{ data }">{{ ymd(data.fechaAperturaPostgrado ?? data.fecha_apertura_postgrado) }}</template>
                </Column>

                <Column field="fechaCierreDocentePostgrado" header="Cierre Docente (Postgrado)" sortable style="width: 14rem; max-width: 14rem">
                    <template #body="{ data }">{{ ymd(data.fechaCierreDocentePostgrado ?? data.fecha_cierre_docente_postgrado) }}</template>
                </Column>

                <Column :exportable="false" headerStyle="width:9rem">
                    <template #body="{ data }">
                        <Button v-if="canEditFechas" icon="pi pi-pencil" rounded text class="mr-1" @click.stop="editProduct(data)" />
                        <Button v-if="canDeleteFechas" icon="pi pi-trash" rounded text severity="danger" @click.stop="confirmDeleteProduct(data)" />
                    </template>
                </Column>
            </DataTable>

            <!-- Crear/Editar -->
            <Dialog v-model:visible="productDialog" header="Crear Fechas por periodo" :style="{ width: '36rem' }" :modal="true">
                <div class="flex flex-col gap-4">
                    <div class="flex flex-col gap-2">
                        <label for="periodo">Periodo</label>
                        <InputText id="periodo" v-model.trim="product.periodo" placeholder="2025-1" :invalid="showError('periodo')" @blur="onBlur('periodo')" fluid />
                        <small v-if="showError('periodo')" class="text-red-500">{{ errors.periodo }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="fechaAperturaPreg">Fecha apertura (Pregrado)</label>
                        <DatePicker inputId="fechaAperturaPreg" v-model="product.fechaAperturaPreg" :invalid="showError('fechaAperturaPreg')" @update:modelValue="onBlur('fechaAperturaPreg')" dateFormat="yy-mm-dd" showIcon fluid />
                        <small v-if="showError('fechaAperturaPreg')" class="text-red-500">{{ errors.fechaAperturaPreg }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="fechaCierreDocentePreg">Fecha cierre solicitud de programación (Pregrado)</label>
                        <DatePicker inputId="fechaCierreDocentePreg" v-model="product.fechaCierreDocentePreg" :invalid="showError('fechaCierreDocentePreg')" @update:modelValue="onBlur('fechaCierreDocentePreg')" dateFormat="yy-mm-dd" showIcon fluid />
                        <small v-if="showError('fechaCierreDocentePreg')" class="text-red-500">{{ errors.fechaCierreDocentePreg }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="fechaCierreJefeDepart">Fecha cierre revisión jefe de departamento</label>
                        <DatePicker inputId="fechaCierreJefeDepart" v-model="product.fechaCierreJefeDepart" :invalid="showError('fechaCierreJefeDepart')" @update:modelValue="onBlur('fechaCierreJefeDepart')" dateFormat="yy-mm-dd" showIcon fluid />
                        <small v-if="showError('fechaCierreJefeDepart')" class="text-red-500">{{ errors.fechaCierreJefeDepart }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="fechaCierreDecano">Fecha cierre revisión decano</label>
                        <DatePicker inputId="fechaCierreDecano" v-model="product.fechaCierreDecano" :invalid="showError('fechaCierreDecano')" @update:modelValue="onBlur('fechaCierreDecano')" dateFormat="yy-mm-dd" showIcon fluid />
                        <small v-if="showError('fechaCierreDecano')" class="text-red-500">{{ errors.fechaCierreDecano }}</small>
                    </div>

                    <!-- Postgrado -->
                    <div class="flex flex-col gap-2">
                        <label for="fechaAperturaPostg">Fecha apertura (Postgrado)</label>
                        <DatePicker inputId="fechaAperturaPostg" v-model="product.fechaAperturaPostg" :invalid="showError('fechaAperturaPostg')" @update:modelValue="onBlur('fechaAperturaPostg')" dateFormat="yy-mm-dd" showIcon fluid />
                        <small v-if="showError('fechaAperturaPostg')" class="text-red-500">{{ errors.fechaAperturaPostg }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="fechaCierreDocentePostg">Fecha cierre solicitud de programación (Postgrado)</label>
                        <DatePicker
                            inputId="fechaCierreDocentePostg"
                            v-model="product.fechaCierreDocentePostg"
                            :invalid="showError('fechaCierreDocentePostg')"
                            @update:modelValue="onBlur('fechaCierreDocentePostg')"
                            dateFormat="yy-mm-dd"
                            showIcon
                            fluid
                        />
                        <small v-if="showError('fechaCierreDocentePostg')" class="text-red-500">{{ errors.fechaCierreDocentePostg }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="fechaCierreCoordinadorPostg">Fecha cierre revisión coordinador postgrados</label>
                        <DatePicker
                            inputId="fechaCierreCoordinadorPostg"
                            v-model="product.fechaCierreCoordinadorPostg"
                            :invalid="showError('fechaCierreCoordinadorPostg')"
                            @update:modelValue="onBlur('fechaCierreCoordinadorPostg')"
                            dateFormat="yy-mm-dd"
                            showIcon
                            fluid
                        />
                        <small v-if="showError('fechaCierreCoordinadorPostg')" class="text-red-500">{{ errors.fechaCierreCoordinadorPostg }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="fechaCierreJefePostg">Fecha cierre jefe postgrados</label>
                        <DatePicker inputId="fechaCierreJefePostg" v-model="product.fechaCierreJefePostg" :invalid="showError('fechaCierreJefePostg')" @update:modelValue="onBlur('fechaCierreJefePostg')" dateFormat="yy-mm-dd" showIcon fluid />
                        <small v-if="showError('fechaCierreJefePostg')" class="text-red-500">{{ errors.fechaCierreJefePostg }}</small>
                    </div>
                </div>

                <template #footer>
                    <Button label="Guardar" icon="pi pi-check" @click="saveProduct" />
                    <Button label="Cancelar" icon="pi pi-times" text @click="productDialog = false" />
                </template>
            </Dialog>

            <!-- Confirmación de borrado -->
            <Dialog v-model:visible="deleteProductDialog" header="Confirmar" :style="{ width: '28rem' }" :modal="true">
                <div>
                    ¿Seguro que quieres eliminar el periodo <b>{{ current?.periodo }}</b
                    >?
                </div>
                <template #footer>
                    <Button label="No" icon="pi pi-times" text @click="deleteProductDialog = false" />
                    <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteProduct" />
                </template>
            </Dialog>

            <!-- Borrado masivo -->
            <Dialog v-model:visible="bulkDeleteDialog" header="Confirmar eliminado" :style="{ width: '28rem' }" :modal="true">
                <div>
                    ¿Seguro que quieres eliminar <b>{{ selected.length }}</b> {{ selected.length === 1 ? 'registro' : 'registros' }}?
                </div>
                <template #footer>
                    <Button label="No" icon="pi pi-times" text @click="bulkDeleteDialog = false" />
                    <Button label="Sí" icon="pi pi-check" severity="danger" @click="bulkDelete" />
                </template>
            </Dialog>
        </template>
    </div>
</template>
