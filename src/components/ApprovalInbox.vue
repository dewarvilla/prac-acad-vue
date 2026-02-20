<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useToast } from 'primevue/usetoast';
import { api, ensureCsrf } from '@/api';

const toast = useToast();

const items = ref([]);
const loading = ref(false);

const page = ref(1);
const rows = ref(10);
const total = ref(0);

const search = ref('');
const sortField = ref('created_at');
const sortOrder = ref(-1);

const sortParam = computed(() => {
    if (!sortField.value) return undefined;
    return `${sortOrder.value === -1 ? '-' : ''}${sortField.value}`;
});

function buildParams() {
    const params = { per_page: +rows.value || 10, page: +page.value || 1 };
    if (sortParam.value) params.sort = sortParam.value;

    const q = String(search.value || '').trim();
    if (q.length >= 2) params.q = q;
    return params;
}

function normalizeInboxRow(r) {
    const ar = r.approval_request ?? r.approvalRequest ?? r;

    return {
        approvalRequestId: ar.id ?? r.approval_request_id ?? r.id,
        status: ar.status ?? r.status ?? 'pending',
        created_at: ar.created_at ?? r.created_at ?? null,

        nombrePractica: r.nombrePractica ?? r.nombre_practica ?? ar.subject ?? ar.title ?? r.title ?? 'Solicitud',

        programaAcademico: r.programaAcademico ?? r.programa_academico ?? r.programa ?? '',

        canApprove: r.can_approve ?? r.canApprove ?? true,
        canReject: r.can_reject ?? r.canReject ?? true
    };
}

async function fetchInbox() {
    loading.value = true;
    try {
        const { data } = await api.get('/approvals/inbox', { params: buildParams() });

        const list = Array.isArray(data) ? data : (data.data ?? []);
        items.value = list.map(normalizeInboxRow);

        total.value = Number(data.meta?.total ?? items.value.length);
        if (data.meta?.current_page) page.value = Number(data.meta.current_page);
        if (data.meta?.per_page) rows.value = Number(data.meta.per_page);
    } catch (e) {
        toast.add({
            severity: 'error',
            summary: 'Error al cargar bandeja',
            detail: e?.response?.data?.message || e.message,
            life: 6000
        });
        items.value = [];
        total.value = 0;
    } finally {
        loading.value = false;
    }
}

function onPage(e) {
    page.value = Number(e.page) + 1;
    rows.value = Number(e.rows);
    fetchInbox();
}
function onSort(e) {
    sortField.value = e.sortField;
    sortOrder.value = e.sortOrder;
    page.value = 1;
    fetchInbox();
}
watch(search, () => {
    page.value = 1;
    fetchInbox();
});

// ===== Aprobar / Rechazar =====
const approveLoading = ref(false);

const rejectDialog = ref(false);
const rejectLoading = ref(false);
const rejectTarget = ref(null);
const rejectJustificacion = ref('');
const rejectError = ref('');

async function approveRow(row) {
    if (!row?.approvalRequestId) return;

    try {
        approveLoading.value = true;
        await ensureCsrf();
        await api.post(`/approval-requests/${row.approvalRequestId}/approve`);

        toast.add({ severity: 'success', summary: 'Aprobado', life: 2500 });
        await fetchInbox();
    } catch (e) {
        toast.add({
            severity: 'error',
            summary: 'No se pudo aprobar',
            detail: e?.response?.data?.message || e.message,
            life: 6000
        });
    } finally {
        approveLoading.value = false;
    }
}

function openReject(row) {
    rejectTarget.value = row;
    rejectJustificacion.value = '';
    rejectError.value = '';
    rejectDialog.value = true;
}

async function confirmReject() {
    if (!rejectJustificacion.value || rejectJustificacion.value.trim().length < 5) {
        rejectError.value = 'La justificación debe tener mínimo 5 caracteres.';
        return;
    }

    try {
        rejectLoading.value = true;
        await ensureCsrf();
        await api.post(`/approval-requests/${rejectTarget.value.approvalRequestId}/reject`, {
            comment: rejectJustificacion.value.trim()
        });

        toast.add({ severity: 'success', summary: 'Rechazado', life: 2500 });
        rejectDialog.value = false;
        await fetchInbox();
    } catch (e) {
        rejectError.value = e?.response?.data?.message || e.message;
    } finally {
        rejectLoading.value = false;
    }
}

onMounted(fetchInbox);
</script>

<template>
    <div class="card">
        <div class="flex items-center justify-between mb-3 gap-3">
            <div class="font-semibold">Bandeja de aprobaciones</div>

            <div class="w-full sm:w-80">
                <InputText v-model.trim="search" placeholder="Buscar…" class="w-full" />
            </div>
        </div>

        <DataTable
            :value="items"
            dataKey="approvalRequestId"
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
            emptyMessage="No hay solicitudes pendientes"
        >
            <Column field="approvalRequestId" header="Id" sortable style="width: 6rem" />
            <Column field="nombrePractica" header="Solicitud" sortable style="min-width: 18rem" />
            <Column field="programaAcademico" header="Programa" sortable style="min-width: 16rem" />
            <Column field="status" header="Estado" sortable style="width: 10rem" />

            <Column header="Acciones" style="width: 10rem">
                <template #body="{ data }">
                    <Button v-if="data.canApprove && data.status === 'pending'" icon="pi pi-check" rounded text severity="success" class="mr-1" :disabled="approveLoading || rejectLoading" @click.stop="approveRow(data)" />
                    <Button v-if="data.canReject && data.status === 'pending'" icon="pi pi-times" rounded text severity="warning" :disabled="approveLoading || rejectLoading" @click.stop="openReject(data)" />
                </template>
            </Column>
        </DataTable>

        <Dialog v-model:visible="rejectDialog" header="Rechazar" :style="{ width: '30rem' }" :modal="true">
            <div class="flex flex-col gap-2">
                <div class="text-sm">
                    Vas a rechazar:
                    <b>{{ rejectTarget?.nombrePractica }}</b>
                </div>

                <label class="font-medium" for="rej">Justificación</label>
                <Textarea id="rej" v-model.trim="rejectJustificacion" rows="4" autoResize :class="{ 'p-invalid': !!rejectError }" />
                <small v-if="rejectError" class="text-red-500">{{ rejectError }}</small>
            </div>

            <template #footer>
                <Button label="Cancelar" icon="pi pi-times" text :disabled="rejectLoading" @click="rejectDialog = false" />
                <Button label="Rechazar" icon="pi pi-check" severity="danger" :loading="rejectLoading" :disabled="rejectLoading" @click="confirmReject" />
            </template>
        </Dialog>
    </div>
</template>
