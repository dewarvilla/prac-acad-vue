<script setup>
import { ref, reactive, computed, onMounted, watch, onBeforeUnmount } from 'vue';
import { useToast } from 'primevue/usetoast';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';

const API = '/smmlv';

const toast = useToast();
const auth = useAuthStore();
const hasPerm = (perm) => auth.hasPermission(perm);

// -------------------------
// Permisos
// -------------------------
const canViewSmmlv = computed(() => hasPerm('salarios.view'));
const canCreateSmmlv = computed(() => hasPerm('salarios.create'));
const canEditSmmlv = computed(() => hasPerm('salarios.edit'));
const canDeleteSmmlv = computed(() => hasPerm('salarios.delete'));
const canAccessModule = computed(() => canViewSmmlv.value);

// -------------------------
// Tabla base
// -------------------------
const tableUid = `smmlv-${Math.random().toString(36).slice(2)}`;
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
const sortField = ref('anio');
const sortOrder = ref(-1);

// -------------------------
// Search debounce
// -------------------------
const search = ref('');
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
let typingTimer = null;
let activeCtrl = null;

// -------------------------
// Form ids
// -------------------------
const uid = Math.random().toString(36).slice(2);
const anioId = `anio-${uid}`;
const valorId = `valor-${uid}`;
const estadoId = `estado-${uid}`;

// -------------------------
// Utils
// -------------------------
function s(v) {
    return v == null ? '' : String(v);
}

function toBool(v) {
    if (typeof v === 'boolean') return v;
    if (v === 1 || v === '1' || v === 'true') return true;
    if (v === 0 || v === '0' || v === 'false') return false;
    return false;
}

function estadoLabel(v) {
    return toBool(v) ? 'Activo' : 'Inactivo';
}

function estadoSeverity(v) {
    return toBool(v) ? 'success' : 'danger';
}

function formatMoney(v) {
    if (v == null || v === '') return '—';
    const n = Number(v);
    if (Number.isNaN(n)) return String(v);
    return `$ ${new Intl.NumberFormat('es-CO').format(n)}`;
}

