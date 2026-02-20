<script setup>
import { ref, reactive, computed, onMounted, watch, onBeforeUnmount } from 'vue';
import { useToast } from 'primevue/usetoast';
import { api, ensureCsrf } from '@/api';
import { useAuthStore } from '@/stores/auth';

const toast = useToast();
const auth = useAuthStore();
const hasPerm = (perm) => auth.hasPermission(perm);

// -------------------------
// Permisos CRUD (Catálogos)
// -------------------------
const canViewCatalogos = computed(() => hasPerm('catalogos.view'));
const canCreateCatalogos = computed(() => hasPerm('catalogos.create'));
const canEditCatalogos = computed(() => hasPerm('catalogos.edit'));
const canDeleteCatalogos = computed(() => hasPerm('catalogos.delete'));

const canAccessModule = computed(() => canViewCatalogos.value);

// -------------------------
// Endpoints (SOLO CRUD)
// -------------------------
const API_CAT = '/catalogos';
const API_CAT_BULK = '/catalogos/bulk';

// -------------------------
// Tabla base
// -------------------------
const tableUid = `cat-${Math.random().toString(36).slice(2)}`;

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
const sortField = ref('facultad');
const sortOrder = ref(1);

const search = ref('');
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
let typingTimer = null;
let activeCtrl = null;

// -------------------------
// Parametrización (sort/search/paginación)
// -------------------------
const SORT_MAP_CAT = {
    id: 'id',
    nivelAcademico: 'nivel_academico',
    facultad: 'facultad',
    programaAcademico: 'programa_academico',
    estado: 'estado',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
};

function mapSort(uiField, order, map) {
    if (!uiField) return undefined;
    const apiField = map[uiField];
    if (!apiField) return undefined;
    return `${order === -1 ? '-' : ''}${apiField}`;
}

const sortParamCat = computed(() => mapSort(sortField.value, sortOrder.value, SORT_MAP_CAT));

function buildParams({ force = false } = {}) {
    const params = { per_page: +rows.value || 10, page: +page.value || 1 };
    const sp = sortParamCat.value;
    if (sp) params.sort = sp;

    const raw = String(search.value || '').trim();
    if (raw.length > 0 && (force || raw.length >= MIN_CHARS)) params.q = raw;

    return params;
}

// -------------------------
// Fetch principal (SOLO CRUD)
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
        const { data } = await api.get(API_CAT, { params: buildParams({ force }), signal });

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
            toast.add({ severity: 'error', summary: 'Error al cargar', detail: `[${status ?? 'ERR'}] ${msg}`, life: 6500 });
            products.value = [];
            total.value = 0;
        }
    } finally {
        if (!opts.signal?.aborted) loading.value = false;
    }
}

// -------------------------
// Search debounce
// -------------------------
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
// Detalles (Auditoría central = createdAt/updatedAt)
// -------------------------
const detailsDialog = ref(false);
const detailsLoading = ref(false);
const details = ref([]);

async function openDetails() {
    if (!selected.value.length) return;
    detailsLoading.value = true;
    details.value = [];

    try {
        const reqs = selected.value.map((r) => api.get(`${API_CAT}/${r.id}`));
        const results = await Promise.allSettled(reqs);
        details.value = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.data?.data ?? r.value.data);
    } finally {
        detailsDialog.value = true;
        detailsLoading.value = false;
    }
}

// -------------------------
// CRUD
// -------------------------
const productDialog = ref(false);
const product = ref({ id: null, nivelAcademico: 'pregrado', facultad: '', programaAcademico: '' });

const nivelOptions = [
    { label: 'Pregrado', value: 'pregrado' },
    { label: 'Postgrado', value: 'postgrado' }
];

const errors = reactive({ nivelAcademico: '', facultad: '', programaAcademico: '' });
const touched = reactive({ nivelAcademico: false, facultad: false, programaAcademico: false });

