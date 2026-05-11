/* ====== MEGAPLEX SHARED FIREBASE MODULE (v2.3 — social system added) ====== */
const firebaseConfig = {
    apiKey: "AIzaSyAqDPmHJ6fdvlTaM44-ycnz-kuKBHHEzwg",
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
// ============================================================
window.MegaplexCloud.registeredGameKeys = [
    // ----- Core / shared keys -----
    { key: 'arcadeScores',              type: 'json'   },
    { key: 'glitchStrikersScores',      type: 'json'   },
    { key: 'tttCoins',                  type: 'string' },
    { key: 'tttInventory',              type: 'json'   },
    { key: 'megaplexTokens',            type: 'string' },
    { key: 'megaplexLifetimeXp',        type: 'string' },
    { key: 'megaplexPrestigeRank',      type: 'string' },   // ← ADD THIS
    { key: 'megaplexPrestigeTokens',    type: 'string' },   // ← ADD THIS
    { key: 'megaplexMemberSince',       type: 'string' },   // ← BONUS: also missing
    { key: 'lastCalculatedScoreValue',  type: 'string' },
    { key: 'avatarData',                type: 'json'   },
    { key: 'avatarInventory',           type: 'json'   },
    { key: 'avatarSeenItems',           type: 'json'   },
    { key: 'claimedAchievements',       type: 'json'   },

    // ----- Per-game keys -----
    { key: 'nj2_times',                 type: 'json'   },
    { key: 'clickerFrenzy_save_v2',     type: 'json'   },
    { key: 'arcadeScores_v2',           type: 'json'   },
    { key: 'cb_achievements',           type: 'json'   }
];

window.MegaplexCloud.registerGameKeys = function(keysArray) {
    keysArray.forEach(k => {
        if (!window.MegaplexCloud.registeredGameKeys.find(x => x.key === k.key)) {
            window.MegaplexCloud.registeredGameKeys.push(k);
            console.log('[Megaplex] Registered game key:', k.key, '(' + k.type + ')');
        }
    });
};

// ============================================================
// 🔄 BACKWARDS COMPATIBILITY
// ============================================================
const FIELD_MIGRATIONS = {
    'clickerSave':              'clickerFrenzy_save_v2',
    'codeBreakerScore':         'arcadeScores_v2',
    'codeBreakerAchievements':  'cb_achievements'
};

// ============================================================
// 👤 PUBLIC PROFILE BUILDER
// Builds the publicProfile object from current localStorage state.
// This is the data other players will see when viewing your card.
// ============================================================
window.MegaplexCloud.buildPublicProfile = function() {
    // ---- Pull avatar EQUIPPED cosmetics (not the whole avatarData wrapper) ----
    let avatarEquipped = { color: 'color_default', hat: 'hat_none', bg: 'bg_default', nameplate: null, aura: null };
    try {
        const avatarData = JSON.parse(localStorage.getItem('avatarData')) || {};
        if (avatarData.equipped) {
            avatarEquipped = {
                color: avatarData.equipped.color || 'color_default',
                hat: avatarData.equipped.hat || 'hat_none',
                bg: avatarData.equipped.bg || 'bg_default',
                nameplate: avatarData.equipped.nameplate || null,
                aura: avatarData.equipped.aura || null
            };
        }
    } catch (e) {
        console.warn('[Megaplex] Could not parse avatarData for public profile');
    }

    const tokens = parseInt(localStorage.getItem('megaplexTokens')) || 0;
    const lifetimeXp = parseInt(localStorage.getItem('megaplexLifetimeXp')) || 0;
    const lastScore = parseInt(localStorage.getItem('lastCalculatedScoreValue')) || 0;
    const prestigeRank = parseInt(localStorage.getItem('megaplexPrestigeRank')) || 0;

    // ---- Compute level from XP using the same formula as the hub ----
    let level = 1;
    while ((level + 1) * (level + 1) * 100 <= lifetimeXp) level++;

    // ---- Aggregate top scores from all known score keys ----
    let arcadeScores = {};
    try { arcadeScores = JSON.parse(localStorage.getItem('arcadeScores')) || {}; } catch (e) {}
    let arcadeScoresV2 = {};
    try { arcadeScoresV2 = JSON.parse(localStorage.getItem('arcadeScores_v2')) || {}; } catch (e) {}
    let glitchScores = {};
    try { glitchScores = JSON.parse(localStorage.getItem('glitchStrikersScores')) || {}; } catch (e) {}

    // Merge all scores (prefer the higher value where keys overlap)
    const mergedScores = { ...arcadeScores };
    Object.entries(arcadeScoresV2).forEach(([k, v]) => {
        if (typeof v === 'number') mergedScores[k] = Math.max(mergedScores[k] || 0, v);
    });
    Object.entries(glitchScores).forEach(([k, v]) => {
        if (typeof v === 'number') mergedScores[k] = Math.max(mergedScores[k] || 0, v);
    });

    // Take top 5 (was 3 — friends.html shows 5)
    const topScores = Object.entries(mergedScores)
        .filter(([, v]) => typeof v === 'number' && v > 0)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .reduce((acc, [game, score]) => ({ ...acc, [game]: score }), {});

    // ---- Achievement / trophy count ----
    let claimedAch = [];
    try {
        const raw = JSON.parse(localStorage.getItem('claimedAchievements')) || [];
        claimedAch = Array.isArray(raw) ? raw : Object.keys(raw);
    } catch (e) {}

    // ---- Member-since: keep the earliest date we've ever recorded ----
    let memberSince = localStorage.getItem('megaplexMemberSince');
    if (!memberSince) {
        memberSince = new Date().toISOString();
        localStorage.setItem('megaplexMemberSince', memberSince);
    }

    return {
        avatar: avatarEquipped,                  // ← now flat: { color, hat, bg, nameplate, aura }
        level: level,                            // ← computed level
        prestigeRank: prestigeRank,              // ← prestige rank
        lifetimeXp: lifetimeXp,
        lastCalculatedScore: lastScore,
        totalTokensEarned: tokens,
        trophiesClaimed: claimedAch.length,
        topScores: topScores,
        memberSince: memberSince,
        lastSeen: new Date().toISOString()
    };
};

// ============================================================
// ☁️ CLOUD SAVE  (now also writes publicProfile + usernameLower)
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
        const username = localStorage.getItem('megaplexUsername') || '';
        const publicProfile = window.MegaplexCloud.buildPublicProfile();

        await fbDB.collection('players').doc(u.uid).set({
            username: username,
            usernameLower: username.toLowerCase(),   // for case-insensitive search
            saveData: saveData,
            publicProfile: publicProfile             // visible to other players
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
// 💨 SYNCHRONOUS BEACON SAVE
// ============================================================
window.MegaplexCloud.saveOnExit = function() {
    const u = window.MegaplexCloud.currentFbUser;
    if (window.MegaplexCloud.isGuestMode || !u) return;
    try {
        window.MegaplexCloud.saveToCloud();
    } catch (e) {
        console.warn('[Megaplex] Exit save error:', e);
    }
};

// ============================================================
// 🏆 RECORD SCORE
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
// ☁️ CLOUD LOAD
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

        for (const oldName in FIELD_MIGRATIONS) {
            const newName = FIELD_MIGRATIONS[oldName];
            if (s[oldName] !== undefined && s[newName] === undefined) {
                s[newName] = s[oldName];
                console.log('[Megaplex] 🔄 Migrated cloud field "' + oldName + '" → "' + newName + '"');
            }
        }

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
// 🎁 DAILY CLAIM — cloud-verified, anti-exploit
// ============================================================
window.MegaplexCloud.DAILY_COOLDOWN_MS = 86400000; // 24 hours

window.MegaplexCloud.getCloudDailyClaim = async function() {
    const u = window.MegaplexCloud.currentFbUser;
    if (window.MegaplexCloud.isGuestMode || !u) return 0;
    try {
        const doc = await fbDB.collection('players').doc(u.uid).get();
        return doc.data()?.lastDailyClaim || 0;
    } catch (err) {
        console.warn('[Megaplex] getCloudDailyClaim failed:', err);
        return null;
    }
};

window.MegaplexCloud.syncDailyClaimFromCloud = async function() {
    const cloudTime = await window.MegaplexCloud.getCloudDailyClaim();
    if (cloudTime && cloudTime > 0) {
        localStorage.setItem('megaplexLastDaily', cloudTime);
        console.log('[Megaplex] ✅ Daily claim synced from cloud:', new Date(cloudTime).toLocaleString());
    }
    return cloudTime;
};

window.MegaplexCloud.tryClaimDaily = async function() {
    const u = window.MegaplexCloud.currentFbUser;
    const now = Date.now();

    if (window.MegaplexCloud.isGuestMode || !u) {
        const localLast = parseInt(localStorage.getItem('megaplexLastDaily')) || 0;
        if (now - localLast < window.MegaplexCloud.DAILY_COOLDOWN_MS) {
            return { success: false, reason: 'cooldown', remainingMs: window.MegaplexCloud.DAILY_COOLDOWN_MS - (now - localLast) };
        }
        localStorage.setItem('megaplexLastDaily', now);
        return { success: true, timestamp: now };
    }

    const cloudTime = await window.MegaplexCloud.getCloudDailyClaim();
    if (cloudTime === null) {
        return { success: false, reason: 'error' };
    }
    if (now - cloudTime < window.MegaplexCloud.DAILY_COOLDOWN_MS) {
        localStorage.setItem('megaplexLastDaily', cloudTime);
        return { success: false, reason: 'cooldown', remainingMs: window.MegaplexCloud.DAILY_COOLDOWN_MS - (now - cloudTime) };
    }

    try {
        await fbDB.collection('players').doc(u.uid).set({
            lastDailyClaim: now
        }, { merge: true });
        localStorage.setItem('megaplexLastDaily', now);
        console.log('[Megaplex] ✅ Daily claim recorded in cloud at', new Date(now).toLocaleString());
        return { success: true, timestamp: now };
    } catch (err) {
        console.error('[Megaplex] Daily claim write failed:', err);
        return { success: false, reason: 'error' };
    }
};

// ============================================================
// 👥 SOCIAL SYSTEM — Friends, Profile Cards, Search
// ============================================================

/**
 * Search players by username (case-insensitive prefix match).
 * Excludes the current user from results.
 * @param {string} term - the search string (min 2 chars)
 * @param {number} maxResults - cap on results returned
 * @returns {Promise<Array>} - [{ uid, username, publicProfile }]
 */
window.MegaplexCloud.searchPlayers = async function(term, maxResults = 10) {
    if (!term || term.trim().length < 2) return [];
    const lower = term.toLowerCase().trim();
    const me = window.MegaplexCloud.currentFbUser;

    try {
        const snap = await fbDB.collection('players')
            .where('usernameLower', '>=', lower)
            .where('usernameLower', '<=', lower + '\uf8ff')
            .limit(maxResults)
            .get();

        const results = [];
        snap.forEach(doc => {
            if (me && doc.id === me.uid) return; // skip self
            const d = doc.data();
            results.push({
                uid: doc.id,
                username: d.username || '(unknown)',
                publicProfile: d.publicProfile || {}
            });
        });
        return results;
    } catch (err) {
        console.error('[Megaplex] searchPlayers failed:', err);
        return [];
    }
};

/**
 * Fetches a single player's public profile by UID.
 * @returns {Promise<{uid, username, publicProfile, friends}|null>}
 */
window.MegaplexCloud.getPlayerProfile = async function(uid) {
    if (!uid) return null;
    try {
        const doc = await fbDB.collection('players').doc(uid).get();
        if (!doc.exists) return null;
        const d = doc.data();
        return {
            uid: uid,
            username: d.username || '(unknown)',
            publicProfile: d.publicProfile || {},
            friends: d.friends || []
        };
    } catch (err) {
        console.error('[Megaplex] getPlayerProfile failed:', err);
        return null;
    }
};

/**
 * Fetches the current user's social state (friends + requests).
 * @returns {Promise<{friends: string[], incoming: string[], outgoing: string[]}>}
 */
window.MegaplexCloud.getMySocialState = async function() {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { friends: [], incoming: [], outgoing: [] };
    try {
        const doc = await fbDB.collection('players').doc(u.uid).get();
        const d = doc.data() || {};
        return {
            friends: d.friends || [],
            incoming: (d.friendRequests && d.friendRequests.incoming) || [],
            outgoing: (d.friendRequests && d.friendRequests.outgoing) || []
        };
    } catch (err) {
        console.error('[Megaplex] getMySocialState failed:', err);
        return { friends: [], incoming: [], outgoing: [] };
    }
};

/**
 * Sends a friend request to another player.
 * Adds target to my outgoing list, and me to their incoming list.
 */
window.MegaplexCloud.sendFriendRequest = async function(targetUid) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false, reason: 'not_logged_in' };
    if (u.uid === targetUid) return { success: false, reason: 'self' };

    try {
        // Update both docs in parallel
        await Promise.all([
            fbDB.collection('players').doc(u.uid).set({
                friendRequests: {
                    outgoing: firebase.firestore.FieldValue.arrayUnion(targetUid)
                }
            }, { merge: true }),
            fbDB.collection('players').doc(targetUid).set({
                friendRequests: {
                    incoming: firebase.firestore.FieldValue.arrayUnion(u.uid)
                }
            }, { merge: true })
        ]);
        console.log('[Megaplex] ✅ Friend request sent to', targetUid);
        return { success: true };
    } catch (err) {
        console.error('[Megaplex] sendFriendRequest failed:', err);
        return { success: false, reason: 'error' };
    }
};

/**
 * Accepts a friend request from another player.
 * Adds both UIDs to each other's friends list and clears the requests.
 */
window.MegaplexCloud.acceptFriendRequest = async function(requesterUid) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false, reason: 'not_logged_in' };

    try {
        await Promise.all([
            fbDB.collection('players').doc(u.uid).update({
                friends: firebase.firestore.FieldValue.arrayUnion(requesterUid),
                'friendRequests.incoming': firebase.firestore.FieldValue.arrayRemove(requesterUid)
            }),
            fbDB.collection('players').doc(requesterUid).update({
                friends: firebase.firestore.FieldValue.arrayUnion(u.uid),
                'friendRequests.outgoing': firebase.firestore.FieldValue.arrayRemove(u.uid)
            })
        ]);
        console.log('[Megaplex] ✅ Accepted friend request from', requesterUid);
        return { success: true };
    } catch (err) {
        console.error('[Megaplex] acceptFriendRequest failed:', err);
        return { success: false, reason: 'error' };
    }
};

