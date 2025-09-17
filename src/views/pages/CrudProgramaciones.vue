<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useToast } from 'primevue/usetoast';
import axios from 'axios';

const API = 'http://127.0.0.1:8000/api/v1/programaciones';
const API_CRE = 'http://127.0.0.1:8000/api/v1/creaciones';

const toast = useToast();

const creaciones = ref([]);
const loadingCreaciones = ref(false);
const CRE_PAGE_SIZE = 200;

const creacionInput = ref(null); // opción seleccionada (objeto)
const creacionSugs = ref([]); // sugerencias remotas
let creTimer = null;
const CRE_DEBOUNCE = 250;

async function loadCreaciones() {
    loadingCreaciones.value = true;
    try {
        const { data } = await axios.get(API_CRE, { params: { per_page: CRE_PAGE_SIZE, page: 1 } });
        const items = Array.isArray(data) ? data : (data.data ?? []);
        creaciones.value = items.map((c) => ({
            id: c.id,
            label: (c.nombrePractica || 'Práctica sin nombre') + (c.programaAcademico ? ` — ${c.programaAcademico}` : ''),
            nombrePractica: c.nombrePractica
        }));
    } catch (e) {
        const msg = e?.response?.data?.message || e.message;
        toast.add({ severity: 'error', summary: 'Error al cargar creaciones', detail: String(msg), life: 5000 });
    } finally {
        loadingCreaciones.value = false;
    }
}

/* ===== Helpers fechas ===== */
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

async function fetchCreacionesByName(q) {
    loadingCreaciones.value = true;
    try {
        const { data } = await axios.get(API_CRE, {
            params: { per_page: 20, page: 1, q: q || '' } // el backend filtra por nombre
        });
        const items = Array.isArray(data) ? data : (data.data ?? []);
        creacionSugs.value = items.map((c) => ({
            id: c.id,
            label: (c.nombrePractica || 'Práctica sin nombre') + (c.programaAcademico ? ` — ${c.programaAcademico}` : ''),
            nombrePractica: c.nombrePractica
        }));
    } catch (e) {
        toast.add({ severity: 'error', summary: 'Creaciones', detail: e?.response?.data?.message || e.message, life: 4000 });
        creacionSugs.value = [];
    } finally {
        loadingCreaciones.value = false;
    }
}
function onCompleteCreaciones(e) {
    const q = (e.query || '').trim();
    if (creTimer) clearTimeout(creTimer);
    creTimer = setTimeout(() => fetchCreacionesByName(q), CRE_DEBOUNCE);
}
function onSelectCreacion(e) {
    const it = e.value;
    product.value.creacionId = it?.id ?? null;
    product.value.nombrePractica = it?.nombrePractica ?? '';
}

/* ===== Tabla (server-side) ===== */
const products = ref([]);
const selected = ref([]);
const loading = ref(false);

const page = ref(1);
const rows = ref(10);
const total = ref(0);

const sortField = ref('nombrePractica');
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
    if (raw.length > 0 && (force || raw.length >= MIN_CHARS)) params.q = raw;

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
    creacionId: null,
    nombrePractica: '', // visible solo para el usuario
    descripcion: '',
    lugarDeRealizacion: '',
    justificacion: '',
    recursosNecesarios: '',
    requiereTransporte: false,
    fechaInicio: '',
    fechaFinalizacion: '',
    estadoPractica: 'en_aprobacion'
});

const errors = reactive({
    creacionId: '',
    descripcion: '',
    lugarDeRealizacion: '',
    justificacion: '',
    recursosNecesarios: '',
    requiereTransporte: '',
    fechaInicio: '',
    fechaFinalizacion: ''
});
const touched = reactive(Object.fromEntries(Object.keys(errors).map((k) => [k, false])));

const rules = {
    creacionId: [(v) => !!v || 'Selecciona una práctica creada.'],
    descripcion: [(v) => !!v || 'Requerido.'],
    justificacion: [(v) => !!v || 'Requerido.'],
    recursosNecesarios: [(v) => !!v || 'Requerido.'],
    fechaInicio: [(v) => !!v || 'Requerida.'],
    fechaFinalizacion: [
        (v) => !!v || 'Requerida.',
        (v) => {
            if (!v || !product.value.fechaInicio) return true;
            return new Date(v) >= new Date(product.value.fechaInicio) || 'No puede ser anterior a la fecha de inicio.';
        }
    ]
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
        creacionId: null,
        nombrePractica: '',
        descripcion: '',
        lugarDeRealizacion: '',
        justificacion: '',
        recursosNecesarios: '',
        requiereTransporte: false,
        fechaInicio: '',
        fechaFinalizacion: '',
        estadoPractica: 'en_aprobacion'
    };
    creacionInput.value = null;
    resetValidation();
    productDialog.value = true;
}

