// --- DOM ---
const board = document.getElementById('board');
const overlay = document.getElementById('overlay');
const ctx = board.getContext('2d');
const oCtx = overlay.getContext('2d');
const toolbar = document.getElementById('toolbar');
const statusInd = document.getElementById('status');
const userCountEl = document.getElementById('user-count');
const qrModal = document.getElementById('qr-modal');
const textInput = document.getElementById('text-input');

// --- URL Params ---
const urlParams = new URLSearchParams(window.location.search);
const roomSlug = urlParams.get('room');
const roomPass = urlParams.get('password');
if (!roomSlug) window.location.href = '/';

// --- State ---
let ws;
let isConnected = false;
let myColor = '#1A1A2E';
let myUserId = null;

let currentTool = 'pen';
let currentColor = '#1A1A2E';
let baseWidth = 3;

let isDrawing = false;
let currentStrokeId = null;
let currentPoints = [];
let lastSentPoint = null;
let lastCursorSent = 0;

const localStrokes = [];
const erasedStrokes = new Set();
let myStrokeStack = [];
const remoteStrokes = new Map();
const remoteCursors = new Map();
let activeTextState = null;

// --- Helpers ---
function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// --- Canvas resize ---
function resize() {
    board.width = window.innerWidth;
    board.height = window.innerHeight;
    overlay.width = window.innerWidth;
    overlay.height = window.innerHeight;
    redrawBoard();
}
window.addEventListener('resize', resize);
resize();

// --- Draw Logic ---
function drawStroke(context, stroke) {
    if (stroke.tool === 'text' && stroke.text) {
        context.save();
        context.font = (stroke.fontSize || 24) + 'px sans-serif';
        context.fillStyle = stroke.color;
        context.textBaseline = 'top';
        context.globalCompositeOperation = 'source-over';
        var lines = stroke.text.split('\n');
        var lineHeight = (stroke.fontSize || 24) * 1.3;
        lines.forEach(function(line, i) {
            context.fillText(line, stroke.x * board.width, stroke.y * board.height + i * lineHeight);
        });
        context.restore();
        return;
    }

    if (!stroke.points || stroke.points.length === 0) return;

    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';

    if (stroke.tool === 'eraser') {
        context.globalCompositeOperation = 'destination-out';
        context.strokeStyle = 'rgba(0,0,0,1)';
        context.lineWidth = (stroke.width || 3) * 3;
    } else {
        context.globalCompositeOperation = 'source-over';
        context.strokeStyle = stroke.color || '#000';
        context.lineWidth = stroke.width || 3;
    }

    context.beginPath();
    context.moveTo(stroke.points[0].x * board.width, stroke.points[0].y * board.height);

    if (stroke.points.length === 1) {
        context.lineTo(stroke.points[0].x * board.width + 0.1, stroke.points[0].y * board.height);
    } else {
        for (var i = 1; i < stroke.points.length - 1; i++) {
            var p1 = stroke.points[i];
            var p2 = stroke.points[i + 1];
            var midX = (p1.x + p2.x) / 2;
            var midY = (p1.y + p2.y) / 2;
            context.quadraticCurveTo(
                p1.x * board.width, p1.y * board.height,
                midX * board.width, midY * board.height
            );
        }
        var last = stroke.points[stroke.points.length - 1];
        context.lineTo(last.x * board.width, last.y * board.height);
    }
    context.stroke();
    context.restore();
}

function redrawBoard() {
    ctx.clearRect(0, 0, board.width, board.height);
    for (var i = 0; i < localStrokes.length; i++) {
        var s = localStrokes[i];
        if (!erasedStrokes.has(s.id)) drawStroke(ctx, s);
    }
}

// --- Overlay Render Loop ---
function renderOverlay() {
    oCtx.clearRect(0, 0, overlay.width, overlay.height);
    var now = Date.now();

    remoteStrokes.forEach(function(stroke) { drawStroke(oCtx, stroke); });

    if (isDrawing && currentPoints.length > 0) {
        drawStroke(oCtx, { color: currentColor, width: baseWidth, tool: currentTool, points: currentPoints });
    }

    remoteCursors.forEach(function(cursor, id) {
        if (now - cursor.timestamp > 3000) { remoteCursors.delete(id); return; }
        cursor.currX += (cursor.targetX - cursor.currX) * 0.3;
        cursor.currY += (cursor.targetY - cursor.currY) * 0.3;
        var px = cursor.currX * overlay.width;
        var py = cursor.currY * overlay.height;
        oCtx.save();
        if (cursor.type === 'laser') {
            oCtx.beginPath();
            oCtx.arc(px, py, 5, 0, Math.PI * 2);
            oCtx.fillStyle = 'red';
            oCtx.shadowColor = 'red';
            oCtx.shadowBlur = 12;
            oCtx.fill();
        } else {
            oCtx.beginPath();
            oCtx.arc(px, py, 6, 0, Math.PI * 2);
            oCtx.fillStyle = cursor.color || '#000';
            oCtx.fill();
            oCtx.strokeStyle = '#fff';
            oCtx.lineWidth = 2;
            oCtx.stroke();
        }
        oCtx.restore();
    });

    requestAnimationFrame(renderOverlay);
}
requestAnimationFrame(renderOverlay);

