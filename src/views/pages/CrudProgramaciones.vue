<script setup>
import { ref, reactive, computed, onMounted, watch, onBeforeUnmount } from 'vue';
import { useToast } from 'primevue/usetoast';
import axios from 'axios';
import RoutePickerDialog from '@/components/RoutePickerDialog.vue';

const API_BASE = 'http://127.0.0.1:8000/api/v1';
const API_PROG = `${API_BASE}/programaciones`;
const API_CRE = `${API_BASE}/creaciones`;

const toast = useToast();

/* ===== SEDES (origen fijo) ===== */
const SEDES = [
    { id: 'monteria', label: 'Montería (Sede principal)', lat: 8.789478076658922, lng: -75.85682013983686, desc: 'Campus Montería' },
    { id: 'berastegui', label: 'Berástegui', lat: 8.882344202163397, lng: -75.7018615673633, desc: 'Sede Berástegüí' },
    { id: 'lorica', label: 'Lorica', lat: 9.243969741154956, lng: -75.80946284785088, desc: 'Sede Lorica' },
    { id: 'sahagun', label: 'Sahagún', lat: 8.944731570525947, lng: -75.43399000105987, desc: 'Sede Sahagún' },
    { id: 'montelibano', label: 'Montelíbano', lat: 7.985484181256228, lng: -75.42109965748082, desc: 'Sede Montelíbano' }
];

/* ===== Tabla (server-side) ===== */
const rows = ref(10);
const page = ref(1);
const total = ref(0);
const loading = ref(false);
const products = ref([]);
const selected = ref([]);
const sortField = ref('fechaInicio');
const sortOrder = ref(-1);

/* ===== Búsqueda ===== */
const search = ref('');
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
let typingTimer = null;
let activeCtrl = null;

const sortParam = computed(() => (!sortField.value ? undefined : `${sortOrder.value === -1 ? '-' : ''}${sortField.value}`));

function buildParams({ force = false } = {}) {
    const params = { per_page: +rows.value || 10, page: +page.value || 1 };
    if (sortParam.value) params.sort = sortParam.value;
    const raw = String(search.value || '').trim();
    if (raw.length > 0 && (force || raw.length >= MIN_CHARS)) params.q = raw;
    return params;
}

