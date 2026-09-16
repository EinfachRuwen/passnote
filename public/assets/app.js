// Globaler Schutz vor iOS Text-Selection (nur wenn man auf dem Canvas zeichnet)
document.addEventListener('touchstart', function(e) {
    if (e.target.tagName === 'CANVAS') {
        e.preventDefault(); 
    }
}, { passive: false });

function onAction(selector, callback) {
    document.querySelectorAll(selector).forEach(function(el) {
        // Verhindere, dass der globale Touchstart-Blocker das Event frisst
        el.addEventListener('touchstart', function(e) {
            e.stopPropagation();
        }, { passive: false });
        
        el.addEventListener('pointerdown', function(e) {
            e.preventDefault();
            callback.call(el, e); // Verwende el explizit als this
        });
        
        el.addEventListener('click', function(e) {
            callback.call(el, e);
        });
    });
}

const urlParams = new URLSearchParams(window.location.search);
const roomSlug = urlParams.get('room');
let roomPass = urlParams.get('password');
let myUsername = localStorage.getItem('passnote_username') || '';
let myUserId = null;
let ws = null;
let isConnected = false;

// DOM Elements
const usernameModal = document.getElementById('username-modal');
const usernameInput = document.getElementById('username-input');
const btnJoin = document.getElementById('btn-join');
const passwordModal = document.getElementById('password-modal');
const passInput = document.getElementById('room-password');
const passError = document.getElementById('password-error');
const chatUi = document.getElementById('chat-ui');
const chatHistory = document.getElementById('chat-history');
const activeUsersList = document.getElementById('active-users-list');
const roomNameDisplay = document.getElementById('room-name-display');
const panicScreen = document.getElementById('panic-screen');

const cBoard = document.getElementById('composer-board');
const cCtx = cBoard.getContext('2d', { alpha: false });
const cOverlay = document.getElementById('composer-overlay');
const oCtx = cOverlay.getContext('2d');

let composerStrokes = [];
let erasedStrokes = new Set();
let isDrawing = false;
let currentStrokeId = null;
let currentPoints = [];
let lastSentPoint = null;
let activePointerId = null;
let activePointerType = null;

let currentColor = '#E2E8F0';
let baseWidth = 5;
let currentTool = 'pen';

if (myUsername) usernameInput.value = myUsername;

// Helpers
function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function resizeComposer() {
    const container = document.getElementById('composer-container');
    const w = container.clientWidth;
    const h = container.clientHeight;
    
    // Scale for Retina
    const dpr = window.devicePixelRatio || 1;
    cBoard.width = w * dpr;
    cBoard.height = h * dpr;
    cOverlay.width = w * dpr;
    cOverlay.height = h * dpr;
    cCtx.scale(dpr, dpr);
    oCtx.scale(dpr, dpr);
    
    cCtx.lineCap = 'round';
    cCtx.lineJoin = 'round';
    oCtx.lineCap = 'round';
    oCtx.lineJoin = 'round';
    
    redrawComposer();
}

window.addEventListener('resize', resizeComposer);

// Init
if (!roomSlug) {
    alert("Kein Raum angegeben!");
} else {
    roomNameDisplay.textContent = roomSlug;
    usernameInput.focus();
}

btnJoin.addEventListener('click', () => {
    myUsername = usernameInput.value.trim() || 'Anon';
    localStorage.setItem('passnote_username', myUsername);
    usernameModal.classList.add('hidden');
    connectWs();
});
usernameInput.addEventListener('keydown', e => {
    if(e.key === 'Enter') btnJoin.click();
});

// WebSocket Logik
function connectWs() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?room=${roomSlug}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        isConnected = true;
        sendMsg({ type: 'auth', password: roomPass || '', username: myUsername });
    };

    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        handleMessage(msg);
    };

    ws.onclose = () => {
        isConnected = false;
        setTimeout(connectWs, 3000); // Reconnect
    };
}

function sendMsg(msg) {
    if (isConnected && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'welcome':
            myUserId = msg.userId;
            passwordModal.classList.add('hidden');
            chatUi.classList.remove('hidden');
            resizeComposer();
            renderActiveUsers(msg.usersList);
            if (msg.canvas && msg.canvas.chatHistory) {
                msg.canvas.chatHistory.forEach(appendChatMessage);
            }
            break;
            
        case 'error':
            if (msg.code === 'WRONG_PASSWORD') {
                passwordModal.classList.remove('hidden');
                passError.textContent = 'Falsches Passwort!';
                passError.classList.remove('hidden');
            } else {
                alert('Fehler: ' + msg.code);
            }
            break;

        case 'active_users':
            renderActiveUsers(msg.usersList);
            break;

        case 'chat_message':
            appendChatMessage(msg);
            break;
    }
}

