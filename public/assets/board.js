(function () {
    'use strict';

    // ---------- Hilfen ----------
    function $(id) { return document.getElementById(id); }

    function makeStore(area) {
        return {
            get: function (k) { try { return area().getItem(k); } catch (e) { return null; } },
            set: function (k, v) { try { area().setItem(k, v); } catch (e) { /* voll oder gesperrt */ } },
            remove: function (k) { try { area().removeItem(k); } catch (e) { /* egal */ } }
        };
    }
    var store = makeStore(function () { return window.localStorage; });
    var session = makeStore(function () { return window.sessionStorage; });

    function readJson(k, fallback) {
        try {
            var v = JSON.parse(store.get(k));
            return v == null ? fallback : v;
        } catch (e) {
            return fallback;
        }
    }

    function uuid() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function formatTime(ts) {
        var d = new Date(ts);
        return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    var INK = '#1F2A44';
    var NAME_KEY = 'passnote_username';
    var CLIENT_KEY = 'passnote_client_id';

    // ---------- Raum & Identität ----------
    var params = new URLSearchParams(location.search);
    var roomSlug = (params.get('room') || '').trim().toLowerCase();

    // Passwort nie in der URL stehen lassen
    if (params.has('password')) {
        session.set('passnote_pw_' + roomSlug, params.get('password'));
        params.delete('password');
        history.replaceState(null, '', location.pathname + '?' + params.toString());
    }

    var clientId = store.get(CLIENT_KEY);
    if (!clientId || !/^[\w-]{8,64}$/.test(clientId)) {
        clientId = uuid();
        store.set(CLIENT_KEY, clientId);
    }
    var myName = store.get(NAME_KEY) || '';
    var myColor = INK;

    var OUTBOX_KEY = 'passnote_outbox_' + roomSlug;
    var outbox = readJson(OUTBOX_KEY, []);
    if (!Array.isArray(outbox)) outbox = [];

    function saveOutbox() {
        if (outbox.length) store.set(OUTBOX_KEY, JSON.stringify(outbox));
        else store.remove(OUTBOX_KEY);
    }

    function getPassword() { return session.get('passnote_pw_' + roomSlug) || ''; }
    function setPassword(pw) { session.set('passnote_pw_' + roomSlug, pw); }

    // ---------- DOM ----------
    var page = $('page');
    var notesEl = $('notes');
    var emptyEl = $('notes-empty');
    var statusEl = $('page-status');
    var pill = $('new-pill');
    var peopleEl = $('people');
    var subjectEl = $('subject');
    var composerArea = $('composer-area');
    var canvas = $('composer-canvas');
    var cctx = canvas.getContext('2d');
    var textEl = $('composer-text');
    var hintEl = $('composer-hint');

    var today = new Date().toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    $('header-date').textContent = today;
    $('cover-date').textContent = new Date().toLocaleDateString('de-DE');

    subjectEl.value = store.get('passnote_subject_' + roomSlug) || 'Mitschrift';
    subjectEl.addEventListener('input', function () {
        store.set('passnote_subject_' + roomSlug, subjectEl.value);
    });
    subjectEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') subjectEl.blur();
    });

    function showSheet(id) {
        ['name-sheet', 'password-sheet', 'error-sheet', 'invite-sheet'].forEach(function (s) {
            $(s).classList.toggle('hidden', s !== id);
        });
    }

    function showError(title, text, canRetry) {
        $('error-title').textContent = title;
        $('error-text').textContent = text;
        $('btn-retry').classList.toggle('hidden', !canRetry);
        showSheet('error-sheet');
    }

    // ---------- Tinte zeichnen ----------
    // Punkte liegen flach als [x, y, druck, x, y, druck, …] in Einheiten der Zettelbreite
    function pressureWidth(pr) { return 0.55 + 0.9 * pr; }

    function drawPieces(ctx, p, size, color, fromIdx, finish) {
        var n = p.length / 3;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (n === 1) {
            if (finish) drawDot(ctx, p, size, color);
            return;
        }

        for (var k = Math.max(1, fromIdx); k < n; k++) {
            var a = (k - 1) * 3;
            var b = k * 3;
            var mx = (p[a] + p[b]) / 2;
            var my = (p[a + 1] + p[b + 1]) / 2;
            ctx.beginPath();
            if (k === 1) {
                ctx.moveTo(p[0], p[1]);
                ctx.lineTo(mx, my);
            } else {
                var z = (k - 2) * 3;
                ctx.moveTo((p[z] + p[a]) / 2, (p[z + 1] + p[a + 1]) / 2);
                ctx.quadraticCurveTo(p[a], p[a + 1], mx, my);
            }
            ctx.lineWidth = size * pressureWidth((p[a + 2] + p[b + 2]) / 2);
            ctx.stroke();
        }

        if (finish) {
            var c = (n - 2) * 3;
            var d = (n - 1) * 3;
            ctx.beginPath();
            ctx.moveTo((p[c] + p[d]) / 2, (p[c + 1] + p[d + 1]) / 2);
            ctx.lineTo(p[d], p[d + 1]);
            ctx.lineWidth = size * pressureWidth(p[d + 2]);
            ctx.stroke();
        }
    }

    function drawDot(ctx, p, size, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p[0], p[1], size * pressureWidth(p[2]) / 2, 0, Math.PI * 2);
        ctx.fill();
    }

    // ---------- Zettel anzeigen ----------
    var notes = [];
    var inkData = new WeakMap();
    var firstRender = true;

    function isMine(n) { return n.userId === clientId; }

    function buildNoteEl(n, pending) {
        var el = document.createElement('div');
        el.className = 'note' + (pending ? ' pending' : '');
        el.dataset.user = n.userId;
        el.dataset.ts = n.ts;
        if (n.id) el.dataset.id = n.id;
        if (n.cid) el.dataset.cid = n.cid;

        var margin = document.createElement('div');
        margin.className = 'note-margin';
        var name = document.createElement('span');
        name.className = 'note-name';
        name.textContent = isMine(n) ? 'ich' : n.username;
        name.style.color = isMine(n) ? myColor : n.color;
        var time = document.createElement('span');
        time.className = 'note-time';
        time.textContent = formatTime(n.ts);
        margin.appendChild(name);
        margin.appendChild(time);

        var body = document.createElement('div');
        body.className = 'note-body';
        if (n.text) {
            var text = document.createElement('div');
            text.className = 'note-text';
            text.textContent = n.text;
            body.appendChild(text);
        }
        if (n.ink && Array.isArray(n.ink.strokes)) {
            var cv = document.createElement('canvas');
            cv.className = 'note-ink';
            inkData.set(cv, n.ink);
            body.appendChild(cv);
        }

        el.appendChild(margin);
        el.appendChild(body);
        return el;
    }

    function paintInk(cv) {
        var ink = inkData.get(cv);
        var body = cv.parentElement;
        if (!ink || !body) return;
        var avail = body.clientWidth - parseFloat(getComputedStyle(body).paddingLeft || 0);
        if (avail <= 0) return;
        // So groß wie geschrieben, aber nie breiter als die Seite
        var ref = composerArea.clientWidth || avail;
        var scale = Math.min(ref, avail / ink.w);
        var dpr = Math.min(window.devicePixelRatio || 1, 3);
        var cssW = ink.w * scale;
        var cssH = ink.h * scale;
        cv.style.width = cssW + 'px';
        cv.style.height = cssH + 'px';
        cv.width = Math.max(1, Math.round(cssW * dpr));
        cv.height = Math.max(1, Math.round(cssH * dpr));
        var ctx = cv.getContext('2d');
        ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
        ink.strokes.forEach(function (s) {
            if (Array.isArray(s.p) && s.p.length >= 3) drawPieces(ctx, s.p, s.s, s.c, 1, true);
        });
    }

    function paintAll(root) {
        root.querySelectorAll('canvas.note-ink').forEach(paintInk);
    }

    function updateCont(el) {
        if (!el) return;
        var prev = el.previousElementSibling;
        var cont = !!prev && prev.dataset.user === el.dataset.user &&
            Number(el.dataset.ts) - Number(prev.dataset.ts) < 5 * 60 * 1000;
        el.classList.toggle('cont', cont);
    }

    function updateEmpty() {
        emptyEl.classList.toggle('hidden', notesEl.children.length > 0);
    }

    function isNearBottom() {
        return page.scrollHeight - page.scrollTop - page.clientHeight < 80;
    }

    function scrollToBottom() {
        page.scrollTop = page.scrollHeight;
        pill.classList.add('hidden');
    }

    function insertNote(n, pending, before) {
        var el = buildNoteEl(n, pending);
        notesEl.insertBefore(el, before || null);
        updateCont(el);
        if (el.nextElementSibling) updateCont(el.nextElementSibling);
        paintAll(el);
        updateEmpty();
        return el;
    }

    function renderAll() {
        var stick = firstRender || isNearBottom();
        firstRender = false;
        notesEl.textContent = '';
        notes.forEach(function (n) { insertNote(n, false); });
        outbox.forEach(function (o) { insertNote(o, true); });
        updateEmpty();
        if (stick) scrollToBottom();
    }

    function findPendingEl(cid) {
        var els = notesEl.querySelectorAll('.note.pending');
        for (var i = 0; i < els.length; i++) {
            if (els[i].dataset.cid === cid) return els[i];
        }
        return null;
    }

    function onNote(n) {
        if (!n || !n.id) return;
        for (var i = 0; i < notes.length; i++) {
            if (notes[i].id === n.id) return;
        }
        notes.push(n);
        stopTyping(n.userId);

        if (isMine(n) && n.cid) {
            var idx = outbox.findIndex(function (o) { return o.cid === n.cid; });
            if (idx !== -1) {
                outbox.splice(idx, 1);
                saveOutbox();
            }
            var pendingEl = findPendingEl(n.cid);
            if (pendingEl) {
                var el = buildNoteEl(n, false);
                pendingEl.replaceWith(el);
                updateCont(el);
                paintAll(el);
                return;
            }
        }

        var atBottom = isNearBottom();
        insertNote(n, false, notesEl.querySelector('.note.pending'));
        if (isMine(n) || atBottom) {
            scrollToBottom();
        } else {
            pill.classList.remove('hidden');
        }
        if (!isMine(n) && coverOn) $('cover-dot').classList.add('on');
    }

    function onDeleted(id) {
        notes = notes.filter(function (n) { return n.id !== id; });
        var el = notesEl.querySelector('.note[data-id="' + id.replace(/[^\w-]/g, '') + '"]');
        if (!el) return;
        var next = el.nextElementSibling;
        el.remove();
        updateCont(next);
        updateEmpty();
    }

    page.addEventListener('scroll', function () {
        if (isNearBottom()) pill.classList.add('hidden');
    });
    pill.addEventListener('click', scrollToBottom);

    // ---------- Eigene Zettel wegwerfen (lange drücken) ----------
    var trashBtn = document.createElement('button');
    trashBtn.className = 'note-trash';
    trashBtn.textContent = 'wegwerfen';
    var trashTarget = null;
    var pressTimer = null;
    var pressStart = null;

    function hideTrash() {
        trashTarget = null;
        trashBtn.remove();
    }

    function offerTrash(el) {
        if (el.dataset.user !== clientId) return;
        trashTarget = el;
        el.appendChild(trashBtn);
    }

    notesEl.addEventListener('pointerdown', function (e) {
        if (e.target === trashBtn) return;
        hideTrash();
        var el = e.target.closest('.note');
        if (!el || el.dataset.user !== clientId) return;
        pressStart = { x: e.clientX, y: e.clientY };
        clearTimeout(pressTimer);
        pressTimer = setTimeout(function () { offerTrash(el); }, 550);
    });
    notesEl.addEventListener('pointermove', function (e) {
        if (pressStart && Math.abs(e.clientX - pressStart.x) + Math.abs(e.clientY - pressStart.y) > 12) {
            clearTimeout(pressTimer);
        }
    });
    ['pointerup', 'pointercancel'].forEach(function (t) {
        notesEl.addEventListener(t, function () { clearTimeout(pressTimer); pressStart = null; });
    });
    notesEl.addEventListener('contextmenu', function (e) {
        var el = e.target.closest('.note');
        if (el && el.dataset.user === clientId) {
            e.preventDefault();
            offerTrash(el);
        }
    });
    trashBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var el = trashTarget;
        hideTrash();
        if (!el) return;
        if (el.classList.contains('pending')) {
            outbox = outbox.filter(function (o) { return o.cid !== el.dataset.cid; });
            saveOutbox();
            var next = el.nextElementSibling;
            el.remove();
            updateCont(next);
            updateEmpty();
        } else if (el.dataset.id) {
            wsSend({ type: 'delete', id: el.dataset.id });
        }
    });

    // ---------- Wer ist da / wer schreibt ----------
    function renderPeople(users) {
        peopleEl.textContent = '';
        (users || []).forEach(function (u) {
            if (u.userId === clientId) return;
            var el = document.createElement('div');
            el.className = 'person';
            el.style.color = u.color;
            el.textContent = (u.username || '?').charAt(0).toUpperCase();
            el.title = u.username;
            peopleEl.appendChild(el);
        });
    }

    var typingUsers = new Map();

    function onTyping(msg) {
        if (msg.userId === clientId) return;
        var entry = typingUsers.get(msg.userId);
        if (entry) clearTimeout(entry.timer);
        typingUsers.set(msg.userId, {
            name: msg.username,
            timer: setTimeout(function () { stopTyping(msg.userId); }, 4000)
        });
        updateStatus();
    }

    function stopTyping(userId) {
        var entry = typingUsers.get(userId);
        if (!entry) return;
        clearTimeout(entry.timer);
        typingUsers.delete(userId);
        updateStatus();
    }

    var lastTypingSent = 0;
    function notifyTyping() {
        var now = Date.now();
        if (now - lastTypingSent < 2000) return;
        lastTypingSent = now;
        wsSend({ type: 'typing' });
    }

    var offlineSince = null;

    function updateStatus() {
        var text = '';
        if (offlineSince !== null && Date.now() - offlineSince > 1500) {
            text = outbox.length ? 'offline – deine Zettel gehen raus, sobald du wieder drin bist' : 'offline – verbinde neu …';
        } else if (typingUsers.size) {
            var names = Array.from(typingUsers.values()).map(function (t) { return t.name; });
            text = names.length === 1 ? names[0] + ' schreibt …' : names.slice(0, -1).join(', ') + ' und ' + names[names.length - 1] + ' schreiben …';
        }
        statusEl.textContent = text;
    }
    setInterval(updateStatus, 2000);

    // ---------- Verbindung ----------
    var ws = null;
    var authed = false;
    var fatal = false;
    var retryDelay = 1000;
    var retryTimer = null;
    var lastMsgAt = 0;

    function wsSend(msg) {
        if (authed && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
            return true;
        }
        return false;
    }

    function connect() {
        clearTimeout(retryTimer);
        if (fatal || !myName) return;
        if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

        var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        var sock = new WebSocket(proto + '//' + location.host + '/ws?room=' + encodeURIComponent(roomSlug));
        ws = sock;

        sock.onopen = function () {
            lastMsgAt = Date.now();
            sock.send(JSON.stringify({ type: 'auth', password: getPassword(), username: myName, clientId: clientId }));
        };

        sock.onmessage = function (e) {
            if (sock !== ws) return;
            lastMsgAt = Date.now();
            var msg;
            try { msg = JSON.parse(e.data); } catch (err) { return; }
            handleMessage(msg);
        };

        sock.onclose = function () {
            if (sock !== ws) return;
            ws = null;
            authed = false;
            if (!fatal) {
                if (offlineSince === null) offlineSince = Date.now();
                updateStatus();
                retryTimer = setTimeout(connect, retryDelay);
                retryDelay = Math.min(retryDelay * 2, 10000);
            }
        };
    }

    function forceReconnect() {
        if (ws) {
            var old = ws;
            ws = null;
            authed = false;
            old.onclose = null;
            try { old.close(); } catch (e) { /* schon zu */ }
            if (offlineSince === null) offlineSince = Date.now();
        }
        retryDelay = 1000;
        connect();
    }

    // Nach Standby / Netzwechsel: prüfen, ob die Leitung noch lebt
    function probe() {
        if (fatal || !myName) return;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
            retryDelay = 1000;
            connect();
            return;
        }
        var sentAt = Date.now();
        wsSend({ type: 'ping' });
        setTimeout(function () {
            if (lastMsgAt < sentAt) forceReconnect();
        }, 4000);
    }

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') probe();
    });
    window.addEventListener('online', probe);
    window.addEventListener('pageshow', function (e) { if (e.persisted) probe(); });

    setInterval(function () {
        if (!authed) return;
        if (Date.now() - lastMsgAt > 50000) forceReconnect();
        else wsSend({ type: 'ping' });
    }, 20000);

    function handleMessage(msg) {
        switch (msg.type) {
            case 'welcome':
                authed = true;
                fatal = false;
                retryDelay = 1000;
                offlineSince = null;
                myColor = msg.color || INK;
                notes = Array.isArray(msg.notes) ? msg.notes : [];
                outbox = outbox.filter(function (o) {
                    return !notes.some(function (n) { return isMine(n) && n.cid === o.cid; });
                });
                saveOutbox();
                renderPeople(msg.users);
                renderAll();
                if (!$('invite-sheet').classList.contains('hidden')) showSheet('invite-sheet');
                else showSheet(null);
                outbox.forEach(transmit);
                rememberRoom();
                updateStatus();
                break;

            case 'note':
                onNote(msg.note);
                break;

            case 'deleted':
                onDeleted(String(msg.id || ''));
                break;

            case 'cleared':
                notes = [];
                renderAll();
                break;

            case 'users':
                renderPeople(msg.users);
                break;

            case 'typing':
                onTyping(msg);
                break;

            case 'error':
                handleError(msg.code);
                break;
        }
    }

    function handleError(code) {
        fatal = true;
        clearTimeout(retryTimer);
        offlineSince = null;
        updateStatus();
        if (code === 'WRONG_PASSWORD') {
            $('password-error').classList.toggle('hidden', !getPassword());
            $('password-input').value = '';
            showSheet('password-sheet');
            setTimeout(function () { $('password-input').focus(); }, 50);
        } else if (code === 'ROOM_FULL') {
            showError('Voll.', 'In diesem Block sind gerade zu viele Leute.', true);
        } else if (code === 'ROOM_NOT_FOUND' || code === 'ROOM_DELETED') {
            forgetRoom();
            store.remove(OUTBOX_KEY);
            showError('Weg.', 'Diesen Block gibt es nicht (mehr). Vielleicht vertippt?', false);
        } else {
            showError('Hm.', 'Da ist was schiefgelaufen (' + code + ').', true);
        }
    }

    $('btn-retry').addEventListener('click', function () {
        fatal = false;
        showSheet(null);
        forceReconnect();
    });

    $('password-form').addEventListener('submit', function (e) {
        e.preventDefault();
        setPassword($('password-input').value);
        fatal = false;
        showSheet(null);
        forceReconnect();
    });

    function rememberRoom() {
        var recent = readJson('passnote_recent', []);
        if (!Array.isArray(recent)) recent = [];
        recent = [roomSlug].concat(recent.filter(function (s) { return s !== roomSlug; })).slice(0, 6);
        store.set('passnote_recent', JSON.stringify(recent));
    }

    function forgetRoom() {
        var recent = readJson('passnote_recent', []);
        if (!Array.isArray(recent)) return;
        store.set('passnote_recent', JSON.stringify(recent.filter(function (s) { return s !== roomSlug; })));
    }

    // ---------- Zettel schreiben ----------
    var strokes = [];
    var undoStack = [];
    var tool = 'pen';
    var color = INK;
    var sizePx = 3.5;
    var drawing = null;
    var erasing = null;
    var penSeen = false;
    var lastPenAt = 0;
    var textMode = false;
    var W = 0;
    var H = 0;
    var dpr = 1;

    function resizeComposer() {
        var r = composerArea.getBoundingClientRect();
        if (!r.width) return;
        W = r.width;
        H = r.height;
        dpr = Math.min(window.devicePixelRatio || 1, 3);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        redrawComposer();
    }

    function redrawComposer() {
        cctx.setTransform(1, 0, 0, 1, 0, 0);
        cctx.clearRect(0, 0, canvas.width, canvas.height);
        cctx.setTransform(dpr * W, 0, 0, dpr * W, 0, 0);
        strokes.forEach(function (s) { drawPieces(cctx, s.p, s.s, s.c, 1, true); });
        updateHint();
    }

    function updateHint() {
        hintEl.classList.toggle('hidden', textMode || strokes.length > 0);
    }

    function toPoint(e) {
        var rect = canvas.getBoundingClientRect();
        var pr = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
        return { x: (e.clientX - rect.left) / W, y: (e.clientY - rect.top) / W, p: pr };
    }

    function cancelDrawing() {
        if (!drawing) return;
        var idx = strokes.indexOf(drawing.stroke);
        if (idx !== -1) strokes.splice(idx, 1);
        drawing = null;
        redrawComposer();
    }

    function addPoint(pt) {
        var p = drawing.stroke.p;
        var n = p.length;
        var dx = (pt.x - p[n - 3]) * W;
        var dy = (pt.y - p[n - 2]) * W;
        if (dx * dx + dy * dy < 1.5) return;
        p.push(pt.x, pt.y, pt.p);
        drawPieces(cctx, p, drawing.stroke.s, drawing.stroke.c, p.length / 3 - 1, false);
    }

    function eventsOf(e) {
        return (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
    }

    // iPad: Ohne das wartet WebKit (Safari und Chrome) nach jedem Strich, ob eine
    // Systemgeste (Lupe, Textauswahl, Doppeltipp) kommt, und verzögert den nächsten Strich
    ['touchstart', 'touchmove', 'touchend'].forEach(function (type) {
        canvas.addEventListener(type, function (e) {
            if (e.cancelable) e.preventDefault();
        }, { passive: false });
    });

    canvas.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'pen') {
            penSeen = true;
            lastPenAt = Date.now();
        } else if (penSeen && e.pointerType === 'touch') {
            return; // Handballen ignorieren, sobald der Pencil benutzt wurde
        }

        if (drawing || erasing) {
            if (e.pointerType === 'pen') {
                // Der Pencil hat immer Vorrang: Handballen-Strich verwerfen,
                // einen hängengebliebenen Strich (verlorenes pointerup) abschließen
                if (drawing && drawing.pointerType !== 'pen') cancelDrawing();
                else finishDrawing();
                erasing = null;
            } else if (e.pointerType === 'touch' && drawing && drawing.pointerType === 'touch') {
                cancelDrawing(); // Zwei Finger = Geste, kein Strich
                return;
            } else {
                return;
            }
        }

        e.preventDefault();
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
        notifyTyping();
        hideTrash();
        var pt = toPoint(e);

        if (tool === 'eraser') {
            erasing = { pointerId: e.pointerId };
            eraseAt(pt);
            return;
        }

        var stroke = { c: color, s: sizePx / W, p: [pt.x, pt.y, pt.p] };
        strokes.push(stroke);
        drawing = { stroke: stroke, pointerId: e.pointerId, pointerType: e.pointerType };
        drawDot(cctx, stroke.p, stroke.s, stroke.c);
        updateHint();
    });

    canvas.addEventListener('pointermove', function (e) {
        if (erasing && e.pointerId === erasing.pointerId) {
            eventsOf(e).forEach(function (ev) { eraseAt(toPoint(ev)); });
            return;
        }
        if (!drawing || e.pointerId !== drawing.pointerId) return;
        if (e.pointerType === 'pen') {
            lastPenAt = Date.now();
            // Pencil schwebt nur noch über dem Display: pointerup ist verloren gegangen
            if (e.buttons === 0 && e.pressure === 0) {
                finishDrawing();
                return;
            }
        }
        eventsOf(e).forEach(function (ev) { addPoint(toPoint(ev)); });
    });

    function finishDrawing() {
        if (!drawing) return;
        var s = drawing.stroke;
        drawing = null;
        drawPieces(cctx, s.p, s.s, s.c, s.p.length / 3, true);
        undoStack.push({ type: 'add', stroke: s });
    }

    function endPointer(e) {
        if (e.pointerType === 'pen') lastPenAt = Date.now();
        if (erasing && e.pointerId === erasing.pointerId) {
            erasing = null;
            return;
        }
        if (drawing && e.pointerId === drawing.pointerId) finishDrawing();
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('lostpointercapture', endPointer);

    function distToSegSq(px, py, ax, ay, bx, by) {
        var dx = bx - ax;
        var dy = by - ay;
        var len = dx * dx + dy * dy;
        var t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
        var x = ax + t * dx - px;
        var y = ay + t * dy - py;
        return x * x + y * y;
    }

    function eraseAt(pt) {
        var r = 12 / W;
        for (var i = strokes.length - 1; i >= 0; i--) {
            var s = strokes[i];
            var p = s.p;
            var lim = (r + s.s / 2) * (r + s.s / 2);
            var hit = false;
            if (p.length === 3) {
                hit = distToSegSq(pt.x, pt.y, p[0], p[1], p[0], p[1]) < lim;
            }
            for (var j = 3; j < p.length && !hit; j += 3) {
                hit = distToSegSq(pt.x, pt.y, p[j - 3], p[j - 2], p[j], p[j + 1]) < lim;
            }
            if (hit) {
                strokes.splice(i, 1);
                undoStack.push({ type: 'erase', stroke: s, index: i });
                redrawComposer();
                return;
            }
        }
    }

    function undo() {
        var action = undoStack.pop();
        if (!action) return;
        if (action.type === 'add') {
            var idx = strokes.lastIndexOf(action.stroke);
            if (idx !== -1) strokes.splice(idx, 1);
        } else if (action.type === 'erase') {
            strokes.splice(Math.min(action.index, strokes.length), 0, action.stroke);
        } else if (action.type === 'clear') {
            strokes = action.strokes;
        }
        redrawComposer();
    }

    function setTool(t) {
        tool = t;
        $('btn-eraser').classList.toggle('active', t === 'eraser');
    }

    function setTextMode(on) {
        textMode = on;
        $('btn-text').classList.toggle('active', on);
        textEl.classList.toggle('hidden', !on);
        canvas.style.visibility = on ? 'hidden' : '';
        updateHint();
        if (on) textEl.focus();
        else textEl.blur();
    }

    document.querySelectorAll('.ink-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.ink-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            color = btn.dataset.color;
            setTool('pen');
            if (textMode) setTextMode(false);
        });
    });

    document.querySelectorAll('.size-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.size-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            sizePx = parseFloat(btn.dataset.size);
            setTool('pen');
            if (textMode) setTextMode(false);
        });
    });

    $('btn-eraser').addEventListener('click', function () {
        if (textMode) setTextMode(false);
        setTool(tool === 'eraser' ? 'pen' : 'eraser');
    });

    $('btn-undo').addEventListener('click', function () {
        if (textMode) setTextMode(false);
        undo();
    });

    $('btn-text').addEventListener('click', function () {
        setTextMode(!textMode);
    });

    $('btn-clear').addEventListener('click', function () {
        if (textMode) {
            textEl.value = '';
            textEl.focus();
            return;
        }
        if (!strokes.length) return;
        undoStack.push({ type: 'clear', strokes: strokes });
        strokes = [];
        redrawComposer();
    });

    textEl.addEventListener('input', notifyTyping);
    textEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            sendNote();
        }
    });

    // Den Zettel auf das Nötigste zuschneiden
    function buildInk() {
        if (!strokes.length) return null;
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxS = 0;
        strokes.forEach(function (s) {
            maxS = Math.max(maxS, s.s * 1.5);
            for (var i = 0; i < s.p.length; i += 3) {
                if (s.p[i] < minX) minX = s.p[i];
                if (s.p[i] > maxX) maxX = s.p[i];
                if (s.p[i + 1] < minY) minY = s.p[i + 1];
                if (s.p[i + 1] > maxY) maxY = s.p[i + 1];
            }
        });
        var pad = maxS / 2 + 0.01;
        var ox = minX - pad;
        var oy = minY - pad;
        function r4(v) { return Math.round(v * 1e4) / 1e4; }
        return {
            w: r4(maxX - minX + 2 * pad),
            h: r4(maxY - minY + 2 * pad),
            strokes: strokes.map(function (s) {
                var p = new Array(s.p.length);
                for (var i = 0; i < s.p.length; i += 3) {
                    p[i] = r4(s.p[i] - ox);
                    p[i + 1] = r4(s.p[i + 1] - oy);
                    p[i + 2] = Math.round(s.p[i + 2] * 100) / 100;
                }
                return { c: s.c, s: r4(s.s), p: p };
            })
        };
    }

    function transmit(item) {
        wsSend({ type: 'note', cid: item.cid, text: item.text, ink: item.ink });
    }

    function sendNote() {
        finishDrawing();
        var text = textEl.value.trim();
        var ink = buildInk();
        if (!text && !ink) return;

        var item = { cid: uuid(), ts: Date.now(), userId: clientId, username: myName, color: myColor };
        if (text) item.text = text;
        if (ink) item.ink = ink;
        outbox.push(item);
        saveOutbox();
        insertNote(item, true);
        scrollToBottom();

        strokes = [];
        undoStack = [];
        textEl.value = '';
        redrawComposer();
        transmit(item);
        updateStatus();
    }

    $('btn-send').addEventListener('click', sendNote);

    // ---------- Einladen & Name ----------
    $('btn-invite').addEventListener('click', function () {
        $('invite-qr').src = '/api/rooms/' + encodeURIComponent(roomSlug) + '/qr';
        $('invite-code').textContent = roomSlug;
        $('rename-input').value = myName;
        $('btn-copy-link').textContent = 'Link kopieren';
        showSheet('invite-sheet');
    });

    $('btn-copy-link').addEventListener('click', function () {
        var link = location.origin + '/board.html?room=' + encodeURIComponent(roomSlug);
        var btn = this;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).then(function () {
                btn.textContent = 'kopiert ✓';
            }, function () {
                btn.textContent = link;
            });
        } else {
            btn.textContent = link;
        }
    });

    $('btn-invite-close').addEventListener('click', function () {
        var newName = $('rename-input').value.trim().slice(0, 20);
        showSheet(null);
        if (newName && newName !== myName) {
            myName = newName;
            store.set(NAME_KEY, myName);
            forceReconnect();
        }
    });

    $('invite-sheet').addEventListener('click', function (e) {
        if (e.target === this) $('btn-invite-close').click();
    });

    $('name-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var name = $('name-input').value.trim().slice(0, 20);
        if (!name) {
            $('name-input').focus();
            return;
        }
        myName = name;
        store.set(NAME_KEY, myName);
        showSheet(null);
        connect();
    });

    // ---------- Tarn-Heft ----------
    var coverOn = false;
    var coverTitle = $('cover-title');
    var coverText = $('cover-text');
    var DEFAULT_COVER_TEXT = [
        'Photosynthese',
        '',
        '6 CO2 + 6 H2O  →  C6H12O6 + 6 O2   (Lichtenergie)',
        '',
        '- findet in den Chloroplasten statt',
        '- Lichtabhängige Reaktion: Thylakoidmembran',
        '    Wasser wird gespalten → O2 entsteht, ATP + NADPH',
        '- Lichtunabhängige Reaktion (Calvin-Zyklus): Stroma',
        '    CO2 wird mit RuBisCO fixiert → Glucose',
        '- Chlorophyll absorbiert v.a. rotes + blaues Licht',
        '    → grünes Licht wird reflektiert, Blätter sind grün',
        '',
        'Einflussfaktoren: Licht, CO2-Gehalt, Temperatur, Wasser',
        ''
    ].join('\n');

    coverTitle.value = store.get('passnote_cover_title') || 'Biologie';
    coverText.value = store.get('passnote_cover_text') || DEFAULT_COVER_TEXT;
    coverTitle.addEventListener('input', function () { store.set('passnote_cover_title', coverTitle.value); });
    coverText.addEventListener('input', function () { store.set('passnote_cover_text', coverText.value); });

    function setCover(on) {
        coverOn = on;
        $('cover').classList.toggle('hidden', !on);
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        hideTrash();
        if (on) {
            $('cover-dot').classList.remove('on');
            var shown = parseInt(store.get('passnote_cover_hints') || '0', 10);
            var hint = $('cover-hint');
            if (shown < 3) {
                store.set('passnote_cover_hints', String(shown + 1));
                hint.style.opacity = '1';
                hint.classList.remove('hidden');
                setTimeout(function () { hint.style.opacity = '0'; }, 2500);
            } else {
                hint.classList.add('hidden');
            }
        }
    }

    $('btn-cover').addEventListener('click', function () { setCover(true); });

    // Zwei Finger doppelt tippen – überall, auch über dem Heft
    var lastTwoFingerTap = 0;
    document.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 2) return;
        // Pencil + aufliegender Handballen sind auch zwei Berührungen – das ist Schreiben, keine Geste
        for (var i = 0; i < e.touches.length; i++) {
            if (e.touches[i].touchType === 'stylus') return;
        }
        var now = Date.now();
        if (drawing || now - lastPenAt < 800) {
            lastTwoFingerTap = 0;
            return;
        }
        if (now - lastTwoFingerTap < 450) {
            lastTwoFingerTap = 0;
            e.preventDefault();
            setCover(!coverOn);
        } else {
            lastTwoFingerTap = now;
        }
    }, { passive: false });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') setCover(!coverOn);
    });

    // ---------- Start ----------
    var resizeTimer = null;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            var stick = isNearBottom();
            resizeComposer();
            paintAll(notesEl);
            if (stick) scrollToBottom();
        }, 150);
    });

    resizeComposer();
    renderAll();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(function () { /* egal */ });
    }

    if (!roomSlug) {
        fatal = true;
        showError('Kein Block.', 'Im Link fehlt der Code. Geh zur Startseite und gib ihn dort ein.', false);
    } else if (!myName) {
        showSheet('name-sheet');
        setTimeout(function () { $('name-input').focus(); }, 50);
    } else {
        connect();
    }
})();