// --- Text Tool ---
function finalizeText() {
    if (!activeTextState) return;
    var text = textInput.value.trim();
    if (text) {
        var strokeId = activeTextState.id;
        var fontSize = baseWidth * 8;
        var strokeObj = {
            id: strokeId, userId: myUserId, color: currentColor,
            width: baseWidth, tool: 'text', text: text,
            x: activeTextState.x, y: activeTextState.y, fontSize: fontSize, points: []
        };
        localStrokes.push(strokeObj);
        myStrokeStack.push(strokeId);
        redrawBoard();
        sendMsg({ type: 'stroke_start', id: strokeId, color: currentColor,
            width: baseWidth, tool: 'text', text: text,
            x: activeTextState.x, y: activeTextState.y, fontSize: fontSize });
    }
    textInput.value = '';
    textInput.classList.remove('active');
    activeTextState = null;
}
textInput.addEventListener('blur', finalizeText);
textInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finalizeText(); }
});

// --- Pointer Events auf OVERLAY ---
overlay.style.cursor = 'crosshair';
overlay.style.touchAction = 'none';

overlay.addEventListener('pointerdown', function(e) {
    e.preventDefault();

    if (activeTextState) { finalizeText(); return; }

    var rect = overlay.getBoundingClientRect();
    var clientX = e.clientX - rect.left;
    var clientY = e.clientY - rect.top;

    if (currentTool === 'text') {
        var x = clientX / rect.width;
        var y = clientY / rect.height;
        var fontSize = baseWidth * 8;
        activeTextState = { x: x, y: y, id: generateUUID() };
        textInput.style.left = clientX + 'px';
        textInput.style.top = clientY + 'px';
        textInput.style.color = currentColor;
        textInput.style.fontSize = fontSize + 'px';
        textInput.classList.add('active');
        setTimeout(function() { textInput.focus(); }, 10);
        return;
    }

    isDrawing = true;
    currentStrokeId = generateUUID();
    myStrokeStack.push(currentStrokeId);

    var actualTool = currentTool;
    if (e.buttons === 32) actualTool = 'eraser';

    var pressure = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    var actualWidth = baseWidth * (0.5 + pressure);

    var point = { x: clientX / rect.width, y: clientY / rect.height, p: pressure };
    currentPoints = [point];
    lastSentPoint = point;

    sendMsg({ type: 'stroke_start', id: currentStrokeId, color: currentColor, width: actualWidth, tool: actualTool });
    localStrokes.push({ id: currentStrokeId, color: currentColor, width: actualWidth, tool: actualTool, points: currentPoints });
    showToolbar();
});

overlay.addEventListener('pointermove', function(e) {
    e.preventDefault();
    var rect = overlay.getBoundingClientRect();
    var clientX = e.clientX - rect.left;
    var clientY = e.clientY - rect.top;
    var x = clientX / rect.width;
    var y = clientY / rect.height;

    if (isDrawing) {
        var dx = (x - lastSentPoint.x) * rect.width;
        var dy = (y - lastSentPoint.y) * rect.height;
        
        // Nur Punkte hinzufügen und senden, wenn sich der Stift min. 2 Pixel bewegt hat (verhindert stottern!)
        if (dx * dx + dy * dy > 4) {
            var pressure = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
            var point = { x: x, y: y, p: pressure };
            currentPoints.push(point);
            sendMsg({ type: 'stroke_point', id: currentStrokeId, x: x, y: y, p: pressure });
            lastSentPoint = point;
        }
    } else {
        var now = Date.now();
        if (now - lastCursorSent > 50) {
            lastCursorSent = now;
            sendMsg({ type: currentTool === 'laser' ? 'laser' : 'cursor', x: x, y: y });
        }
    }
    showToolbar();
});

function endStroke() {
    if (!isDrawing) return;
    isDrawing = false;
    sendMsg({ type: 'stroke_end', id: currentStrokeId });
    redrawBoard();
    currentPoints = [];
    currentStrokeId = null;
}
overlay.addEventListener('pointerup', endStroke);
overlay.addEventListener('pointercancel', endStroke);
overlay.addEventListener('pointerleave', endStroke);

// --- WebSocket ---
var reconnectDelay = 2000;

