/* ====== MEGAPLEX SHARED FIREBASE MODULE (v2.1 — registry-based) ====== */
const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_KEY,
    authDomain: "the-megaplex.firebaseapp.com",
    projectId: "the-megaplex",
    storageBucket: "the-megaplex.firebasestorage.app",
    messagingSenderId: "40159978468",
    appId: "1:40159978468:web:5f271a998adba27b765df1",
    measurementId: "G-KKPYGQ3BHN"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const fbAuth = firebase.auth();
const fbDB = firebase.firestore();

window.MegaplexCloud = {
    currentFbUser: null,
    isGuestMode: localStorage.getItem('megaplexGuestMode') === 'true',
    isReady: false,
    onReadyCallbacks: [],
    _savePending: false
};

// ====== onReady HELPER ======
window.MegaplexCloud.onReady = function(callback) {
    if (window.MegaplexCloud.isReady) callback(window.MegaplexCloud.currentFbUser);
    else window.MegaplexCloud.onReadyCallbacks.push(callback);
};

// ============================================================
// 📋 GAME KEY REGISTRY
// Every game registers which localStorage keys it owns.
// Format: { key: 'localStorage_key_name', type: 'json' | 'string' }
// ============================================================
window.MegaplexCloud.registeredGameKeys = [
    // ----- Core / shared keys (always synced) -----
    { key: 'arcadeScores',              type: 'json'   },
    { key: 'glitchStrikersScores',      type: 'json'   },
    { key: 'tttCoins',                  type: 'string' },
    { key: 'tttInventory',              type: 'json'   },
    { key: 'megaplexTokens',            type: 'string' },
    { key: 'megaplexLifetimeXp',        type: 'string' },
    { key: 'lastCalculatedScoreValue',  type: 'string' },
    { key: 'avatarData',                type: 'json'   },
    { key: 'avatarInventory',           type: 'json'   },  // ← Owned shop items
    { key: 'avatarSeenItems',           type: 'json'   },  // ← "NEW" badge tracking
    { key: 'claimedAchievements',       type: 'json'   },

    // ----- Per-game keys -----
    { key: 'nj2_times',                 type: 'json'   },  // Neon Jumper 2 best times
    { key: 'clickerFrenzy_save_v2',     type: 'json'   },  // Clicker Frenzy full save
    { key: 'arcadeScores_v2',           type: 'json'   },  // Code Breaker scores
    { key: 'cb_achievements',           type: 'json'   }   // Code Breaker achievements
];

// Public API: any game can call this to register additional keys it owns.
window.MegaplexCloud.registerGameKeys = function(keysArray) {
    keysArray.forEach(k => {
        if (!window.MegaplexCloud.registeredGameKeys.find(x => x.key === k.key)) {
            window.MegaplexCloud.registeredGameKeys.push(k);
            console.log('[Megaplex] Registered game key:', k.key, '(' + k.type + ')');
        }
    });
};

// ============================================================
// 🔄 BACKWARDS COMPATIBILITY — old → new field name migration
// (Used when loading from cloud, in case old saves use legacy names.)
// ============================================================
const FIELD_MIGRATIONS = {
    'clickerSave':              'clickerFrenzy_save_v2',
    'codeBreakerScore':         'arcadeScores_v2',
    'codeBreakerAchievements':  'cb_achievements'
};

// ============================================================
// ☁️ CLOUD SAVE — auto-driven by registry
// ============================================================
window.MegaplexCloud.saveToCloud = async function() {
    const u = window.MegaplexCloud.currentFbUser;
    if (window.MegaplexCloud.isGuestMode || !u) {
        console.log('[Megaplex] Save skipped (guest or not logged in)');
        return false;
    }
    if (window.MegaplexCloud._savePending) return false;
    window.MegaplexCloud._savePending = true;

    const saveData = { lastSaved: new Date().toISOString() };

    window.MegaplexCloud.registeredGameKeys.forEach(({ key, type }) => {
        const raw = localStorage.getItem(key);
        if (raw === null || raw === undefined) return;
        if (type === 'json') {
            try {
                saveData[key] = JSON.parse(raw);
            } catch (e) {
                console.warn('[Megaplex] Bad JSON for key "' + key + '" — skipped');
            }
        } else {
            saveData[key] = raw;
        }
    });

    try {
        await fbDB.collection('players').doc(u.uid).set({
            username: localStorage.getItem('megaplexUsername'),
            saveData: saveData
        }, { merge: true });
        console.log('[Megaplex] ✅ Cloud save OK at', new Date().toLocaleTimeString());
        return true;
    } catch (err) {
        console.error('[Megaplex] ❌ Cloud save failed:', err);
        return false;
    } finally {
        window.MegaplexCloud._savePending = false;
    }
};