/**
 * Declines an incoming friend request.
 */
window.MegaplexCloud.declineFriendRequest = async function(requesterUid) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false, reason: 'not_logged_in' };

    try {
        await Promise.all([
            fbDB.collection('players').doc(u.uid).update({
                'friendRequests.incoming': firebase.firestore.FieldValue.arrayRemove(requesterUid)
            }),
            fbDB.collection('players').doc(requesterUid).update({
                'friendRequests.outgoing': firebase.firestore.FieldValue.arrayRemove(u.uid)
            })
        ]);
        console.log('[Megaplex] Declined request from', requesterUid);
        return { success: true };
    } catch (err) {
        console.error('[Megaplex] declineFriendRequest failed:', err);
        return { success: false, reason: 'error' };
    }
};

/**
 * Cancels an outgoing friend request you previously sent.
 */
window.MegaplexCloud.cancelFriendRequest = async function(targetUid) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false, reason: 'not_logged_in' };

    try {
        await Promise.all([
            fbDB.collection('players').doc(u.uid).update({
                'friendRequests.outgoing': firebase.firestore.FieldValue.arrayRemove(targetUid)
            }),
            fbDB.collection('players').doc(targetUid).update({
                'friendRequests.incoming': firebase.firestore.FieldValue.arrayRemove(u.uid)
            })
        ]);
        return { success: true };
    } catch (err) {
        console.error('[Megaplex] cancelFriendRequest failed:', err);
        return { success: false, reason: 'error' };
    }
};

