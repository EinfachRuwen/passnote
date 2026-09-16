// Constants and DOM
const board = document.getElementById('board');
const overlay = document.getElementById('overlay');
const ctx = board.getContext('2d', { desynchronized: true });
const oCtx = overlay.getContext('2d');
const toolbar = document.getElementById('toolbar');
const statusInd = document.getElementById('status');
const userCountEl = document.getElementById('user-count');
const qrModal = document.getElementById('qr-modal');

const urlParams = new URLSearchParams(window.location.search);
const roomSlug = urlParams.get('room');
const roomPass = urlParams.get('password');

if (!roomSlug) window.location.href = '/';

// State
let ws;
let isConnected = false;
let users = 0;
let myColor = '#1A1A2E';
let myUserId = null;

let currentTool = 'pen';
let currentColor = '#1A1A2E';
let baseWidth = 3;

let isDrawing = false;
let currentStrokeId = null;
let currentPoints = [];

// Local data
const localStrokes = []; // Array of { id, color, width, tool, points }
const erasedStrokes = new Set();
let myStrokeStack = []; // For undo

// Remote data
const remoteStrokes = new Map(); // id -> { color, width, tool, points }
const remoteCursors = new Map(); // id -> { targetX, targetY, currX, currY, color, type } (type = cursor|laser, timestamp)

// Setup Canvas
function resize() {
    board.width = window.innerWidth;
    board.height = window.innerHeight;
    overlay.width = window.innerWidth;
    overlay.height = window.innerHeight;
    redrawBoard();
}
window.addEventListener('resize', resize);
resize();

// Math helpers
function generateUUID() {
    return crypto.randomUUID();
}

function smoothPoints(points) {
    if (points.length < 3) return points;
    // Simple quadratic bezier smoothing logic usually done while drawing
    return points; 
}

// Drawing Functions
function drawStrokeOnCtx(context, stroke) {
    if (stroke.tool === 'text' && stroke.text) {
        context.font = `${stroke.fontSize}px sans-serif`;
        context.fillStyle = stroke.color;
        context.textBaseline = 'top';
        context.globalCompositeOperation = 'source-over';
        
        // Handle multi-line text
        const lines = stroke.text.split('\n');
        const lineHeight = stroke.fontSize * 1.2;
        for (let i = 0; i < lines.length; i++) {
            context.fillText(lines[i], stroke.x * board.width, (stroke.y * board.height) + (i * lineHeight));
        }
        return;
    }

    if (!stroke.points || stroke.points.length === 0) return;
    
    context.beginPath();
    context.strokeStyle = stroke.tool === 'eraser' ? '#FAFAF8' : stroke.color;
    context.lineWidth = stroke.width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    
    if (stroke.tool === 'eraser') {
        context.globalCompositeOperation = 'destination-out';
        context.lineWidth = stroke.width * 2;
    } else {
        context.globalCompositeOperation = 'source-over';
    }

    context.moveTo(stroke.points[0].x * board.width, stroke.points[0].y * board.height);
    
    if (stroke.points.length === 1) {
        context.lineTo(stroke.points[0].x * board.width + 0.1, stroke.points[0].y * board.height);
    } else {
        for (let i = 1; i < stroke.points.length - 1; i++) {
            const p1 = stroke.points[i];
            const p2 = stroke.points[i + 1];
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            context.quadraticCurveTo(p1.x * board.width, p1.y * board.height, midX * board.width, midY * board.height);
        }
        const last = stroke.points[stroke.points.length - 1];
        context.lineTo(last.x * board.width, last.y * board.height);
    }
    context.stroke();
    context.globalCompositeOperation = 'source-over'; // reset
}

function redrawBoard() {
    ctx.clearRect(0, 0, board.width, board.height);
    for (const stroke of localStrokes) {
        if (!erasedStrokes.has(stroke.id)) {
            drawStrokeOnCtx(ctx, stroke);
        }
    }
}

function renderOverlay() {
    oCtx.clearRect(0, 0, overlay.width, overlay.height);
    const now = Date.now();

    // Draw active remote strokes
    for (const stroke of remoteStrokes.values()) {
        drawStrokeOnCtx(oCtx, stroke);
    }

    // Draw active local stroke
    if (isDrawing && currentPoints.length > 0) {
        drawStrokeOnCtx(oCtx, {
            color: currentColor,
            width: baseWidth, // Simplified, no pressure logic implemented yet
            tool: currentTool,
            points: currentPoints
        });
    }

    // Draw cursors and lasers
    for (const [id, cursor] of remoteCursors.entries()) {
        if (now - cursor.timestamp > 3000) {
            remoteCursors.delete(id);
            continue;
        }
        
        // Lerp
        cursor.currX += (cursor.targetX - cursor.currX) * 0.3;
        cursor.currY += (cursor.targetY - cursor.currY) * 0.3;
        
        const px = cursor.currX * overlay.width;
        const py = cursor.currY * overlay.height;
        
        if (cursor.type === 'laser') {
            oCtx.beginPath();
            oCtx.arc(px, py, 4, 0, Math.PI * 2);
            oCtx.fillStyle = 'red';
            oCtx.shadowColor = 'red';
            oCtx.shadowBlur = 10;
            oCtx.fill();
            oCtx.shadowBlur = 0; // reset
        } else {
            oCtx.beginPath();
            oCtx.arc(px, py, 6, 0, Math.PI * 2);
            oCtx.fillStyle = cursor.color || '#000';
            oCtx.fill();
            oCtx.strokeStyle = '#fff';
            oCtx.lineWidth = 2;
            oCtx.stroke();
        }
    }

    requestAnimationFrame(renderOverlay);
}
requestAnimationFrame(renderOverlay);


