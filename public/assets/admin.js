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

window.loadRooms = async function() {
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
    
    let totalActiveUsers = 0;
    
    rooms.forEach(room => {
        totalActiveUsers += room.activeUsers || 0;
        
        const tr = document.createElement('tr');
        
        const createdDate = new Date(room.created_at).toLocaleDateString('de-DE');
        const lastActivityDate = new Date(room.last_active_at).toLocaleString('de-DE', { hour: '2-digit', minute:'2-digit', day:'2-digit', month:'2-digit' });
        
        tr.innerHTML = `
            <td class="room-name-cell">
                <strong>${room.name || 'Ohne Name'}</strong>
                <small>${room.slug}</small>
            </td>
            <td><span class="badge ${room.type}">${room.type === 'permanent' ? 'Permanent' : 'Temporär'}</span></td>
            <td><strong>${room.activeUsers}</strong> / ${room.max_users}</td>
            <td>${lastActivityDate}</td>
            <td class="modern-action-btns">
                <button class="action-btn qr" title="QR Code anzeigen" onclick="showQr('${room.slug}')">📱</button>
                <button class="action-btn" title="Board leeren" onclick="clearRoom('${room.id}')">🧹</button>
                <button class="action-btn delete" title="Raum löschen" onclick="deleteRoom('${room.id}')">🗑</button>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
    
    document.getElementById('stat-total').textContent = rooms.length;
    document.getElementById('stat-active').textContent = totalActiveUsers;
}

window.clearRoom = async function(id) {
    if(confirm('Möchtest du dieses Board wirklich komplett leeren? (Dies kann nicht rückgängig gemacht werden)')) {
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
    if(confirm('Möchtest du diesen Raum wirklich löschen? Alle Nutzer werden rausgeworfen.')) {
        try {
            const res = await fetch(`/api/admin/rooms/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Delete failed');
            loadRooms();
        } catch(e) {
            alert('Fehler beim Löschen des Raumes.');
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
        title.textContent = 'Beitreten: ' + slug;
        modal.classList.remove('hidden');
    } catch(e) {
        alert('QR Code konnte nicht geladen werden');
    }
}

document.getElementById('admin-close-qr')?.addEventListener('click', () => {
    document.getElementById('admin-qr-modal').classList.add('hidden');
});
