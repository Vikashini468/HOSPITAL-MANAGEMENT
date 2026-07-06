"use strict";

let roomPatients = [];
let roomRefreshTimer = null;

/* ==========================================================
   INITIALIZE
========================================================== */

async function initializeRoom() {

    try {

        await loadRoomData();

        initRoomSearch();
        initRoomFilters();
        initRoomSocketEvents();
        startRoomAutoRefresh();

        document.getElementById("refreshRoomsBtn")
            ?.addEventListener("click", loadRoomData);

    } catch (err) {

        console.error("Room init error:", err);
        showAlert("Unable to load room allocation.", "error");

    }

}

/* ==========================================================
   LOAD DATA
========================================================== */

async function loadRoomData() {

    const tbody = document.getElementById("roomTableBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="9" class="text-center">Loading...</td></tr>`;

    try {

        roomPatients = await api.get("/patients");
        renderRoomTable(roomPatients);
        updateRoomSummary();

    } catch (err) {

        console.error(err);
        tbody.innerHTML = `<tr><td colspan="9" class="text-center">Failed to load data.</td></tr>`;

    }

}

/* ==========================================================
   RENDER TABLE
========================================================== */

function renderRoomTable(data) {

    const tbody = document.getElementById("roomTableBody");
    if (!tbody) return;

    if (!data.length) {

        tbody.innerHTML = `<tr><td colspan="9" class="text-center">No room allocations found.</td></tr>`;
        return;

    }

    tbody.innerHTML = "";

    data.forEach(p => {

        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${p.id}</td>
            <td><strong>${p.patient_name}</strong></td>
            <td>${p.ward || "-"}</td>
            <td>${p.room_no || "-"}</td>
            <td>${p.bed_no || "-"}</td>
            <td>${p.doctor_name || "-"}</td>
            <td><span class="badge blue">${p.admission_type || "-"}</span></td>
            <td>${p.status === "Discharged"
                ? `<span class="status discharged">Discharged</span>`
                : `<span class="status admitted">Admitted</span>`}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-primary btn-sm" onclick="openTransferRoomModal(${p.id})">
                        <i class="fa-solid fa-right-left"></i>
                    </button>
                    <button class="btn btn-warning btn-sm" onclick="openChangeRoomModal(${p.id}, '${p.ward}', '${p.room_no}', '${p.bed_no}')">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="openReleaseModal(${p.id})">
                        <i class="fa-solid fa-bed"></i>
                    </button>
                </div>
            </td>
        `;

        tbody.appendChild(tr);

    });

}

/* ==========================================================
   SUMMARY CARDS
========================================================== */

function updateRoomSummary() {

    const total = 100;
    const occupied = roomPatients.filter(p => p.status === "Admitted").length;
    const available = total - occupied;
    const icu = roomPatients.filter(p => p.admission_type === "ICU" && p.status === "Admitted").length;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    set("totalBeds", total);
    set("availableBeds", available);
    set("occupiedBeds", occupied);
    set("icuBeds", icu);

}

/* ==========================================================
   SEARCH & FILTER
========================================================== */

function initRoomSearch() {

    document.getElementById("roomSearch")?.addEventListener("keyup", applyRoomFilters);

}

function initRoomFilters() {

    document.getElementById("wardFilter")?.addEventListener("change", applyRoomFilters);
    document.getElementById("bedStatusFilter")?.addEventListener("change", applyRoomFilters);

}

function applyRoomFilters() {

    const keyword = (document.getElementById("roomSearch")?.value || "").toLowerCase();
    const ward    = document.getElementById("wardFilter")?.value || "";
    const status  = document.getElementById("bedStatusFilter")?.value || "";

    const filtered = roomPatients.filter(p => {

        const matchKeyword = !keyword ||
            p.patient_name.toLowerCase().includes(keyword) ||
            (p.ward || "").toLowerCase().includes(keyword) ||
            (p.room_no || "").toLowerCase().includes(keyword) ||
            (p.doctor_name || "").toLowerCase().includes(keyword);

        const matchWard = !ward || p.ward === ward;

        const matchStatus = !status ||
            (status === "Occupied" && p.status === "Admitted") ||
            (status === "Available" && p.status !== "Admitted");

        return matchKeyword && matchWard && matchStatus;

    });

    renderRoomTable(filtered);

}

/* ==========================================================
   TRANSFER MODAL
========================================================== */

function openTransferRoomModal(patientId) {

    document.getElementById("transferPatientId").value = patientId;
    document.getElementById("transferWard").value = "";
    document.getElementById("transferRoom").value = "";
    document.getElementById("transferBed").value = "";
    document.getElementById("transferRoomModal").classList.add("show");

}

function closeTransferModal() {

    document.getElementById("transferRoomModal")?.classList.remove("show");

}

async function transferPatientRoom() {

    const patient_id = document.getElementById("transferPatientId").value;
    const ward       = document.getElementById("transferWard").value;
    const room_no    = document.getElementById("transferRoom").value.trim();
    const bed_no     = document.getElementById("transferBed").value.trim();

    if (!ward || !room_no || !bed_no) {
        showAlert("Please fill all transfer fields.", "warning");
        return;
    }

    try {

        const res = await api.put("/assign-room", { patient_id, ward, room_no, bed_no });
        if (!res.success) throw new Error(res.message);
        showAlert("Patient transferred successfully.", "success");
        closeTransferModal();
        await loadRoomData();

    } catch (err) {

        console.error(err);
        showAlert(err.message || "Transfer failed.", "error");

    }

}

/* ==========================================================
   CHANGE ROOM MODAL
========================================================== */

function openChangeRoomModal(patientId, ward, room, bed) {

    document.getElementById("changePatientId").value = patientId;
    document.getElementById("changeWard").value = ward || "";
    document.getElementById("changeRoomNo").value = room || "";
    document.getElementById("changeBedNo").value = bed || "";
    document.getElementById("changeRoomModal").classList.add("show");

}

function closeChangeRoomModal() {

    document.getElementById("changeRoomModal")?.classList.remove("show");

}

async function changePatientRoom() {

    const patient_id = document.getElementById("changePatientId").value;
    const ward       = document.getElementById("changeWard").value;
    const room_no    = document.getElementById("changeRoomNo").value.trim();
    const bed_no     = document.getElementById("changeBedNo").value.trim();

    if (!ward || !room_no || !bed_no) {
        showAlert("Please fill all fields.", "warning");
        return;
    }

    try {

        const res = await api.put("/assign-room", { patient_id, ward, room_no, bed_no });
        if (!res.success) throw new Error(res.message);
        showAlert("Room updated successfully.", "success");
        closeChangeRoomModal();
        await loadRoomData();

    } catch (err) {

        console.error(err);
        showAlert(err.message || "Update failed.", "error");

    }

}

/* ==========================================================
   RELEASE BED MODAL
========================================================== */

function openReleaseModal(patientId) {

    document.getElementById("releasePatientId").value = patientId;
    document.getElementById("releaseBedModal").classList.add("show");

}

function closeReleaseModal() {

    document.getElementById("releaseBedModal")?.classList.remove("show");

}

async function releaseBed() {

    const patient_id = document.getElementById("releasePatientId").value;

    try {

        const res = await api.put("/assign-room", { patient_id, ward: "-", room_no: "-", bed_no: "-" });
        if (!res.success) throw new Error(res.message);
        showAlert("Bed released successfully.", "success");
        closeReleaseModal();
        await loadRoomData();

    } catch (err) {

        console.error(err);
        showAlert(err.message || "Release failed.", "error");

    }

}

/* ==========================================================
   SOCKET EVENTS
========================================================== */

function initRoomSocketEvents() {

    if (typeof socket === "undefined" || !socket) return;

    socket.on("patientAdmitted", loadRoomData);
    socket.on("roomChanged", loadRoomData);
    socket.on("patientDischarged", loadRoomData);

}

/* ==========================================================
   AUTO REFRESH
========================================================== */

function startRoomAutoRefresh() {

    if (roomRefreshTimer) clearInterval(roomRefreshTimer);
    roomRefreshTimer = setInterval(loadRoomData, 30000);

}

/* ==========================================================
   EXPORTS
========================================================== */

window.initializeRoom        = initializeRoom;
window.loadRoomData          = loadRoomData;
window.openTransferRoomModal = openTransferRoomModal;
window.closeTransferModal    = closeTransferModal;
window.transferPatientRoom   = transferPatientRoom;
window.openChangeRoomModal   = openChangeRoomModal;
window.closeChangeRoomModal  = closeChangeRoomModal;
window.changePatientRoom     = changePatientRoom;
window.openReleaseModal      = openReleaseModal;
window.closeReleaseModal     = closeReleaseModal;
window.releaseBed            = releaseBed;
