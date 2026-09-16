const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginForm = document.getElementById('admin-login-form');
const passInput = document.getElementById('admin-password');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');

let token = sessionStorage.getItem('admin_token');

if (token) {
    showDashboard();
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: passInput.value })
        });
        
        if (!res.ok) {
            loginError.classList.remove('hidden');
            return;
        }
        
        const data = await res.json();
        token = data.token;
        sessionStorage.setItem('admin_token', token);
        loginError.classList.add('hidden');
        showDashboard();
    } catch (err) {
        console.error(err);
        loginError.classList.remove('hidden');
    }
});

logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem('admin_token');
    token = null;
    loginView.classList.remove('hidden');
    dashboardView.classList.add('hidden');
});

function showDashboard() {
    loginView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    loadRooms();
    if (!window.pollInterval) {
        window.pollInterval = setInterval(loadRooms, 10000);
    }
}

async function loadRooms() {
    if (!token) return;
    
    try {
        const res = await fetch('/api/admin/rooms', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.status === 401) {
            logoutBtn.click();
            return;
        }
        
        const data = await res.json();
        renderRooms(data);
    } catch(e) {
        console.error(e);
    }
}

function renderRooms(rooms) {
    const tbody = document.getElementById('rooms-tbody');
    tbody.innerHTML = '';
    
    rooms.forEach(room => {
        const tr = document.createElement('tr');
        
        const createdDate = new Date(room.created_at).toLocaleString();
        const lastActivityDate = new Date(room.last_active_at).toLocaleString();
        
        tr.innerHTML = `
            <td>
                <strong>${room.name || '-'}</strong><br>
                <small class="text-gray">${room.slug}</small>
            </td>
            <td><span class="badge ${room.type}">${room.type}</span></td>
            <td>${room.activeUsers}</td>
            <td>${lastActivityDate}</td>
            <td>${createdDate}</td>
            <td class="action-btns">
                <button class="btn-icon" title="Clear Board" onclick="clearRoom('${room.id}')">🧹</button>
                <button class="btn-icon" title="Löschen" onclick="deleteRoom('${room.id}')">🗑</button>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
}

window.clearRoom = async function(id) {
    if(confirm('Canvas wirklich leeren?')) {
        try {
            await fetch(`/api/admin/rooms/${id}/clear`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            loadRooms();
        } catch(e) {
            alert('Fehler beim Leeren');
        }
    }
}

window.deleteRoom = async function(id) {
    if(confirm('Raum wirklich löschen?')) {
        try {
            await fetch(`/api/admin/rooms/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            loadRooms();
        } catch(e) {
            alert('Fehler beim Löschen');
        }
    }
}

document.getElementById('create-room-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    
    const payload = {
        slug: formData.get('slug') || undefined,
        name: formData.get('name') || undefined,
        type: formData.get('type'),
        password: formData.get('password') || undefined,
        maxUsers: formData.get('maxUsers') ? parseInt(formData.get('maxUsers')) : undefined
    };
    
    try {
        const res = await fetch('/api/admin/rooms', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
            const err = await res.json();
            alert('Fehler: ' + (err.error || 'Unbekannt'));
            return;
        }
        
        e.target.reset();
        loadRooms();
    } catch (err) {
        alert('Konnte Raum nicht erstellen');
    }
});

window.showQr = async function(slug) {
    try {
        const res = await fetch(`/api/rooms/${slug}/qr`);
        if (!res.ok) throw new Error();
        const svg = await res.text();
        const modal = document.getElementById('admin-qr-modal');
        const container = document.getElementById('admin-qr-container');
        const title = document.getElementById('admin-qr-title');
        
        container.innerHTML = svg;
        title.textContent = 'QR Code für ' + slug;
        modal.classList.remove('hidden');
    } catch(e) {
        alert('QR Code konnte nicht geladen werden');
    }
}

document.getElementById('admin-close-qr')?.addEventListener('click', () => {
    document.getElementById('admin-qr-modal').classList.add('hidden');
});
