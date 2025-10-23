<script setup>
import { ref, reactive, computed, onMounted, watch, onBeforeUnmount } from 'vue';
import { useToast } from 'primevue/usetoast';
import axios from 'axios';

const API = 'http://127.0.0.1:8000/api/v1/creaciones';
const API_CAT = 'http://127.0.0.1:8000/api/v1/catalogos';

const toast = useToast();

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

const uid = Math.random().toString(36).slice(2);
const recId = `recursosNecesarios-${uid}`;
const jusId = `justificacion-${uid}`;

/* ===== Autocomplete de Programa académico (solo FORM, NO tabla) ===== */
const programaQuery = ref(''); // texto visible en el input del diálogo
const progSugs = ref([]); // sugerencias del endpoint
const loadingProgs = ref(false);
const showProgPanel = ref(false);
const highlightedIndex = ref(-1);
let progTimer = null;
const PROG_DEBOUNCE = 250;

// Normaliza a string
const s = (v) => (v == null ? '' : String(v));

function openProgPanel() {
    showProgPanel.value = true;
}
function closeProgPanel() {
    showProgPanel.value = false;
    highlightedIndex.value = -1;
}

// Llamado al endpoint de catálogos (solo para el formulario)
async function fetchProgramas(query = '') {
    loadingProgs.value = true;
    try {
        const { data } = await axios.get(API_CAT, {
            params: { q: query, per_page: 20, page: 1 }
        });
        const items = Array.isArray(data) ? data : (data.data ?? []);
        progSugs.value = items.map((p) => ({
            id: p.id,
            codigo: p.codigo ?? p.id, // ajusta si tu catálogo usa otro campo
            nombre: p.programaAcademico ?? p.programa_academico ?? p.nombre ?? p.label ?? ''
        }));
    } catch (e) {
        progSugs.value = [];
        toast.add({
            severity: 'error',
            summary: 'Programas',
            detail: e?.response?.data?.message || e.message,
            life: 4000
        });
    } finally {
        loadingProgs.value = false;
    }
}

// Input con debounce de sugerencias (NO toca la tabla)
function onProgramaInput() {
    const q = s(programaQuery.value).trim();
    showProgPanel.value = true;
    if (progTimer) clearTimeout(progTimer);
    progTimer = setTimeout(() => {
        if (!q.length) {
            progSugs.value = [];
            highlightedIndex.value = -1;
            return; // ← NO refresca tabla
        }
        fetchProgramas(q);
    }, PROG_DEBOUNCE);
}

// Navegación por teclado en el panel del formulario (NO toca la tabla)
function onProgramaKeydown(e) {
    if (!showProgPanel.value || !progSugs.value.length) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightedIndex.value = highlightedIndex.value < progSugs.value.length - 1 ? highlightedIndex.value + 1 : 0;
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightedIndex.value = highlightedIndex.value > 0 ? highlightedIndex.value - 1 : progSugs.value.length - 1;
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedIndex.value >= 0) {
            selectPrograma(progSugs.value[highlightedIndex.value]);
        }
    }
}

// Selección (solo setea en el FORM, NO filtra tabla)
function selectPrograma(it) {
    product.value.programa = it;
    programaQuery.value = it.nombre; // no muestras el código
    closeProgPanel();
}

// Enter en el input del FORM (no filtra tabla)
function onProgramaEnter() {
    closeProgPanel();
}

// Limpiar solo el campo del FORM (no filtra tabla)
function clearPrograma() {
    if (!programaQuery.value) return;
    programaQuery.value = '';
    progSugs.value = [];
    highlightedIndex.value = -1;
    closeProgPanel();
}
// — Handler general: bloquea la barra espaciadora fuera de campos de texto —
function onFormKeyCapture(e) {
    if (e.key !== ' ') return;

    const t = e.target;
    const tag = (t.tagName || '').toUpperCase();
    const type = (t.type || '').toLowerCase();

    const isTextInput = tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type);

    const isEditable = isTextInput || tag === 'TEXTAREA' || t.isContentEditable;

    // Deja pasar si se está escribiendo texto o si es checkbox/radio
    if (isEditable) return;
    if (tag === 'INPUT' && (type === 'checkbox' || type === 'radio')) return;

    // Bloquea Space en botones, links, contenedor del diálogo, etc.
    e.preventDefault();
    e.stopPropagation();
}

