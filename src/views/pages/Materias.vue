<script setup>
import { ref, reactive, computed, onMounted, watch, onBeforeUnmount } from 'vue';
import { useToast } from 'primevue/usetoast';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';

const toast = useToast();
const auth = useAuthStore();
const hasPerm = (perm) => auth.hasPermission(perm);

// -------------------------
// Permisos
// -------------------------
const canViewMaterias = computed(() => hasPerm('materias.view'));
const canCreateMaterias = computed(() => hasPerm('materias.create'));
const canEditMaterias = computed(() => hasPerm('materias.edit'));
const canDeleteMaterias = computed(() => hasPerm('materias.delete'));

const canAccessModule = computed(() => canViewMaterias.value);

// -------------------------
// Endpoints
// -------------------------
const API_MAT = '/materias';
const API_MAT_BULK = '/materias/bulk'; // si implementas el upsert masivo
// Bulk delete usa `${API_MAT}/bulk-delete` igual que Catálogos

// -------------------------
// Tabla base
// -------------------------
const tableUid = `mat-${Math.random().toString(36).slice(2)}`;

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
const sortField = ref('codigo');
const sortOrder = ref(1);

// -------------------------
// Search debounce
// -------------------------
const search = ref('');
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
let typingTimer = null;
let activeCtrl = null;