function onPickCreacion(id) {
    const item = creaciones.value.find((x) => x.id === id);
    product.value.nombrePractica = item?.nombrePractica ?? '';
}

function editProduct(row) {
    product.value.fechaInicio = toLocalDate(row.fechaInicio);
    product.value.fechaFinalizacion = toLocalDate(row.fechaFinalizacion);
    product.value = { ...row };
    product.value.creacionId = row.creacionId ?? row.creacion_id ?? null;
    product.value.nombrePractica = row.nombrePractica ?? '';
    // Pre-carga el objeto del AutoComplete si lo tenemos en cache
    const cached = creaciones.value.find((x) => x.id === product.value.creacionId);
    creacionInput.value = cached ? { ...cached } : product.value.creacionId ? { id: product.value.creacionId, label: product.value.nombrePractica, nombrePractica: product.value.nombrePractica } : null;
    resetValidation();
    productDialog.value = true;
}

async function saveProduct() {
    submitted.value = true;
    if (!validateAll()) {
        toast.add({ severity: 'warn', summary: 'Valida el formulario', detail: 'Corrige los campos marcados en rojo.', life: 3000 });
        return;
    }
    try {
        const payload = {
            creacionId: product.value.creacionId,
            descripcion: product.value.descripcion,
            lugarDeRealizacion: product.value.lugarDeRealizacion || null,
            justificacion: product.value.justificacion,
            recursosNecesarios: product.value.recursosNecesarios,
            requiereTransporte: !!product.value.requiereTransporte,
            fechaInicio: ymd(product.value.fechaInicio),
            fechaFinalizacion: ymd(product.value.fechaFinalizacion),
            estadoPractica: product.value.estadoPractica || 'en_aprobacion'
        };

        if (product.value.id) {
            await axios.patch(`${API}/${product.value.id}`, payload);
            toast.add({ severity: 'success', summary: 'Programación actualizada', life: 2500 });
        } else {
            await axios.post(API, payload);
            toast.add({ severity: 'success', summary: 'Programación creada', life: 2500 });
        }

        productDialog.value = false;
        await getProducts({ force: true });
    } catch (e) {
        if (e?.response?.status === 422 && e.response.data?.errors) {
            Object.entries(e.response.data.errors).forEach(([field, msgs]) => {
                errors[field] = Array.isArray(msgs) ? msgs[0] : String(msgs);
                touched[field] = true;
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

/* ===== Montaje ===== */
onMounted(async () => {
    await Promise.all([loadCreaciones(), getProducts()]);
});
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
            <Column field="id" header="ID" sortable style="min-width: 6rem" />
            <Column field="nombrePractica" header="Nombre práctica" sortable style="min-width: 14rem" />
            <Column field="fechaInicio" header="Inicio" sortable style="min-width: 10rem" />
            <Column field="fechaFinalizacion" header="Finalización" sortable style="min-width: 12rem" />
            <Column field="requiereTransporte" header="Transporte" sortable style="min-width: 10rem">
                <template #body="{ data }">{{ data.requiereTransporte ? 'Sí' : 'No' }}</template>
            </Column>
            <Column field="estadoPractica" header="Estado" sortable style="min-width: 12rem" />
            <Column :exportable="false" headerStyle="width:9rem">
                <template #body="{ data }">
                    <Button icon="pi pi-pencil" rounded text class="mr-1" @click.stop="editProduct(data)" />
                    <Button icon="pi pi-trash" rounded text severity="danger" @click.stop="confirmDeleteProduct(data)" />
                </template>
            </Column>
        </DataTable>

        <!-- Crear/Editar Programación -->
        <Dialog v-model:visible="productDialog" header="Programar práctica" :style="{ width: '40rem' }" :modal="true">
            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                    <label for="creacionId">Práctica (creada)</label>
                    <Listbox
                        id="creacionId"
                        v-model="product.creacionId"
                        :options="creaciones"
                        optionLabel="label"
                        optionValue="id"
                        placeholder="Selecciona o escribe para buscar…"
                        :loading="loadingCreaciones"
                        filter
                        showClear
                        fluid
                        @update:modelValue="onPickCreacion"
                    />
                    <small v-if="showError('creacionId')" class="text-red-500">{{ errors.creacionId }}</small>
                </div>

                <div class="flex flex-col gap-2">
                    <label for="descripcion">Descripción</label>
                    <Textarea id="descripcion" v-model.trim="product.descripcion" :invalid="showError('descripcion')" @blur="onBlur('descripcion')" fluid />
                    <small v-if="showError('descripcion')" class="text-red-500">{{ errors.descripcion }}</small>
                </div>

                <div class="flex flex-col gap-2">
                    <label for="lugarDeRealizacion">Lugar de realización</label>
                    <InputText id="lugarDeRealizacion" v-model.trim="product.lugarDeRealizacion" :invalid="showError('lugarDeRealizacion')" @blur="onBlur('lugarDeRealizacion')" fluid />
                    <small v-if="showError('lugarDeRealizacion')" class="text-red-500">{{ errors.lugarDeRealizacion }}</small>
                </div>

                <div class="flex flex-col gap-2">
                    <label for="recursosNecesarios">Recursos necesarios</label>
                    <Textarea id="recursosNecesarios" v-model.trim="product.recursosNecesarios" :invalid="showError('recursosNecesarios')" @blur="onBlur('recursosNecesarios')" fluid />
                    <small v-if="showError('recursosNecesarios')" class="text-red-500">{{ errors.recursosNecesarios }}</small>
                </div>

                <div class="flex flex-col gap-2">
                    <label for="justificacion">Justificación</label>
                    <Textarea id="justificacion" v-model.trim="product.justificacion" :invalid="showError('justificacion')" @blur="onBlur('justificacion')" fluid />
                    <small v-if="showError('justificacion')" class="text-red-500">{{ errors.justificacion }}</small>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div class="flex flex-col gap-2">
                        <label for="fechaInicio">Fecha inicio</label>
                        <InputText id="fechaInicio" type="date" v-model="product.fechaInicio" :invalid="showError('fechaInicio')" @blur="onBlur('fechaInicio')" />
                        <small v-if="showError('fechaInicio')" class="text-red-500">{{ errors.fechaInicio }}</small>
                    </div>

                    <div class="flex flex-col gap-2">
                        <label for="fechaFinalizacion">Fecha finalización</label>
                        <InputText id="fechaFinalizacion" type="date" v-model="product.fechaFinalizacion" :invalid="showError('fechaFinalizacion')" @blur="onBlur('fechaFinalizacion')" />
                        <small v-if="showError('fechaFinalizacion')" class="text-red-500">{{ errors.fechaFinalizacion }}</small>
                    </div>
                </div>

                <div class="flex items-center gap-2">
                    <Checkbox v-model="product.requiereTransporte" :binary="true" inputId="requiereTransporte" />
                    <label for="requiereTransporte">Requiere transporte</label>
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
                ¿Seguro que quieres eliminar la <b>programación</b> <b>ID: {{ current?.id }}</b> — <b>{{ current?.nombrePractica }}</b
                >?
            </div>
            <template #footer>
                <Button label="No" icon="pi pi-times" text @click="deleteProductDialog = false" />
                <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteProduct" />
            </template>
        </Dialog>

        <!-- Detalles -->
        <Dialog v-model:visible="detailsDialog" header="Detalles de programación" :style="{ width: '56vw' }" :modal="true">
            <div v-if="detailsLoading" class="p-4">Cargando…</div>
            <div v-else>
                <div v-for="d in details" :key="d.id" class="mb-3 border p-3 rounded">
                    <div class="font-semibold mb-2">ID: {{ d.id }} — {{ d.nombrePractica }}</div>
                    <div class="grid grid-cols-2 gap-2">
                        <div><b>Descripción:</b> {{ d.descripcion }}</div>
                        <div><b>Lugar:</b> {{ d.lugarDeRealizacion }}</div>
                        <div><b>Inicio:</b> {{ d.fechaInicio }}</div>
                        <div><b>Finalización:</b> {{ d.fechaFinalizacion }}</div>
                        <div><b>Transporte:</b> {{ d.requiereTransporte ? 'Sí' : 'No' }}</div>
                        <div><b>Estado:</b> {{ d.estadoPractica }}</div>
                    </div>
                    <div class="mt-3">
                        <b>Recursos necesarios:</b>
                        <div class="whitespace-pre-line">{{ d.recursosNecesarios }}</div>
                    </div>
                    <div class="mt-2">
                        <b>Justificación:</b>
                        <div class="whitespace-pre-line">{{ d.justificacion }}</div>
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
