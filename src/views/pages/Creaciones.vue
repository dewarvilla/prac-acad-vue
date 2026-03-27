<script setup>
import { ref, reactive, computed, onMounted, watch, onBeforeUnmount } from 'vue';
import { useToast } from 'primevue/usetoast';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';

const toast = useToast();
const auth = useAuthStore();
const hasPerm = (perm) => auth.hasPermission(perm);

// -------------------------
// Tabla base
// -------------------------
const tableUid = `cre-${Math.random().toString(36).slice(2)}`;
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

// -------------------------
// Permisos de CRUD
// -------------------------
const canViewCreaciones = computed(() => hasPerm('creaciones.view'));
const canCreateCreaciones = computed(() => hasPerm('creaciones.create'));
const canEditCreaciones = computed(() => hasPerm('creaciones.edit'));
const canDeleteCreaciones = computed(() => hasPerm('creaciones.delete'));

// -------------------------
// Restricción UI: editar/eliminar
// -------------------------
const isRejected = (row) => {
    const st = row?.estado_creacion ?? row?.estadoCreacion ?? '';
    return String(st).trim().toLowerCase() === 'rechazada';
};

const canEditRow = (row) => canEditCreaciones.value && isRejected(row);
const canDeleteRow = (row) => canDeleteCreaciones.value && isRejected(row);

const canBulkDelete = computed(() => canDeleteCreaciones.value && selected.value.length > 0 && selected.value.every(isRejected));

// -------------------------
// Permisos de aprobación
// -------------------------
const CRE_APPROVE_PERMS = ['approvals.aprobar.comite_acreditacion', 'approvals.aprobar.consejo_facultad', 'approvals.aprobar.consejo_academico'];

const CRE_REJECT_PERMS = ['approvals.rechazar.comite_acreditacion', 'approvals.rechazar.consejo_facultad', 'approvals.rechazar.consejo_academico'];

const isCreacionesApprover = computed(() => [...CRE_APPROVE_PERMS, ...CRE_REJECT_PERMS].some((p) => hasPerm(p)));

const isApproverMode = computed(() => isCreacionesApprover.value);
const canAccessModule = computed(() => isApproverMode.value || canViewCreaciones.value);

const currentActorKey = computed(() => {
    if (hasPerm('approvals.aprobar.comite_acreditacion') || hasPerm('approvals.rechazar.comite_acreditacion')) return 'comite_acreditacion';
    if (hasPerm('approvals.aprobar.consejo_facultad') || hasPerm('approvals.rechazar.consejo_facultad')) return 'consejo_facultad';
    if (hasPerm('approvals.aprobar.consejo_academico') || hasPerm('approvals.rechazar.consejo_academico')) return 'consejo_academico';
    return null;
});

const canApproveAtStage = computed(() => {
    const k = currentActorKey.value;
    if (k === 'comite_acreditacion') return hasPerm('approvals.aprobar.comite_acreditacion');
    if (k === 'consejo_facultad') return hasPerm('approvals.aprobar.consejo_facultad');
    if (k === 'consejo_academico') return hasPerm('approvals.aprobar.consejo_academico');
    return false;
});

const canRejectAtStage = computed(() => {
    const k = currentActorKey.value;
    if (k === 'comite_acreditacion') return hasPerm('approvals.rechazar.comite_acreditacion');
    if (k === 'consejo_facultad') return hasPerm('approvals.rechazar.consejo_facultad');
    if (k === 'consejo_academico') return hasPerm('approvals.rechazar.consejo_academico');
    return false;
});

// -------------------------
// Endpoints
// -------------------------
const API_CRE = '/creaciones';
const API_INBOX = '/approvals/inbox';
const API_APPROVAL_REQUESTS = '/approval-requests';

const API_ACA_PROGRAMAS = '/academusoft/programas_academicos';
const API_ACA_MATERIAS = '/academusoft/materias';

const approvalEndpoints = {
    approve: (approvalRequestId) => `${API_APPROVAL_REQUESTS}/${approvalRequestId}/approve`,
    reject: (approvalRequestId) => `${API_APPROVAL_REQUESTS}/${approvalRequestId}/reject`,
    cancel: (approvalRequestId) => `${API_APPROVAL_REQUESTS}/${approvalRequestId}/cancel`
};

function getApprovalRequestId(row) {
    return row?.approvalRequestId ?? row?.approval_request_id ?? row?.approval_request?.id ?? row?.approvalRequest?.id ?? null;
}

function getApprovalCurrentRoleKey(row) {
    return row?.approvalCurrentRoleKey ?? row?.approval_current_role_key ?? row?.approval_request?.current_role_key ?? row?.approvalRequest?.current_role_key ?? null;
}

// -------------------------
// Search debounce
// -------------------------
const search = ref('');
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
let typingTimer = null;
let activeCtrl = null;

// -------------------------
// IDs únicos form
// -------------------------
const uid = Math.random().toString(36).slice(2);
const recId = `recursosNecesarios-${uid}`;
const jusId = `justificacion-${uid}`;

// -------------------------
// Utils normalización
// -------------------------
const s = (v) => (v == null ? '' : String(v));

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

// -------------------------
// Programa (Autocomplete)
// -------------------------
const programaQuery = ref('');
const progSugs = ref([]);
const loadingProgs = ref(false);
const showProgPanel = ref(false);
const highlightedIndex = ref(-1);
let progTimer = null;
const PROG_DEBOUNCE = 250;

function openProgPanel() {
    showProgPanel.value = true;
}

function closeProgPanel() {
    showProgPanel.value = false;
    highlightedIndex.value = -1;
}