async function getProducts(opts = {}) {
    const { signal, force = false } = opts;
    loading.value = true;
    try {
        const { data } = await axios.get(API_PROG, { params: buildParams({ force }), signal });
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
            toast.add({
                severity: 'error',
                summary: 'Error al cargar',
                detail: `[${status ?? 'ERR'}] ${msg}`,
                life: 6000
            });
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

/* ===== Detalles ===== */
const detailsDialog = ref(false);
const detailsLoading = ref(false);
const details = ref([]);

async function openDetails() {
    if (!selected.value.length) return;
    detailsLoading.value = true;
    details.value = [];
    const reqs = selected.value.map((r) => axios.get(`${API_PROG}/${r.id}`));
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

/* ========================= CRUD crear/editar ========================= */
const productDialog = ref(false);
const saving = ref(false);
const product = ref({
    id: null,
    creacion: null, // { id, label, programa, facultad, nivel }
    nombrePractica: '',
    descripcion: '',
    requiereTransporte: false,
    lugarDeRealizacion: '',
    justificacion: '',
    recursosNecesarios: '',
    fechaInicio: '',
    fechaFinalizacion: ''
});

/* ==== Recorridos dentro del modal ==== */
const routesDraft = ref([]); // {id?, ...payload, _state?: 'new'|'keep'|'delete'}
const routeDlg = ref(false);

function fmtKm(m) {
    if (m == null) return '—';
    const km = Number(m) / 1000;
    return isFinite(km) ? `${km.toFixed(2)} km` : '—';
}
function fmtMin(s) {
    if (s == null) return '—';
    const min = Math.round(Number(s) / 60);
    return isFinite(min) ? `${min} min` : '—';
}
function addDraftRoute(payload) {
    routesDraft.value.push({ ...payload, _state: 'new' });
}
function removeDraftRoute(idx) {
    const r = routesDraft.value[idx];
    if (r?.id) routesDraft.value[idx] = { ...r, _state: 'delete' };
    else routesDraft.value.splice(idx, 1);
}
function visibleRoutes() {
    return routesDraft.value.filter((r) => r._state !== 'delete');
}

const errors = reactive({
    creacion: '',
    justificacion: '',
    recursosNecesarios: '',
    fechaInicio: '',
    fechaFinalizacion: ''
});
const touched = reactive({
    creacion: false,
    justificacion: false,
    recursosNecesarios: false,
    fechaInicio: false,
    fechaFinalizacion: false
});
const rules = {
    creacion: [(v) => !!v || 'Selecciona una práctica (Creación).'],
    justificacion: [(v) => !!v || 'Requerido.'],
    recursosNecesarios: [(v) => !!v || 'Requerido.'],
    fechaInicio: [(v) => !!v || 'Requerido.'],
    fechaFinalizacion: [(v) => !!v || 'Requerido.']
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
        creacion: null,
        nombrePractica: '',
        descripcion: '',
        requiereTransporte: false,
        lugarDeRealizacion: '',
        justificacion: '',
        recursosNecesarios: '',
        fechaInicio: '',
        fechaFinalizacion: ''
    };
    routesDraft.value = [];
    progSugs.value = [];
    resetValidation();
    productDialog.value = true;
}

async function editProduct(row) {
    product.value = {
        id: row.id ?? null,
        creacion: row.creacionId ? { id: row.creacionId, label: row.nombrePractica, programa: row.programaAcademico, facultad: row.facultad, nivel: row.nivelAcademico } : null,
        nombrePractica: row.nombrePractica ?? '',
        descripcion: row.descripcion ?? '',
        requiereTransporte: !!row.requiereTransporte,
        lugarDeRealizacion: row.lugarDeRealizacion ?? '',
        justificacion: row.justificacion ?? '',
        recursosNecesarios: row.recursosNecesarios ?? '',
        fechaInicio: row.fechaInicio ?? '',
        fechaFinalizacion: row.fechaFinalizacion ?? ''
    };
    resetValidation();
    routesDraft.value = [];

    // Cargar recorridos existentes (se marcan 'keep')
    try {
        const { data } = await axios.get(`${API_BASE}/programaciones/${row.id}/rutas`);
        const items = data?.data ?? data ?? [];
        routesDraft.value = items.map((it) => ({
            id: it.id,
            programacion_id: row.id,
            origen_place_id: it.origen?.placeId ?? null,
            origen_desc: it.origen?.desc ?? '',
            origen_lat: it.origen?.lat ?? null,
            origen_lng: it.origen?.lng ?? null,
            destino_place_id: it.destino?.placeId ?? null,
            destino_desc: it.destino?.desc ?? '',
            destino_lat: it.destino?.lat ?? null,
            destino_lng: it.destino?.lng ?? null,
            distancia_m: it.distanciaM ?? null,
            duracion_s: it.duracionS ?? null,
            polyline: it.polyline ?? null,
            justificacion: it.justificacion ?? '',
            _state: 'keep'
        }));
    } catch (e) {
        toast.add({ severity: 'error', summary: 'Rutas', detail: e?.response?.data?.message || e.message, life: 5000 });
    }

    productDialog.value = true;
}

/* ===== AutoComplete de Creaciones ===== */
const progSugs = ref([]);
const loadingProgs = ref(false);
let progTimer = null;
const PROG_DEBOUNCE = 250;

function norm(v) {
    try {
        return (v ?? '') + '';
    } catch {
        return '';
    }
}

async function fetchCreaciones(q = '') {
    loadingProgs.value = true;
    try {
        const params = { per_page: 20, page: 1 };
        if (q.trim() !== '') params.q = q.trim();
        const { data } = await axios.get(API_CRE, { params });
        const items = Array.isArray(data) ? data : (data.data ?? []);
        progSugs.value = items.map((c) => ({
            id: c.id,
            label: c.nombrePractica ?? c.nombre_practica,
            programa: c.programaAcademico ?? c.programa_academico,
            facultad: c.facultad,
            nivel: c.nivelAcademico ?? c.nivel_academico
        }));
    } catch (e) {
        toast.add({ severity: 'error', summary: 'Creaciones', detail: e?.response?.data?.message || e.message, life: 5000 });
        progSugs.value = [];
    } finally {
        loadingProgs.value = false;
    }
}
function onCompleteCreaciones(e) {
    const q = norm(e?.query);
    clearTimeout(progTimer);
    progTimer = setTimeout(() => fetchCreaciones(q), PROG_DEBOUNCE);
}
function onSelectCreacion(e) {
    const it = e.value || null;
    product.value.creacion = it;
    product.value.nombrePractica = it?.label ?? '';
}

/* ===== Guardar ===== */
async function saveProduct() {
    if (saving.value) return;
    if (!validateAll()) {
        toast.add({ severity: 'warn', summary: 'Valida el formulario', detail: 'Corrige los campos marcados.', life: 3000 });
        return;
    }

    const payload = {
        creacion_id: product.value.creacion?.id,
        descripcion: product.value.descripcion || null,
        requiere_transporte: !!product.value.requiereTransporte,
        lugar_de_realizacion: product.value.lugarDeRealizacion || null,
        justificacion: product.value.justificacion,
        recursos_necesarios: product.value.recursosNecesarios,
        fecha_inicio: product.value.fechaInicio,
        fecha_finalizacion: product.value.fechaFinalizacion
    };

    try {
        saving.value = true;

        if (product.value.id) {
            // EDITAR
            await axios.patch(`${API_PROG}/${product.value.id}`, payload);

            const progId = product.value.id;
            const toCreate = routesDraft.value.filter((r) => r._state === 'new');
            const toDelete = routesDraft.value.filter((r) => r._state === 'delete' && r.id);
            const reqs = [];

            toCreate.forEach((r) => {
                const p = { ...r, programacion_id: progId };
                delete p._state;
                delete p.id;
                reqs.push(axios.post(`${API_BASE}/programaciones/${progId}/rutas`, p));
            });
            toDelete.forEach((r) => {
                reqs.push(axios.delete(`${API_BASE}/programaciones/${progId}/rutas/${r.id}`));
            });

            if (reqs.length) await Promise.allSettled(reqs);

            toast.add({ severity: 'success', summary: 'Actualizado', life: 2500 });
        } else {
            // CREAR
            const { data } = await axios.post(API_PROG, payload);
            const created = data?.data ?? data ?? {};
            const progId = created.id;

            if (progId && routesDraft.value.length) {
                const reqs = routesDraft.value.map((r) => {
                    const p = { ...r, programacion_id: progId };
                    delete p._state;
                    delete p.id;
                    return axios.post(`${API_BASE}/programaciones/${progId}/rutas`, p);
                });
                await Promise.allSettled(reqs);
            }

            toast.add({ severity: 'success', summary: 'Creado', life: 2500 });
        }

        productDialog.value = false;
        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        if (status === 422 && data?.errors) {
            errors.creacion = data.errors.creacion_id?.[0] ?? errors.creacion;
            errors.justificacion = data.errors.justificacion?.[0] ?? errors.justificacion;
            errors.recursosNecesarios = data.errors.recursos_necesarios?.[0] ?? errors.recursosNecesarios;
            errors.fechaInicio = data.errors.fecha_inicio?.[0] ?? errors.fechaInicio;
            errors.fechaFinalizacion = data.errors.fecha_finalizacion?.[0] ?? errors.fechaFinalizacion;
        }
        toast.add({ severity: 'error', summary: 'No se pudo guardar', detail: data?.message || e.message, life: 5000 });
    } finally {
        saving.value = false;
    }
}

/* ===== Delete / Bulk ===== */
const deleteProductDialog = ref(false);
const current = ref(null);
function confirmDeleteProduct(row) {
    current.value = { ...row };
    deleteProductDialog.value = true;
}
async function deleteProduct() {
    try {
        await axios.delete(`${API_PROG}/${current.value.id}`);
        products.value = products.value.filter((x) => x.id !== current.value.id);
        toast.add({ severity: 'success', summary: 'Eliminado', life: 2500 });
        await refreshAfterDelete(1);
    } catch (e) {
        toast.add({ severity: 'error', summary: 'No se pudo eliminar', detail: e?.response?.data?.message || e.message, life: 5000 });
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
        await axios.post(`${API_PROG}/bulk-delete`, { ids });
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

/* ===== Util ===== */
onBeforeUnmount(() => {
    if (typingTimer) clearTimeout(typingTimer);
    if (activeCtrl) activeCtrl.abort();
    if (progTimer) clearTimeout(progTimer);
});
function fmtDDMMYYYY(v) {
    if (!v) return '';
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return '';
    const useUTC = typeof v === 'string' && /Z$/i.test(v);
    const day = useUTC ? d.getUTCDate() : d.getDate();
    const month = useUTC ? d.getUTCMonth() + 1 : d.getMonth() + 1;
    const year = useUTC ? d.getUTCFullYear() : d.getFullYear();
    const dd = String(day).padStart(2, '0');
    const mm = String(month).padStart(2, '0');
    return `${dd}/${mm}/${year}`;
}

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

            <template #end>
                <div class="min-w-0 w-full sm:w-80 md:w-[26rem]">
                    <IconField class="w-full">
                        <InputIcon :class="loading ? 'pi pi-spinner pi-spin' : 'pi pi-search'" />
                        <InputText v-model.trim="search" placeholder="Escribe para buscar…" class="w-full" @keydown.enter.prevent="forceFetch" @keydown.esc.prevent="clearSearch" />
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
            <Column field="nombrePractica" header="Nombre práctica" sortable style="min-width: 14rem" />
            <Column field="estadoPractica" header="Estado" sortable style="min-width: 10rem" />
            <Column field="fechaInicio" header="Inicio" sortable style="min-width: 10rem">
                <template #body="{ data }">{{ fmtDDMMYYYY(data.fechaInicio) }}</template>
            </Column>
            <Column field="fechaFinalizacion" header="Fin" sortable style="min-width: 10rem">
                <template #body="{ data }">{{ fmtDDMMYYYY(data.fechaFinalizacion) }}</template>
            </Column>

            <!-- Acciones -->
            <Column :exportable="false" headerStyle="width:9rem">
                <template #body="{ data }">
                    <Button icon="pi pi-pencil" rounded text class="mr-1" @click.stop="editProduct(data)" />
                    <Button icon="pi pi-trash" rounded text severity="danger" @click.stop="confirmDeleteProduct(data)" />
                </template>
            </Column>
        </DataTable>

        <!-- Crear/Editar -->
        <Dialog v-model:visible="productDialog" header="Programación de práctica" :style="{ width: '42rem' }" :modal="true">
            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                    <label for="creacion" class="font-medium">Nombre Práctica</label>
                    <AutoComplete
                        inputId="creacion"
                        v-model="product.creacion"
                        :suggestions="progSugs"
                        optionLabel="label"
                        placeholder="Escribe para buscar…"
                        :dropdown="true"
                        :forceSelection="true"
                        :loading="loadingProgs"
                        @complete="onCompleteCreaciones"
                        @item-select="onSelectCreacion"
                        appendTo="self"
                        class="w-full"
                        :pt="{ root: { class: 'w-full' }, input: { class: 'w-full h-11 text-base' }, dropdownButton: { class: 'h-11' }, panel: { class: 'w-full max-h-80 overflow-auto' } }"
                    >
                        <template #option="{ option }">
                            <div class="flex flex-col">
                                <span class="font-medium">{{ option.label }}</span>
                                <small class="text-gray-500"> {{ option.programa }}<span v-if="option.facultad"> • </span>{{ option.facultad }} </small>
                            </div>
                        </template>
                    </AutoComplete>
                    <small v-if="showError('creacion')" class="text-red-500">{{ errors.creacion }}</small>
                </div>

                <div class="flex flex-col gap-2">
                    <label for="descripcion">Descripción</label>
                    <Textarea id="descripcion" v-model.trim="product.descripcion" autoResize fluid />
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="flex items-center gap-2">
                        <Checkbox binary v-model="product.requiereTransporte" inputId="reqTrans" />
                        <label for="reqTrans">Requiere transporte</label>
                    </div>
                    <div class="flex flex-col gap-2">
                        <label for="lugar">Lugar de realización</label>
                        <InputText id="lugar" v-model.trim="product.lugarDeRealizacion" fluid />
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="flex flex-col gap-2">
                        <label for="fechaInicio">Fecha inicio</label>
                        <InputText id="fechaInicio" type="date" v-model="product.fechaInicio" :invalid="showError('fechaInicio')" @blur="onBlur('fechaInicio')" />
                        <small v-if="showError('fechaInicio')" class="text-red-500">{{ errors.fechaInicio }}</small>
                    </div>
                    <div class="flex flex-col gap-2">
                        <label for="fechaFin">Fecha finalización</label>
                        <InputText id="fechaFin" type="date" v-model="product.fechaFinalizacion" :invalid="showError('fechaFinalizacion')" @blur="onBlur('fechaFinalizacion')" />
                        <small v-if="showError('fechaFinalizacion')" class="text-red-500">{{ errors.fechaFinalizacion }}</small>
                    </div>
                </div>

                <div class="flex flex-col gap-2">
                    <label for="recursos">Recursos necesarios</label>
                    <Textarea id="recursos" v-model.trim="product.recursosNecesarios" :invalid="showError('recursosNecesarios')" @blur="onBlur('recursosNecesarios')" />
                    <small v-if="showError('recursosNecesarios')" class="text-red-500">{{ errors.recursosNecesarios }}</small>
                </div>

                <div class="flex flex-col gap-2">
                    <label for="justificacion">Justificación</label>
                    <Textarea id="justificacion" v-model.trim="product.justificacion" :invalid="showError('justificacion')" @blur="onBlur('justificacion')" />
                    <small v-if="showError('justificacion')" class="text-red-500">{{ errors.justificacion }}</small>
                </div>

                <!-- Recorridos -->
                <div class="mt-2">
                    <div class="flex items-center justify-between mb-2">
                        <label class="font-medium">Recorridos</label>
                        <Button size="small" icon="pi pi-plus" label="Añadir recorrido" @click="routeDlg = true" />
                    </div>

                    <div v-if="!visibleRoutes().length" class="text-gray-500 text-sm">No hay recorridos definidos. Añade al menos uno si lo requiere la práctica.</div>

                    <div v-else class="space-y-2">
                        <div v-for="(r, idx) in visibleRoutes()" :key="idx" class="border rounded p-2">
                            <div class="flex items-center justify-between">
                                <div class="text-sm">
                                    <div><b>Origen:</b> {{ r.origen_desc || (r.origen_lat ? r.origen_lat + ', ' + r.origen_lng : '—') }}</div>
                                    <div><b>Destino:</b> {{ r.destino_desc || (r.destino_lat ? r.destino_lat + ', ' + r.destino_lng : '—') }}</div>
                                    <div class="text-xs text-gray-600">Distancia: {{ fmtKm(r.distancia_m) }} • Duración: {{ fmtMin(r.duracion_s) }}</div>
                                    <div class="mt-1"><b>Justificación:</b> {{ r.justificacion }}</div>
                                </div>
                                <Button icon="pi pi-times" text severity="danger" @click="removeDraftRoute(routesDraft.indexOf(r))" />
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Picker de rutas en modo diferido -->
                <RoutePickerDialog v-model:visible="routeDlg" :sedes="SEDES" deferred @picked="addDraftRoute" />
            </div>

            <template #footer>
                <Button type="button" label="Guardar" icon="pi pi-check" :loading="saving" :disabled="saving" @click="saveProduct" />
                <Button type="button" label="Cancelar" icon="pi pi-times" text :disabled="saving" @click="productDialog = false" />
            </template>
        </Dialog>

        <!-- Confirmar eliminar -->
        <Dialog v-model:visible="deleteProductDialog" header="Confirmar" :style="{ width: '28rem' }" :modal="true">
            <div>
                ¿Seguro que quieres eliminar la programación <b>Id:{{ current?.id }}</b> — <b>{{ current?.nombrePractica }}</b
                >?
            </div>
            <template #footer>
                <Button label="No" icon="pi pi-times" text @click="deleteProductDialog = false" />
                <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteProduct" />
            </template>
        </Dialog>

        <!-- Detalles -->
        <Dialog v-model:visible="detailsDialog" header="Detalles de programación" :modal="true" :breakpoints="{ '1024px': '60vw', '768px': '75vw', '560px': '92vw' }" :style="{ width: '42vw', maxWidth: '720px' }">
            <div v-if="detailsLoading" class="p-4">Cargando…</div>
            <div v-else class="p-3 sm:p-4">
                <div v-for="d in details" :key="d.id" class="mb-3 border rounded p-3 sm:p-4">
                    <div class="font-semibold mb-3 break-words">Id: {{ d.id }} — {{ d.nombrePractica }}</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <dl class="space-y-2">
                            <div>
                                <dt class="text-sm font-semibold">Programa</dt>
                                <dd>{{ d.programaAcademico }}</dd>
                            </div>
                            <div>
                                <dt class="text-sm font-semibold">Estado</dt>
                                <dd>{{ d.estadoPractica }}</dd>
                            </div>
                            <div>
                                <dt class="text-sm font-semibold">Fechas</dt>
                                <dd class="break-words">{{ fmtDDMMYYYY(d.fechaInicio) }} → {{ fmtDDMMYYYY(d.fechaFinalizacion) }}</dd>
                            </div>
                        </dl>
                        <dl class="space-y-2">
                            <div>
                                <dt class="text-sm font-semibold">Transporte</dt>
                                <dd>{{ d.requiereTransporte ? 'Sí' : 'No' }}</dd>
                            </div>
                            <div>
                                <dt class="text-sm font-semibold">Lugar</dt>
                                <dd>{{ d.lugarDeRealizacion || '—' }}</dd>
                            </div>
                        </dl>
                    </div>

                    <div class="mt-4 space-y-3">
                        <div>
                            <div class="text-sm font-semibold">Recursos necesarios</div>
                            <div class="whitespace-pre-line break-words">{{ d.recursosNecesarios }}</div>
                        </div>
                        <div>
                            <div class="text-sm font-semibold">Justificación</div>
                            <div class="whitespace-pre-line break-words">{{ d.justificacion }}</div>
                        </div>
                        <div v-if="d.descripcion">
                            <div class="text-sm font-semibold">Descripción</div>
                            <div class="whitespace-pre-line break-words">{{ d.descripcion }}</div>
                        </div>
                    </div>

                    <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-500">
                        <div>
                            <div class="font-semibold">Creado</div>
                            <div>{{ d.fechacreacion }}</div>
                        </div>
                        <div>
                            <div class="font-semibold">Modificado</div>
                            <div>{{ d.fechamodificacion }}</div>
                        </div>
                    </div>
                </div>
            </div>
            <template #footer><Button label="Cerrar" icon="pi pi-times" text @click="detailsDialog = false" /></template>
        </Dialog>
    </div>
</template>