function connectWS() {
    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = protocol + '//' + window.location.host + '/ws?room=' + encodeURIComponent(roomSlug);
    ws = new WebSocket(wsUrl);

    ws.onopen = function() {
        statusInd.className = 'status-indicator connected';
        isConnected = true;
        reconnectDelay = 2000;
        var authMsg = { type: 'auth' };
        if (roomPass) authMsg.password = roomPass;
        sendMsg(authMsg);
    };

    ws.onmessage = function(e) { handleWSMsg(JSON.parse(e.data)); };

    ws.onclose = function() {
        statusInd.className = 'status-indicator offline';
        isConnected = false;
        setTimeout(connectWS, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    };
}
connectWS();

function sendMsg(msg) {
    if (isConnected && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

setInterval(function() { sendMsg({ type: 'ping' }); }, 25000);

function handleWSMsg(msg) {
    switch (msg.type) {
        case 'welcome':
            myUserId = msg.userId;
            myColor = msg.color;
            userCountEl.textContent = msg.users;
            if (msg.canvas) {
                if (msg.canvas.strokes) localStrokes.push.apply(localStrokes, msg.canvas.strokes);
                if (msg.canvas.erased) msg.canvas.erased.forEach(function(id) { erasedStrokes.add(id); });
                redrawBoard();
            }
            break;
        case 'error':
            alert('Fehler: ' + msg.code);
            window.location.href = '/';
            break;
        case 'user_joined':
        case 'user_left':
            userCountEl.textContent = msg.users;
            break;
        case 'stroke_start':
            if (msg.tool === 'text') {
                localStrokes.push({ id: msg.id, color: msg.color, width: msg.width, tool: 'text',
                    text: msg.text, x: msg.x, y: msg.y, fontSize: msg.fontSize, points: [] });
                redrawBoard();
            } else {
                remoteStrokes.set(msg.id, { color: msg.color, width: msg.width, tool: msg.tool, points: [] });
            }
            break;
        case 'stroke_point':
            if (remoteStrokes.has(msg.id)) remoteStrokes.get(msg.id).points.push({ x: msg.x, y: msg.y });
            break;
        case 'stroke_end':
            if (remoteStrokes.has(msg.id)) {
                var stroke = remoteStrokes.get(msg.id);
                stroke.id = msg.id;
                localStrokes.push(stroke);
                remoteStrokes.delete(msg.id);
                redrawBoard();
            }
            break;
        case 'cursor':
        case 'laser':
            if (msg.userId === myUserId) break;
            if (!remoteCursors.has(msg.userId)) {
                remoteCursors.set(msg.userId, { currX: msg.x, currY: msg.y, targetX: msg.x, targetY: msg.y, timestamp: Date.now() });
            }
            var c = remoteCursors.get(msg.userId);
            c.targetX = msg.x; c.targetY = msg.y;
            c.type = msg.type; c.timestamp = Date.now();
            c.color = msg.color || '#000';
            break;
        case 'undo':
            erasedStrokes.add(msg.strokeId);
            redrawBoard();
            break;
        case 'clear':
            localStrokes.length = 0;
            erasedStrokes.clear();
            remoteStrokes.clear();
            redrawBoard();
            break;
    }
}

// --- UI ---
var hideTimeout;
function showToolbar() {
    toolbar.classList.remove('hidden-bar');
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(function() { toolbar.classList.add('hidden-bar'); }, 4000);
}
document.addEventListener('pointermove', function(e) { if (e.clientY < 100) showToolbar(); });
showToolbar();

document.querySelectorAll('.color-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        document.querySelector('.color-btn.active') && document.querySelector('.color-btn.active').classList.remove('active');
        btn.classList.add('active');
        currentColor = btn.dataset.color;
        currentTool = 'pen';
        updateToolUI();
        showToolbar();
    });
});

document.querySelectorAll('.width-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        document.querySelector('.width-btn.active') && document.querySelector('.width-btn.active').classList.remove('active');
        btn.classList.add('active');
        baseWidth = parseFloat(btn.dataset.width);
        showToolbar();
    });
});

document.querySelectorAll('.tool-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        currentTool = btn.dataset.tool;
        updateToolUI();
        showToolbar();
    });
});

function updateToolUI() {
    document.querySelector('.tool-btn.active') && document.querySelector('.tool-btn.active').classList.remove('active');
    var active = document.querySelector('.tool-btn[data-tool="' + currentTool + '"]');
    if (active) active.classList.add('active');
}

document.getElementById('btn-undo').addEventListener('click', function() {
    if (myStrokeStack.length > 0) {
        var strokeId = myStrokeStack.pop();
        erasedStrokes.add(strokeId);
        redrawBoard();
        sendMsg({ type: 'undo' });
    }
});

document.getElementById('btn-clear').addEventListener('click', function() {
    if (confirm('Wirklich alles löschen?')) sendMsg({ type: 'clear' });
});

document.getElementById('btn-fullscreen').addEventListener('click', function() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
});

document.getElementById('btn-qr').addEventListener('click', async function() {
    try {
        var res = await fetch('/api/rooms/' + roomSlug + '/qr');
        var svg = await res.text();
        document.getElementById('qr-container').innerHTML = svg;
        document.getElementById('room-code-display').textContent = roomSlug;
        qrModal.classList.remove('hidden');
    } catch(e) { alert('QR Code konnte nicht geladen werden.'); }
});

document.getElementById('close-qr').addEventListener('click', function() { qrModal.classList.add('hidden'); });
qrModal.addEventListener('click', function(e) { if (e.target === qrModal) qrModal.classList.add('hidden'); });
