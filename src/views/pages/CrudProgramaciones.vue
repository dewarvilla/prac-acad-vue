<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useToast } from 'primevue/usetoast';
import axios from 'axios';

const API = 'http://127.0.0.1:8000/api/v1/creaciones';
const API_CRE = 'http://127.0.0.1:8000/api/v1/creaciones';
const API_RUT = 'http://127.0.0.1:8000/api/v1/rutas';
const API_PAR = 'http://127.0.0.1:8000/api/v1/participantes';

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

/* =========================
   CRUD: crear/editar
   + AutoComplete Programa
   ========================= */
const productDialog = ref(false);
const submitted = ref(false);
const product = ref({
    id: null,
    programaAcademico: null, // { id, label, facultad?, nivel_academico? }
    nombrePractica: '',
    recursosNecesarios: '',
    justificacion: '',
    nivelAcademico: null,
    facultad: null
});

const errors = reactive({
    programaAcademico: '',
    nombrePractica: '',
    recursosNecesarios: '',
    justificacion: ''
});
const touched = reactive({
    programaAcademico: false,
    nombrePractica: false,
    recursosNecesarios: false,
    justificacion: false
});

const rules = {
    programaAcademico: [(v) => !!v || 'Selecciona un programa académico.'],
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
        programaAcademico: null,
        nombrePractica: '',
        recursosNecesarios: '',
        justificacion: ''
    };
    progSugs.value = [];
    resetValidation();
    productDialog.value = true;
}
function editProduct(row) {
    product.value = {
        id: row.id ?? null,
        programaAcademico:
            row.catalogoId || row.catalogo_id
                ? {
                      id: row.catalogoId ?? row.catalogo_id,
                      label: row.programaAcademico ?? row.programa_academico ?? row.programaAcademico ?? 'Programa Académico',
                      facultad: row.facultad ?? row.facultad_nombre,
                      nivel_academico: row.nivel_academico ?? row.nivel
                  }
                : null,
        nombrePractica: row.nombrePractica ?? '',
        recursosNecesarios: row.recursosNecesarios ?? '',
        justificacion: row.justificacion ?? ''
    };
    resetValidation();
    productDialog.value = true;
}

/* ===== AutoComplete Programas (remoto con debounce) ===== */
const progSugs = ref([]);
const loadingProgs = ref(false);
let progTimer = null;
const PROG_DEBOUNCE = 250;

function normStr(v) {
    // fuerza string plano
    if (typeof v === 'string') return v;
    if (v == null) return '';
    // evita mandar [object Object]
    try {
        return String(v);
    } catch {
        return '';
    }
}

async function fetchProgramas(query = '') {
    loadingProgs.value = true;
    try {
        const term = normStr(query).trim();

        // arma params SIN q cuando esté vacío
        const params = { per_page: 20, page: 1 };
        if (term !== '') params.q = term;

        const { data } = await axios.get(API_CAT, { params });
        const items = Array.isArray(data) ? data : (data.data ?? []);

        progSugs.value = items.map((p) => ({
            id: p.id,
            label: p.programaAcademico ?? p.programa_academico ?? p.label,
            facultad: p.facultad,
            nivel_academico: p.nivelAcademico ?? p.nivel_academico
        }));
    } catch (e) {
        toast.add({ severity: 'error', summary: 'Programas', detail: e?.response?.data?.message || e.message, life: 4000 });
        progSugs.value = [];
    } finally {
        loadingProgs.value = false;
    }
}
function onClearPrograma() {
    product.value.programaAcademico = null;
    product.value.nivelAcademico = null;
    product.value.facultad = null;
    product.value.programaAcademicoTexto = null;
}
function onCompleteProgramas(e) {
    const q = normStr(e?.query).trim();
    clearTimeout(progTimer);
    progTimer = setTimeout(() => fetchProgramas(q), PROG_DEBOUNCE);
}
function onSelectPrograma(e) {
    const it = e.value || null;
    product.value.programaAcademico = it;

    product.value.nivelAcademico = it?.nivel_academico ?? it?.nivelAcademico ?? null;
    product.value.facultad = it?.facultad ?? null;
    product.value.programaAcademicoTexto = it?.label ?? it?.programaAcademico ?? null;
}
/* ===== Guardar ===== */
const saving = ref(false);

async function saveProduct() {
    if (saving.value) return; // evita doble clic
    submitted.value = true;

    if (!validateAll()) {
        toast.add({ severity: 'warn', summary: 'Valida el formulario', detail: 'Corrige los campos marcados en rojo.', life: 3000 });
        return;
    }

    const payload = {
        catalogo_id: product.value.programaAcademico?.id,
        nombre_practica: product.value.nombrePractica,
        recursos_necesarios: product.value.recursosNecesarios,
        justificacion: product.value.justificacion
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
        submitted.value = false;
    } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        console.error('Error guardando', data || e);

        if (status === 422 && data?.errors) {
            errors.programaAcademico = data.errors.catalogo_id?.[0] ?? errors.programaAcademico;
            errors.nombrePractica = data.errors.nombre_practica?.[0] ?? errors.nombrePractica;
            errors.recursosNecesarios = data.errors.recursos_necesarios?.[0] ?? errors.recursosNecesarios;
            errors.justificacion = data.errors.justificacion?.[0] ?? errors.justificacion;
        }

        toast.add({ severity: 'error', summary: 'No se pudo guardar', detail: data?.message || e.message, life: 5000 });
    } finally {
        saving.value = false;
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
                    <label class="font-medium">Nombre práctica</label>
                    <AutoComplete
                        v-model="product.nombrePractica"
                        :suggestions="progSugs"
                        optionLabel="label"
                        placeholder="Escribe para buscar…"
                        :dropdown="true"
                        :forceSelection="true"
                        :loading="loadingProgs"
                        @complete="onCompleteProgramas"
                        @update:modelValue="
                            () => {
                                touched.nombrePractica = true;
                                validateField('nombrePractica');
                            }
                        "
                        appendTo="self"
                        :pt="{
                            panel: { class: 'w-full max-h-72 overflow-auto' }
                        }"
                    >
                        <template #option="{ option }">
                            <div class="flex flex-col">
                                <span class="font-medium">{{ option.label }}</span>
                                <small v-if="option.nombrePractica || option.nivel_academico" class="text-gray-500">
                                    {{ option.nombrePractica }}<span v-if="option.nombrePractica && option.nivel_academico"> • </span>{{ option.nivel_academico }}
                                </small>
                            </div>
                        </template>
                    </AutoComplete>
                    <small v-if="showError('programaAcademico')" class="text-red-500">{{ errors.programaAcademico }}</small>
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