// -------------------------
// Helpers vista
// -------------------------
function estadoLabel(v) {
    if (v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true') return 'Activo';
    if (v === false || v === 0 || v === '0' || String(v).toLowerCase() === 'false') return 'Inactivo';
    return '—';
}
function estadoSeverity(v) {
    if (v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true') return 'success';
    if (v === false || v === 0 || v === '0' || String(v).toLowerCase() === 'false') return 'secondary';
    return 'info';
}
function prettyEstadoMateria(v) {
    const s = String(v ?? '')
        .trim()
        .toLowerCase();
    if (s === 'activa') return 'Activa';
    if (s === 'inactiva') return 'Inactiva';
    return s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : '—';
}
function estadoMateriaSeverity(v) {
    const s = String(v ?? '')
        .trim()
        .toLowerCase();
    if (s === 'activa') return 'success';
    if (s === 'inactiva') return 'secondary';
    return 'info';
}

// -------------------------
// Parametrización (sort/search/paginación)
// -------------------------
const SORT_MAP_MAT = {
    id: 'id',
    codigo: 'codigo',
    nombre: 'nombre',
    creditos: 'creditos',
    estadoMateria: 'estado_materia',
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

const sortParamMat = computed(() => mapSort(sortField.value, sortOrder.value, SORT_MAP_MAT));

function buildParams({ force = false } = {}) {
    const params = { per_page: +rows.value || 10, page: +page.value || 1 };
    const sp = sortParamMat.value;
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
        const { data } = await api.get(API_MAT, { params: buildParams({ force }), signal });

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
// CRUD
// -------------------------
const productDialog = ref(false);
const product = ref({ id: null, codigo: '', nombre: '', creditos: null, estadoMateria: 'activa' });

const estadoMateriaOptions = [
    { label: 'Activa', value: 'activa' },
    { label: 'Inactiva', value: 'inactiva' }
];

const errors = reactive({ codigo: '', nombre: '', creditos: '', estadoMateria: '' });
const touched = reactive({ codigo: false, nombre: false, creditos: false, estadoMateria: false });

const rules = {
    codigo: [(v) => !!String(v ?? '').trim() || 'Requerido.', (v) => String(v ?? '').trim().length <= 50 || 'Máximo 50 caracteres.'],
    nombre: [(v) => !!String(v ?? '').trim() || 'Requerido.', (v) => String(v ?? '').trim().length <= 255 || 'Máximo 255 caracteres.'],
    creditos: [(v) => v === null || v === '' || (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 30) || 'Créditos inválidos (0 a 30).'],
    estadoMateria: [(v) => !!v || 'Requerido.']
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
    product.value = { id: null, codigo: '', nombre: '', creditos: null, estadoMateria: 'activa' };
    resetValidation();
    productDialog.value = true;
}
function editProduct(row) {
    product.value = {
        id: row.id ?? null,
        codigo: row.codigo ?? '',
        nombre: row.nombre ?? '',
        creditos: row.creditos ?? null,
        estadoMateria: row.estadoMateria ?? row.estado_materia ?? 'activa'
    };
    resetValidation();
    productDialog.value = true;
}

const saving = ref(false);

const SERVER_TO_FORM = {
    codigo: 'codigo',
    nombre: 'nombre',
    creditos: 'creditos',
    estado_materia: 'estadoMateria',
    estadoMateria: 'estadoMateria'
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

    const fields = ['codigo', 'nombre', 'creditos', 'estadoMateria'];
    fields.forEach((f) => {
        touched[f] = true;
        validateField(f);
    });

    const ok = fields.every((f) => !errors[f]);
    if (!ok) {
        toast.add({ severity: 'warn', summary: 'No se pudo guardar', detail: 'Revisa los campos obligatorios.', life: 4500 });
        return;
    }

    const payloadBase = {
        codigo: String(product.value.codigo || '').trim(),
        nombre: String(product.value.nombre || '').trim(),
        creditos: product.value.creditos === '' ? null : (product.value.creditos ?? null),
        estado_materia: product.value.estadoMateria
    };

    const payload = { ...payloadBase };

    try {
        saving.value = true;

        if (product.value.id) {
            await api.patch(`${API_MAT}/${product.value.id}`, payload);
            toast.add({ severity: 'success', summary: 'Actualizado', life: 2500 });
        } else {
            await api.post(API_MAT, payload);
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
        await api.delete(`${API_MAT}/${current.value.id}`);
        products.value = products.value.filter((x) => x.id !== current.value.id);
        toast.add({ severity: 'success', summary: 'Eliminado', life: 2500 });
        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.message || e.message;
        toast.add({ severity: status === 409 ? 'warn' : 'error', summary: status === 409 ? 'No se puede eliminar' : 'No se pudo eliminar', detail: `[${status ?? 'ERR'}] ${msg}`, life: 6000 });
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
        await api.post(`${API_MAT}/bulk-delete`, { ids });
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
// BULK JSON Upload
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
function makeKey(codigo) {
    return `${normLower(codigo)}`;
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
    } catch {
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
        const codigo = normText(it?.codigo);
        const nombre = normText(it?.nombre);
        const creditosRaw = it?.creditos ?? null;
        const estadoMateria = normLower(it?.estadoMateria ?? it?.estado_materia ?? 'activa');

        const isCodigoOk = codigo.length > 0 && codigo.length <= 50;
        const isNombreOk = nombre.length > 0 && nombre.length <= 255;
        const isEstadoMatOk = estadoMateria === 'activa' || estadoMateria === 'inactiva';

        let creditos = null;
        if (creditosRaw !== null && creditosRaw !== '' && creditosRaw !== undefined) {
            const n = Number(creditosRaw);
            const okCred = Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= 30;
            if (!okCred) {
                bulkPreview.invalid += 1;
                continue;
            }
            creditos = n;
        }

        if (!isCodigoOk || !isNombreOk || !isEstadoMatOk) {
            bulkPreview.invalid += 1;
            continue;
        }

        const k = makeKey(codigo);
        if (seen.has(k)) {
            bulkPreview.dupes += 1;
            continue;
        }
        seen.add(k);

        normalized.push({
            codigo,
            nombre,
            creditos,
            estado_materia: estadoMateria
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

        await api.post(API_MAT_BULK, payload);

        toast.add({
            severity: 'success',
            summary: 'Carga masiva OK',
            detail: 'Operación completada.',
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
// bloquear space en el form
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
                <h2 class="text-lg font-semibold m-0">Materias</h2>
            </div>
        </div>

        <div v-if="!canAccessModule" class="p-4 border rounded bg-surface-50 text-surface-700">No tienes permisos para ver este módulo.</div>

        <template v-else>
            <Toolbar class="mb-3">
                <template #start>
                    <div class="flex items-center gap-2 shrink-0">
                        <Button v-if="canCreateMaterias" label="Crear" icon="pi pi-plus" @click="openNew" />
                        <Button v-if="canCreateMaterias" label="Cargar JSON" icon="pi pi-upload" severity="secondary" @click="openBulkDialog" />
                        <Button v-if="canDeleteMaterias" label="Borrar" icon="pi pi-trash" :disabled="!selected.length" @click="confirmBulkDelete" />
                    </div>
                </template>

                <template #center />

                <template #end>
                    <div class="flex items-center gap-3 w-full justify-end">
                        <form role="search" class="min-w-0 w-full sm:w-80 md:w-[26rem]" @submit.prevent="forceFetch">
                            <IconField class="w-full p-input-icon-left relative">
                                <InputIcon :class="loading ? 'pi pi-spinner pi-spin' : 'pi pi-search'" />
                                <InputText
                                    id="matSearch"
                                    name="matSearch"
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
                        <Checkbox v-model="selected" :value="data" :inputId="`${tableUid}-row-${index + 1}`" name="row-select" :aria-label="`Seleccionar fila ${index + 1}`" />
                    </template>
                </Column>

                <Column field="codigo" header="Código" sortable headerStyle="width:10rem" style="width: 10rem">
                    <template #body="{ data }">
                        <span class="block overflow-hidden text-ellipsis whitespace-nowrap" v-tooltip.top="data.codigo">
                            {{ data.codigo || '—' }}
                        </span>
                    </template>
                </Column>

                <Column field="nombre" header="Nombre" sortable headerStyle="width:32rem" style="width: 32rem">
                    <template #body="{ data }">
                        <span class="clamp-2" v-tooltip.top="data.nombre ?? ''">
                            {{ data.nombre || '—' }}
                        </span>
                    </template>
                </Column>

                <Column field="creditos" header="Créditos" sortable headerStyle="width:8rem" style="width: 8rem" class="text-right">
                    <template #body="{ data }">
                        {{ data.creditos ?? '—' }}
                    </template>
                </Column>

                <Column field="estadoMateria" header="Estado materia" sortable headerStyle="width:12rem" style="width: 12rem">
                    <template #body="{ data }">
                        <Tag :value="prettyEstadoMateria(data.estadoMateria ?? data.estado_materia)" :severity="estadoMateriaSeverity(data.estadoMateria ?? data.estado_materia)" />
                    </template>
                </Column>

                <Column :exportable="false" headerStyle="width:11rem" style="width: 11rem">
                    <template #body="{ data }">
                        <Button v-if="canEditMaterias" icon="pi pi-pencil" rounded text class="mr-1" @click.stop="editProduct(data)" />
                        <Button v-if="canDeleteMaterias" icon="pi pi-trash" rounded text severity="danger" @click.stop="confirmDeleteProduct(data)" />
                    </template>
                </Column>
            </DataTable>

            <!-- Crear/Editar -->
            <Dialog v-model:visible="productDialog" header="Materia" :style="{ width: '36rem' }" :modal="true">
                <div class="flex flex-col gap-4" @keydown.capture="onFormKeyCapture">
                    <div class="flex flex-col gap-2">
                        <label for="codigo">Código</label>
                        <InputText id="codigo" v-model.trim="product.codigo" :invalid="showError('codigo')" @blur="onBlur('codigo')" @keydown.space.stop fluid />
                        <small v-if="showError('codigo')" class="text-red-500">{{ errors.codigo }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="nombre">Nombre</label>
                        <InputText id="nombre" v-model.trim="product.nombre" :invalid="showError('nombre')" @blur="onBlur('nombre')" fluid />
                        <small v-if="showError('nombre')" class="text-red-500">{{ errors.nombre }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="creditos">Créditos</label>
                        <InputNumber id="creditos" v-model="product.creditos" :useGrouping="false" :min="0" :max="30" inputClass="w-full" :class="{ 'p-invalid': showError('creditos') }" @blur="onBlur('creditos')" />
                        <small v-if="showError('creditos')" class="text-red-500">{{ errors.creditos }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="estadoMateria">Estado de la materia</label>
                        <Dropdown
                            id="estadoMateria"
                            v-model="product.estadoMateria"
                            :options="estadoMateriaOptions"
                            optionLabel="label"
                            optionValue="value"
                            placeholder="Selecciona…"
                            :class="{ 'p-invalid': showError('estadoMateria') }"
                            @blur="onBlur('estadoMateria')"
                        />
                        <small v-if="showError('estadoMateria')" class="text-red-500">{{ errors.estadoMateria }}</small>
                    </div>
                </div>

                <template #footer>
                    <Button type="button" label="Guardar" icon="pi pi-check" :loading="saving" :disabled="saving" @click="saveProduct" @keydown="onSaveBtnKeydown" />
                    <Button type="button" label="Cancelar" icon="pi pi-times" text :disabled="saving" @click="productDialog = false" />
                </template>
            </Dialog>

            <!-- Carga masiva JSON -->
            <Dialog v-model:visible="bulkDialog" header="Cargar materias desde JSON" :style="{ width: '46rem', maxWidth: '95vw' }" :modal="true">
                <input ref="bulkFileInput" type="file" accept=".json,.txt,application/json,text/plain" class="hidden" @change="onBulkFileChange" />

                <div class="flex flex-col gap-3">
                    <div class="text-sm text-surface-600">
                        Pega el JSON o sube un archivo. Formato esperado:
                        <code>{ "items": [ { "codigo": "301151", "nombre": "...", "creditos": 3, "estadoMateria": "activa" } ] }</code>
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
                    ¿Seguro que quieres eliminar la materia <b>{{ current?.codigo }}</b> — {{ current?.nombre }}?
                </div>
                <template #footer>
                    <Button label="No" icon="pi pi-times" text @click="deleteProductDialog = false" />
                    <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteProduct" />
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