document.getElementById('btn-submit-password').addEventListener('click', () => {
    roomPass = passInput.value;
    connectWs();
});

function renderActiveUsers(users) {
    activeUsersList.innerHTML = '';
    users.forEach(u => {
        const el = document.createElement('div');
        el.className = 'user-bubble';
        el.style.backgroundColor = u.color;
        el.textContent = u.username.charAt(0).toUpperCase();
        el.title = u.username;
        activeUsersList.appendChild(el);
    });
}

function appendChatMessage(msg) {
    const isMe = msg.userId === myUserId;
    const wrap = document.createElement('div');
    wrap.className = `chat-message-wrap ${isMe ? 'mine' : 'theirs'}`;
    
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    
    const header = document.createElement('div');
    header.className = 'chat-author';
    header.textContent = msg.username;
    header.style.color = msg.color;
    bubble.appendChild(header);
    
    // Chat Bubble Canvas dynamisch an Fensterbreite anpassen (großes Bild!)
    const cvs = document.createElement('canvas');
    // Die Chat-Blase nimmt bis zu 80% des Bildschirms ein, max 600px
    const maxBubbleWidth = Math.min(window.innerWidth * 0.8, 600);
    const width = maxBubbleWidth;
    const height = width * (msg.aspectRatio || 0.4);
    
    cvs.width = width * 2; // Retina Auflösung
    cvs.height = height * 2;
    cvs.style.width = width + 'px';
    cvs.style.height = height + 'px';
    const ctx = cvs.getContext('2d');
    ctx.scale(2, 2);
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Draw all strokes
    if (msg.strokes) {
        msg.strokes.forEach(s => {
            drawStrokeBase(ctx, s, width, height);
        });
    }
    
    bubble.appendChild(cvs);
    
    const time = document.createElement('div');
    time.className = 'chat-time';
    const d = new Date(msg.timestamp);
    time.textContent = d.getHours() + ':' + d.getMinutes().toString().padStart(2, '0');
    bubble.appendChild(time);
    
    wrap.appendChild(bubble);
    chatHistory.appendChild(wrap);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Composer Drawing Logic
function getCoordinates(e) {
    const rect = cOverlay.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x, y, rect };
}

cOverlay.addEventListener('pointerdown', function(e) {
    if (activePointerId !== null) {
        if (e.pointerType === 'pen' && activePointerType !== 'pen') {
            if (isDrawing) {
                isDrawing = false;
                var pStroke = composerStrokes[composerStrokes.length - 1];
                if (pStroke) drawStrokeBase(cCtx, pStroke, cBoard.clientWidth, cBoard.clientHeight);
                currentPoints = [];
                currentStrokeId = null;
            }
        } else {
            return;
        }
    }

    activePointerId = e.pointerId;
    activePointerType = e.pointerType;

    const { x, y, rect } = getCoordinates(e);

    if (currentTool === 'eraser-stroke') {
        var thresholdSq = 0.0005;
        for (var i = 0; i < composerStrokes.length; i++) {
            var s = composerStrokes[i];
            if (erasedStrokes.has(s.id) || !s.points) continue;
            for (var j = 0; j < s.points.length; j++) {
                var sp = s.points[j];
                var sDx = sp.x - x;
                var sDy = sp.y - y;
                if (sDx*sDx + sDy*sDy < thresholdSq) {
                    erasedStrokes.add(s.id);
                    redrawComposer();
                    break;
                }
            }
        }
        return;
    }

    isDrawing = true;
    currentStrokeId = generateUUID();
    var pressure = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    
    var point = { x, y, p: pressure };
    currentPoints = [point];
    lastSentPoint = point;

    composerStrokes.push({
        id: currentStrokeId,
        color: currentColor,
        width: baseWidth,
        points: currentPoints
    });
});

cOverlay.addEventListener('pointermove', function(e) {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    
    const { x, y, rect } = getCoordinates(e);

    if (currentTool === 'eraser-stroke') {
        if (e.buttons > 0 || e.pointerType === 'pen') {
            var thresholdSq = 0.0005;
            for (var i = 0; i < composerStrokes.length; i++) {
                var s = composerStrokes[i];
                if (erasedStrokes.has(s.id) || !s.points) continue;
                for (var j = 0; j < s.points.length; j++) {
                    var sp = s.points[j];
                    var sDx = sp.x - x;
                    var sDy = sp.y - y;
                    if (sDx*sDx + sDy*sDy < thresholdSq) {
                        erasedStrokes.add(s.id);
                        redrawComposer();
                        break;
                    }
                }
            }
        }
    }

    if (isDrawing) {
        var dx = (x - lastSentPoint.x) * rect.width;
        var dy = (y - lastSentPoint.y) * rect.height;
        if (dx * dx + dy * dy > 4) {
            var pressure = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
            var point = { x, y, p: pressure };
            currentPoints.push(point);
            lastSentPoint = point;
        }
    }
});