async function fetchProgramas(query = '') {
    loadingProgs.value = true;

    try {
        const params = {};
        const q = s(query).trim();

        if (q) params.q = q;
        params.per_page = 20;

        const { data } = await api.get(API_ACA_PROGRAMAS, { params });
        const items = Array.isArray(data) ? data : (data?.items ?? data?.data ?? []);

        const normalizedQ = q.toLowerCase();

        progSugs.value = items
            .filter((p) => !!p?.programa_activo)
            .filter((p) => {
                if (!normalizedQ) return true;
                const name = s(p?.nombre_programa).toLowerCase();
                const code = s(p?.codigo_programa).toLowerCase();
                const fac = s(p?.facultad).toLowerCase();
                return name.includes(normalizedQ) || code.includes(normalizedQ) || fac.includes(normalizedQ);
            })
            .slice(0, 20)
            .map((p) => ({
                codigoPrograma: s(p?.codigo_programa).trim(),
                nombrePrograma: s(p?.nombre_programa).trim(),
                nivelAcademico: s(p?.nivel_academico).trim(),
                facultad: s(p?.facultad).trim(),
                codigoFacultad: s(p?.codigo_facultad).trim(),
                label: `${s(p?.codigo_programa).trim()} - ${s(p?.nombre_programa).trim()}`.trim()
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

function onProgramaInput() {
    const q = s(programaQuery.value).trim();
    showProgPanel.value = true;

    const currentLabel = s(product.value.programa?.label || product.value.programa?.nombrePrograma || '').trim();

    if (product.value.programa && q !== currentLabel) {
        product.value.programa = null;

        product.value.materia = null;
        materiaQuery.value = '';
        matSugs.value = [];
        highlightedMatIndex.value = -1;

        if (touched.programa) validateField('programa');
        if (touched.materia) validateField('materia');
    }

    if (progTimer) clearTimeout(progTimer);

    progTimer = setTimeout(() => {
        if (!q.length) {
            progSugs.value = [];
            highlightedIndex.value = -1;
            return;
        }
        fetchProgramas(q);
    }, PROG_DEBOUNCE);
}

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
        } else {
            touched.programa = true;
            validateField('programa');
            closeProgPanel();
        }
    }
}

function selectPrograma(it) {
    product.value.programa = it;
    programaQuery.value = it.label || it.nombrePrograma || '';

    product.value.materia = null;
    materiaQuery.value = '';
    matSugs.value = [];
    highlightedMatIndex.value = -1;

    touched.programa = true;
    validateField('programa');
    if (touched.materia) validateField('materia');

    closeProgPanel();
}

// Se deja para no romper el template actual si todavía tiene @keydown.enter.prevent
function onProgramaEnter() {
    return;
}

function clearPrograma() {
    programaQuery.value = '';
    progSugs.value = [];
    highlightedIndex.value = -1;

    product.value.programa = null;

    product.value.materia = null;
    materiaQuery.value = '';
    matSugs.value = [];
    highlightedMatIndex.value = -1;

    touched.programa = true;
    validateField('programa');
    if (touched.materia) validateField('materia');

    closeProgPanel();
}

// -------------------------
// Helpers estado
// -------------------------
function estadoLabel(estado) {
    const st = String(estado ?? '')
        .trim()
        .toLowerCase();

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
    const st = String(estado ?? '')
        .trim()
        .toLowerCase();

    if (st === 'aprobada' || st === 'approved') return 'success';
    if (st === 'rechazada' || st === 'rejected') return 'danger';
    if (st === 'en_aprobacion' || st === 'pending') return 'warn';

    return 'info';
}

// -------------------------
// Materia (Autocomplete)
// -------------------------
const materiaQuery = ref('');
const matSugs = ref([]);
const loadingMats = ref(false);
const showMatPanel = ref(false);
const highlightedMatIndex = ref(-1);
let matTimer = null;
const MAT_DEBOUNCE = 250;

function openMatPanel() {
    showMatPanel.value = true;
}

function closeMatPanel() {
    showMatPanel.value = false;
    highlightedMatIndex.value = -1;
}

async function fetchMaterias(query = '') {
    loadingMats.value = true;

    try {
        const prog = product.value.programa;
        const codigoPrograma = prog?.codigoPrograma;

        if (!codigoPrograma) {
            matSugs.value = [];
            return;
        }

        const params = { codigo_programa: codigoPrograma, per_page: 20 };
        const q = s(query).trim();
        if (q) params.q = q;

        const { data } = await api.get(API_ACA_MATERIAS, { params });
        const items = Array.isArray(data) ? data : (data?.items ?? data?.data ?? []);

        const normalizedQ = q.toLowerCase();

        matSugs.value = items
            .filter((m) => !!m?.materia_activa)
            .filter((m) => !m?.codigo_programa || s(m.codigo_programa) === s(codigoPrograma))
            .filter((m) => {
                if (!normalizedQ) return true;
                const name = s(m?.nombre_materia).toLowerCase();
                const code = s(m?.codigo_materia).toLowerCase();
                return name.includes(normalizedQ) || code.includes(normalizedQ);
            })
            .slice(0, 20)
            .map((m) => ({
                codigoPrograma: s(m?.codigo_programa || codigoPrograma).trim(),
                codigoMateria: s(m?.codigo_materia).trim(),
                nombreMateria: s(m?.nombre_materia).trim(),
                label: `${s(m?.codigo_materia).trim()} - ${s(m?.nombre_materia).trim()}`.trim()
            }));
    } catch (e) {
        matSugs.value = [];
        toast.add({
            severity: 'error',
            summary: 'Materias',
            detail: e?.response?.data?.message || e.message,
            life: 4000
        });
    } finally {
        loadingMats.value = false;
    }
}

function onMateriaInput() {
    const q = s(materiaQuery.value).trim();
    showMatPanel.value = true;

    if (!product.value.programa?.codigoPrograma) {
        matSugs.value = [];
        highlightedMatIndex.value = -1;
        return;
    }

    const currentLabel = s(product.value.materia?.label || '').trim();

    if (product.value.materia && q !== currentLabel) {
        product.value.materia = null;
        if (touched.materia) validateField('materia');
    }

    if (matTimer) clearTimeout(matTimer);

    matTimer = setTimeout(() => {
        if (!q.length) {
            matSugs.value = [];
            highlightedMatIndex.value = -1;
            return;
        }
        fetchMaterias(q);
    }, MAT_DEBOUNCE);
}

function onMateriaKeydown(e) {
    if (!showMatPanel.value || !matSugs.value.length) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightedMatIndex.value = highlightedMatIndex.value < matSugs.value.length - 1 ? highlightedMatIndex.value + 1 : 0;
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightedMatIndex.value = highlightedMatIndex.value > 0 ? highlightedMatIndex.value - 1 : matSugs.value.length - 1;
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedMatIndex.value >= 0) {
            selectMateria(matSugs.value[highlightedMatIndex.value]);
        } else {
            touched.materia = true;
            validateField('materia');
            closeMatPanel();
        }
    }
}

