<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useToast } from 'primevue/usetoast';
import axios from 'axios';

const API = 'http://127.0.0.1:8000/api/v1/catalogos';
const toast = useToast();

/* ===== Tabla (server-side) ===== */
const products = ref([]);
const selected = ref([]);
const loading = ref(false);

const page = ref(1);
const rows = ref(10);
const total = ref(0);

const sortField = ref('facultad');
const sortOrder = ref(1); // 1 asc, -1 desc

/* ===== Búsqueda única (en tiempo real) ===== */
const search = ref('');
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
let typingTimer = null;
let activeCtrl = null;

/* ===== Orden ===== */
const sortParam = computed(() => (!sortField.value ? undefined : `${sortOrder.value === -1 ? '-' : ''}${sortField.value}`));

/* ===== Params ===== */
function buildParams({ force = false } = {}) {
    const params = { per_page: +rows.value || 10, page: +page.value || 1 };
    if (sortParam.value) params.sort = sortParam.value;

    const raw = String(search.value || '').trim();
    if (raw.length > 0 && (force || raw.length >= MIN_CHARS)) {
        params.q = raw;
    }
    return params;
}

/* ===== Llamada con cancelación ===== */
async function getProducts(opts = {}) {
    const { signal, force = false } = opts;
    loading.value = true;
    try {
        const { data } = await axios.get(API, {
            params: buildParams({ force }),
            signal
        });
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
            toast.add({ severity: 'error', summary: 'Error al cargar', detail: `[${status}] ${msg}`, life: 6000 });
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

    if (typingTimer) {
        clearTimeout(typingTimer);
        typingTimer = null;
    }
    if (activeCtrl) {
        activeCtrl.abort();
        activeCtrl = null;
    }
    typingTimer = setTimeout(() => {
        activeCtrl = new AbortController();
        getProducts({ signal: activeCtrl.signal }).finally(() => (activeCtrl = null));
    }, DEBOUNCE_MS);
}

/* Dispara solo cuando: vacío (recargar todo) o ≥ 2 chars */
watch(search, () => {
    page.value = 1;
    // si está vacío, recarga todo; si no, usar debounce
    if (String(search.value || '').trim().length === 0) {
        if (activeCtrl) {
            activeCtrl.abort();
            activeCtrl = null;
        }
        if (typingTimer) clearTimeout(typingTimer);
        getProducts(); // listado completo
    } else {
        scheduleFetch();
    }
});

/* ===== Acciones rápidas ===== */
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
    getProducts(); // sin q -> listado completo
}

/* ===== DataTable events ===== */
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

/* ===== Detalles ===== */
const detailsDialog = ref(false);
const detailsLoading = ref(false);
const details = ref([]);

async function openDetails() {
    if (!selected.value.length) return;
    detailsLoading.value = true;
    details.value = [];
    const reqs = selected.value.map((r) => axios.get(`${API}/${r.id}`));
    const results = await Promise.allSettled(reqs);
    details.value = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.data?.data ?? r.value.data);
    const fails = results.length - details.value.length;
    if (fails)
        toast.add({
            severity: 'warn',
            summary: 'Algunos detalles fallaron',
            detail: `Fallaron ${fails} de ${results.length}`,
            life: 4000
        });
    detailsDialog.value = true;
    detailsLoading.value = false;
}

/* ===== CRUD: crear/editar ===== */
const productDialog = ref(false);
const submitted = ref(false);
const product = ref({
    id: null,
    facultad: '',
    nivelAcademico: '',
    programaAcademico: ''
});

const errors = reactive({
    facultad: '',
    nivelAcademico: '',
    programaAcademico: ''
});
const touched = reactive({
    facultad: false,
    nivelAcademico: false,
    programaAcademico: false
});