// ============================================================
// 💨 SYNCHRONOUS BEACON SAVE — for page unload moments
// Uses navigator.sendBeacon-style approach via fetch keepalive,
// so the request survives even if the tab is being closed.
// ============================================================
window.MegaplexCloud.saveOnExit = function() {
    const u = window.MegaplexCloud.currentFbUser;
    if (window.MegaplexCloud.isGuestMode || !u) return;

    // Fire the standard async save — Firebase SDK uses keepalive internally
    // and most modern browsers will let it complete on pagehide/beforeunload.
    try {
        window.MegaplexCloud.saveToCloud();
    } catch (e) {
        console.warn('[Megaplex] Exit save error:', e);
    }
};

// ============================================================
// 🏆 RECORD SCORE — convenience helper for leaderboard entries
// Stores best in arcadeScores[key], pushes to cloud if new best.
// ============================================================
window.MegaplexCloud.recordScore = async function(key, value, higherIsBetter = true) {
    let scores = JSON.parse(localStorage.getItem('arcadeScores')) || {};
    const current = scores[key];
    let isNewBest = false;

    if (current === undefined || current === null) {
        isNewBest = true;
    } else if (higherIsBetter && value > current) {
        isNewBest = true;
    } else if (!higherIsBetter && value < current) {
        isNewBest = true;
    }

    if (isNewBest) {
        scores[key] = value;
        localStorage.setItem('arcadeScores', JSON.stringify(scores));
        console.log('[Megaplex] 🏆 New best for "' + key + '": ' + value);
        await window.MegaplexCloud.saveToCloud();
    }
    return isNewBest;
};

// ============================================================
// ☁️ CLOUD LOAD — auto-driven by registry, with migration
// ============================================================
window.MegaplexCloud.loadFromCloud = async function(uid) {
    try {
        const doc = await fbDB.collection('players').doc(uid).get();
        if (!doc.exists) {
            console.warn('[Megaplex] Ghost account — signing out');
            await fbAuth.signOut();
            localStorage.removeItem('megaplexUsername');
            alert('Your account profile no longer exists. Please create a new account.');
            return false;
        }

        const data = doc.data();
        if (!data.username) {
            await fbAuth.signOut();
            localStorage.removeItem('megaplexUsername');
            alert('Account corrupted. Please create a new account.');
            return false;
        }

        localStorage.setItem('megaplexUsername', data.username);
        const s = data.saveData || {};

        // ----- Migrate legacy field names -----
        for (const oldName in FIELD_MIGRATIONS) {
            const newName = FIELD_MIGRATIONS[oldName];
            if (s[oldName] !== undefined && s[newName] === undefined) {
                s[newName] = s[oldName];
                console.log('[Megaplex] 🔄 Migrated cloud field "' + oldName + '" → "' + newName + '"');
            }
        }

        // ----- Apply registry-driven load -----
        window.MegaplexCloud.registeredGameKeys.forEach(({ key, type }) => {
            if (s[key] === undefined || s[key] === null) return;
            if (type === 'json') {
                localStorage.setItem(key, JSON.stringify(s[key]));
            } else {
                localStorage.setItem(key, s[key]);
            }
        });

        console.log('[Megaplex] ✅ Cloud load OK for', data.username);
        return true;
    } catch (err) {
        console.error('[Megaplex] ❌ Cloud load failed:', err);
        return false;
    }
};

// ============================================================
// 🔐 AUTH STATE LISTENER
// ============================================================
fbAuth.onAuthStateChanged(async (user) => {
    if (user) {
        const loaded = await window.MegaplexCloud.loadFromCloud(user.uid);
        if (!loaded) {
            window.MegaplexCloud.currentFbUser = null;
        } else {
            window.MegaplexCloud.currentFbUser = user;
            window.MegaplexCloud.isGuestMode = false;
        }
    } else {
        window.MegaplexCloud.currentFbUser = null;
        if (localStorage.getItem('megaplexGuestMode') === 'true') {
            window.MegaplexCloud.isGuestMode = true;
        }
    }

    window.MegaplexCloud.isReady = true;

    // Fire all queued onReady callbacks
    window.MegaplexCloud.onReadyCallbacks.forEach(cb => {
        try { cb(window.MegaplexCloud.currentFbUser); }
        catch (e) { console.error('[Megaplex] onReady callback error:', e); }
    });
    window.MegaplexCloud.onReadyCallbacks = [];

    window.dispatchEvent(new CustomEvent('megaplex-auth-ready', {
        detail: { user: window.MegaplexCloud.currentFbUser }
    }));
});

// ============================================================
// 💾 AUTO-SAVE — periodic + page exit triggers
// ============================================================
setInterval(() => window.MegaplexCloud.saveToCloud(), 30000);

document.addEventListener('visibilitychange', () => {
    if (document.hidden) window.MegaplexCloud.saveOnExit();
});

// pagehide fires reliably on navigation away, tab close, mobile background, etc.
window.addEventListener('pagehide', () => window.MegaplexCloud.saveOnExit());

// beforeunload as a final safety net
window.addEventListener('beforeunload', () => window.MegaplexCloud.saveOnExit());

console.log('[Megaplex] Firebase module loaded (registry mode, ' +
    window.MegaplexCloud.registeredGameKeys.length + ' keys registered)');
