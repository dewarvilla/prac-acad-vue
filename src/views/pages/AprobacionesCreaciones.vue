<script setup>
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue';
import { useToast } from 'primevue/usetoast';
import { api } from '@/api';

const toast = useToast();

const tableUid = `apr-cre-${Math.random().toString(36).slice(2)}`;
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
const sortField = ref('nombrePractica');
const sortOrder = ref(1);

const API_INBOX = '/approvals/inbox';
const API_APPROVAL_REQUESTS = '/approvals/requests';
const CREACION_CODES = ['CREACION_PRACTICA'];

const approvalEndpoints = {
    approve: (approvalRequestId) => `${API_APPROVAL_REQUESTS}/${approvalRequestId}/approve`,
    reject: (approvalRequestId) => `${API_APPROVAL_REQUESTS}/${approvalRequestId}/reject`,
};

const search = ref('');
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
let typingTimer = null;
let activeCtrl = null;

const s = (v) => (v == null ? '' : String(v));

function extractErrorMessage(data, fallback) {
    return data?.message || data?.error?.detail || data?.error || fallback;
}

function formatDateTime(value) {
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return s(value);

    return new Intl.DateTimeFormat('es-CO', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

function unwrapApiPayload(responseData) {
    return responseData?.data ?? responseData ?? {};
}

function unwrapCollection(responseData) {
    const payload = unwrapApiPayload(responseData);

    if (Array.isArray(payload)) return { items: payload, meta: {} };
    if (Array.isArray(payload?.data)) return { items: payload.data, meta: payload.meta ?? {} };
    if (Array.isArray(payload?.items)) return { items: payload.items, meta: payload.meta ?? {} };

    return { items: [], meta: payload?.meta ?? {} };
}

function getFacultadFromRow(row) {
    const f = row?.facultadObj ?? row?.facultad_obj ?? row?.facultad ?? null;

    const codigoFacultad = f?.codigoFacultad ?? row?.codigoFacultad ?? row?.codigo_facultad ?? row?.facultadCodigo ?? null;
    const nombreFacultad = typeof f === 'object' ? (f?.nombreFacultad ?? f?.facultad ?? f?.nombre ?? null) : (row?.facultadNombre ?? row?.facultad ?? null);

    if (!codigoFacultad && !nombreFacultad) return null;

    return {
        codigoFacultad: s(codigoFacultad).trim(),
        nombreFacultad: s(nombreFacultad).trim(),
        label: `${s(codigoFacultad).trim()} - ${s(nombreFacultad).trim()}`.replace(/^ - /, '').trim()
    };
}

function getProgramaFromRow(row) {
    const p = row?.programa ?? row?.programa_obj ?? null;

    const codigoPrograma = p?.codigoPrograma ?? row?.codigoPrograma ?? row?.codigo_programa ?? row?.programaCodigo ?? null;
    const nombrePrograma = p?.nombrePrograma ?? row?.nombrePrograma ?? row?.nombre_programa ?? row?.programaNombre ?? null;
    const codigoFacultad = p?.codigoFacultad ?? row?.codigoFacultad ?? row?.codigo_facultad ?? null;
    const facultad = p?.facultad ?? row?.facultad ?? null;
    const nivelAcademico = p?.nivelAcademico ?? row?.nivelAcademico ?? row?.nivel_academico ?? null;

    if (!codigoPrograma && !nombrePrograma) return null;

    return {
        codigoPrograma: s(codigoPrograma).trim(),
        nombrePrograma: s(nombrePrograma).trim(),
        codigoFacultad: s(codigoFacultad).trim(),
        facultad: s(facultad).trim(),
        nivelAcademico: s(nivelAcademico).trim(),
        label: `${s(codigoPrograma).trim()} - ${s(nombrePrograma).trim()}`.trim()
    };
}

function getMateriaFromRow(row) {
    const m = row?.materia ?? row?.materia_obj ?? null;

    const codigoMateria = m?.codigoMateria ?? row?.codigoMateria ?? row?.codigo_materia ?? row?.materiaCodigo ?? null;
    const nombreMateria = m?.nombreMateria ?? row?.nombreMateria ?? row?.nombre_materia ?? row?.materiaNombre ?? null;
    const codigoPrograma = m?.codigoPrograma ?? row?.codigoPrograma ?? row?.codigo_programa ?? null;

    if (!codigoMateria && !nombreMateria) return null;

    return {
        codigoPrograma: s(codigoPrograma).trim(),
        codigoMateria: s(codigoMateria).trim(),
        nombreMateria: s(nombreMateria).trim(),
        label: `${s(codigoMateria).trim()} - ${s(nombreMateria).trim()}`.trim()
    };
}

function facultadRowLabel(row) {
    const f = getFacultadFromRow(row);
    if (!f) return '—';
    return f.label || f.nombreFacultad || f.codigoFacultad || '—';
}

function programaRowLabel(row) {
    const p = getProgramaFromRow(row);
    if (!p) return '—';
    return p.label || p.nombrePrograma || p.codigoPrograma || '—';
}

function materiaRowLabel(row) {
    const m = getMateriaFromRow(row);
    if (!m) return '—';
    return m.label || m.nombreMateria || m.codigoMateria || '—';
}

function estadoLabel(estado) {
    const st = String(estado ?? '').trim().toLowerCase();

    const map = {
        en_aprobacion: 'En aprobación',
        aprobada: 'Aprobada',
        rechazada: 'Rechazada',
        creada: 'Creada',
        pending: 'En aprobación',
        approved: 'Aprobada',
        rejected: 'Rechazada',
        cancelled: 'Cancelada',
        cancelada: 'Cancelada'
    };

    if (map[st]) return map[st];

    const pretty = st.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return pretty || '—';
}

function estadoSeverity(estado) {
    const st = String(estado ?? '').trim().toLowerCase();

    if (st === 'aprobada' || st === 'approved') return 'success';
    if (st === 'rechazada' || st === 'rejected') return 'danger';
    if (st === 'en_aprobacion' || st === 'pending') return 'warn';

    return 'info';
}

const SORT_MAP_INBOX = {
    id: 'id',
    createdAt: 'fechacreacion',
    updatedAt: 'fechamodificacion'
};

function mapSort(uiField, order, map) {
    if (!uiField) return undefined;
    const apiField = map[uiField];
    if (!apiField) return undefined;
    return `${order === -1 ? '-' : ''}${apiField}`;
}

const sortParam = computed(() => mapSort(sortField.value, sortOrder.value, SORT_MAP_INBOX));

function buildParams({ force = false } = {}) {
    const params = {
        per_page: +rows.value || 10,
        page: +page.value || 1,
        definition_codes: CREACION_CODES
    };

    if (sortParam.value) params.sort = sortParam.value;

    const raw = String(search.value || '').trim();
    if (raw.length > 0 && (force || raw.length >= MIN_CHARS)) params.q = raw;

    return params;
}

function getApprovalRequestId(row) {
    return row?.approvalRequestId ?? row?.approval_request_id ?? row?.approval_request?.id ?? row?.approvalRequest?.id ?? null;
}

function canApproveRow(row) {
    return row?.can_approve === true;
}

function canRejectRow(row) {
    return row?.can_reject === true;
}

function normalizeInboxItem(ar) {
    const raw = unwrapApiPayload(ar);
    const a = raw?.approvable?.data ?? raw?.approvable ?? {};

    const facultad = {
        codigoFacultad: s(a?.codigoFacultad ?? a?.codigo_facultad).trim(),
        nombreFacultad: s(a?.facultad).trim()
    };
    if (facultad.codigoFacultad || facultad.nombreFacultad) {
        facultad.label = `${facultad.codigoFacultad} - ${facultad.nombreFacultad}`.replace(/^ - /, '').trim();
    }

    const programa = {
        codigoPrograma: s(a?.codigoPrograma ?? a?.codigo_programa).trim(),
        nombrePrograma: s(a?.nombrePrograma ?? a?.nombre_programa).trim(),
        codigoFacultad: facultad.codigoFacultad,
        facultad: facultad.nombreFacultad,
        nivelAcademico: s(a?.nivelAcademico ?? a?.nivel_academico).trim()
    };
    if (programa.codigoPrograma || programa.nombrePrograma) {
        programa.label = `${programa.codigoPrograma} - ${programa.nombrePrograma}`.trim();
    }

    const materia = {
        codigoPrograma: programa.codigoPrograma,
        codigoMateria: s(a?.codigoMateria ?? a?.codigo_materia).trim(),
        nombreMateria: s(a?.nombreMateria ?? a?.nombre_materia).trim()
    };
    if (materia.codigoMateria || materia.nombreMateria) {
        materia.label = `${materia.codigoMateria} - ${materia.nombreMateria}`.trim();
    }

    return {
        approvalRequestId: raw?.id ?? null,
        can_approve: raw?.can_approve ?? false,
        can_reject: raw?.can_reject ?? false,
        id: a?.id ?? raw?.recursoaprobableid ?? raw?.approvable_id ?? raw?.id ?? null,
        facultadObj: facultad.codigoFacultad || facultad.nombreFacultad ? facultad : null,
        programa: programa.codigoPrograma || programa.nombrePrograma ? programa : null,
        materia: materia.codigoMateria || materia.nombreMateria ? materia : null,
        codigoFacultad: facultad.codigoFacultad || null,
        codigoPrograma: programa.codigoPrograma || null,
        codigoMateria: materia.codigoMateria || null,
        nombrePractica: a?.nombrePractica ?? a?.nombre_practica ?? '',
        estadoCreacion: a?.estadoCreacion ?? a?.estado_creacion ?? 'en_aprobacion',
        comentarioRechazo: a?.comentarioRechazo ?? a?.comentario_rechazo ?? '',
        rolRechazoLabel: a?.rolRechazoLabel ?? a?.rol_rechazo_label ?? '',
        fechaRechazo: a?.fechaRechazo ?? a?.fecha_rechazo ?? null,
        createdAt: a?.createdAt ?? a?.created_at ?? raw?.fechacreacion ?? raw?.created_at ?? null,
        updatedAt: a?.updatedAt ?? a?.updated_at ?? raw?.fechamodificacion ?? raw?.updated_at ?? null
    };
}

async function getProducts(opts = {}) {
    const { signal, force = false } = opts;

    loading.value = true;

    try {
        const response = await api.get(API_INBOX, { params: buildParams({ force }), signal });
        const { items, meta } = unwrapCollection(response.data);
        products.value = items.map(normalizeInboxItem);
        total.value = Number(meta?.total ?? products.value.length);

        if (meta?.current_page) page.value = Number(meta.current_page);
        if (meta?.per_page) rows.value = Number(meta.per_page);
    } catch (e) {
        const canceled = e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError';

        if (!canceled) {
            const status = e?.response?.status;
            const msg = extractErrorMessage(e?.response?.data, e.message);

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

const approveLoading = ref(false);

async function approveRow(row) {
    const approvalRequestId = getApprovalRequestId(row);

    if (!approvalRequestId) return;

    try {
        approveLoading.value = true;
        await api.post(approvalEndpoints.approve(approvalRequestId));

        toast.add({
            severity: 'success',
            summary: 'Aprobado',
            detail: 'Aprobación registrada.',
            life: 3000
        });

        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const msg = extractErrorMessage(e?.response?.data, e.message);

        toast.add({
            severity: status === 409 ? 'warn' : 'error',
            summary: status === 409 ? 'No se puede aprobar' : 'Error al aprobar',
            detail: `[${status ?? 'ERR'}] ${msg}`,
            life: 6500
        });
    } finally {
        approveLoading.value = false;
    }
}

const rejectDialog = ref(false);
const rejectLoading = ref(false);
const rejectTarget = ref(null);
const rejectJustificacion = ref('');
const rejectError = ref('');

function openRejectDialog(row) {
    const approvalRequestId = getApprovalRequestId(row);
    if (!approvalRequestId) return;

    rejectTarget.value = { row, approvalRequestId };
    rejectJustificacion.value = '';
    rejectError.value = '';
    rejectDialog.value = true;
}

function closeRejectDialog() {
    rejectDialog.value = false;
    rejectTarget.value = null;
    rejectJustificacion.value = '';
    rejectError.value = '';
}

async function confirmReject() {
    if (!rejectJustificacion.value || rejectJustificacion.value.trim().length < 5) {
        rejectError.value = 'La justificación debe tener mínimo 5 caracteres.';
        return;
    }

    const target = rejectTarget.value;
    if (!target) return;

    try {
        rejectLoading.value = true;
        await api.post(approvalEndpoints.reject(target.approvalRequestId), {
            comment: rejectJustificacion.value.trim()
        });

        toast.add({
            severity: 'success',
            summary: 'Rechazado',
            detail: 'Rechazo registrado.',
            life: 3000
        });

        closeRejectDialog();
        await getProducts({ force: true });
    } catch (e) {
        const status = e?.response?.status;
        const msg = extractErrorMessage(e?.response?.data, e.message);
        rejectError.value = `[${status ?? 'ERR'}] ${msg}`;
    } finally {
        rejectLoading.value = false;
    }
}

const detailsDialog = ref(false);
const detailsLoading = ref(false);
const details = ref([]);

async function openDetails() {
    if (!selected.value.length) return;

    detailsLoading.value = true;
    details.value = [];

    try {
        const reqs = selected.value.map((r) => api.get(`${API_APPROVAL_REQUESTS}/${getApprovalRequestId(r)}`));
        const results = await Promise.allSettled(reqs);

        details.value = results
            .filter((r) => r.status === 'fulfilled')
            .map((r) => {
                const ar = unwrapApiPayload(r.value.data);
                return ar?.approvable?.data ?? ar?.approvable ?? null;
            })
            .filter(Boolean);
    } finally {
        detailsDialog.value = true;
        detailsLoading.value = false;
    }
}

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
        <Toast />

        <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
                <h2 class="text-lg font-semibold m-0">Solicitudes creación</h2>
            </div>
        </div>

        <Toolbar class="mb-3">
            <template #start>
                <div class="flex items-center gap-2 shrink-0 flex-wrap">
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
                                v-model.trim="search"
                                role="searchbox"
                                placeholder="Escribe para buscar..."
                                class="w-full h-10 leading-10 pr-8"
                                autocomplete="off"
                                @keydown.enter.prevent="forceFetch"
                                @keydown.esc.prevent="clearSearch"
                            />
                            <button v-if="search" type="button" class="absolute right-3 top-1/2 -translate-y-1/2" aria-label="Limpiar búsqueda" @click="clearSearch">X</button>
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
            emptyMessage="No hay solicitudes pendientes"
            responsiveLayout="scroll"
            :scrollable="true"
            tableStyle="width: 100%; min-width: 1200px;"
            @keydown.capture="onFormKeyCapture"
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

            <Column field="nombrePractica" header="Práctica" sortable style="min-width: 20rem">
                <template #body="{ data }">
                    <span class="block overflow-hidden text-ellipsis whitespace-nowrap font-medium" v-tooltip.top="data.nombrePractica ?? 'Sin nombre'">
                        {{ data.nombrePractica ?? '—' }}
                    </span>
                </template>
            </Column>

            <Column field="codigoFacultad" header="Facultad" sortable style="min-width: 18rem">
                <template #body="{ data }">
                    <span class="block overflow-hidden text-ellipsis whitespace-nowrap" v-tooltip.top="facultadRowLabel(data)">
                        {{ facultadRowLabel(data) }}
                    </span>
                </template>
            </Column>

            <Column field="codigoPrograma" header="Programa" sortable style="min-width: 18rem">
                <template #body="{ data }">
                    <span class="block overflow-hidden text-ellipsis whitespace-nowrap" v-tooltip.top="programaRowLabel(data)">
                        {{ programaRowLabel(data) }}
                    </span>
                </template>
            </Column>

            <Column field="codigoMateria" header="Materia" sortable style="min-width: 18rem">
                <template #body="{ data }">
                    <span class="block overflow-hidden text-ellipsis whitespace-nowrap" v-tooltip.top="materiaRowLabel(data)">
                        {{ materiaRowLabel(data) }}
                    </span>
                </template>
            </Column>

            <Column field="estadoCreacion" header="Estado" sortable style="width: 12rem; max-width: 12rem">
                <template #body="{ data }">
                    <Tag :value="estadoLabel(data.estadoCreacion ?? data.estado_creacion)" :severity="estadoSeverity(data.estadoCreacion ?? data.estado_creacion)" />
                </template>
            </Column>

            <Column :exportable="false" headerStyle="width:13rem">
                <template #body="{ data }">
                    <template v-if="canApproveRow(data) || canRejectRow(data)">
                        <Button v-if="canApproveRow(data)" icon="pi pi-check" rounded text severity="success" class="mr-1" :loading="approveLoading" @click.stop="approveRow(data)" />
                        <Button v-if="canRejectRow(data)" icon="pi pi-times" rounded text severity="danger" @click.stop="openRejectDialog(data)" />
                    </template>
                </template>
            </Column>
        </DataTable>

        <Dialog v-model:visible="rejectDialog" header="Rechazar creación" :style="{ width: '34rem' }" :modal="true">
            <div class="flex flex-column gap-3">
                <div class="w-full">
                    <label class="block font-semibold mb-2">Justificación <span class="text-red-500">*</span></label>
                    <Textarea v-model="rejectJustificacion" rows="5" autoResize class="w-full block" style="width: 100%" />
                    <small v-if="rejectError" class="text-red-500">{{ rejectError }}</small>
                </div>
            </div>

            <template #footer>
                <Button label="Cancelar" icon="pi pi-times" text @click="closeRejectDialog" />
                <Button label="Rechazar" icon="pi pi-times" severity="danger" :loading="rejectLoading" @click="confirmReject" />
            </template>
        </Dialog>

        <Dialog v-model:visible="detailsDialog" header="Detalles" :modal="true" :breakpoints="{ '1024px': '70vw', '768px': '85vw', '560px': '95vw' }" :style="{ width: '56vw', maxWidth: '980px' }">
            <div v-if="detailsLoading" class="p-4">Cargando...</div>

            <div v-else class="p-3 sm:p-4">
                <div v-for="d in details" :key="d.id" class="mb-4 border rounded-lg p-3 sm:p-4">
                    <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div class="min-w-0">
                            <div class="text-xs text-surface-500 break-words">Id: {{ d.id }}</div>
                            <div class="text-base font-semibold break-words leading-snug">
                                {{ d.nombrePractica ?? d.nombre_practica ?? '—' }}
                            </div>
                            <div class="text-sm text-surface-600 break-words">
                                {{ programaRowLabel(d) }}
                            </div>
                        </div>

                        <div class="flex flex-wrap items-center gap-2 sm:justify-end">
                            <Tag :value="estadoLabel(d.estadoCreacion ?? d.estado_creacion)" :severity="estadoSeverity(d.estadoCreacion ?? d.estado_creacion)" />
                        </div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-sm">
                        <div><b>Facultad:</b> {{ facultadRowLabel(d) }}</div>
                        <div><b>Programa:</b> {{ programaRowLabel(d) }}</div>
                        <div><b>Materia:</b> {{ materiaRowLabel(d) }}</div>
                        <div><b>Nivel académico:</b> {{ d.nivel_academico ?? d.nivelAcademico ?? '—' }}</div>
                    </div>

                    <div class="mt-4 pt-4 border-t">
                        <div class="text-sm font-semibold mb-3">Contenido</div>

                        <div class="mb-3">
                            <div class="text-sm text-surface-600 mb-1">Recursos necesarios</div>
                            <div class="line-height-3 white-space-pre-line">
                                {{ d.recursosNecesarios ?? d.recursos_necesarios ?? '—' }}
                            </div>
                        </div>

                        <div>
                            <div class="text-sm text-surface-600 mb-1">Justificación</div>
                            <div class="line-height-3 white-space-pre-line">
                                {{ d.justificacion ?? '—' }}
                            </div>
                        </div>
                    </div>

                    <div v-if="d.comentarioRechazo ?? d.comentario_rechazo" class="mt-4 pt-4 border-t">
                        <Message severity="warn" :closable="false">
                            <div class="font-semibold mb-1">
                                Motivo de rechazo
                                <template v-if="d.rolRechazoLabel ?? d.rol_rechazo_label"> · {{ d.rolRechazoLabel ?? d.rol_rechazo_label }} </template>
                            </div>
                            <div v-if="d.fechaRechazo ?? d.fecha_rechazo" class="text-sm text-color-secondary mb-2">
                                {{ formatDateTime(d.fechaRechazo ?? d.fecha_rechazo) }}
                            </div>
                            <div class="white-space-pre-line">
                                {{ d.comentarioRechazo ?? d.comentario_rechazo }}
                            </div>
                        </Message>
                    </div>
                </div>

                <div v-if="!details.length" class="text-surface-500">No fue posible cargar los detalles de los registros seleccionados.</div>
            </div>

            <template #footer>
                <Button label="Cerrar" icon="pi pi-times" text @click="detailsDialog = false" />
            </template>
        </Dialog>
    </div>
</template>