/**
 * Removes a friend (mutual unfriend).
 */
window.MegaplexCloud.removeFriend = async function(friendUid) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false, reason: 'not_logged_in' };

    try {
        await Promise.all([
            fbDB.collection('players').doc(u.uid).update({
                friends: firebase.firestore.FieldValue.arrayRemove(friendUid)
            }),
            fbDB.collection('players').doc(friendUid).update({
                friends: firebase.firestore.FieldValue.arrayRemove(u.uid)
            })
        ]);
        console.log('[Megaplex] Removed friend', friendUid);
        return { success: true };
    } catch (err) {
        console.error('[Megaplex] removeFriend failed:', err);
        return { success: false, reason: 'error' };
    }
};

/**
 * Subscribes to live changes on the current user's social data.
 * Fires the callback whenever friends, incoming, or outgoing change.
 *
 * @param {Function} callback - receives { friends: [profiles], incoming: [uids], outgoing: [uids] }
 * @returns {Function} unsubscribe function — call it to stop listening
 */
window.MegaplexCloud.subscribeToSocial = function(callback) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) {
        console.warn('[Megaplex] subscribeToSocial called without logged-in user');
        return () => {};
    }

    return fbDB.collection('players').doc(u.uid).onSnapshot(async (snap) => {
        const d = snap.data() || {};
        const friendUids = d.friends || [];
        const incoming = (d.friendRequests && d.friendRequests.incoming) || [];
        const outgoing = (d.friendRequests && d.friendRequests.outgoing) || [];

        // Resolve friend UIDs into full profile objects (parallel fetch)
        const friendProfiles = await Promise.all(
            friendUids.map(uid => window.MegaplexCloud.getPlayerProfile(uid))
        );

        callback({
            friends: friendProfiles.filter(Boolean),
            incoming: incoming,
            outgoing: outgoing
        });
    }, (err) => {
        console.error('[Megaplex] subscribeToSocial error:', err);
    });
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

            // ----- Backfill: ensure usernameLower & publicProfile exist on the doc -----
            // This makes existing accounts searchable without requiring them to save first.
            try {
                const username = localStorage.getItem('megaplexUsername') || '';
                await fbDB.collection('players').doc(user.uid).set({
                    usernameLower: username.toLowerCase(),
                    publicProfile: window.MegaplexCloud.buildPublicProfile()
                }, { merge: true });
            } catch (e) {
                console.warn('[Megaplex] Profile backfill skipped:', e);
            }
        }
    } else {
        window.MegaplexCloud.currentFbUser = null;
        if (localStorage.getItem('megaplexGuestMode') === 'true') {
            window.MegaplexCloud.isGuestMode = true;
        }
    }

    // ----- INITIAL READY: fire onReady callbacks the FIRST time only -----
    if (!window.MegaplexCloud.isReady) {
        window.MegaplexCloud.isReady = true;
        window.MegaplexCloud.onReadyCallbacks.forEach(cb => {
            try { cb(window.MegaplexCloud.currentFbUser); }
            catch (e) { console.error('[Megaplex] onReady callback error:', e); }
        });
        window.MegaplexCloud.onReadyCallbacks = [];
    }

    // ----- ALWAYS fire the auth-changed event so the page can update UI -----
    window.dispatchEvent(new CustomEvent('megaplex-auth-ready', {
        detail: { user: window.MegaplexCloud.currentFbUser }
    }));
    window.dispatchEvent(new CustomEvent('megaplex-auth-changed', {
        detail: { user: window.MegaplexCloud.currentFbUser }
    }));
});

// ============================================================
// 💾 AUTO-SAVE
// ============================================================
setInterval(() => window.MegaplexCloud.saveToCloud(), 30000);

document.addEventListener('visibilitychange', () => {
    if (document.hidden) window.MegaplexCloud.saveOnExit();
});

window.addEventListener('pagehide', () => window.MegaplexCloud.saveOnExit());
window.addEventListener('beforeunload', () => window.MegaplexCloud.saveOnExit());

console.log('[Megaplex] Firebase module loaded (v2.3, ' +
    window.MegaplexCloud.registeredGameKeys.length + ' keys registered, social system online)');