// Input handling
let lastSentPoint = null;
let lastCursorSent = 0;

const textInput = document.getElementById('text-input');
let activeTextState = null; // { x, y, id }

function finalizeText() {
    if (!activeTextState) return;
    const text = textInput.value.trim();
    if (text) {
        const strokeId = activeTextState.id;
        const fontSize = baseWidth * 8; // baseWidth 1.5 -> 12px, 3 -> 24px, 6 -> 48px
        
        const strokeObj = {
            id: strokeId,
            userId: myUserId,
            color: currentColor,
            width: baseWidth,
            tool: 'text',
            text: text,
            x: activeTextState.x,
            y: activeTextState.y,
            fontSize: fontSize
        };

        // Local
        localStrokes.push(strokeObj);
        myStrokeStack.push(strokeId);
        redrawBoard();

        // Remote
        sendMsg({
            type: 'stroke_start',
            id: strokeId,
            color: currentColor,
            width: baseWidth,
            tool: 'text',
            text: text,
            x: activeTextState.x,
            y: activeTextState.y,
            fontSize: fontSize
        });
    }
    
    textInput.value = '';
    textInput.classList.remove('active');
    activeTextState = null;
}

textInput.addEventListener('blur', finalizeText);
textInput.addEventListener('keydown', (e) => {
    // Shift+Enter um Zeilenumbruch zu machen, normales Enter schließt ab
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finalizeText();
    }
});

board.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    
    // Wenn wir schon Text tippen und woanders klicken, finalize!
    if (activeTextState) {
        finalizeText();
        return;
    }

    if (currentTool === 'text') {
        const x = e.offsetX / board.width;
        const y = e.offsetY / board.height;
        const fontSize = baseWidth * 8;
        
        activeTextState = { x, y, id: generateUUID() };
        
        textInput.style.left = `${e.offsetX}px`;
        textInput.style.top = `${e.offsetY}px`;
        textInput.style.color = currentColor;
        textInput.style.fontSize = `${fontSize}px`;
        textInput.classList.add('active');
        
        // Timeout needed for focus because of pointerdown intercept
        setTimeout(() => textInput.focus(), 10);
        return;
    }

    isDrawing = true;
    currentStrokeId = generateUUID();
    myStrokeStack.push(currentStrokeId);
    
    let actualTool = currentTool;
    // Eraser end of Apple Pencil
    if (e.buttons === 32) actualTool = 'eraser';
    
    const pressure = e.pointerType === 'pen' ? e.pressure : 0.5;
    const actualWidth = baseWidth * (0.4 + pressure * 1.2);

    const point = { x: e.offsetX / board.width, y: e.offsetY / board.height, p: pressure };
    currentPoints = [point];
    
    sendMsg({
        type: 'stroke_start',
        id: currentStrokeId,
        color: currentColor,
        width: actualWidth,
        tool: actualTool
    });
    
    // Add to local strokes early so we can track it
    localStrokes.push({
        id: currentStrokeId,
        color: currentColor,
        width: actualWidth,
        tool: actualTool,
        points: currentPoints
    });
    
    lastSentPoint = point;
    showToolbar();
});

board.addEventListener('pointermove', (e) => {
    e.preventDefault();
    const x = e.offsetX / board.width;
    const y = e.offsetY / board.height;

    if (isDrawing) {
        const pressure = e.pointerType === 'pen' ? e.pressure : 0.5;
        const point = { x, y, p: pressure };
        currentPoints.push(point);
        
        // Throttle sending: send if distance is large enough
        const dx = (x - lastSentPoint.x) * board.width;
        const dy = (y - lastSentPoint.y) * board.height;
        if (dx*dx + dy*dy > 4) { // 2px Mindestabstand (quadriert)
            sendMsg({ type: 'stroke_point', id: currentStrokeId, x, y, p: pressure });
            lastSentPoint = point;
        }
    } else {
        // Cursor/Laser-Updates maximal alle 50ms senden
        const now = Date.now();
        if (now - lastCursorSent > 50) {
            lastCursorSent = now;
            if (currentTool === 'laser') {
                sendMsg({ type: 'laser', x, y });
            } else {
                sendMsg({ type: 'cursor', x, y });
            }
        }
    }
    showToolbar();
});