function selectMateria(it) {
    product.value.materia = it;
    materiaQuery.value = it.label || it.nombreMateria || '';

    touched.materia = true;
    validateField('materia');

    closeMatPanel();
}

// Se deja para no romper el template actual si todavía tiene @keydown.enter.prevent
function onMateriaEnter() {
    return;
}

function clearMateria() {
    materiaQuery.value = '';
    matSugs.value = [];
    highlightedMatIndex.value = -1;

    product.value.materia = null;

    touched.materia = true;
    validateField('materia');

    closeMatPanel();
}

// -------------------------
// Parametrización (sort/search/paginación)
// -------------------------
const SORT_MAP_CRE = {
    id: 'id',
    nombrePractica: 'nombre_practica',
    estadoCreacion: 'estado_creacion',
    estado: 'estado',
    codigoFacultad: 'codigo_facultad',
    codigoPrograma: 'codigo_programa',
    codigoMateria: 'codigo_materia',
    createdAt: 'fechacreacion',
    updatedAt: 'fechamodificacion'
};

const SORT_MAP_INBOX = {
    id: 'id',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
};

function mapSort(uiField, order, map) {
    if (!uiField) return undefined;
    const apiField = map[uiField];
    if (!apiField) return undefined;
    return `${order === -1 ? '-' : ''}${apiField}`;
}

function compareValues(a, b, order = 1) {
    const av = a == null ? '' : String(a).toLowerCase();
    const bv = b == null ? '' : String(b).toLowerCase();

    if (av < bv) return -1 * order;
    if (av > bv) return 1 * order;
    return 0;
}

function sortInboxItems(items) {
    const field = sortField.value;
    const order = sortOrder.value === -1 ? -1 : 1;

    const sorted = [...items];

    sorted.sort((a, b) => {
        switch (field) {
            case 'nombrePractica':
                return compareValues(a.nombrePractica ?? a.nombre_practica, b.nombrePractica ?? b.nombre_practica, order);

            case 'codigoPrograma':
                return compareValues(a.codigoPrograma, b.codigoPrograma, order);

            case 'codigoMateria':
                return compareValues(a.codigoMateria, b.codigoMateria, order);

            case 'estadoCreacion':
                return compareValues(a.estadoCreacion ?? a.estado_creacion, b.estadoCreacion ?? b.estado_creacion, order);

            case 'id':
                return compareValues(a.id, b.id, order);

            case 'createdAt':
                return compareValues(a.createdAt ?? a.created_at, b.createdAt ?? b.created_at, order);

            case 'updatedAt':
                return compareValues(a.updatedAt ?? a.updated_at, b.updatedAt ?? b.updated_at, order);

            default:
                return 0;
        }
    });

    return sorted;
}

const sortParamCre = computed(() => mapSort(sortField.value, sortOrder.value, SORT_MAP_CRE));
const sortParamInbox = computed(() => mapSort(sortField.value, sortOrder.value, SORT_MAP_INBOX));

function buildParams({ force = false } = {}) {
    const params = { per_page: +rows.value || 10, page: +page.value || 1 };
    const sp = isApproverMode.value ? sortParamInbox.value : sortParamCre.value;
    if (sp) params.sort = sp;

    const raw = String(search.value || '').trim();
    if (raw.length > 0 && (force || raw.length >= MIN_CHARS)) params.q = raw;

    return params;
}

// -------------------------
// Inbox helpers (ocultar inmediatamente al decidir)
// -------------------------
function removeInboxItem(approvalRequestId) {
    if (!approvalRequestId) return;
    products.value = products.value.filter((x) => getApprovalRequestId(x) !== approvalRequestId);
    selected.value = selected.value.filter((x) => getApprovalRequestId(x) !== approvalRequestId);
    total.value = Number(products.value.length);
}

function isActionable(row) {
    const status = row?.approvalStatus ?? row?._approval?.status;
    const isCurrent = row?.approvalIsCurrent ?? row?._approval?.is_current ?? row?._approval?.isCurrent;

    if (status && String(status).toLowerCase() !== 'pending') return false;
    if (isCurrent === false) return false;

    return true;
}

function canApproveRow(row) {
    if (!isApproverMode.value) return false;
    if (!currentActorKey.value) return false;
    if (!canApproveAtStage.value) return false;

    const approvalRequestId = getApprovalRequestId(row);
    if (!approvalRequestId) return false;

    if (!isActionable(row)) return false;

    const roleKey = getApprovalCurrentRoleKey(row);
    if (roleKey && roleKey !== currentActorKey.value) return false;

    return true;
}

function canRejectRow(row) {
    if (!isApproverMode.value) return false;
    if (!currentActorKey.value) return false;
    if (!canRejectAtStage.value) return false;

    const approvalRequestId = getApprovalRequestId(row);
    if (!approvalRequestId) return false;

    if (!isActionable(row)) return false;

    const roleKey = getApprovalCurrentRoleKey(row);
    if (roleKey && roleKey !== currentActorKey.value) return false;

    return true;
}

