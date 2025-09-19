<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'; // <- añadí watch
import { useToast } from 'primevue/usetoast';
import axios from 'axios';

const API = 'http://127.0.0.1:8000/api/v1/fechas';
const toast = useToast();

/* ===== Tabla (server-side) ===== */
const products = ref([]);
const selected = ref([]);
const loading = ref(false);

const page = ref(1);
const rows = ref(10);
const total = ref(0);

const sortField = ref('periodo');
const sortOrder = ref(1); // 1 asc, -1 desc

/* ===== Búsqueda única ===== */
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

/* Dispara solo cuando: ≥ 2 chars */
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
    getProducts({ force: true }); // fuerza consulta aunque haya 1 char
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
    if (fails) {
        toast.add({
            severity: 'warn',
            summary: 'Algunos detalles fallaron',
            detail: `Fallaron ${fails} de ${results.length}`,
            life: 4000
        });
    }
    detailsDialog.value = true;
    detailsLoading.value = false;
}

/* ===== CRUD: crear/editar ===== */
const productDialog = ref(false);
const submitted = ref(false);
const product = ref({
    id: null,
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
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; // YYYY-MM-DD
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

// campos de fecha en tu formulario
const DATE_FIELDS = ['fechaAperturaPreg', 'fechaCierreDocentePreg', 'fechaCierreJefeDepart', 'fechaCierreDecano', 'fechaAperturaPostg', 'fechaCierreDocentePostg', 'fechaCierreCoordinadorPostg', 'fechaCierreJefePostg'];

const toLocalDate = (v) => {
    if (!v) return null;
    if (v instanceof Date) return v;
    const s = String(v);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(s);
};

const ymd = (v) => {
    if (!v) return '';
    const d = v instanceof Date ? v : toLocalDate(v);
    if (!d || isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
};

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
    product.value = { ...row };
    // convierte strings ISO del API a Date
    DATE_FIELDS.forEach((f) => (product.value[f] = toLocalDate(row[f])));
    resetValidation();
    productDialog.value = true;
}

/* ===== Helpers para payload y errores (camelCase -> snake_case) ===== */
const FIELD_MAP = {
    periodo: 'periodo',
    // Pregrado
    fechaAperturaPreg: 'fecha_apertura_preg',
    fechaCierreDocentePreg: 'fecha_cierre_docente_preg',
    fechaCierreJefeDepart: 'fecha_cierre_jefe_depart',
    fechaCierreDecano: 'fecha_cierre_decano',
    // Postgrado
    fechaAperturaPostg: 'fecha_apertura_postg',
    fechaCierreDocentePostg: 'fecha_cierre_docente_postg',
    fechaCierreCoordinadorPostg: 'fecha_cierre_coordinador_postg',
    fechaCierreJefePostg: 'fecha_cierre_jefe_postg'
};

// Normaliza Date -> 'YYYY-MM-DD' y arma el payload en snake_case
function buildPayload() {
    const out = {};
    for (const [camel, snake] of Object.entries(FIELD_MAP)) {
        const v = product.value[camel];
        out[snake] = camel !== 'periodo' ? ymd(v) : v;
    }
    return out;
}

// Traduce errores del backend (snake) -> claves camel para mostrarlos en el form
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
            await axios.patch(`${API}/${product.value.id}`, payload, { headers: { 'Content-Type': 'application/json' } });
            toast.add({ severity: 'success', summary: 'Actualizado', life: 2500 });
        } else {
            await axios.post(API, payload, { headers: { 'Content-Type': 'application/json' } });
            toast.add({ severity: 'success', summary: 'Creado', life: 2500 });
        }

        productDialog.value = false;
        await getProducts();
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
        toast.add({ severity: 'error', summary: 'No se pudo eliminar', detail: String(e?.response?.data?.message || e.message), life: 5000 });
    } finally {
        deleteProductDialog.value = false;
        current.value = null;
    }
}