function endStroke() {
    if (!isDrawing) return;
    isDrawing = false;
    sendMsg({ type: 'stroke_end', id: currentStrokeId });
    
    // Stroke is already in localStrokes, just need to redraw board to bake it in
    redrawBoard();
    currentPoints = [];
    currentStrokeId = null;
}

board.addEventListener('pointerup', endStroke);
board.addEventListener('pointercancel', endStroke);


// WebSocket
let reconnectDelay = 2000;

function connectWS() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?room=${encodeURIComponent(roomSlug)}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        statusInd.className = 'status-indicator connected';
        isConnected = true;
        reconnectDelay = 2000; // Reset bei erfolgreichem Connect
        
        let authMsg = { type: 'auth' };
        if (roomPass) authMsg.password = roomPass;
        sendMsg(authMsg);
    };

    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        handleWSMsg(msg);
    };

    ws.onclose = () => {
        statusInd.className = 'status-indicator offline';
        isConnected = false;
        // Exponentieller Backoff (max 30s)
        setTimeout(connectWS, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    };
}
connectWS();

function sendMsg(msg) {
    if (isConnected && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

// Heartbeat
setInterval(() => {
    sendMsg({ type: 'ping' });
}, 25000);

function handleWSMsg(msg) {
    switch (msg.type) {
        case 'welcome':
            myUserId = msg.userId;
            myColor = msg.color;
            userCountEl.textContent = msg.users;
            
            // Load canvas state
            if (msg.canvas) {
                if (msg.canvas.strokes) localStrokes.push(...msg.canvas.strokes);
                if (msg.canvas.erased) {
                    msg.canvas.erased.forEach(id => erasedStrokes.add(id));
                }
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
            remoteStrokes.set(msg.id, {
                color: msg.color,
                width: msg.width,
                tool: msg.tool,
                points: []
            });
            break;
            
        case 'stroke_point':
            if (remoteStrokes.has(msg.id)) {
                remoteStrokes.get(msg.id).points.push({x: msg.x, y: msg.y});
            }
            break;
            
        case 'stroke_end':
            if (remoteStrokes.has(msg.id)) {
                const stroke = remoteStrokes.get(msg.id);
                stroke.id = msg.id;
                localStrokes.push(stroke);
                remoteStrokes.delete(msg.id);
                redrawBoard();
            }
            break;
            
        case 'cursor':
        case 'laser':
            if (!remoteCursors.has(msg.userId)) {
                remoteCursors.set(msg.userId, {
                    currX: msg.x, currY: msg.y, targetX: msg.x, targetY: msg.y
                });
            }
            const c = remoteCursors.get(msg.userId);
            c.targetX = msg.x;
            c.targetY = msg.y;
            c.type = msg.type;
            c.timestamp = Date.now();
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


// UI Logic
let hideTimeout;
function showToolbar() {
    toolbar.classList.remove('hidden-bar');
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
        toolbar.classList.add('hidden-bar');
    }, 4000);
}

document.addEventListener('pointermove', (e) => {
    if (e.clientY < 100) showToolbar();
});
showToolbar();

document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelector('.color-btn.active')?.classList.remove('active');
        btn.classList.add('active');
        currentColor = btn.dataset.color;
        currentTool = 'pen';
        updateToolUI();
        showToolbar();
    });
});

document.querySelectorAll('.width-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelector('.width-btn.active')?.classList.remove('active');
        btn.classList.add('active');
        baseWidth = parseFloat(btn.dataset.width);
        showToolbar();
    });
});

document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        currentTool = btn.dataset.tool;
        updateToolUI();
        showToolbar();
    });
});

function updateToolUI() {
    document.querySelector('.tool-btn.active')?.classList.remove('active');
    document.querySelector(`.tool-btn[data-tool="${currentTool}"]`)?.classList.add('active');
}

document.getElementById('btn-undo').addEventListener('click', () => {
    if (myStrokeStack.length > 0) {
        const strokeId = myStrokeStack.pop();
        erasedStrokes.add(strokeId);
        redrawBoard();
        sendMsg({ type: 'undo' }); // Server ermittelt selbst den letzten Stroke dieses Nutzers
    }
});

document.getElementById('btn-clear').addEventListener('click', () => {
    if (confirm('Wirklich alles löschen?')) {
        sendMsg({ type: 'clear' });
    }
});

document.getElementById('btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
});

document.getElementById('btn-qr').addEventListener('click', async () => {
    try {
        const res = await fetch(`/api/rooms/${roomSlug}/qr`);
        const svg = await res.text();
        document.getElementById('qr-container').innerHTML = svg;
        document.getElementById('room-code-display').textContent = roomSlug;
        qrModal.classList.remove('hidden');
    } catch (e) {
        alert('QR Code konnte nicht geladen werden.');
    }
});

document.getElementById('close-qr').addEventListener('click', () => {
    qrModal.classList.add('hidden');
});

qrModal.addEventListener('click', (e) => {
    if(e.target === qrModal) qrModal.classList.add('hidden');
});