// -------------------------
// Normalizador Inbox (nuevo esquema Creación)
// -------------------------
function normalizeInboxItem(ar) {
    const raw = ar?.data ?? ar;
    const a = raw?.approvable?.data ?? raw?.approvable ?? {};

    const programa = {
        codigoPrograma: s(a?.codigoPrograma ?? a?.codigo_programa).trim(),
        nombrePrograma: s(a?.nombrePrograma ?? a?.nombre_programa).trim(),
        codigoFacultad: s(a?.codigoFacultad ?? a?.codigo_facultad).trim(),
        facultad: s(a?.facultad).trim(),
        nivelAcademico: s(a?.nivelAcademico ?? a?.nivel_academico).trim()
    };

    if (programa.codigoPrograma || programa.nombrePrograma) {
        programa.label = `${programa.codigoPrograma} - ${programa.nombrePrograma}`.trim();
    }

    const materia = {
        codigoPrograma: s(a?.codigoPrograma ?? a?.codigo_programa).trim(),
        codigoMateria: s(a?.codigoMateria ?? a?.codigo_materia).trim(),
        nombreMateria: s(a?.nombreMateria ?? a?.nombre_materia).trim()
    };

    if (materia.codigoMateria || materia.nombreMateria) {
        materia.label = `${materia.codigoMateria} - ${materia.nombreMateria}`.trim();
    }

    return {
        _mode: 'inbox',

        approvalRequestId: raw?.id ?? null,
        approvalStatus: raw?.status ?? null,
        approvalIsCurrent: raw?.is_current ?? raw?.isCurrent ?? null,
        approvalCurrentRoleKey: raw?.current_role_key ?? raw?.currentRoleKey ?? null,
        approvalDefinitionCode: raw?.definition?.code ?? raw?.definition_code ?? null,

        id: a?.id ?? raw?.approvable_id ?? raw?.id ?? null,

        programa: programa.codigoPrograma || programa.nombrePrograma ? programa : null,
        materia: materia.codigoMateria || materia.nombreMateria ? materia : null,

        codigoPrograma: programa.codigoPrograma || null,
        nombrePrograma: programa.nombrePrograma || null,
        codigoFacultad: programa.codigoFacultad || null,
        facultad: programa.facultad || null,
        nivelAcademico: programa.nivelAcademico || null,

        codigoMateria: materia.codigoMateria || null,
        nombreMateria: materia.nombreMateria || null,

        nombrePractica: a?.nombrePractica ?? a?.nombre_practica ?? '',
        estadoCreacion: a?.estadoCreacion ?? a?.estado_creacion ?? 'en_aprobacion',
        recursosNecesarios: a?.recursosNecesarios ?? a?.recursos_necesarios ?? '',
        justificacion: a?.justificacion ?? '',

        comentarioRechazo: a?.comentarioRechazo ?? a?.comentario_rechazo ?? '',
        rolRechazo: a?.rolRechazo ?? a?.rol_rechazo ?? '',
        rolRechazoLabel: a?.rolRechazoLabel ?? a?.rol_rechazo_label ?? '',
        fechaRechazo: a?.fechaRechazo ?? a?.fecha_rechazo ?? null,

        createdAt: a?.createdAt ?? a?.created_at ?? raw?.created_at ?? null,
        updatedAt: a?.updatedAt ?? a?.updated_at ?? raw?.updated_at ?? null
    };
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
        if (!isApproverMode.value) {
            const { data } = await api.get(API_CRE, { params: buildParams({ force }), signal });

            if (Array.isArray(data)) {
                products.value = data;
                total.value = data.length;
            } else {
                products.value = data.data ?? [];
                total.value = Number(data.meta?.total ?? products.value.length);
                if (data.meta?.current_page) page.value = Number(data.meta.current_page);
                if (data.meta?.per_page) rows.value = Number(data.meta.per_page);
            }
            return;
        }

        const { data } = await api.get(API_INBOX, { params: buildParams({ force }), signal });

        const items = Array.isArray(data) ? data : (data.data ?? []);
        const normalized = items.map(normalizeInboxItem);

        let onlyCreaciones = normalized.filter((x) => !x.approvalDefinitionCode || x.approvalDefinitionCode === 'CREACION_PRACTICA');

        if (currentActorKey.value) {
            onlyCreaciones = onlyCreaciones.filter((x) => {
                const rk = getApprovalCurrentRoleKey(x);
                return rk ? rk === currentActorKey.value : true;
            });
        }

        products.value = sortInboxItems(onlyCreaciones);

        // Mientras el backend del inbox no filtre por definition_code,
        // el total correcto del módulo en frontend es lo que realmente se está mostrando.
        total.value = products.value.length;

        if (!Array.isArray(data)) {
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

// -------------------------
// Acciones aprobar/rechazar
// -------------------------
const approveLoading = ref(false);

async function approveRow(row) {
    const approvalRequestId = getApprovalRequestId(row);

    if (!approvalRequestId) {
        toast.add({
            severity: 'warn',
            summary: 'Sin solicitud',
            detail: 'No hay solicitud de aprobación asociada.',
            life: 4500
        });
        return;
    }

    try {
        approveLoading.value = true;
        const { data } = await api.post(approvalEndpoints.approve(approvalRequestId));

        if (data?.ok === false) {
            toast.add({
                severity: 'warn',
                summary: 'No se pudo aprobar',
                detail: data?.message || 'Operación rechazada.',
                life: 5000
            });
            return;
        }

        removeInboxItem(approvalRequestId);
        await getProducts({ force: true });

        toast.add({
            severity: 'success',
            summary: 'Aprobado',
            detail: 'Aprobación registrada.',
            life: 3000
        });
    } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.message || e.message;

        if (
            String(msg || '')
                .toLowerCase()
                .includes('finalizada')
        ) {
            removeInboxItem(approvalRequestId);
            await getProducts({ force: true });
        }

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

    if (!approvalRequestId) {
        toast.add({
            severity: 'warn',
            summary: 'Sin solicitud',
            detail: 'No hay solicitud de aprobación asociada.',
            life: 4500
        });
        return;
    }

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

        const { data } = await api.post(approvalEndpoints.reject(target.approvalRequestId), {
            comment: rejectJustificacion.value.trim()
        });

        if (data?.ok === false) {
            rejectError.value = data?.message || 'Operación rechazada.';
            return;
        }

        removeInboxItem(target.approvalRequestId);
        await getProducts({ force: true });

        toast.add({
            severity: 'success',
            summary: 'Rechazado',
            detail: 'Rechazo registrado.',
            life: 3000
        });

        closeRejectDialog();
    } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.message || e.message;

        if (
            String(msg || '')
                .toLowerCase()
                .includes('finalizada')
        ) {
            removeInboxItem(target.approvalRequestId);
            await getProducts({ force: true });
            closeRejectDialog();
        }

        rejectError.value = `[${status ?? 'ERR'}] ${msg}`;
    } finally {
        rejectLoading.value = false;
    }
}