const rules = {
    nivelAcademico: [(v) => !!v || 'Requerido.'],
    facultad: [(v) => !!v || 'Requerido.'],
    programaAcademico: [(v) => !!v || 'Requerido.']
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
    product.value = { id: null, nivelAcademico: 'pregrado', facultad: '', programaAcademico: '' };
    resetValidation();
    productDialog.value = true;
}
function editProduct(row) {
    product.value = {
        id: row.id ?? null,
        nivelAcademico: row.nivelAcademico ?? row.nivel_academico ?? 'pregrado',
        facultad: row.facultad ?? '',
        programaAcademico: row.programaAcademico ?? row.programa_academico ?? ''
    };
    resetValidation();
    productDialog.value = true;
}

const saving = ref(false);

const SERVER_TO_FORM = {
    nivel_academico: 'nivelAcademico',
    facultad: 'facultad',
    programa_academico: 'programaAcademico'
};

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

    const fields = ['nivelAcademico', 'facultad', 'programaAcademico'];
    fields.forEach((f) => {
        touched[f] = true;
        validateField(f);
    });

    const ok = fields.every((f) => !errors[f]);
    if (!ok) {
        toast.add({ severity: 'warn', summary: 'No se pudo guardar', detail: 'Revisa los campos obligatorios.', life: 4500 });
        return;
    }

    const payload = {
        nivel_academico: product.value.nivelAcademico,
        facultad: product.value.facultad,
        programa_academico: product.value.programaAcademico
    };

    try {
        saving.value = true;
        await ensureCsrf();

        if (product.value.id) {
            await api.patch(`${API_CAT}/${product.value.id}`, payload);
            toast.add({ severity: 'success', summary: 'Actualizado', life: 2500 });
        } else {
            await api.post(API_CAT, payload);
            toast.add({ severity: 'success', summary: 'Creado', life: 2500 });
        }

        productDialog.value = false;
        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;

        if (status === 422) {
            applyServerFieldErrors(data?.errors);
            const detail = summarizeValidationErrors(data?.errors) || data?.message || 'Los datos enviados son inválidos.';
            toast.add({ severity: 'warn', summary: 'No se pudo guardar', detail, life: 6500 });
            return;
        }

        const msg = data?.message || data?.error || e.message;
        toast.add({
            severity: status === 409 ? 'warn' : 'error',
            summary: status === 409 ? 'Conflicto' : 'No se pudo guardar',
            detail: `[${status ?? 'ERR'}] ${msg}`,
            life: 6500
        });
    } finally {
        saving.value = false;
    }
}

// Delete individual + bulk
const deleteProductDialog = ref(false);
const current = ref(null);