// — (Opcional) Handler específico para el botón Guardar —
// Si prefieres, en vez de 'pt' puedes usar este:
function onSaveBtnKeydown(e) {
    if (e.key === ' ') e.preventDefault();
}

/* ===== Orden ===== */
const sortParam = computed(() => (!sortField.value ? undefined : `${sortOrder.value === -1 ? '-' : ''}${sortField.value}`));

/* ===== Params (SOLO lo que afecta a la TABLA) ===== */
function buildParams({ force = false } = {}) {
    const params = { per_page: +rows.value || 10, page: +page.value || 1 };
    if (sortParam.value) params.sort = sortParam.value;

    // q general de la barra superior
    const raw = String(search.value || '').trim();
    if (raw.length > 0 && (force || raw.length >= MIN_CHARS)) {
        params.q = raw;
    }

    // 🚫 Importante: NO agregar aquí filtros del formulario (programaQuery/product.programa)
    return params;
}

/* ===== Llamada con cancelación ===== */
async function getProducts(opts = {}) {
    const { signal, force = false } = opts;
    loading.value = true;
    try {
        const { data } = await axios.get(API, { params: buildParams({ force }), signal });
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
                detail: `[${status}] ${msg}`,
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

/* ===== Watchers de búsqueda general ===== */
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

/* =========================
   CRUD: crear/editar
   ========================= */
const productDialog = ref(false);
const product = ref({
    id: null,
    programa: null, // objeto seleccionado (ID)
    nombrePractica: '',
    recursosNecesarios: '',
    justificacion: ''
});

const errors = reactive({
    nombrePractica: '',
    recursosNecesarios: '',
    justificacion: ''
});
const touched = reactive({
    nombrePractica: false,
    recursosNecesarios: false,
    justificacion: false
});

function resetValidation() {
    Object.keys(errors).forEach((k) => (errors[k] = ''));
    Object.keys(touched).forEach((k) => (touched[k] = false));
}

const rules = {
    nombrePractica: [(v) => !!v || 'Requerido.'],
    recursosNecesarios: [(v) => !!v || 'Requerido.'],
    justificacion: [(v) => !!v || 'Requerido.']
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

/* === Abrir diálogo NUEVO === */
function openNew() {
    product.value = {
        id: null,
        programa: null,
        nombrePractica: '',
        recursosNecesarios: '',
        justificacion: ''
    };
    resetValidation();
    productDialog.value = true;
}

/* === Editar fila existente === */
function editProduct(row) {
    product.value = {
        id: row.id ?? null,
        programa:
            row.catalogoId || row.catalogo_id
                ? {
                      id: row.catalogoId ?? row.catalogo_id,
                      codigo: row.codigo ?? row.catalogo_id,
                      nombre: row.programaAcademico ?? row.programa_academico ?? ''
                  }
                : null,
        nombrePractica: row.nombrePractica ?? '',
        recursosNecesarios: row.recursosNecesarios ?? '',
        justificacion: row.justificacion ?? ''
    };

    // Si quieres precargar el texto en el input del form:
    programaQuery.value = product.value.programa ? product.value.programa.nombre : '';

    resetValidation();
    productDialog.value = true;
}

/* ===== Guardar ===== */
const saving = ref(false);
async function saveProduct() {
    if (saving.value) return;

    const payload = {
        catalogo_id: product.value.programa?.id ?? null,
        nombre_practica: product.value.nombrePractica,
        recursos_necesarios: product.value.recursosNecesarios,
        justificacion: product.value.justificacion,
        programa_text: String(programaQuery.value || '').trim() // opcional
    };

    try {
        saving.value = true;
        if (product.value.id) {
            await axios.patch(`${API}/${product.value.id}`, payload);
            toast.add({ severity: 'success', summary: 'Actualizado', life: 2500 });
        } else {
            await axios.post(API, payload);
            toast.add({ severity: 'success', summary: 'Creado', life: 2500 });
        }
        productDialog.value = false;
        await getProducts({ force: true });
    } catch (e) {
        toast.add({
            severity: 'error',
            summary: 'No se pudo guardar',
            detail: e?.message,
            life: 5000
        });
    } finally {
        saving.value = false;
    }
}

/* ===== Borrado individual ===== */
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
        await getProducts({ force: true });
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

/* ===== Borrado en lote ===== */
const bulkDeleteDialog = ref(false);

function confirmBulkDelete() {
    if (!selected.value.length) return;
    bulkDeleteDialog.value = true;
}
async function bulkDelete() {
    const ids = selected.value.map((r) => r.id);
    try {
        await axios.post(`${API}/bulk-delete`, { ids });
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

/* ===== Limpieza ===== */
onBeforeUnmount(() => {
    if (typingTimer) clearTimeout(typingTimer);
    if (activeCtrl) activeCtrl.abort();
    if (progTimer) clearTimeout(progTimer);
});

/* ===== Montaje ===== */
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
                        <InputText id="q" name="q" v-model.trim="search" placeholder="Escribe para buscar…" class="w-full" @keydown.enter.prevent="forceFetch" @keydown.esc.prevent="clearSearch" />
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
            :pt="{
                headerCheckbox: { input: { name: 'dt-select-all' } }, // checkbox de cabecera
                rowCheckbox: { input: { name: 'dt-row-select' } } // checkbox de cada fila
            }"
        >
            <Column selectionMode="multiple" headerStyle="width:3rem" />
            <Column field="id" header="id" sortable style="min-width: 6rem" />
            <Column field="nombrePractica" header="Nombre práctica" sortable style="min-width: 12rem" />
            <Column field="programaAcademico" header="Programa académico" sortable style="min-width: 16rem" />
            <Column field="estadoPractica" header="Estado de la práctica" sortable style="min-width: 12rem" />

            <Column :exportable="false" headerStyle="width:9rem">
                <template #body="{ data }">
                    <Button icon="pi pi-pencil" rounded text class="mr-1" @click.stop="editProduct(data)" />
                    <Button icon="pi pi-trash" rounded text severity="danger" @click.stop="confirmDeleteProduct(data)" />
                </template>
            </Column>
        </DataTable>

        <!-- Crear/Editar -->
        <Dialog v-model:visible="productDialog" header="Creación de práctica" :style="{ width: '36rem' }" :modal="true">
            <!-- Captura de espacio a nivel de formulario -->
            <div class="flex flex-col gap-4" @keydown.capture="onFormKeyCapture">
                <!-- ===== Nombre práctica ===== -->
                <div class="flex flex-col gap-2">
                    <label for="nombrePractica">Nombre práctica</label>
                    <InputText id="nombrePractica" name="nombrePractica" v-model.trim="product.nombrePractica" :invalid="showError('nombrePractica')" @blur="onBlur('nombrePractica')" @keydown.space.stop fluid />
                    <small v-if="showError('nombrePractica')" class="text-red-500">{{ errors.nombrePractica }}</small>
                </div>

                <!-- ===== Programa académico (Autocomplete liviano) ===== -->
                <div class="flex flex-col gap-2 relative">
                    <label for="programaAcademico">Programa académico</label>

                    <IconField class="w-full">
                        <InputIcon :class="loadingProgs ? 'pi pi-spinner pi-spin' : 'pi pi-search'" />
                        <InputText
                            id="programaAcademico"
                            name="programaAcademico"
                            v-model.trim="programaQuery"
                            placeholder="Escribe para buscar…"
                            class="w-full"
                            autocomplete="off"
                            role="combobox"
                            aria-autocomplete="list"
                            :aria-expanded="showProgPanel ? 'true' : 'false'"
                            :aria-controls="'prog-listbox'"
                            :aria-activedescendant="highlightedIndex >= 0 ? 'prog-opt-' + highlightedIndex : undefined"
                            @focus="openProgPanel"
                            @input="onProgramaInput"
                            @keydown="onProgramaKeydown"
                            @keydown.enter.prevent="onProgramaEnter"
                            @keydown.esc.prevent="closeProgPanel"
                        />
                        <span v-if="programaQuery" class="pi pi-times cursor-pointer p-input-icon-right" style="right: 0.75rem" @click="clearPrograma" aria-label="Limpiar filtro de programa" />
                    </IconField>

                    <!-- Panel de sugerencias -->
                    <div v-if="showProgPanel && progSugs.length" id="prog-listbox" role="listbox" class="absolute top-full mt-1 w-full max-h-72 overflow-auto rounded-md border border-surface-300 bg-surface-0 shadow-lg z-50">
                        <div
                            v-for="(it, i) in progSugs"
                            :key="it.id"
                            :id="'prog-opt-' + i"
                            role="option"
                            :aria-selected="i === highlightedIndex ? 'true' : 'false'"
                            class="px-3 py-2 cursor-pointer select-none"
                            :class="i === highlightedIndex ? 'bg-primary-50' : ''"
                            @mouseenter="highlightedIndex = i"
                            @mouseleave="highlightedIndex = -1"
                            @mousedown.prevent
                            @click="selectPrograma(it)"
                        >
                            <div class="text-sm font-medium">{{ it.nombre }}</div>
                        </div>
                    </div>

                    <!-- “Sin resultados” -->
                    <div v-else-if="showProgPanel && !loadingProgs && programaQuery && !progSugs.length" class="absolute top-full mt-1 w-full rounded-md border border-surface-300 bg-surface-0 shadow-lg z-50 px-3 py-2 text-sm text-surface-500">
                        Sin coincidencias
                    </div>
                </div>

                <!-- ===== Recursos necesarios ===== -->
                <div class="flex flex-col gap-2">
                    <label :for="recId">Recursos necesarios</label>
                    <textarea :id="recId" name="recursosNecesarios" v-model.trim="product.recursosNecesarios" class="p-inputtextarea p-inputtext p-component w-full" rows="3" @blur="onBlur('recursosNecesarios')" @keydown.space.stop></textarea>
                    <small v-if="showError('recursosNecesarios')" class="text-red-500">
                        {{ errors.recursosNecesarios }}
                    </small>
                </div>

                <!-- ===== Justificación ===== -->
                <div class="flex flex-col gap-2">
                    <label :for="jusId">Justificación</label>
                    <textarea :id="jusId" name="justificacion" v-model.trim="product.justificacion" class="p-inputtextarea p-inputtext p-component w-full" rows="3" @blur="onBlur('justificacion')" @keydown.space.stop></textarea>
                    <small v-if="showError('justificacion')" class="text-red-500">
                        {{ errors.justificacion }}
                    </small>
                </div>
            </div>

            <!-- ===== Footer (botones) ===== -->
            <template #footer>
                <Button type="button" label="Guardar" icon="pi pi-check" :loading="saving" :disabled="saving" @click="saveProduct" @keydown="onSaveBtnKeydown" />
                <Button type="button" label="Cancelar" icon="pi pi-times" text :disabled="saving" @click="productDialog = false" />
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
        <Dialog v-model:visible="detailsDialog" header="Detalles de creación" :modal="true" :breakpoints="{ '1024px': '60vw', '768px': '75vw', '560px': '92vw' }" :style="{ width: '42vw', maxWidth: '720px' }">
            <div v-if="detailsLoading" class="p-4">Cargando…</div>

            <div v-else class="p-3 sm:p-4">
                <div v-for="d in details" :key="d.id" class="mb-3 border rounded p-3 sm:p-4">
                    <div class="font-semibold mb-3 break-words">Id: {{ d.id }} — {{ d.nombrePractica }}</div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <dl class="space-y-2">
                            <div>
                                <dt class="text-sm font-semibold">Nombre Práctica</dt>
                                <dd class="break-words">{{ d.nombrePractica }}</dd>
                            </div>

                            <div>
                                <dt class="text-sm font-semibold">Programa Académico</dt>
                                <dd class="break-words">
                                    <template v-if="typeof d.programaAcademico === 'string'">
                                        {{ d.programaAcademico }}
                                    </template>
                                    <template v-else>
                                        {{ d.programaAcademico?.label }}
                                    </template>
                                </dd>
                            </div>

                            <div>
                                <dt class="text-sm font-semibold">Estado práctica</dt>
                                <dd class="break-words">{{ d.estadoPractica }}</dd>
                            </div>
                        </dl>

                        <dl class="space-y-2">
                            <div>
                                <dt class="text-sm font-semibold">Estado jefe departamento</dt>
                                <dd class="break-words">{{ d.estadoDepart }}</dd>
                            </div>

                            <div>
                                <dt class="text-sm font-semibold">Estado consejo facultad</dt>
                                <dd class="break-words">{{ d.estadoConsejoFacultad }}</dd>
                            </div>

                            <div>
                                <dt class="text-sm font-semibold">Estado consejo académico</dt>
                                <dd class="break-words">{{ d.estadoConsejoAcademico }}</dd>
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
