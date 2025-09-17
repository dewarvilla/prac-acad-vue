<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useToast } from 'primevue/usetoast';
import axios from 'axios';

const API = 'http://127.0.0.1:8000/api/v1/salarios';
const toast = useToast();

/* ===== Tabla (server-side) ===== */
const products = ref([]);
const selected = ref([]);
const loading = ref(false);

const page = ref(1);
const rows = ref(10);
const total = ref(0);

const sortField = ref('anio');
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

    // evita llamadas innecesarias
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
    scheduleFetch();
});

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

/* ===== Acciones búsqueda ===== */
function buscar() {
    if (typingTimer) clearTimeout(typingTimer);
    if (activeCtrl) {
        activeCtrl.abort();
        activeCtrl = null;
    }
    page.value = 1;
    getProducts({ force: true }); // <- clave
}

function limpiar() {
    search.value = '';
    page.value = 1;
    if (typingTimer) clearTimeout(typingTimer);
    if (activeCtrl) {
        activeCtrl.abort();
        activeCtrl = null;
    }
    getProducts(); // sin q -> listado completo
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
    anio: '',
    valor: ''
});

const errors = reactive({
    anio: '',
    valor: ''
});
const touched = reactive({
    anio: false,
    valor: false
});

const rules = {
    anio: [(v) => !!v || 'Requerido.'],
    valor: [(v) => !!v || 'Requerido.']
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
        anio: '',
        valor: ''
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
        products.value = products.value.filter((x) => x.id !== current.value.id);
        toast.add({ severity: 'success', summary: 'Eliminado', life: 2500 });
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

onMounted(() => getProducts());

const toNumber = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')));

const formatMoney = (v) => {
    const n = toNumber(v);
    if (!Number.isFinite(n)) return ''; // o devuelve `$ ${v}` si prefieres
    // Cambia 'es-CO'/'COP' si quieres otro formato
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(n);
};
</script>

<template>
    <div class="card">
        <Toolbar class="mb-3">
            <template #start>
                <Button label="Crear" icon="pi pi-plus" class="mr-2" @click="openNew" />
                <Button label="Borrar" icon="pi pi-trash" class="mr-2" :disabled="!selected.length" @click="selected.length && confirmDeleteProduct(selected[0])" />
                <Button label="Detalles" icon="pi pi-list" :disabled="!selected.length" @click="openDetails" />
            </template>

            <template #end>
                <IconField>
                    <InputIcon :class="loading ? 'pi pi-spinner pi-spin' : 'pi pi-search'" />
                    <InputText v-model.trim="search" placeholder="Escribe para buscar…" style="width: 420px" @keydown.enter.prevent="buscar" />
                </IconField>
                <Button label="Buscar" icon="pi pi-search" class="ml-2" @click="buscar" />
                <Button label="Limpiar" icon="pi pi-times" text class="ml-1" @click="limpiar" />
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
            <Column field="anio" header="Año" sortable style="min-width: 12rem" />
            <Column field="valor" header="Valor" sortable style="min-width: 14rem">
                <template #body="{ data }">
                    {{ formatMoney(data.valor) }}
                </template>
            </Column>

            <Column :exportable="false" headerStyle="width:9rem">
                <template #body="{ data }">
                    <Button icon="pi pi-pencil" rounded text class="mr-1" @click.stop="editProduct(data)" />
                    <Button icon="pi pi-trash" rounded text severity="danger" @click.stop="confirmDeleteProduct(data)" />
                </template>
            </Column>
        </DataTable>

        <!-- Crear/Editar -->
        <Dialog v-model:visible="productDialog" header="Creación de salario minimo (SMLV)" :style="{ width: '36rem' }" :modal="true">
            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                    <label for="anio">Año</label>
                    <InputText id="anio" v-model.trim="product.anio" :invalid="showError('anio')" @blur="onBlur('anio')" fluid />
                    <small v-if="showError('anio')" class="text-red-500">{{ errors.anio }}</small>
                </div>
                <div class="flex flex-col gap-2">
                    <label for="valor">Valor</label>
                    <InputNumber id="valor" v-model="product.valor" mode="currency" currency="COP" locale="es-CO" :minFractionDigits="2" :maxFractionDigits="2" fluid />
                    <small v-if="showError('valor')" class="text-red-500">{{ errors.valor }}</small>
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

        <!-- Detalles -->
        <Dialog v-model:visible="detailsDialog" header="Detalles de salario" :style="{ width: '56vw' }" :modal="true">
            <div v-if="detailsLoading" class="p-4">Cargando…</div>
            <div v-else>
                <div v-for="d in details" :key="d.id" class="mb-3 border p-3 rounded">
                    <div class="font-semibold mb-2">Id: {{ d.id }} — {{ d.anio }}</div>
                    <div class="grid grid-cols-2 gap-2">
                        <div><b>Año:</b> {{ d.anio }}</div>
                        <div><b>Valor:</b> {{ formatMoney(d.valor) }}</div>
                    </div>
                    <div>
                        <small class="text-gray-500">Fecha Creación: {{ d.fechacreacion }}</small>
                    </div>
                    <div>
                        <small class="text-gray-500">Fecha Modificación: {{ d.fechamodificacion }}</small>
                    </div>
                    <div>
                        <small class="text-gray-500">IP Creación: {{ d.ipcreacion }}</small>
                    </div>
                    <div>
                        <small class="text-gray-500">IP Modificación: {{ d.ipmodificacion }}</small>
                    </div>
                </div>
            </div>
            <template #footer>
                <Button label="Cerrar" icon="pi pi-times" text @click="detailsDialog = false" />
            </template>
        </Dialog>
    </div>
</template>