function confirmDeleteProduct(row) {
    current.value = { ...row };
    deleteProductDialog.value = true;
}
async function deleteProduct() {
    try {
        await ensureCsrf();
        await api.delete(`${API_CAT}/${current.value.id}`);
        products.value = products.value.filter((x) => x.id !== current.value.id);
        toast.add({ severity: 'success', summary: 'Eliminado', life: 2500 });
        await getProducts({ force: true });
    } catch (e) {
        toast.add({ severity: 'error', summary: 'No se pudo eliminar', detail: String(e?.response?.data?.message || e.message), life: 5000 });
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
        await ensureCsrf();
        await api.post(`${API_CAT}/bulk-delete`, { ids });
        const set = new Set(ids);
        products.value = products.value.filter((x) => !set.has(x.id));
        selected.value = [];
        toast.add({ severity: 'success', summary: `Eliminados (${ids.length})`, life: 2500 });
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
// BULK JSON Upload (Upsert masivo)
// -------------------------
const bulkDialog = ref(false);
const bulkLoading = ref(false);
const bulkFileInput = ref(null);
const bulkText = ref('');
const bulkError = ref('');

const bulkPreview = reactive({
    total: 0,
    valid: 0,
    invalid: 0,
    dupes: 0,
    overLimit: false
});

function normText(s) {
    if (s == null) return '';
    return String(s).replace(/\s+/g, ' ').trim();
}
function normLower(s) {
    return normText(s).toLowerCase();
}
function makeKey(fac, prog) {
    return `${normLower(fac)}|${normLower(prog)}`;
}

function analyzeBulkText(text) {
    bulkError.value = '';
    bulkPreview.total = 0;
    bulkPreview.valid = 0;
    bulkPreview.invalid = 0;
    bulkPreview.dupes = 0;
    bulkPreview.overLimit = false;

    const raw = String(text || '').trim();
    if (!raw) return { ok: false, payload: null, reason: null };

    let obj;
    try {
        obj = JSON.parse(raw);
    } catch (e) {
        bulkError.value = 'El JSON no es válido.';
        return { ok: false, payload: null, reason: 'invalid_json' };
    }

    const items = Array.isArray(obj) ? obj : obj?.items;
    if (!Array.isArray(items)) {
        bulkError.value = 'El payload debe ser un array o un objeto con { "items": [...] }.';
        return { ok: false, payload: null, reason: 'missing_items' };
    }

    bulkPreview.total = items.length;
    if (items.length > 1000) bulkPreview.overLimit = true;

    const seen = new Set();
    const normalized = [];

    for (const it of items) {
        const nivel = normLower(it?.nivelAcademico ?? it?.nivel_academico);
        const fac = normText(it?.facultad);
        const prog = normText(it?.programaAcademico ?? it?.programa_academico);

        const isNivelOk = nivel === 'pregrado' || nivel === 'postgrado';
        const isFacOk = fac.length > 0;
        const isProgOk = prog.length > 0;

        if (!isNivelOk || !isFacOk || !isProgOk) {
            bulkPreview.invalid += 1;
            continue;
        }

        const k = makeKey(fac, prog);
        if (seen.has(k)) {
            bulkPreview.dupes += 1;
            continue;
        }
        seen.add(k);
        normalized.push({
            nivel_academico: nivel,
            facultad: fac,
            programa_academico: prog
        });
        bulkPreview.valid += 1;
    }

    if (bulkPreview.valid === 0) {
        bulkError.value = 'No hay items válidos para procesar.';
        return { ok: false, payload: null, reason: 'no_valid_items' };
    }

    if (bulkPreview.overLimit) {
        bulkError.value = 'El máximo permitido es 1000 items. Reduce el archivo.';
        return { ok: false, payload: null, reason: 'over_limit' };
    }

    return { ok: true, payload: { items: normalized }, reason: null };
}

watch(bulkText, (val) => {
    if (!bulkDialog.value) return;
    analyzeBulkText(val);
});

function openBulkDialog() {
    bulkText.value = '';
    bulkError.value = '';
    bulkPreview.total = 0;
    bulkPreview.valid = 0;
    bulkPreview.invalid = 0;
    bulkPreview.dupes = 0;
    bulkPreview.overLimit = false;
    bulkDialog.value = true;
}

function triggerFilePick() {
    bulkFileInput.value?.click?.();
}

function onBulkFileChange(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;

    if (file.size > 3_000_000) {
        toast.add({ severity: 'warn', summary: 'Archivo grande', detail: 'El archivo supera ~3MB. Si falla, divídelo en partes.', life: 6500 });
    }

    const reader = new FileReader();
    reader.onload = () => {
        bulkText.value = String(reader.result || '');
        analyzeBulkText(bulkText.value);
    };
    reader.onerror = () => {
        toast.add({ severity: 'error', summary: 'No se pudo leer', detail: 'Error leyendo el archivo.', life: 5500 });
    };
    reader.readAsText(file);
    e.target.value = '';
}

async function submitBulk() {
    const { ok, payload } = analyzeBulkText(bulkText.value);
    if (!ok || !payload) {
        toast.add({ severity: 'warn', summary: 'No se puede procesar', detail: bulkError.value || 'Revisa el JSON.', life: 6500 });
        return;
    }

    try {
        bulkLoading.value = true;
        await ensureCsrf();

        const { data } = await api.post(API_CAT_BULK, payload);
        const meta = data?.meta;
        const created = meta?.created ?? null;
        const updated = meta?.updated ?? null;
        const processed = meta?.processed ?? null;

        const msgParts = [];
        if (processed != null) msgParts.push(`Procesados: ${processed}`);
        if (created != null) msgParts.push(`Creados: ${created}`);
        if (updated != null) msgParts.push(`Actualizados: ${updated}`);

        toast.add({
            severity: 'success',
            summary: 'Carga masiva OK',
            detail: msgParts.length ? msgParts.join(' | ') : 'Operación completada.',
            life: 5000
        });

        bulkDialog.value = false;
        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.message || e.message;

        toast.add({
            severity: status === 422 ? 'warn' : 'error',
            summary: status === 422 ? 'JSON inválido' : 'Error en carga masiva',
            detail: `[${status ?? 'ERR'}] ${msg}`,
            life: 7000
        });
    } finally {
        bulkLoading.value = false;
    }
}

// -------------------------
// UX: bloquear space en el form
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

function prettyNivel(v) {
    return v === 'postgrado' ? 'Postgrado' : 'Pregrado';
}
</script>

<template>
    <div class="card">
        <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
                <h2 class="text-lg font-semibold m-0">Catálogos</h2>
                <span class="text-sm text-surface-500">Auditoría central (createdAt / updatedAt)</span>
            </div>
        </div>

        <div v-if="!canAccessModule" class="p-4 border rounded bg-surface-50 text-surface-700">No tienes permisos para ver este módulo.</div>

        <template v-else>
            <Toolbar class="mb-3">
                <template #start>
                    <div class="flex items-center gap-2 shrink-0">
                        <Button v-if="canCreateCatalogos" label="Crear" icon="pi pi-plus" @click="openNew" />
                        <Button v-if="canCreateCatalogos" label="Cargar JSON" icon="pi pi-upload" severity="secondary" @click="openBulkDialog" />
                        <Button v-if="canDeleteCatalogos" label="Borrar" icon="pi pi-trash" :disabled="!selected.length" @click="confirmBulkDelete" />
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
                                    id="catSearch"
                                    name="catSearch"
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
                :rowsPerPageOptions="[5, 10, 25, 50]"
                currentPageReportTemplate="Mostrando desde {first} hasta {last} de {totalRecords}"
                emptyMessage="No hay registros"
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

                <Column field="id" header="Id" sortable style="min-width: 10rem" />
                <Column field="nivelAcademico" header="Nivel" sortable style="min-width: 9rem">
                    <template #body="{ data }">
                        {{ prettyNivel(data.nivelAcademico ?? data.nivel_academico) }}
                    </template>
                </Column>
                <Column field="facultad" header="Facultad" sortable style="min-width: 14rem" />
                <Column field="programaAcademico" header="Programa académico" sortable style="min-width: 18rem">
                    <template #body="{ data }">
                        {{ data.programaAcademico ?? data.programa_academico ?? '' }}
                    </template>
                </Column>

                <Column field="estado" header="Estado" sortable style="min-width: 8rem">
                    <template #body="{ data }">
                        <span v-if="data.estado === true">Activo</span>
                        <span v-else-if="data.estado === false">Inactivo</span>
                        <span v-else class="text-surface-500">—</span>
                    </template>
                </Column>

                <Column field="createdAt" header="Creado" sortable style="min-width: 12rem">
                    <template #body="{ data }">
                        {{ data.createdAt ?? data.created_at ?? '—' }}
                    </template>
                </Column>

                <Column field="updatedAt" header="Actualizado" sortable style="min-width: 12rem">
                    <template #body="{ data }">
                        {{ data.updatedAt ?? data.updated_at ?? '—' }}
                    </template>
                </Column>

                <Column :exportable="false" headerStyle="width:11rem">
                    <template #body="{ data }">
                        <Button v-if="canEditCatalogos" icon="pi pi-pencil" rounded text class="mr-1" @click.stop="editProduct(data)" />
                        <Button v-if="canDeleteCatalogos" icon="pi pi-trash" rounded text severity="danger" @click.stop="confirmDeleteProduct(data)" />
                    </template>
                </Column>
            </DataTable>

            <!-- Crear/Editar -->
            <Dialog v-model:visible="productDialog" header="Catálogo" :style="{ width: '36rem' }" :modal="true">
                <div class="flex flex-col gap-4" @keydown.capture="onFormKeyCapture">
                    <div class="flex flex-col gap-2">
                        <label for="nivelAcademico">Nivel académico</label>
                        <Dropdown
                            id="nivelAcademico"
                            v-model="product.nivelAcademico"
                            :options="nivelOptions"
                            optionLabel="label"
                            optionValue="value"
                            placeholder="Selecciona…"
                            :class="{ 'p-invalid': showError('nivelAcademico') }"
                            @blur="onBlur('nivelAcademico')"
                        />
                        <small v-if="showError('nivelAcademico')" class="text-red-500">{{ errors.nivelAcademico }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="facultad">Facultad</label>
                        <InputText id="facultad" v-model.trim="product.facultad" :invalid="showError('facultad')" @blur="onBlur('facultad')" @keydown.space.stop fluid />
                        <small v-if="showError('facultad')" class="text-red-500">{{ errors.facultad }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="programaAcademico">Programa académico</label>
                        <InputText id="programaAcademico" v-model.trim="product.programaAcademico" :invalid="showError('programaAcademico')" @blur="onBlur('programaAcademico')" @keydown.space.stop fluid />
                        <small v-if="showError('programaAcademico')" class="text-red-500">{{ errors.programaAcademico }}</small>
                    </div>
                </div>

                <template #footer>
                    <Button type="button" label="Guardar" icon="pi pi-check" :loading="saving" :disabled="saving" @click="saveProduct" @keydown="onSaveBtnKeydown" />
                    <Button type="button" label="Cancelar" icon="pi pi-times" text :disabled="saving" @click="productDialog = false" />
                </template>
            </Dialog>

            <!-- Carga masiva JSON -->
            <Dialog v-model:visible="bulkDialog" header="Cargar catálogos desde JSON" :style="{ width: '46rem', maxWidth: '95vw' }" :modal="true">
                <input ref="bulkFileInput" type="file" accept=".json,.txt,application/json,text/plain" class="hidden" @change="onBulkFileChange" />

                <div class="flex flex-col gap-3">
                    <div class="text-sm text-surface-600">
                        Pega el JSON o sube un archivo. Formato esperado:
                        <code>{ "items": [ { "nivelAcademico": "pregrado", "facultad": "...", "programaAcademico": "..." } ] }</code>
                    </div>

                    <div class="flex items-center gap-2">
                        <Button label="Seleccionar archivo" icon="pi pi-folder-open" severity="secondary" @click="triggerFilePick" />
                        <Button
                            label="Limpiar"
                            icon="pi pi-trash"
                            text
                            severity="secondary"
                            @click="
                                bulkText = '';
                                bulkError = '';
                            "
                        />
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="bulk-json" class="font-medium">JSON</label>
                        <Textarea id="bulk-json" v-model="bulkText" rows="10" autoResize :class="{ 'p-invalid': !!bulkError }" placeholder="Pega aquí el JSON…" />
                        <small v-if="bulkError" class="text-red-500">{{ bulkError }}</small>
                    </div>

                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                        <div class="p-2 border rounded">
                            <div class="text-surface-500">Total</div>
                            <div class="font-semibold">{{ bulkPreview.total }}</div>
                        </div>
                        <div class="p-2 border rounded">
                            <div class="text-surface-500">Válidos</div>
                            <div class="font-semibold">{{ bulkPreview.valid }}</div>
                        </div>
                        <div class="p-2 border rounded">
                            <div class="text-surface-500">Inválidos</div>
                            <div class="font-semibold">{{ bulkPreview.invalid }}</div>
                        </div>
                        <div class="p-2 border rounded">
                            <div class="text-surface-500">Duplicados (en payload)</div>
                            <div class="font-semibold">{{ bulkPreview.dupes }}</div>
                        </div>
                    </div>
                </div>

                <template #footer>
                    <Button label="Cancelar" icon="pi pi-times" text :disabled="bulkLoading" @click="bulkDialog = false" />
                    <Button label="Procesar" icon="pi pi-check" :loading="bulkLoading" :disabled="bulkLoading" @click="submitBulk" />
                </template>
            </Dialog>

            <!-- Confirmación borrado -->
            <Dialog v-model:visible="deleteProductDialog" header="Confirmar" :style="{ width: '28rem' }" :modal="true">
                <div>
                    ¿Seguro que quieres eliminar el catálogo <b>{{ current?.programaAcademico ?? current?.programa_academico }}</b> ({{ current?.facultad }})?
                </div>
                <template #footer>
                    <Button label="No" icon="pi pi-times" text @click="deleteProductDialog = false" />
                    <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteProduct" />
                </template>
            </Dialog>

            <!-- Detalles -->
            <Dialog v-model:visible="detailsDialog" header="Detalles" :modal="true" :breakpoints="{ '1024px': '60vw', '768px': '75vw', '560px': '92vw' }" :style="{ width: '46vw', maxWidth: '820px' }">
                <div v-if="detailsLoading" class="p-4">Cargando…</div>

                <div v-else class="p-3 sm:p-4">
                    <div v-for="d in details" :key="d.id" class="mb-3 border rounded p-3 sm:p-4">
                        <div class="font-semibold mb-3 break-words">{{ d.programaAcademico ?? d.programa_academico }} — {{ d.facultad }}</div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <dl class="space-y-2">
                                <div>
                                    <dt class="text-sm font-semibold">Id</dt>
                                    <dd class="break-words">{{ d.id }}</dd>
                                </div>
                                <div>
                                    <dt class="text-sm font-semibold">Nivel académico</dt>
                                    <dd class="break-words">{{ prettyNivel(d.nivelAcademico ?? d.nivel_academico) }}</dd>
                                </div>
                                <div>
                                    <dt class="text-sm font-semibold">Facultad</dt>
                                    <dd class="break-words">{{ d.facultad }}</dd>
                                </div>
                                <div>
                                    <dt class="text-sm font-semibold">Programa académico</dt>
                                    <dd class="break-words">{{ d.programaAcademico ?? d.programa_academico }}</dd>
                                </div>
                                <div>
                                    <dt class="text-sm font-semibold">Estado</dt>
                                    <dd class="break-words">
                                        <span v-if="d.estado === true">Activo</span>
                                        <span v-else-if="d.estado === false">Inactivo</span>
                                        <span v-else class="text-surface-500">—</span>
                                    </dd>
                                </div>
                            </dl>

                            <dl class="space-y-2">
                                <div>
                                    <dt class="text-sm font-semibold">Creado</dt>
                                    <dd class="break-words">{{ d.createdAt ?? d.created_at ?? '—' }}</dd>
                                </div>
                                <div>
                                    <dt class="text-sm font-semibold">Actualizado</dt>
                                    <dd class="break-words">{{ d.updatedAt ?? d.updated_at ?? '—' }}</dd>
                                </div>
                            </dl>
                        </div>
                    </div>
                </div>

                <template #footer>
                    <Button label="Cerrar" icon="pi pi-times" text @click="detailsDialog = false" />
                </template>
            </Dialog>

            <!-- Bulk delete -->
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
