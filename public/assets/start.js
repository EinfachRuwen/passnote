(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }

    function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } }
    function sessionSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* egal */ } }

    var nameInput = $('name');
    var codeInput = $('code');
    var joinPw = $('join-password');
    var joinErr = $('join-error');
    var joinBtn = $('join-btn');

    nameInput.value = storeGet('passnote_username') || '';

    function saveName() {
        var name = nameInput.value.trim().slice(0, 20);
        if (name) storeSet('passnote_username', name);
        return name;
    }

    function requireName() {
        if (saveName()) return true;
        nameInput.focus();
        nameInput.placeholder = 'Erst deinen Namen …';
        return false;
    }

    function normalizeCode(v) {
        // Erlaubt auch eingefügte Links
        var m = v.match(/room=([\w-]+)/);
        return (m ? m[1] : v).trim().toLowerCase().replace(/\s+/g, '-');
    }

    function openBoard(slug, password) {
        if (password) sessionSet('passnote_pw_' + slug, password);
        location.href = '/board.html?room=' + encodeURIComponent(slug);
    }

    function showJoinError(text) {
        joinErr.textContent = text;
        joinErr.classList.remove('hidden');
    }

    codeInput.addEventListener('input', function () {
        joinErr.classList.add('hidden');
        joinPw.classList.add('hidden');
    });

    $('join-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var slug = normalizeCode(codeInput.value);
        if (!slug) {
            codeInput.focus();
            return;
        }
        if (!requireName()) return;

        if (!joinPw.classList.contains('hidden')) {
            openBoard(slug, joinPw.value);
            return;
        }

        joinBtn.disabled = true;
        fetch('/api/rooms/' + encodeURIComponent(slug) + '/info')
            .then(function (res) {
                if (res.status === 404) throw new Error('not-found');
                if (!res.ok) throw new Error('server');
                return res.json();
            })
            .then(function (info) {
                joinBtn.disabled = false;
                if (info.hasPassword) {
                    joinPw.classList.remove('hidden');
                    joinPw.focus();
                } else {
                    openBoard(slug);
                }
            })
            .catch(function (err) {
                joinBtn.disabled = false;
                showJoinError(err.message === 'not-found' ? 'Den Code gibt es nicht. Vertippt?' : 'Gerade keine Verbindung.');
            });
    });

    $('create-form').addEventListener('submit', function (e) {
        e.preventDefault();
        if (!requireName()) return;
        var btn = $('create-btn');
        var password = $('create-password').value;
        btn.disabled = true;
        fetch('/api/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password })
        })
            .then(function (res) {
                if (!res.ok) throw new Error('server');
                return res.json();
            })
            .then(function (data) {
                openBoard(data.slug, password);
            })
            .catch(function () {
                btn.disabled = false;
                $('create-error').textContent = 'Konnte keinen Block anlegen.';
                $('create-error').classList.remove('hidden');
            });
    });

    // Zuletzt benutzte Blöcke
    var recent = [];
    try { recent = JSON.parse(storeGet('passnote_recent')) || []; } catch (e) { recent = []; }
    if (Array.isArray(recent) && recent.length) {
        var list = $('recent');
        recent.forEach(function (slug) {
            if (typeof slug !== 'string') return;
            var li = document.createElement('li');
            var a = document.createElement('a');
            a.href = '/board.html?room=' + encodeURIComponent(slug);
            a.textContent = slug;
            a.addEventListener('click', function (e) {
                if (!requireName()) e.preventDefault();
            });
            li.appendChild(a);
            list.appendChild(li);
        });
        $('recent-wrap').classList.remove('hidden');
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(function () { /* egal */ });
    }
})();