const rules = {
    facultad: [(v) => !!v || 'Requerido.'],
    nivelAcademico: [(v) => !!v || 'Requerido.'],
    programaAcademico: [(v) => !!v || 'Requerido.']
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

function openNew() {
    product.value = {
        id: null,
        facultad: '',
        nivelAcademico: '',
        programaAcademico: ''
    };
    resetValidation();
    productDialog.value = true;
}
function editProduct(row) {
    product.value = { ...row };
    resetValidation();
    productDialog.value = true;
}

async function saveProduct() {
    submitted.value = true;
    if (!validateAll()) {
        toast.add({
            severity: 'warn',
            summary: 'Valida el formulario',
            detail: 'Corrige los campos marcados en rojo.',
            life: 3000
        });
        return;
    }
    try {
        if (product.value.id) {
            await axios.patch(`${API}/${product.value.id}`, product.value);
            toast.add({ severity: 'success', summary: 'Actualizado', life: 2500 });
        } else {
            await axios.post(API, product.value);
            toast.add({ severity: 'success', summary: 'Creado', life: 2500 });
        }
        productDialog.value = false;
        await getProducts({ force: true });
    } catch (e) {
        if (e?.response?.status === 422 && e.response.data?.errors) {
            Object.entries(e.response.data.errors).forEach(([f, msgs]) => {
                errors[f] = Array.isArray(msgs) ? msgs[0] : String(msgs);
                touched[f] = true;
            });
        }
        const detail = e?.response?.data?.message || e?.response?.data?.error || e.message;
        toast.add({ severity: 'error', summary: 'No se pudo guardar', detail: String(detail), life: 5000 });
    } finally {
        submitted.value = false;
    }
}

/* ===== Borrado ===== */
const deleteProductDialog = ref(false);
const current = ref(null);

function confirmDeleteProduct(row) {
    current.value = { ...row };
    deleteProductDialog.value = true;
}
async function deleteProduct() {
    try {
        await axios.delete(`${API}/${current.value.id}`);

        // Limpieza optimista
        products.value = products.value.filter((x) => x.id !== current.value.id);

        toast.add({ severity: 'success', summary: 'Eliminado', life: 2500 });

        // 🔁 Refill de la página
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
// ===== Borrado en lote =====
const bulkDeleteDialog = ref(false);

function confirmBulkDelete() {
    if (!selected.value.length) return;
    bulkDeleteDialog.value = true;
}

async function bulkDelete() {
    const ids = selected.value.map((r) => r.id);
    try {
        await axios.post(`${API}/bulk-delete`, { ids });

        // Limpieza optimista
        const set = new Set(ids);
        products.value = products.value.filter((x) => !set.has(x.id));
        selected.value = [];

        toast.add({ severity: 'success', summary: `Eliminados (${ids.length})`, life: 2500 });

        // 🔁 Refill de la página
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
    if (Number(page.value) > totalPages) {
        page.value = totalPages;
    }
    return getProducts({ force: true });
}

const dropdownNivelAcademico = ref([
    { name: 'Pregrado', code: 'pregrado' },
    { name: 'Postgrado', code: 'postgrado' }
]);

onMounted(() => getProducts());
</script>

<template>
    <div class="card">
        <Toolbar class="mb-3">
            <template #start>
                <div class="flex items-center gap-2 shrink-0">
                    <Button label="Crear" icon="pi pi-plus" @click="openNew" />
                    <Button label="Borrar" icon="pi pi-trash" :disabled="!selected.length" @click="confirmBulkDelete" />
                    <Button label="Detalles" icon="pi pi-list" :disabled="!selected.length" @click="openDetails" />
                </div>
            </template>

            <template #center />

            <template #end>
                <div class="min-w-0 w-full sm:w-80 md:w-[26rem]">
                    <IconField class="w-full">
                        <InputIcon :class="loading ? 'pi pi-spinner pi-spin' : 'pi pi-search'" />
                        <InputText v-model.trim="search" placeholder="Escribe para buscar…" class="w-full" @keydown.enter.prevent="forceFetch" @keydown.esc.prevent="clearSearch" />
                        <!-- limpiar dentro del campo -->
                        <span v-if="search" class="pi pi-times cursor-pointer p-input-icon-right" style="right: 0.75rem" @click="clearSearch" aria-label="Limpiar búsqueda" />
                    </IconField>
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
            <Column selectionMode="multiple" headerStyle="width:3rem" />
            <Column field="id" header="id" sortable style="min-width: 6rem" />
            <Column field="programaAcademico" header="Programa Académico" sortable style="min-width: 12rem" />
            <Column field="nivelAcademico" header="Nivel Académico" sortable style="min-width: 12rem" />
            <Column field="facultad" header="Facultad" sortable style="min-width: 12rem" />
            <Column :exportable="false" headerStyle="width:9rem">
                <template #body="{ data }">
                    <Button icon="pi pi-pencil" rounded text class="mr-1" @click.stop="editProduct(data)" />
                    <Button icon="pi pi-trash" rounded text severity="danger" @click.stop="confirmDeleteProduct(data)" />
                </template>
            </Column>
        </DataTable>

        <!-- Crear/Editar -->
        <Dialog v-model:visible="productDialog" header="Creación de programa académico por facultad" :style="{ width: '36rem' }" :modal="true">
            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                    <label for="nivelAcademico">Nivel académico</label>
                    <Select id="nivelAcademico" v-model="product.nivelAcademico" :options="dropdownNivelAcademico" optionLabel="name" optionValue="code" placeholder="Nivel Académico" fluid />
                    <small v-if="showError('nivelAcademico')" class="text-red-500">{{ errors.nivelAcademico }}</small>
                </div>
                <div class="flex flex-col gap-2">
                    <label for="facultad">Facultad Académica</label>
                    <InputText id="facultad" v-model.trim="product.facultad" :invalid="showError('facultad')" @blur="onBlur('facultad')" fluid />
                    <small v-if="showError('facultad')" class="text-red-500">{{ errors.facultad }}</small>
                </div>
                <div class="flex flex-col gap-2">
                    <label for="programaAcademico">Programa Académico</label>
                    <InputText id="programaAcademico" v-model.trim="product.programaAcademico" :invalid="showError('programaAcademico')" @blur="onBlur('programaAcademico')" fluid />
                    <small v-if="showError('programaAcademico')" class="text-red-500">{{ errors.programaAcademico }}</small>
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
                ¿Seguro que quieres eliminar la creación <b>Id:{{ current?.id }}</b> — <b>{{ current?.anio }}</b
                >?
            </div>
            <template #footer>
                <Button label="No" icon="pi pi-times" text @click="deleteProductDialog = false" />
                <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteProduct" />
            </template>
        </Dialog>

        <!-- Detalles (Catálogos) -->
        <Dialog v-model:visible="detailsDialog" header="Detalles de catálogo" :modal="true" :breakpoints="{ '1024px': '60vw', '768px': '75vw', '560px': '92vw' }" :style="{ width: '42vw', maxWidth: '720px' }">
            <div v-if="detailsLoading" class="p-4">Cargando…</div>

            <div v-else class="p-3 sm:p-4">
                <div v-for="d in details" :key="d.id" class="mb-3 border rounded p-3 sm:p-4">
                    <div class="font-semibold mb-3 break-words">Id: {{ d.id }} — {{ d.programaAcademico }}</div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <dl class="space-y-2">
                            <div>
                                <dt class="text-sm font-semibold">Facultad</dt>
                                <dd class="break-words">{{ d.facultad }}</dd>
                            </div>
                            <div>
                                <dt class="text-sm font-semibold">Programa Académico</dt>
                                <dd class="break-words">{{ d.programaAcademico }}</dd>
                            </div>
                        </dl>

                        <dl class="space-y-2">
                            <div>
                                <dt class="text-sm font-semibold">Nivel Académico</dt>
                                <dd class="break-words">{{ d.nivelAcademico }}</dd>
                            </div>
                        </dl>
                    </div>

                    <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-500">
                        <div>
                            <div class="font-semibold">Fecha Creación</div>
                            <div>{{ d.fechacreacion }}</div>
                        </div>
                        <div>
                            <div class="font-semibold">Fecha Modificación</div>
                            <div>{{ d.fechamodificacion }}</div>
                        </div>
                        <div>
                            <div class="font-semibold">IP Creación</div>
                            <div>{{ d.ipcreacion }}</div>
                        </div>
                        <div>
                            <div class="font-semibold">IP Modificación</div>
                            <div>{{ d.ipmodificacion }}</div>
                        </div>
                    </div>
                </div>
            </div>

            <template #footer>
                <Button label="Cerrar" icon="pi pi-times" text @click="detailsDialog = false" />
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
    </div>
</template>