function formatDate(v) {
    if (!v) return '—';
    try {
        return new Intl.DateTimeFormat('es-CO', {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(new Date(v));
    } catch {
        return v;
    }
}

// -------------------------
// Sort mapping
// -------------------------
const SORT_MAP = {
    id: 'id',
    anio: 'anio',
    valor: 'valor',
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
        const { data } = await api.get(API, {
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
        const reqs = selected.value.map((r) => api.get(`${API}/${r.id}`));
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
    anio: null,
    valor: null,
    estado: true
});

const product = ref(defaults());

const errors = reactive({
    anio: '',
    valor: ''
});

const touched = reactive({
    anio: false,
    valor: false
});

const rules = {
    anio: [
        (v) => (v !== null && v !== '') || 'Requerido.',
        (v) => Number.isInteger(Number(v)) || 'Debe ser un número entero.',
        (v) => Number(v) >= 1900 || 'Debe ser mayor o igual a 1900.',
        (v) => Number(v) <= 2100 || 'Debe ser menor o igual a 2100.'
    ],
    valor: [(v) => (v !== null && v !== '') || 'Requerido.', (v) => Number.isInteger(Number(v)) || 'Debe ser un número entero.', (v) => Number(v) >= 1 || 'Debe ser mayor o igual a 1.']
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
        anio: row.anio != null ? Number(row.anio) : null,
        valor: row.valor != null ? Number(row.valor) : null,
        estado: toBool(row.estado)
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
    anio: 'anio',
    valor: 'valor'
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

    const fields = ['anio', 'valor'];
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
        anio: Number(product.value.anio),
        valor: Number(product.value.valor),
        estado: !!product.value.estado
    };

    try {
        saving.value = true;

        if (product.value.id) {
            await api.patch(`${API}/${product.value.id}`, payload);
            toast.add({
                severity: 'success',
                summary: 'Actualizado',
                detail: 'El SMMLV fue actualizado correctamente.',
                life: 3500
            });
        } else {
            await api.post(API, payload);
            toast.add({
                severity: 'success',
                summary: 'Creado',
                detail: 'El SMMLV fue creado correctamente.',
                life: 3500
            });
        }

        productDialog.value = false;
        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;

        if (status === 422) {
            applyServerFieldErrors(data?.errors);
            const detail = summarizeValidationErrors(data?.errors) || data?.message || 'Los datos enviados son inválidos.';
            toast.add({
                severity: 'warn',
                summary: 'No se pudo guardar',
                detail,
                life: 6500
            });
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
        await api.delete(`${API}/${current.value.id}`);
        products.value = products.value.filter((x) => x.id !== current.value.id);
        selected.value = selected.value.filter((x) => x.id !== current.value.id);

        toast.add({
            severity: 'success',
            summary: 'Eliminado',
            detail: 'El registro fue eliminado.',
            life: 2500
        });

        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.message || e.message;
        toast.add({
            severity: status === 409 ? 'warn' : 'error',
            summary: status === 409 ? 'No se puede eliminar' : 'No se pudo eliminar',
            detail: `[${status ?? 'ERR'}] ${msg}`,
            life: 6000
        });
    } finally {
        deleteProductDialog.value = false;
        current.value = null;
    }
}

const bulkDeleteDialog = ref(false);
const canBulkDelete = computed(() => canDeleteSmmlv.value && selected.value.length > 0);

function confirmBulkDelete() {
    if (!canBulkDelete.value) {
        toast.add({
            severity: 'warn',
            summary: 'No se puede eliminar',
            detail: 'Selecciona al menos un registro.',
            life: 4500
        });
        return;
    }

    bulkDeleteDialog.value = true;
}

async function bulkDelete() {
    const ids = selected.value.map((r) => r.id);

    try {
        await api.post(`${API}/bulk-delete`, { ids });

        const set = new Set(ids);
        products.value = products.value.filter((x) => !set.has(x.id));
        selected.value = [];

        toast.add({
            severity: 'success',
            summary: `Eliminados (${ids.length})`,
            detail: 'Los registros fueron eliminados.',
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

// -------------------------
// Limpieza
// -------------------------
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
                <h2 class="text-lg font-semibold m-0">SMMLV</h2>
            </div>
        </div>

        <div v-if="!canAccessModule" class="p-4 border rounded bg-surface-50 text-surface-700">No tienes permisos para ver este módulo.</div>

        <template v-else>
            <Toolbar class="mb-3">
                <template #start>
                    <div class="flex items-center gap-2 shrink-0">
                        <Button v-if="canCreateSmmlv" label="Crear" icon="pi pi-plus" @click="openNew" />
                        <Button v-if="canDeleteSmmlv" label="Borrar" icon="pi pi-trash" :disabled="!canBulkDelete" @click="confirmBulkDelete" />
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
                                    id="smmlvSearch"
                                    name="smmlvSearch"
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
                :rowsPerPageOptions="[5, 10, 25, 50, 100]"
                currentPageReportTemplate="Mostrando desde {first} hasta {last} de {totalRecords}"
                emptyMessage="No hay registros"
                responsiveLayout="scroll"
                :scrollable="true"
                tableStyle="width: 100%; min-width: 700px;"
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

                <Column field="anio" header="Año" sortable style="min-width: 10rem; max-width: 10rem">
                    <template #body="{ data }">
                        <span class="font-medium">{{ data.anio }}</span>
                    </template>
                </Column>

                <Column field="valor" header="Valor" sortable style="min-width: 14rem; max-width: 16rem">
                    <template #body="{ data }">
                        {{ formatMoney(data.valor) }}
                    </template>
                </Column>

                <Column field="estado" header="Estado" sortable style="min-width: 10rem; max-width: 10rem">
                    <template #body="{ data }">
                        <Tag :value="estadoLabel(data.estado)" :severity="estadoSeverity(data.estado)" />
                    </template>
                </Column>

                <Column :exportable="false" headerStyle="width:10rem">
                    <template #body="{ data }">
                        <Button v-if="canEditSmmlv" icon="pi pi-pencil" rounded text class="mr-1" @click.stop="editProduct(data)" />
                        <Button v-if="canDeleteSmmlv" icon="pi pi-trash" rounded text severity="danger" @click.stop="confirmDeleteProduct(data)" />
                    </template>
                </Column>
            </DataTable>

            <!-- Crear / Editar -->
            <Dialog v-model:visible="productDialog" :header="product.id ? 'Editar SMMLV' : 'Crear SMMLV'" :style="{ width: '32rem' }" :modal="true">
                <div class="flex flex-col gap-4" @keydown.capture="onFormKeyCapture">
                    <div class="flex flex-col gap-2">
                        <label :for="anioId">Año</label>
                        <InputText :id="anioId" name="anio" type="number" inputmode="numeric" v-model.number="product.anio" :invalid="showError('anio')" @blur="onBlur('anio')" />
                        <small v-if="showError('anio')" class="text-red-500">{{ errors.anio }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label :for="valorId">Valor</label>
                        <InputText :id="valorId" name="valor" type="number" inputmode="numeric" v-model.number="product.valor" :invalid="showError('valor')" @blur="onBlur('valor')" />
                        <small v-if="product.valor" class="text-surface-500">{{ formatMoney(product.valor) }}</small>
                        <small v-if="showError('valor')" class="text-red-500">{{ errors.valor }}</small>
                    </div>

                    <div class="flex items-center gap-2">
                        <Checkbox :id="estadoId" name="estado" v-model="product.estado" binary />
                        <label :for="estadoId">Activo</label>
                    </div>
                </div>

                <template #footer>
                    <Button type="button" label="Guardar" icon="pi pi-check" :loading="saving" :disabled="saving" @click="saveProduct" @keydown="onSaveBtnKeydown" />
                    <Button type="button" label="Cancelar" icon="pi pi-times" text :disabled="saving" @click="productDialog = false" />
                </template>
            </Dialog>

            <!-- Confirmación borrado -->
            <Dialog v-model:visible="deleteProductDialog" header="Confirmar" :style="{ width: '28rem' }" :modal="true">
                <div>
                    ¿Seguro que quieres eliminar el registro del año <b>{{ current?.anio }}</b> con valor <b>{{ formatMoney(current?.valor) }}</b
                    >?
                </div>
                <template #footer>
                    <Button label="No" icon="pi pi-times" text @click="deleteProductDialog = false" />
                    <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteProduct" />
                </template>
            </Dialog>

            <!-- Confirmación borrado masivo -->
            <Dialog v-model:visible="bulkDeleteDialog" header="Confirmar eliminado" :style="{ width: '28rem' }" :modal="true">
                <div>
                    ¿Seguro que quieres eliminar <b>{{ selected.length }}</b> {{ selected.length === 1 ? 'registro' : 'registros' }}?
                </div>
                <template #footer>
                    <Button label="No" icon="pi pi-times" text @click="bulkDeleteDialog = false" />
                    <Button label="Sí" icon="pi pi-check" severity="danger" @click="bulkDelete" />
                </template>
            </Dialog>

            <!-- Detalles -->
            <Dialog v-model:visible="detailsDialog" header="Detalles" :modal="true" :breakpoints="{ '1024px': '60vw', '768px': '75vw', '560px': '92vw' }" :style="{ width: '42vw', maxWidth: '760px' }">
                <div v-if="detailsLoading" class="p-4">Cargando…</div>

                <div v-else class="p-3 sm:p-4">
                    <div v-for="d in details" :key="d.id" class="mb-4 border rounded-lg p-3 sm:p-4">
                        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                            <div class="min-w-0">
                                <div class="text-xs text-surface-500 break-words">Id: {{ d.id }}</div>
                                <div class="text-base font-semibold break-words leading-snug">Año {{ d.anio }} — {{ formatMoney(d.valor) }}</div>
                            </div>

                            <div class="flex flex-wrap items-center gap-2 sm:justify-end">
                                <Tag :value="estadoLabel(d.estado)" :severity="estadoSeverity(d.estado)" />
                            </div>
                        </div>

                        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div class="border rounded-md p-3">
                                <div class="text-sm font-semibold mb-1">Creado</div>
                                <div>{{ formatDate(d.created_at ?? d.createdAt) }}</div>
                            </div>

                            <div class="border rounded-md p-3">
                                <div class="text-sm font-semibold mb-1">Actualizado</div>
                                <div>{{ formatDate(d.updated_at ?? d.updatedAt) }}</div>
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