// -------------------------
// CRUD (NO aprobador) + Detalles
// -------------------------
const productDialog = ref(false);
const detailsDialog = ref(false);
const detailsLoading = ref(false);
const details = ref([]);

async function openDetails() {
    if (!selected.value.length) return;

    detailsLoading.value = true;
    details.value = [];

    try {
        if (!isApproverMode.value) {
            const reqs = selected.value.map((r) => api.get(`${API_CRE}/${r.id}`));
            const results = await Promise.allSettled(reqs);

            details.value = results
                .filter((r) => r.status === 'fulfilled')
                .map((r) => r.value.data?.data ?? r.value.data)
                .filter(Boolean);
        } else {
            const reqs = selected.value.map((r) => api.get(`${API_APPROVAL_REQUESTS}/${getApprovalRequestId(r)}`));
            const results = await Promise.allSettled(reqs);

            details.value = results
                .filter((r) => r.status === 'fulfilled')
                .map((r) => {
                    const ar = r.value.data?.data ?? r.value.data;
                    return ar?.approvable?.data ?? ar?.approvable ?? null;
                })
                .filter(Boolean);
        }
    } finally {
        detailsDialog.value = true;
        detailsLoading.value = false;
    }
}

const product = ref({
    id: null,
    programa: null,
    materia: null,
    nombrePractica: '',
    recursosNecesarios: '',
    justificacion: '',
    comentarioRechazo: '',
    rolRechazoLabel: ''
});

const errors = reactive({
    programa: '',
    materia: '',
    nombrePractica: '',
    recursosNecesarios: '',
    justificacion: ''
});

const touched = reactive({
    programa: false,
    materia: false,
    nombrePractica: false,
    recursosNecesarios: false,
    justificacion: false
});

const rules = {
    programa: [(v) => !!v?.codigoPrograma || 'Requerido.'],
    materia: [(v) => !!v?.codigoMateria || 'Requerido.'],
    nombrePractica: [(v) => !!s(v).trim() || 'Requerido.'],
    recursosNecesarios: [(v) => !!s(v).trim() || 'Requerido.'],
    justificacion: [(v) => !!s(v).trim() || 'Requerido.']
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
    product.value = {
        id: null,
        programa: null,
        materia: null,
        nombrePractica: '',
        recursosNecesarios: '',
        justificacion: '',
        comentarioRechazo: '',
        rolRechazoLabel: ''
    };

    programaQuery.value = '';
    progSugs.value = [];
    closeProgPanel();

    materiaQuery.value = '';
    matSugs.value = [];
    closeMatPanel();

    resetValidation();
    productDialog.value = true;
}

function editProduct(row) {
    const prog = getProgramaFromRow(row);
    const mat = getMateriaFromRow(row);

    product.value = {
        id: row.id ?? null,
        programa: prog,
        materia: mat,
        nombrePractica: row.nombrePractica ?? row.nombre_practica ?? '',
        recursosNecesarios: row.recursosNecesarios ?? row.recursos_necesarios ?? '',
        justificacion: row.justificacion ?? '',
        comentarioRechazo: row.comentarioRechazo ?? row.comentario_rechazo ?? '',
        rolRechazoLabel: row.rolRechazoLabel ?? row.rol_rechazo_label ?? ''
    };

    programaQuery.value = prog ? prog.label || prog.nombrePrograma || '' : '';
    progSugs.value = [];
    closeProgPanel();

    materiaQuery.value = mat ? mat.label || mat.nombreMateria || '' : '';
    matSugs.value = [];
    closeMatPanel();

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
    codigo_programa: 'programa',
    codigo_materia: 'materia',
    nombre_practica: 'nombrePractica',
    recursos_necesarios: 'recursosNecesarios',
    justificacion: 'justificacion'
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

// -------------------------
// Confirmación antes de guardar (crear/editar)
// -------------------------
const confirmSaveDialog = ref(false);
const pendingSaveAction = ref(null); // 'create' | 'edit'
const pendingSavePayload = ref(null);

function openConfirmSave(action, payload) {
    pendingSaveAction.value = action;
    pendingSavePayload.value = payload;
    confirmSaveDialog.value = true;
}

function closeConfirmSave() {
    confirmSaveDialog.value = false;
    pendingSaveAction.value = null;
    pendingSavePayload.value = null;
}

async function confirmSave() {
    const action = pendingSaveAction.value;
    const payload = pendingSavePayload.value;

    if (!action || !payload) {
        closeConfirmSave();
        return;
    }

    try {
        saving.value = true;

        if (action === 'edit') {
            await api.patch(`${API_CRE}/${product.value.id}`, payload);
            toast.add({
                severity: 'success',
                summary: 'Actualizado',
                detail: 'La práctica fue actualizada y volvió a aprobación.',
                life: 3500
            });
        } else {
            await api.post(API_CRE, payload);
            toast.add({
                severity: 'success',
                summary: 'Creado',
                detail: 'La práctica fue creada y enviada a aprobación.',
                life: 3500
            });
        }

        productDialog.value = false;
        closeConfirmSave();
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
            closeConfirmSave();
            return;
        }

        const msg = data?.message || data?.error || e.message;

        toast.add({
            severity: status === 409 ? 'warn' : 'error',
            summary: status === 409 ? 'Conflicto' : 'No se pudo guardar',
            detail: `[${status ?? 'ERR'}] ${msg}`,
            life: 6500
        });

        closeConfirmSave();
    } finally {
        saving.value = false;
    }
}

async function saveProduct() {
    if (saving.value) return;

    const fields = ['programa', 'materia', 'nombrePractica', 'recursosNecesarios', 'justificacion'];

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
        codigo_programa: product.value.programa?.codigoPrograma ?? null,
        codigo_materia: product.value.materia?.codigoMateria ?? null,
        nombre_practica: s(product.value.nombrePractica).trim(),
        recursos_necesarios: s(product.value.recursosNecesarios).trim(),
        justificacion: s(product.value.justificacion).trim()
    };

    const action = product.value.id ? 'edit' : 'create';
    openConfirmSave(action, payload);
}

