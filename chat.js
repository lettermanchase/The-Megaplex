/* ============================================================
   💬 MEGAPLEX CHAT — UI module
   Hooks into MegaplexCloud chat API, matches site SFX/style
   ============================================================ */
(function () {
    // === Inject HTML on page load ===
    function injectChatUI() {
        if (document.getElementById('mpx-chat-popup')) return; // already injected

        const html = `
            <button id="mpx-chat-toggle" title="Open Megaplex Chat (C)">
                💬 <span style="letter-spacing:2px;">CHAT</span>
                <span id="mpx-chat-badge">0</span>
            </button>
            <div id="mpx-chat-popup">
                <div id="mpx-chat-header">
                    <span>
                        <span id="mpx-chat-online-dot"></span>
                        <span class="mpx-chat-title-icon">💬</span>MEGAPLEX CHAT
                    </span>
                    <button id="mpx-chat-close" title="Close (Esc)">×</button>
                </div>
                <div id="mpx-chat-messages">
                    <div class="mpx-chat-system">// CONNECTING TO CHAT_NET... //</div>
                </div>
                <div id="mpx-chat-charcount">0/200</div>
                <div id="mpx-chat-input-area">
                    <input type="text" id="mpx-chat-input" placeholder="Type a message..." maxlength="200" />
                    <button id="mpx-chat-send">SEND</button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
        wireUp();
    }

    // === Module state ===
    let unsubscribe = null;
    let unreadCount = 0;
    let lastSeenMessageId = null;
    let popupOpen = false;

    // Optional SFX hook — uses your existing sfx object if present
    function playSfx(name) {
        if (typeof window.sfx === 'object' && typeof window.sfx[name] === 'function') {
            try { window.sfx[name](); } catch (e) {}
        }
    }

    function wireUp() {
        const toggle = document.getElementById('mpx-chat-toggle');
        const popup = document.getElementById('mpx-chat-popup');
        const closeBtn = document.getElementById('mpx-chat-close');
        const input = document.getElementById('mpx-chat-input');
        const sendBtn = document.getElementById('mpx-chat-send');
        const badge = document.getElementById('mpx-chat-badge');
        const charCount = document.getElementById('mpx-chat-charcount');

        // Open / close
        toggle.addEventListener('click', () => {
            playSfx('click');
            togglePopup();
        });
        toggle.addEventListener('mouseenter', () => playSfx('hover'));
        closeBtn.addEventListener('click', () => {
            playSfx('click');
            popup.classList.remove('open');
            popupOpen = false;
        });

        // Char counter & color states
        input.addEventListener('input', () => {
            const len = input.value.length;
            charCount.textContent = `${len}/200`;
            charCount.classList.toggle('warn', len >= 150 && len < 190);
            charCount.classList.toggle('danger', len >= 190);
        });

        // Send message
        async function send() {
            const text = input.value.trim();
            if (!text) return;

            sendBtn.disabled = true;
            sendBtn.textContent = '...';
            const result = await window.MegaplexCloud.sendChatMessage(text);
            sendBtn.disabled = false;
            sendBtn.textContent = 'SEND';

            if (result.success) {
                input.value = '';
                charCount.textContent = '0/200';
                charCount.classList.remove('warn', 'danger');
                input.focus();
                playSfx('click');
            } else if (result.reason === 'not_logged_in') {
                if (typeof window.toast === 'function') {
                    window.toast('Log in to use chat!', 'warning', '🔒');
                } else {
                    alert('You must be logged in to chat!');
                }
            } else if (result.reason === 'cooldown') {
                if (typeof window.toast === 'function') {
                    window.toast('Slow down! Wait a moment between messages.', 'warning', '⏳');
                }
            } else if (result.reason === 'empty') {
                // ignore
            } else {
                if (typeof window.toast === 'function') {
                    window.toast('Failed to send message', 'error', '❌');
                }
            }
        }

        sendBtn.addEventListener('click', send);
        sendBtn.addEventListener('mouseenter', () => playSfx('hover'));
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); send(); }
        });

        // Keyboard shortcut: 'C' to toggle, 'Esc' to close (when not typing)
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                if (e.key === 'Escape' && e.target === input) input.blur();
                return;
            }
            if (e.key === 'Escape' && popupOpen) {
                popup.classList.remove('open');
                popupOpen = false;
            }
            if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                togglePopup();
            }
        });
    }

    function togglePopup() {
        const popup = document.getElementById('mpx-chat-popup');
        const badge = document.getElementById('mpx-chat-badge');
        const input = document.getElementById('mpx-chat-input');
        popup.classList.toggle('open');
        popupOpen = popup.classList.contains('open');
        if (popupOpen) {
            unreadCount = 0;
            badge.classList.remove('show');
            setTimeout(() => input.focus(), 100);
            scrollToBottom();
        }
    }

    function renderMessages(messages) {
        const container = document.getElementById('mpx-chat-messages');
        const popup = document.getElementById('mpx-chat-popup');
        const badge = document.getElementById('mpx-chat-badge');
        if (!container) return;

        const myUid = window.MegaplexCloud.currentFbUser?.uid;
        const wasAtBottom = isScrolledToBottom(container);

        if (messages.length === 0) {
            container.innerHTML = '<div class="mpx-chat-system">// NO MESSAGES YET — BE THE FIRST! //</div>';
            return;
        }

        container.innerHTML = '';
        messages.forEach(msg => {
            const div = document.createElement('div');
            div.className = 'mpx-msg' + (msg.uid === myUid ? ' own' : '');

            // Username (with prestige if present)
            const userSpan = document.createElement('span');
            userSpan.className = 'mpx-msg-user';
            userSpan.textContent = (msg.username || 'PLAYER').toUpperCase() + ':';

            const timeSpan = document.createElement('span');
            timeSpan.className = 'mpx-msg-time';
            timeSpan.textContent = formatTime(msg.createdAt);

            const textSpan = document.createElement('span');
            textSpan.className = 'mpx-msg-text';
            textSpan.textContent = ' ' + msg.text;

            div.appendChild(userSpan);
            div.appendChild(textSpan);
            div.appendChild(timeSpan);
            container.appendChild(div);
        });

        // Unread badge — only count when popup is closed
        const newest = messages[messages.length - 1];
        if (!popup.classList.contains('open') && lastSeenMessageId && newest.id !== lastSeenMessageId) {
            const lastIdx = messages.findIndex(m => m.id === lastSeenMessageId);
            const newOnes = lastIdx >= 0 ? messages.slice(lastIdx + 1) : messages;
            const fromOthers = newOnes.filter(m => m.uid !== myUid).length;
            if (fromOthers > 0) {
                unreadCount += fromOthers;
                badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                badge.classList.add('show');
                playSfx('hover'); // subtle ping
            }
        }
        lastSeenMessageId = newest.id;

        if (wasAtBottom || popup.classList.contains('open')) {
            scrollToBottom();
        }
    }

    function isScrolledToBottom(el) {
        return el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    }
    function scrollToBottom() {
        const el = document.getElementById('mpx-chat-messages');
        if (el) el.scrollTop = el.scrollHeight;
    }
    function formatTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const h = d.getHours();
        const m = d.getMinutes().toString().padStart(2, '0');
        return ` ${h}:${m}`;
    }

    function setLoggedOutState() {
        const container = document.getElementById('mpx-chat-messages');
        const input = document.getElementById('mpx-chat-input');
        const send = document.getElementById('mpx-chat-send');
        if (container) container.innerHTML = '<div class="mpx-chat-system">// LOG IN TO ACCESS CHAT_NET //</div>';
        if (input) { input.disabled = true; input.placeholder = 'Log in to chat...'; }
        if (send) send.disabled = true;
    }

    function setLoggedInState() {
        const input = document.getElementById('mpx-chat-input');
        const send = document.getElementById('mpx-chat-send');
        if (input) { input.disabled = false; input.placeholder = 'Type a message...'; }
        if (send) send.disabled = false;
    }

    // === Boot ===
    function start() {
        injectChatUI();

        // Wait for Megaplex auth, then subscribe
        window.MegaplexCloud.onReady((user) => {
            if (unsubscribe) unsubscribe();
            if (!user || window.MegaplexCloud.isGuestMode) {
                setLoggedOutState();
                return;
            }
            setLoggedInState();
            unsubscribe = window.MegaplexCloud.subscribeToChat(renderMessages);
        });

        // Re-subscribe on auth changes
        window.addEventListener('megaplex-auth-changed', (e) => {
            if (unsubscribe) { unsubscribe(); unsubscribe = null; }
            const user = e.detail.user;
            if (user && !window.MegaplexCloud.isGuestMode) {
                setLoggedInState();
                unsubscribe = window.MegaplexCloud.subscribeToChat(renderMessages);
            } else {
                setLoggedOutState();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();