function endStroke(e) {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    activePointerId = null;
    activePointerType = null;
    
    if (!isDrawing) return;
    isDrawing = false;
    
    var strokeToBake = composerStrokes[composerStrokes.length - 1];
    if (strokeToBake) {
        drawStrokeBase(cCtx, strokeToBake, cBoard.clientWidth, cBoard.clientHeight);
    }
    
    currentPoints = [];
    currentStrokeId = null;
}

cOverlay.addEventListener('pointerup', endStroke);
cOverlay.addEventListener('pointercancel', endStroke);
cOverlay.addEventListener('pointerleave', endStroke);

function renderOverlay() {
    oCtx.clearRect(0, 0, cOverlay.width, cOverlay.height);
    if (isDrawing && currentPoints.length > 0) {
        drawStrokeBase(oCtx, {
            color: currentColor,
            width: baseWidth,
            points: currentPoints
        }, cBoard.clientWidth, cBoard.clientHeight);
    }
    requestAnimationFrame(renderOverlay);
}
requestAnimationFrame(renderOverlay);

function redrawComposer() {
    cCtx.fillStyle = '#1e293b';
    cCtx.fillRect(0, 0, cBoard.width, cBoard.height);
    for (var i = 0; i < composerStrokes.length; i++) {
        var s = composerStrokes[i];
        if (!erasedStrokes.has(s.id)) drawStrokeBase(cCtx, s, cBoard.clientWidth, cBoard.clientHeight);
    }
}

function drawStrokeBase(context, stroke, w, h) {
    if (!stroke.points || stroke.points.length === 0) return;
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    
    if (stroke.points.length === 1) {
        context.beginPath();
        context.arc(stroke.points[0].x * w, stroke.points[0].y * h, (stroke.width / 2) * (stroke.points[0].p * 2), 0, Math.PI * 2);
        context.fill();
        return;
    }
    
    context.beginPath();
    context.moveTo(stroke.points[0].x * w, stroke.points[0].y * h);
    for (var j = 1; j < stroke.points.length - 1; j++) {
        var cpX = (stroke.points[j].x + stroke.points[j+1].x) / 2;
        var cpY = (stroke.points[j].y + stroke.points[j+1].y) / 2;
        context.quadraticCurveTo(stroke.points[j].x * w, stroke.points[j].y * h, cpX * w, cpY * h);
    }
    var last = stroke.points[stroke.points.length - 1];
    context.lineTo(last.x * w, last.y * h);
    
    context.lineWidth = stroke.width;
    context.stroke();
}

// UI Actions
onAction('.color-btn', function() {
    document.querySelector('.color-btn.active') && document.querySelector('.color-btn.active').classList.remove('active');
    this.classList.add('active');
    currentColor = this.dataset.color;
    currentTool = 'pen';
    updateToolUI();
});

onAction('.width-btn', function() {
    document.querySelector('.width-btn.active') && document.querySelector('.width-btn.active').classList.remove('active');
    this.classList.add('active');
    baseWidth = parseFloat(this.dataset.width);
});

onAction('.tool-btn[data-tool]', function() {
    currentTool = this.dataset.tool;
    updateToolUI();
});

function updateToolUI() {
    document.querySelector('.tool-btn.active') && document.querySelector('.tool-btn.active').classList.remove('active');
    var active = document.querySelector('.tool-btn[data-tool="' + currentTool + '"]');
    if (active) active.classList.add('active');
}

onAction('#btn-clear-composer', function() {
    composerStrokes = [];
    erasedStrokes.clear();
    redrawComposer();
});

onAction('#btn-send-chat', function() {
    const validStrokes = composerStrokes.filter(s => !erasedStrokes.has(s.id));
    if (validStrokes.length === 0) return;
    
    const container = document.getElementById('composer-container');
    const aspectRatio = container.clientHeight / container.clientWidth;
    
    sendMsg({
        type: 'chat_message',
        strokes: validStrokes,
        aspectRatio: aspectRatio
    });
    
    composerStrokes = [];
    erasedStrokes.clear();
    redrawComposer();
});

onAction('#btn-exit', function() {
    window.location.href = '/';
});

// Panic Mode (2 Finger Doppeltipp)
let lastTap = 0;
document.addEventListener('touchstart', function(e) {
    if (e.touches.length === 2) {
        const now = Date.now();
        if (now - lastTap < 500) {
            panicScreen.classList.toggle('hidden');
        }
        lastTap = now;
    }
});