// delete individual + bulk
const deleteProductDialog = ref(false);
const current = ref(null);

function confirmDeleteProduct(row) {
    current.value = { ...row };
    deleteProductDialog.value = true;
}

async function deleteProduct() {
    try {
        await api.delete(`${API_CRE}/${current.value.id}`);
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

const bulkDeleteDialog = ref(false);

function confirmBulkDelete() {
    if (!canBulkDelete.value) {
        toast.add({
            severity: 'warn',
            summary: 'No se puede eliminar',
            detail: 'Solo puedes eliminar creaciones en estado "rechazada".',
            life: 4500
        });
        return;
    }
    bulkDeleteDialog.value = true;
}

async function bulkDelete() {
    const ids = selected.value.map((r) => r.id);

    try {
        await api.post(`${API_CRE}/bulk-delete`, { ids });

        const set = new Set(ids);
        products.value = products.value.filter((x) => !set.has(x.id));
        selected.value = [];

        toast.add({
            severity: 'success',
            summary: `Eliminados (${ids.length})`,
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

// bloquear space en el form
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
    if (progTimer) clearTimeout(progTimer);
    if (matTimer) clearTimeout(matTimer);
});

onMounted(async () => {
    await getProducts();
});
</script>

<template>
    <div class="card">
        <Toast />
        <div v-if="!canAccessModule" class="p-4 text-color-secondary">No tienes permisos para acceder a este módulo.</div>
        <template v-else>
            <Toolbar class="mb-4">
                <template #start>
                    <div class="flex flex-wrap gap-2">
                        <Button v-if="!isApproverMode && canCreateCreaciones" label="Nueva" icon="pi pi-plus" severity="success" @click="openNew" />
                        <Button label="Detalles" icon="pi pi-eye" severity="info" :disabled="!selected.length" @click="openDetails" />
                        <Button v-if="!isApproverMode && canDeleteCreaciones" label="Eliminar" icon="pi pi-trash" severity="danger" :disabled="!canBulkDelete" @click="confirmBulkDelete" />
                    </div>
                </template>
                <template #end>
                    <div class="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
                        <IconField> <InputIcon class="pi pi-search" /> <InputText v-model="search" placeholder="Buscar..." class="w-full sm:w-80" @keydown.enter.prevent="forceFetch" /> </IconField>
                        <Button icon="pi pi-times" severity="secondary" outlined :disabled="!search" @click="clearSearch" /> <Button icon="pi pi-refresh" severity="secondary" outlined @click="forceFetch" />
                    </div>
                </template>
            </Toolbar>
            <DataTable
                :id="tableUid"
                v-model:selection="selected"
                :value="products"
                dataKey="id"
                :loading="loading"
                lazy
                paginator
                :rows="rows"
                :first="(page - 1) * rows"
                :totalRecords="total"
                :rowsPerPageOptions="[10, 20, 50]"
                :sortField="sortField"
                :sortOrder="sortOrder"
                responsiveLayout="scroll"
                stripedRows
                showGridlines
                @page="onPage"
                @sort="onSort"
            >
                <template #empty> <div class="p-4 text-center text-color-secondary">No se encontraron registros.</div> </template> <template #loading> <div class="p-4 text-center">Cargando…</div> </template>
                <Column selectionMode="multiple" headerStyle="width: 3rem" />
                <Column field="nombrePractica" header="Práctica" sortable style="min-width: 18rem">
                    <template #body="{ data }">
                        <div class="font-medium">{{ data.nombrePractica ?? data.nombre_practica ?? '—' }}</div>
                    </template>
                </Column>
                <Column field="codigoPrograma" header="Programa" sortable style="min-width: 18rem">
                    <template #body="{ data }">
                        <span>{{ programaRowLabel(data) }}</span>
                    </template>
                </Column>
                <Column field="codigoMateria" header="Materia" sortable style="min-width: 18rem">
                    <template #body="{ data }">
                        <span>{{ materiaRowLabel(data) }}</span>
                    </template>
                </Column>
                <Column field="estadoCreacion" header="Estado" sortable style="min-width: 11rem">
                    <template #body="{ data }">
                        <Tag :value="estadoLabel(data.estadoCreacion ?? data.estado_creacion ?? data.approvalStatus)" :severity="estadoSeverity(data.estadoCreacion ?? data.estado_creacion ?? data.approvalStatus)" />
                    </template>
                </Column>
                <Column header="Acciones" style="min-width: 16rem">
                    <template #body="{ data }">
                        <div class="flex flex-wrap gap-2">
                            <template v-if="isApproverMode">
                                <Button v-if="canApproveRow(data)" icon="pi pi-check" label="Aprobar" severity="success" size="small" :loading="approveLoading" @click="approveRow(data)" />
                                <Button v-if="canRejectRow(data)" icon="pi pi-times" label="Rechazar" severity="danger" size="small" @click="openRejectDialog(data)" />
                            </template>
                            <template v-else>
                                <Button v-if="canEditRow(data)" icon="pi pi-pencil" severity="warning" text rounded @click="editProduct(data)" />
                                <Button v-if="canDeleteRow(data)" icon="pi pi-trash" severity="danger" text rounded @click="confirmDeleteProduct(data)" />
                            </template>
                        </div>
                    </template>
                </Column>
            </DataTable>
            <!-- Dialog crear/editar -->
            <Dialog v-model:visible="productDialog" :header="product.id ? 'Editar creación' : 'Nueva creación'" :modal="true" :breakpoints="{ '1024px': '70vw', '768px': '85vw', '560px': '95vw' }" :style="{ width: '56vw', maxWidth: '980px' }">
                <div class="p-2 sm:p-3" @keydown.capture="onFormKeyCapture">
                    <div class="grid">
                        <!-- Programa -->
                        <div class="col-12 md:col-6">
                            <label class="block font-semibold mb-2">Programa <span class="text-red-500">*</span></label>
                            <div class="relative">
                                <span class="p-input-icon-right w-full">
                                    <i v-if="product.programa" class="pi pi-times cursor-pointer" @click="clearPrograma" /> <i v-else-if="loadingProgs" class="pi pi-spin pi-spinner" /> <i v-else class="pi pi-search" />
                                    <InputText
                                        v-model="programaQuery"
                                        class="w-full"
                                        placeholder="Buscar programa"
                                        :invalid="showError('programa')"
                                        autocomplete="off"
                                        @focus="openProgPanel"
                                        @input="onProgramaInput"
                                        @keydown="onProgramaKeydown"
                                        @blur="onBlur('programa')"
                                    />
                                </span>
                                <div v-if="showProgPanel" class="absolute z-5 surface-overlay border-1 border-300 border-round shadow-3 mt-2 w-full max-h-18rem overflow-auto">
                                    <div v-if="loadingProgs" class="p-3 text-sm text-color-secondary">Cargando…</div>
                                    <template v-else-if="progSugs.length">
                                        <div
                                            v-for="(item, idx) in progSugs"
                                            :key="`${item.codigoPrograma}-${idx}`"
                                            class="p-3 cursor-pointer border-bottom-1 border-100"
                                            :class="{ 'surface-100': idx === highlightedIndex }"
                                            @mousedown.prevent="selectPrograma(item)"
                                        >
                                            <div class="font-medium">{{ item.label }}</div>
                                            <small class="text-color-secondary">
                                                {{ item.facultad || '—' }} <template v-if="item.nivelAcademico"> · {{ item.nivelAcademico }}</template>
                                            </small>
                                        </div>
                                    </template>
                                    <div v-else class="p-3 text-sm text-color-secondary">Sin resultados.</div>
                                </div>
                            </div>
                            <small v-if="showError('programa')" class="text-red-500"> {{ errors.programa }} </small>
                        </div>
                        <!-- Materia -->
                        <div class="col-12 md:col-6">
                            <label class="block font-semibold mb-2">Materia <span class="text-red-500">*</span></label>
                            <div class="relative">
                                <span class="p-input-icon-right w-full">
                                    <i v-if="product.materia" class="pi pi-times cursor-pointer" @click="clearMateria" /> <i v-else-if="loadingMats" class="pi pi-spin pi-spinner" /> <i v-else class="pi pi-search" />
                                    <InputText
                                        v-model="materiaQuery"
                                        class="w-full"
                                        placeholder="Buscar materia"
                                        :disabled="!product.programa?.codigoPrograma"
                                        :invalid="showError('materia')"
                                        autocomplete="off"
                                        @focus="openMatPanel"
                                        @input="onMateriaInput"
                                        @keydown="onMateriaKeydown"
                                        @blur="onBlur('materia')"
                                    />
                                </span>
                                <div v-if="showMatPanel" class="absolute z-5 surface-overlay border-1 border-300 border-round shadow-3 mt-2 w-full max-h-18rem overflow-auto">
                                    <div v-if="loadingMats" class="p-3 text-sm text-color-secondary">Cargando…</div>
                                    <template v-else-if="matSugs.length">
                                        <div
                                            v-for="(item, idx) in matSugs"
                                            :key="`${item.codigoMateria}-${idx}`"
                                            class="p-3 cursor-pointer border-bottom-1 border-100"
                                            :class="{ 'surface-100': idx === highlightedMatIndex }"
                                            @mousedown.prevent="selectMateria(item)"
                                        >
                                            <div class="font-medium">{{ item.label }}</div>
                                        </div>
                                    </template>
                                    <div v-else class="p-3 text-sm text-color-secondary">Sin resultados.</div>
                                </div>
                            </div>
                            <small v-if="showError('materia')" class="text-red-500"> {{ errors.materia }} </small>
                        </div>
                        <!-- Nombre práctica -->
                        <div class="col-12">
                            <label class="block font-semibold mb-2">Nombre de la práctica <span class="text-red-500">*</span></label>
                            <InputText v-model="product.nombrePractica" class="w-full" maxlength="200" :invalid="showError('nombrePractica')" @blur="onBlur('nombrePractica')" />
                            <small v-if="showError('nombrePractica')" class="text-red-500"> {{ errors.nombrePractica }} </small>
                        </div>
                        <!-- Recursos -->
                        <div class="col-12">
                            <label :for="recId" class="block font-semibold mb-2"> Recursos necesarios <span class="text-red-500">*</span> </label>
                            <Textarea :id="recId" v-model="product.recursosNecesarios" rows="5" autoResize class="w-full" :invalid="showError('recursosNecesarios')" @blur="onBlur('recursosNecesarios')" />
                            <small v-if="showError('recursosNecesarios')" class="text-red-500"> {{ errors.recursosNecesarios }} </small>
                        </div>
                        <!-- Justificación -->
                        <div class="col-12">
                            <label :for="jusId" class="block font-semibold mb-2"> Justificación <span class="text-red-500">*</span> </label>
                            <Textarea :id="jusId" v-model="product.justificacion" rows="6" autoResize class="w-full" :invalid="showError('justificacion')" @blur="onBlur('justificacion')" />
                            <small v-if="showError('justificacion')" class="text-red-500"> {{ errors.justificacion }} </small>
                        </div>
                        <!-- Comentario rechazo -->
                        <div v-if="product.comentarioRechazo" class="col-12">
                            <Message severity="warn" :closable="false">
                                <div class="font-semibold mb-1">
                                    Motivo de rechazo <template v-if="product.rolRechazoLabel"> · {{ product.rolRechazoLabel }} </template>
                                </div>
                                <div>{{ product.comentarioRechazo }}</div>
                            </Message>
                        </div>
                    </div>
                </div>
                <template #footer>
                    <div class="flex justify-content-end gap-2">
                        <Button label="Cancelar" icon="pi pi-times" severity="secondary" text @click="productDialog = false" />
                        <Button :label="product.id ? 'Actualizar' : 'Guardar'" icon="pi pi-check" :loading="saving" @keydown="onSaveBtnKeydown" @click="saveProduct" />
                    </div>
                </template>
            </Dialog>
            <!-- Confirmar guardar -->
            <Dialog v-model:visible="confirmSaveDialog" header="Confirmar" :modal="true" :style="{ width: '30rem' }">
                <div class="flex align-items-start gap-3">
                    <i class="pi pi-exclamation-triangle text-yellow-500 text-2xl mt-1" />
                    <div>
                        <p class="m-0"><template v-if="pendingSaveAction === 'edit'"> La creación será actualizada y volverá al flujo de aprobación. </template> <template v-else> La creación será enviada al flujo de aprobación. </template></p>
                    </div>
                </div>
                <template #footer> <Button label="No" icon="pi pi-times" severity="secondary" text @click="closeConfirmSave" /> <Button label="Sí, continuar" icon="pi pi-check" :loading="saving" @click="confirmSave" /> </template>
            </Dialog>
            <!-- Rechazar -->
            <Dialog v-model:visible="rejectDialog" header="Rechazar creación" :modal="true" :style="{ width: '34rem' }">
                <div class="flex flex-column gap-3">
                    <div>
                        <label class="block font-semibold mb-2">Justificación <span class="text-red-500">*</span></label> <Textarea v-model="rejectJustificacion" rows="5" autoResize class="w-full" />
                        <small v-if="rejectError" class="text-red-500">{{ rejectError }}</small>
                    </div>
                </div>
                <template #footer>
                    <Button label="Cancelar" icon="pi pi-times" severity="secondary" text @click="closeRejectDialog" /> <Button label="Rechazar" icon="pi pi-times" severity="danger" :loading="rejectLoading" @click="confirmReject" />
                </template>
            </Dialog>
            <!-- Confirmar eliminar uno -->
            <Dialog v-model:visible="deleteProductDialog" header="Confirmar eliminación" :modal="true" :style="{ width: '30rem' }">
                <div class="flex align-items-start gap-3"><i class="pi pi-exclamation-triangle text-yellow-500 text-2xl mt-1" /> <span> ¿Seguro que deseas eliminar esta creación? </span></div>
                <template #footer> <Button label="No" icon="pi pi-times" severity="secondary" text @click="deleteProductDialog = false" /> <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteProduct" /> </template>
            </Dialog>
            <!-- Confirmar eliminar varios -->
            <Dialog v-model:visible="bulkDeleteDialog" header="Confirmar eliminación" :modal="true" :style="{ width: '30rem' }">
                <div class="flex align-items-start gap-3"><i class="pi pi-exclamation-triangle text-yellow-500 text-2xl mt-1" /> <span> ¿Seguro que deseas eliminar las creaciones seleccionadas? </span></div>
                <template #footer> <Button label="No" icon="pi pi-times" severity="secondary" text @click="bulkDeleteDialog = false" /> <Button label="Sí" icon="pi pi-check" severity="danger" @click="bulkDelete" /> </template>
            </Dialog>
            <!-- Detalles -->
            <Dialog v-model:visible="detailsDialog" header="Detalles" :modal="true" :breakpoints="{ '1024px': '70vw', '768px': '85vw', '560px': '95vw' }" :style="{ width: '52vw', maxWidth: '980px' }">
                <div v-if="detailsLoading" class="p-4">Cargando…</div>
                <div v-else class="p-3 sm:p-4">
                    <div v-for="d in details" :key="d.id" class="mb-4 border-1 border-200 border-round-lg p-3 sm:p-4">
                        <div class="flex flex-col sm:flex-row sm:align-items-start sm:justify-content-between gap-3">
                            <div class="min-w-0">
                                <div class="text-xs text-color-secondary mb-2">ID: {{ d.id }}</div>
                                <div class="text-lg font-semibold mb-2">{{ d.nombrePractica ?? d.nombre_practica ?? '—' }}</div>
                                <div class="grid">
                                    <div class="col-12 md:col-6">
                                        <div class="text-sm text-color-secondary">Programa</div>
                                        <div class="font-medium">{{ programaRowLabel(d) }}</div>
                                    </div>
                                    <div class="col-12 md:col-6">
                                        <div class="text-sm text-color-secondary">Materia</div>
                                        <div class="font-medium">{{ materiaRowLabel(d) }}</div>
                                    </div>
                                    <div class="col-12 md:col-6">
                                        <div class="text-sm text-color-secondary">Facultad</div>
                                        <div class="font-medium">{{ d.facultad ?? d.codigo_facultad ?? d.codigoFacultad ?? '—' }}</div>
                                    </div>
                                    <div class="col-12 md:col-6">
                                        <div class="text-sm text-color-secondary">Nivel académico</div>
                                        <div class="font-medium">{{ d.nivel_academico ?? d.nivelAcademico ?? '—' }}</div>
                                    </div>
                                </div>
                            </div>
                            <div class="shrink-0"><Tag :value="estadoLabel(d.estadoCreacion ?? d.estado_creacion)" :severity="estadoSeverity(d.estadoCreacion ?? d.estado_creacion)" /></div>
                        </div>
                        <Divider />
                        <div class="mb-3">
                            <div class="text-sm text-color-secondary mb-1">Recursos necesarios</div>
                            <div class="line-height-3 white-space-pre-line">{{ d.recursosNecesarios ?? d.recursos_necesarios ?? '—' }}</div>
                        </div>
                        <div class="mb-3">
                            <div class="text-sm text-color-secondary mb-1">Justificación</div>
                            <div class="line-height-3 white-space-pre-line">{{ d.justificacion ?? '—' }}</div>
                        </div>
                        <div v-if="d.comentarioRechazo ?? d.comentario_rechazo" class="mt-3">
                            <Message severity="warn" :closable="false">
                                <div class="font-semibold mb-1">
                                    Motivo de rechazo <template v-if="d.rolRechazoLabel ?? d.rol_rechazo_label"> · {{ d.rolRechazoLabel ?? d.rol_rechazo_label }} </template>
                                </div>
                                <div class="white-space-pre-line">{{ d.comentarioRechazo ?? d.comentario_rechazo }}</div>
                            </Message>
                        </div>
                    </div>
                </div>
            </Dialog>
        </template>
    </div>
</template>