onMounted(() => getProducts());
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
            <Column field="periodo" header="Periodo" sortable style="min-width: 12rem" />
            <Column field="fechaAperturaPreg" header="Apertura pregrado" sortable style="min-width: 12rem">
                <template #body="{ data }">
                    {{ ymd(data.fechaAperturaPreg) }}
                </template>
            </Column>
            <Column field="fechaCierreDocentePreg" header="Cierre pregrado" sortable style="min-width: 12rem">
                <template #body="{ data }">
                    {{ ymd(data.fechaCierreDocentePreg) }}
                </template>
            </Column>
            <Column field="fechaAperturaPostg" header="Apertura postgrado" sortable style="min-width: 12rem">
                <template #body="{ data }">
                    {{ ymd(data.fechaAperturaPostg) }}
                </template>
            </Column>
            <Column field="fechaCierreDocentePostg" header="Cierre postgrado" sortable style="min-width: 12rem">
                <template #body="{ data }">
                    {{ ymd(data.fechaCierreDocentePostg) }}
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
        <Dialog v-model:visible="productDialog" header="Crear Fechas por periodo" :style="{ width: '36rem' }" :modal="true">
            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                    <label for="periodo">Periodo</label>
                    <InputText id="periodo" v-model.trim="product.periodo" placeholder="2025-1" :invalid="showError('periodo')" @blur="onBlur('periodo')" fluid />
                    <small v-if="showError('periodo')" class="text-red-500">{{ errors.periodo }}</small>
                </div>

                <!-- Pregrado -->
                <div class="flex flex-col gap-2">
                    <label for="fechaAperturaPreg">Fecha apertura (Pregrado)</label>
                    <DatePicker id="fechaAperturaPreg" v-model="product.fechaAperturaPreg" :invalid="showError('fechaAperturaPreg')" @update:modelValue="onBlur('fechaAperturaPreg')" dateFormat="yy-mm-dd" showIcon fluid />
                    <small v-if="showError('fechaAperturaPreg')" class="text-red-500">{{ errors.fechaAperturaPreg }}</small>
                </div>
                <div class="flex flex-col gap-2">
                    <label for="fechaCierreDocentePreg">Fecha cierre solicitud de programación (Pregrado)</label>
                    <DatePicker id="fechaCierreDocentePreg" v-model="product.fechaCierreDocentePreg" :invalid="showError('fechaCierreDocentePreg')" @update:modelValue="onBlur('fechaCierreDocentePreg')" dateFormat="yy-mm-dd" showIcon fluid />
                    <small v-if="showError('fechaCierreDocentePreg')" class="text-red-500">{{ errors.fechaCierreDocentePreg }}</small>
                </div>
                <div class="flex flex-col gap-2">
                    <label for="fechaCierreJefeDepart">Fecha cierre revisión jefe de departamento</label>
                    <DatePicker id="fechaCierreJefeDepart" v-model="product.fechaCierreJefeDepart" :invalid="showError('fechaCierreJefeDepart')" @update:modelValue="onBlur('fechaCierreJefeDepart')" dateFormat="yy-mm-dd" showIcon fluid />
                    <small v-if="showError('fechaCierreJefeDepart')" class="text-red-500">{{ errors.fechaCierreJefeDepart }}</small>
                </div>
                <div class="flex flex-col gap-2">
                    <label for="fechaCierreDecano">Fecha cierre revisión decano</label>
                    <DatePicker id="fechaCierreDecano" v-model="product.fechaCierreDecano" :invalid="showError('fechaCierreDecano')" @update:modelValue="onBlur('fechaCierreDecano')" dateFormat="yy-mm-dd" showIcon fluid />
                    <small v-if="showError('fechaCierreDecano')" class="text-red-500">{{ errors.fechaCierreDecano }}</small>
                </div>

                <!-- Postgrado -->
                <div class="flex flex-col gap-2">
                    <label for="fechaAperturaPostg">Fecha apertura (Postgrado)</label>
                    <DatePicker id="fechaAperturaPostg" v-model="product.fechaAperturaPostg" :invalid="showError('fechaAperturaPostg')" @update:modelValue="onBlur('fechaAperturaPostg')" dateFormat="yy-mm-dd" showIcon fluid />
                    <small v-if="showError('fechaAperturaPostg')" class="text-red-500">{{ errors.fechaAperturaPostg }}</small>
                </div>
                <div class="flex flex-col gap-2">
                    <label for="fechaCierreDocentePostg">Fecha cierre solicitud de programación (Postgrado)</label>
                    <DatePicker id="fechaCierreDocentePostg" v-model="product.fechaCierreDocentePostg" :invalid="showError('fechaCierreDocentePostg')" @update:modelValue="onBlur('fechaCierreDocentePostg')" dateFormat="yy-mm-dd" showIcon fluid />
                    <small v-if="showError('fechaCierreDocentePostg')" class="text-red-500">{{ errors.fechaCierreDocentePostg }}</small>
                </div>
                <div class="flex flex-col gap-2">
                    <label for="fechaCierreCoordinadorPostg">Fecha cierre revisión coordinardor postgrados</label>
                    <DatePicker
                        id="fechaCierreCoordinadorPostg"
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
                    <DatePicker id="fechaCierreJefePostg" v-model="product.fechaCierreJefePostg" :invalid="showError('fechaCierreJefePostg')" @update:modelValue="onBlur('fechaCierreJefePostg')" dateFormat="yy-mm-dd" showIcon fluid />
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
                ¿Seguro que quieres eliminar la creación <b>Id: {{ current?.id }}</b> — <b>{{ current?.periodo }}</b
                >?
            </div>
            <template #footer>
                <Button label="No" icon="pi pi-times" text @click="deleteProductDialog = false" />
                <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteProduct" />
            </template>
        </Dialog>

        <!-- Detalles -->
        <Dialog v-model:visible="detailsDialog" header="Detalles de creación" :style="{ width: '56vw' }" :modal="true">
            <div v-if="detailsLoading" class="p-4">Cargando…</div>
            <div v-else>
                <div v-for="d in details" :key="d.id" class="mb-3 border p-3 rounded">
                    <div class="font-semibold mb-2">Id: {{ d.id }} — {{ d.periodo }}</div>
                    <div class="grid grid-cols-2 gap-2">
                        <div><b>Fecha apertura solicitud programación:</b> {{ ymd(d.fechaAperturaPreg) }}</div>
                        <div><b>Fecha cierre solicitud programación:</b> {{ ymd(d.fechaCierreDocentePreg) }}</div>
                        <div><b>Fecha cierre revisión jefe de departamento:</b> {{ ymd(d.fechaCierreJefeDepart) }}</div>
                        <div><b>Fecha cierre revisión decano:</b> {{ ymd(d.fechaCierreDecano) }}</div>
                        <div><b>Fecha apertura solicitud postgrados:</b> {{ ymd(d.fechaAperturaPostg) }}</div>
                        <div><b>Fecha cierre solicitud postgrados:</b> {{ ymd(d.fechaCierreDocentePostg) }}</div>
                        <div><b>Fecha cierre revisión coordinador postgrados:</b> {{ ymd(d.fechaCierreCoordinadorPostg) }}</div>
                        <div><b>Fecha cierre revisión jefe postgrados:</b> {{ ymd(d.fechaCierreJefePostg) }}</div>
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
