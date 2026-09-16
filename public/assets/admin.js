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

loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    // Simulate login for frontend only
    // In reality this would fetch /api/admin/login
    token = 'mock_token_' + passInput.value;
    sessionStorage.setItem('admin_token', token);
    showDashboard();
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
    setInterval(loadRooms, 10000);
}

async function loadRooms() {
    if (!token) return;
    
    // Mock data for frontend demonstration
    const rooms = [
        { slug: 'violet-hawk-42', name: 'Mathe Klasse 9', type: 'permanent', users: 12, lastActivity: 'Vor 2 Min', created: 'Gestern' },
        { slug: 'blue-bear-11', name: '', type: 'temporary', users: 0, lastActivity: 'Vor 2 Std', created: 'Vor 2 Std' }
    ];
    
    renderRooms(rooms);
    /* In reality:
    try {
        const res = await fetch('/api/admin/rooms', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        renderRooms(data.rooms);
    } catch(e) {
        console.error(e);
    }
    */
}

function renderRooms(rooms) {
    const tbody = document.getElementById('rooms-tbody');
    tbody.innerHTML = '';
    
    rooms.forEach(room => {
        const tr = document.createElement('tr');
        
        tr.innerHTML = `
            <td>
                <strong>${room.name || '-'}</strong><br>
                <small class="text-gray">${room.slug}</small>
            </td>
            <td><span class="badge ${room.type}">${room.type}</span></td>
            <td>${room.users}</td>
            <td>${room.lastActivity}</td>
            <td>${room.created}</td>
            <td class="action-btns">
                <button class="btn-icon" title="QR Code" onclick="showQr('${room.slug}')">📱</button>
                <button class="btn-icon" title="Clear Board" onclick="clearRoom('${room.slug}')">🧹</button>
                <button class="btn-icon" title="Löschen" onclick="deleteRoom('${room.slug}')">🗑</button>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
}

function showQr(slug) {
    alert('Zeige QR für ' + slug);
}

function clearRoom(slug) {
    if(confirm('Canvas wirklich leeren?')) {
        alert('Cleared: ' + slug);
    }
}

function deleteRoom(slug) {
    if(confirm('Raum wirklich löschen?')) {
        alert('Deleted: ' + slug);
    }
}

document.getElementById('create-room-form').addEventListener('submit', (e) => {
    e.preventDefault();
    alert('Raum wird erstellt...');
});
