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

// ============================================================
// 🧹 ONE-TIME MIGRATION: clear pre-fix exploit session scores
// ============================================================
// Before the wager-baseline fix shipped, megaplexSessionScores could
// contain a player's full lifetime score (e.g., 132,431,159 for Clicker).
// We wipe that ONCE per user, then set a flag so we never wipe again.
// After this runs, session scores persist normally between game and
// friends pages, exactly as they should.
(function migrateLegacySessionScores() {
    try {
        const MIGRATION_FLAG = 'megaplexMigration_sessionScores_v1';
        if (localStorage.getItem(MIGRATION_FLAG) === 'done') return;

        const raw = localStorage.getItem('megaplexSessionScores');
        if (raw) {
            console.log('[Megaplex] 🧹 First-load migration: wiping legacy session scores');
            localStorage.removeItem('megaplexSessionScores');
        }
        localStorage.setItem(MIGRATION_FLAG, 'done');
        console.log('[Megaplex] ✅ Session score migration complete (will not run again)');
    } catch (e) {
        console.warn('[Megaplex] Migration error:', e);
    }
})();

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
    { key: 'megaplexPrestigeRank',      type: 'string' },
    { key: 'megaplexPrestigeTokens',    type: 'string' },
    { key: 'megaplexMemberSince',       type: 'string' },
    { key: 'lastCalculatedScoreValue',  type: 'string' },
    { key: 'avatarData',                type: 'json'   },
    { key: 'avatarInventory',           type: 'json'   },
    { key: 'avatarSeenItems',           type: 'json'   },
    { key: 'claimedAchievements',       type: 'json'   },

    // Add inside registeredGameKeys array
    { key: 'megaplexBounties',          type: 'json'   },
    { key: 'megaplexBountyDay',         type: 'string' },
    
    // ----- 🎯 Wager System keys -----
    { key: 'megaplexSessionScores',     type: 'json'   },   // session score tracker (shared with bounties)
    { key: 'megaplexLastKnownScores',   type: 'json'   },   // for detecting score changes
    { key: 'megaplexWagerStats',        type: 'json'   },   // local W/L stats cache

    // ----- 🔥 NEW: Daily Streak System keys -----
    { key: 'megaplexStreak',            type: 'string' },   // current streak count
    { key: 'megaplexCycleDay',          type: 'string' },   // 0-6 within the 7-day cycle
    { key: 'megaplexStreakUnlocks',     type: 'json'   },   // array of unlocked milestone IDs
    { key: 'megaplexActivePerks',       type: 'json'   },   // array of active perk IDs

    // ----- Per-game keys -----
    { key: 'nj2_times',                 type: 'json'   },
    { key: 'clickerFrenzy_save_v2',     type: 'json'   },
    { key: 'arcadeScores_v2',           type: 'json'   },
    { key: 'cb_achievements',           type: 'json'   },
    
    
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

                                // 🔒 ACCOUNT ISOLATION FIX
        window.MegaplexCloud.registeredGameKeys.forEach(({ key, type }) => {
            if (s[key] !== undefined && s[key] !== null) {
                if (type === 'json') {
                    localStorage.setItem(key, JSON.stringify(s[key]));
                } else {
                    localStorage.setItem(key, s[key]);
                }
            } else {
                localStorage.removeItem(key);
            }
        });

        // 🧹 ONE-TIME CLOUD CLEANUP: wipe pre-fix exploit session scores
        // from the cloud the first time this account is loaded after the fix.
        // Uses a per-account flag so it runs exactly once per account.
        try {
            const CLOUD_FLAG = 'megaplexCloudMigration_sessionScores_v1_' + uid;
            if (localStorage.getItem(CLOUD_FLAG) !== 'done') {
                if (s.megaplexSessionScores) {
                    console.log('[Megaplex] 🧹 First-load cloud migration: wiping legacy cloud session scores for', data.username);
                    // Local copy: clear immediately
                    localStorage.removeItem('megaplexSessionScores');
                    // Cloud copy: overwrite with empty object on next save
                    // (saveToCloud reads localStorage, so empty local → empty cloud)
                    await fbDB.collection('players').doc(uid).set({
                        saveData: { megaplexSessionScores: {} }
                    }, { merge: true });
                    console.log('[Megaplex] ✅ Cloud session scores cleared for', data.username);
                }
                localStorage.setItem(CLOUD_FLAG, 'done');
            }
        } catch (e) {
            console.warn('[Megaplex] Cloud migration error:', e);
        }

        // Also clear non-registered account-specific keys so they don't leak
        ['recentlyPlayed', 'megaplexLastDaily'].forEach(key => {
            if (s[key] !== undefined && s[key] !== null) {
                if (typeof s[key] === 'object') {
                    localStorage.setItem(key, JSON.stringify(s[key]));
                } else {
                    localStorage.setItem(key, s[key]);
                }
            } else {
                localStorage.removeItem(key);
            }
        });

        console.log('[Megaplex] ✅ Cloud load OK for', data.username);
        return true;

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
// ⚔️ WAGER SYSTEM — Friend-vs-Friend Token Battles
// ============================================================

// ---- Wager-compatible games registry ----
// scoreType: 'higher' = bigger number wins | 'lower' = smaller number wins
window.MegaplexCloud.WAGER_GAMES = [
    { key: 'snake',            title: '🐍 Snake Classic',     scoreType: 'higher', link: 'snake.html' },
    { key: 'clicker',          title: '👆 Clicker Frenzy',    scoreType: 'higher', link: 'clicker.html' },
    { key: 'math',             title: '🧠 Quick Math',        scoreType: 'higher', link: 'math.html' },
    { key: 'guesser',          title: '🔐 Code Breaker',      scoreType: 'higher', link: 'guesser.html' },
    { key: 'asteroids',        title: '☄️ Quantum Asteroids', scoreType: 'higher', link: 'asteroids.html' },
    { key: 'tanks_score',      title: '💣 Plasma Tanks',      scoreType: 'higher', link: 'tanks.html' },
    { key: 'fps',              title: '🔫 System Breach',     scoreType: 'higher', link: 'fps.html' },
    { key: 'cyberrunner',      title: '🏃‍♂️ Cyber Runner',      scoreType: 'higher', link: 'runner.html' },
    { key: 'nj2_score',        title: '⚡ Neon Jumper 2',     scoreType: 'higher', link: 'neonjumper2.html' },
    { key: 'glitch_score',     title: '💥 Glitch Brawler',    scoreType: 'higher', link: 'glitch_brawler.html' },
    { key: 'glitch_strikers',  title: '⚔️ Glitch Strikers',   scoreType: 'higher', link: 'glitch_strikers.html' },
    { key: 'ttt',              title: '⭕ Tic-Tac-Toe',       scoreType: 'higher', link: 'tictactoe.html' },
    { key: 'reaction',         title: '⚡ Reaction Tester',   scoreType: 'lower',  link: 'reaction.html' },
    { key: 'memory',           title: '👁️ Memory Match',      scoreType: 'lower',  link: 'memory.html' },
    { key: 'platformer_deaths',title: '🏃 Neon Jumper',       scoreType: 'lower',  link: 'platformer.html' },
    { key: 'racer_best_time',  title: '🏎️ Vaporwave Racer',   scoreType: 'lower',  link: 'racer.html' }
];

// ---- Wager amount tiers (in tokens) ----
window.MegaplexCloud.WAGER_AMOUNTS = [
    100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000, 10000000, 100000000
];

// ---- House cut configuration ----
window.MegaplexCloud.WAGER_HOUSE_CUT_WIN = 0.10;  // 10% taken from pot when there's a winner
window.MegaplexCloud.WAGER_HOUSE_CUT_TIE = 0.05;  // 5% per side on tie/expire-no-play

// ---- Wager duration ----
window.MegaplexCloud.WAGER_DURATION_MS = 86400000; // 24 hours after BOTH accept

// ---- Helper: lookup game info ----
window.MegaplexCloud.getWagerGameInfo = function(gameKey) {
    return window.MegaplexCloud.WAGER_GAMES.find(g => g.key === gameKey) || null;
};

// ---- Helper: format token amount nicely ----
window.MegaplexCloud.formatTokenAmount = function(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k';
    return n.toString();
};

/**
 * Send a wager challenge to a friend.
 * Atomically deducts the challenger's tokens (escrow) and creates the wager doc.
 */
window.MegaplexCloud.sendWagerChallenge = async function(opponentUid, gameKey, amount) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false, reason: 'not_logged_in' };
    if (u.uid === opponentUid) return { success: false, reason: 'self' };

    const gameInfo = window.MegaplexCloud.getWagerGameInfo(gameKey);
    if (!gameInfo) return { success: false, reason: 'invalid_game' };
    if (!window.MegaplexCloud.WAGER_AMOUNTS.includes(amount)) {
        return { success: false, reason: 'invalid_amount' };
    }

    // Validate friendship + opponent existence
    const myDocRef = fbDB.collection('players').doc(u.uid);
    const oppDocRef = fbDB.collection('players').doc(opponentUid);

    try {
        // Use a transaction to atomically check + deduct tokens + create wager
        const wagerRef = fbDB.collection('wagers').doc();
        await fbDB.runTransaction(async (tx) => {
            const myDoc = await tx.get(myDocRef);
            const oppDoc = await tx.get(oppDocRef);
            if (!myDoc.exists) throw new Error('your_doc_missing');
            if (!oppDoc.exists) throw new Error('opponent_missing');

            const myData = myDoc.data();
            const oppData = oppDoc.data();

            // Must be friends
            const myFriends = myData.friends || [];
            if (!myFriends.includes(opponentUid)) throw new Error('not_friends');

            // Check token balance (read from saveData since that's where it lives)
            const myTokens = parseInt((myData.saveData && myData.saveData.megaplexTokens) || 0);
            if (myTokens < amount) throw new Error('insufficient_tokens');

            // Deduct tokens from challenger
            const newBalance = myTokens - amount;
            tx.set(myDocRef, {
                saveData: { megaplexTokens: String(newBalance) }
            }, { merge: true });

            // Create the wager doc
            const now = Date.now();
            tx.set(wagerRef, {
                challenger: {
                    uid: u.uid,
                    username: myData.username,
                    avatar: (myData.publicProfile && myData.publicProfile.avatar) || {},
                    score: null,
                    submittedAt: null,
                    claimed: false
                },
                opponent: {
                    uid: opponentUid,
                    username: oppData.username,
                    avatar: (oppData.publicProfile && oppData.publicProfile.avatar) || {},
                    score: null,
                    submittedAt: null,
                    claimed: false
                },
                game: {
                    key: gameInfo.key,
                    title: gameInfo.title,
                    scoreType: gameInfo.scoreType,
                    link: gameInfo.link
                },
                amount: amount,
                pot: amount * 2,
                status: 'pending',
                winner: null,
                createdAt: now,
                acceptedAt: null,
                expiresAt: null,
                completedAt: null
            });
        });

        // Sync local token balance with cloud (we just deducted)
        const myFresh = await myDocRef.get();
        const newTokens = parseInt(myFresh.data().saveData.megaplexTokens) || 0;
        localStorage.setItem('megaplexTokens', String(newTokens));

        console.log('[Megaplex] ⚔️ Wager challenge sent — escrowed', amount, 'tokens');
        return { success: true, wagerId: wagerRef.id, newTokens };
    } catch (err) {
        console.error('[Megaplex] sendWagerChallenge failed:', err);
        return { success: false, reason: err.message || 'error' };
    }
};

/**
 * Accept an incoming wager challenge.
 * Atomically deducts opponent's tokens & flips status to 'active'.
 */
window.MegaplexCloud.acceptWager = async function(wagerId) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false, reason: 'not_logged_in' };

    const wagerRef = fbDB.collection('wagers').doc(wagerId);
    const myDocRef = fbDB.collection('players').doc(u.uid);

    try {
        await fbDB.runTransaction(async (tx) => {
            const wagerDoc = await tx.get(wagerRef);
            const myDoc = await tx.get(myDocRef);
            if (!wagerDoc.exists) throw new Error('wager_missing');
            if (!myDoc.exists) throw new Error('your_doc_missing');

            const w = wagerDoc.data();
            if (w.opponent.uid !== u.uid) throw new Error('not_your_wager');
            if (w.status !== 'pending') throw new Error('already_resolved');

            const myTokens = parseInt((myDoc.data().saveData && myDoc.data().saveData.megaplexTokens) || 0);
            if (myTokens < w.amount) throw new Error('insufficient_tokens');

            // Deduct opponent tokens
            tx.set(myDocRef, {
                saveData: { megaplexTokens: String(myTokens - w.amount) }
            }, { merge: true });

            // Activate the wager
            const now = Date.now();
            tx.update(wagerRef, {
                status: 'active',
                acceptedAt: now,
                expiresAt: now + window.MegaplexCloud.WAGER_DURATION_MS
            });
        });

        // Sync local tokens
        const myFresh = await myDocRef.get();
        const newTokens = parseInt(myFresh.data().saveData.megaplexTokens) || 0;
        localStorage.setItem('megaplexTokens', String(newTokens));

        // Clear session score for this wager's game so it's a fresh challenge
        const wagerFresh = await wagerRef.get();
        const gameKey = wagerFresh.data().game.key;
        const sessions = JSON.parse(localStorage.getItem('megaplexSessionScores')) || {};
        delete sessions[gameKey];
        localStorage.setItem('megaplexSessionScores', JSON.stringify(sessions));

        console.log('[Megaplex] ⚔️ Wager accepted!');
        return { success: true, newTokens };
    } catch (err) {
        console.error('[Megaplex] acceptWager failed:', err);
        return { success: false, reason: err.message || 'error' };
    }
};

/**
 * Decline an incoming wager. Refunds the challenger.
 */
window.MegaplexCloud.declineWager = async function(wagerId) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false, reason: 'not_logged_in' };

    const wagerRef = fbDB.collection('wagers').doc(wagerId);

    try {
        await fbDB.runTransaction(async (tx) => {
            const wagerDoc = await tx.get(wagerRef);
            if (!wagerDoc.exists) throw new Error('wager_missing');
            const w = wagerDoc.data();
            if (w.opponent.uid !== u.uid) throw new Error('not_your_wager');
            if (w.status !== 'pending') throw new Error('already_resolved');

            // Refund challenger
            const challengerRef = fbDB.collection('players').doc(w.challenger.uid);
            const challengerDoc = await tx.get(challengerRef);
            const cTokens = parseInt((challengerDoc.data().saveData && challengerDoc.data().saveData.megaplexTokens) || 0);
            tx.set(challengerRef, {
                saveData: { megaplexTokens: String(cTokens + w.amount) }
            }, { merge: true });

            // Mark declined
            tx.update(wagerRef, {
                status: 'declined',
                completedAt: Date.now()
            });
        });
        console.log('[Megaplex] Wager declined, challenger refunded');
        return { success: true };
    } catch (err) {
        console.error('[Megaplex] declineWager failed:', err);
        return { success: false, reason: err.message || 'error' };
    }
};

/**
 * Cancel an outgoing pending wager. Refunds yourself.
 */
window.MegaplexCloud.cancelWager = async function(wagerId) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false, reason: 'not_logged_in' };

    const wagerRef = fbDB.collection('wagers').doc(wagerId);
    const myDocRef = fbDB.collection('players').doc(u.uid);

    try {
        await fbDB.runTransaction(async (tx) => {
            const wagerDoc = await tx.get(wagerRef);
            const myDoc = await tx.get(myDocRef);
            if (!wagerDoc.exists) throw new Error('wager_missing');
            const w = wagerDoc.data();
            if (w.challenger.uid !== u.uid) throw new Error('not_your_wager');
            if (w.status !== 'pending') throw new Error('already_resolved');

            // Refund self
            const myTokens = parseInt((myDoc.data().saveData && myDoc.data().saveData.megaplexTokens) || 0);
            tx.set(myDocRef, {
                saveData: { megaplexTokens: String(myTokens + w.amount) }
            }, { merge: true });

            tx.update(wagerRef, {
                status: 'cancelled',
                completedAt: Date.now()
            });
        });

        const myFresh = await myDocRef.get();
        const newTokens = parseInt(myFresh.data().saveData.megaplexTokens) || 0;
        localStorage.setItem('megaplexTokens', String(newTokens));
        return { success: true, newTokens };
    } catch (err) {
        console.error('[Megaplex] cancelWager failed:', err);
        return { success: false, reason: err.message || 'error' };
    }
};

// ============================================================
// 🎯 WAGER SESSION-SCORE API
// Games must explicitly call these. Session scores are NEVER
// auto-written from saves — they only exist when a player
// genuinely plays a fresh round.
// ============================================================

/**
 * Called by a game at game-OVER (or whenever the player finishes a run).
 * Records the achieved score for any active wager on this game.
 *
 * @param {string} gameKey - matches WAGER_GAMES key (e.g. 'clicker', 'snake')
 * @param {number} score   - the score from THIS run only
 */
window.MegaplexCloud.reportWagerRunScore = function(gameKey, score) {
    if (typeof score !== 'number' || isNaN(score)) return;
    const sessions = JSON.parse(localStorage.getItem('megaplexSessionScores')) || {};

    // Determine whether higher or lower is better for this game
    const info = window.MegaplexCloud.getWagerGameInfo(gameKey);
    const higherIsBetter = !info || info.scoreType === 'higher';

    const existing = sessions[gameKey];
    let shouldUpdate = false;
    if (existing === undefined || existing === null) {
        shouldUpdate = true;
    } else if (higherIsBetter && score > existing) {
        shouldUpdate = true;
    } else if (!higherIsBetter && score < existing) {
        shouldUpdate = true;
    }

    if (shouldUpdate) {
        sessions[gameKey] = score;
        localStorage.setItem('megaplexSessionScores', JSON.stringify(sessions));
        console.log('[Megaplex] 🎯 Wager session score for "' + gameKey + '": ' + score);
    }
};

/**
 * Clears the session score for a game.
 * Call this when a wager is submitted/resolved, or when a fresh
 * run should begin (e.g. on prestige).
 */
window.MegaplexCloud.clearWagerSessionScore = function(gameKey) {
    const sessions = JSON.parse(localStorage.getItem('megaplexSessionScores')) || {};
    if (sessions[gameKey] !== undefined) {
        delete sessions[gameKey];
        localStorage.setItem('megaplexSessionScores', JSON.stringify(sessions));
        console.log('[Megaplex] 🎯 Cleared session score for "' + gameKey + '"');
    }
};

/**
 * Submit your session score for an active wager.
 * Pulls from megaplexSessionScores (set when player plays the game after accepting).
 */
window.MegaplexCloud.submitWagerScore = async function(wagerId) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false, reason: 'not_logged_in' };

    const wagerRef = fbDB.collection('wagers').doc(wagerId);

    try {
        const wagerDoc = await wagerRef.get();
        if (!wagerDoc.exists) return { success: false, reason: 'wager_missing' };
        const w = wagerDoc.data();
        if (w.status !== 'active') return { success: false, reason: 'not_active' };

        const isChallenger = w.challenger.uid === u.uid;
        const isOpponent = w.opponent.uid === u.uid;
        if (!isChallenger && !isOpponent) return { success: false, reason: 'not_your_wager' };

        const mySide = isChallenger ? 'challenger' : 'opponent';
        if (w[mySide].score !== null) return { success: false, reason: 'already_submitted' };

        const sessions = JSON.parse(localStorage.getItem('megaplexSessionScores')) || {};
        const sessionScore = sessions[w.game.key];
        if (sessionScore === undefined || sessionScore === null) {
            return { success: false, reason: 'no_session_score' };
        }

        const updates = {};
        updates[mySide + '.score'] = sessionScore;
        updates[mySide + '.submittedAt'] = Date.now();
        await wagerRef.update(updates);

        // 🆕 Clear the session score so it can't be re-submitted to another wager
        window.MegaplexCloud.clearWagerSessionScore(w.game.key);

        console.log('[Megaplex] ⚔️ Wager score submitted:', sessionScore);
        return { success: true, score: sessionScore };
    } catch (err) {
        console.error('[Megaplex] submitWagerScore failed:', err);
        return { success: false, reason: err.message || 'error' };
    }
};

/**
 * Resolve a wager — determine winner and pay out.
 * Called automatically when claim is requested OR when wager expires.
 */
window.MegaplexCloud.resolveWager = async function(wagerId) {
    const wagerRef = fbDB.collection('wagers').doc(wagerId);
    try {
        await fbDB.runTransaction(async (tx) => {
            const wagerDoc = await tx.get(wagerRef);
            if (!wagerDoc.exists) throw new Error('wager_missing');
            const w = wagerDoc.data();
            if (w.status !== 'active') return; // already resolved

            const cScore = w.challenger.score;
            const oScore = w.opponent.score;
            const now = Date.now();
            const expired = now >= w.expiresAt;

            // If still time left and not both submitted, don't resolve yet
            if (!expired && (cScore === null || oScore === null)) {
                throw new Error('not_ready');
            }

            // Determine winner
            let winner = null;
            let resultStatus = 'completed';

            if (cScore === null && oScore === null) {
                // Both no-shows — full refund minus 5% each
                resultStatus = 'tied';
            } else if (cScore === null) {
                winner = w.opponent.uid;
            } else if (oScore === null) {
                winner = w.challenger.uid;
            } else if (cScore === oScore) {
                resultStatus = 'tied';
            } else {
                const higherWins = w.game.scoreType === 'higher';
                if (higherWins) {
                    winner = (cScore > oScore) ? w.challenger.uid : w.opponent.uid;
                } else {
                    winner = (cScore < oScore) ? w.challenger.uid : w.opponent.uid;
                }
            }

            // Calculate payouts
            const pot = w.pot;
            let challengerPayout = 0;
            let opponentPayout = 0;

            if (resultStatus === 'tied') {
                // 5% per side cut, refund the rest
                const cut = Math.floor(w.amount * window.MegaplexCloud.WAGER_HOUSE_CUT_TIE);
                const refundEach = w.amount - cut;
                challengerPayout = refundEach;
                opponentPayout = refundEach;
            } else {
                // Winner takes pot minus 10%
                const cut = Math.floor(pot * window.MegaplexCloud.WAGER_HOUSE_CUT_WIN);
                const winnings = pot - cut;
                if (winner === w.challenger.uid) challengerPayout = winnings;
                else opponentPayout = winnings;
            }

            // Pay out (read both player docs)
            const cRef = fbDB.collection('players').doc(w.challenger.uid);
            const oRef = fbDB.collection('players').doc(w.opponent.uid);
            const [cDoc, oDoc] = await Promise.all([tx.get(cRef), tx.get(oRef)]);

            if (challengerPayout > 0) {
                const cTok = parseInt((cDoc.data().saveData && cDoc.data().saveData.megaplexTokens) || 0);
                tx.set(cRef, { saveData: { megaplexTokens: String(cTok + challengerPayout) } }, { merge: true });
            }
            if (opponentPayout > 0) {
                const oTok = parseInt((oDoc.data().saveData && oDoc.data().saveData.megaplexTokens) || 0);
                tx.set(oRef, { saveData: { megaplexTokens: String(oTok + opponentPayout) } }, { merge: true });
            }

            // Update wager
            tx.update(wagerRef, {
                status: resultStatus,
                winner: winner,
                completedAt: now,
                challengerPayout: challengerPayout,
                opponentPayout: opponentPayout
            });
        });

        // 🧹 Clean up session score for this game (wager is over)
        try {
            const wagerDoc = await wagerRef.get();
            const gameKey = wagerDoc.data()?.game?.key;
            if (gameKey) window.MegaplexCloud.clearWagerSessionScore(gameKey);
        } catch (e) {}

        return { success: true };
    } catch (err) {
        if (err.message === 'not_ready') return { success: false, reason: 'not_ready' };
        console.error('[Megaplex] resolveWager failed:', err);
        return { success: false, reason: err.message || 'error' };
    }
};

/**
 * Mark a wager as 'claimed' from the local user's side.
 * Called when the user clicks "Collect Winnings".
 */
window.MegaplexCloud.markWagerClaimed = async function(wagerId) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false };
    const wagerRef = fbDB.collection('wagers').doc(wagerId);
    try {
        const doc = await wagerRef.get();
        if (!doc.exists) return { success: false };
        const w = doc.data();
        const isChallenger = w.challenger.uid === u.uid;
        const updates = {};
        updates[(isChallenger ? 'challenger' : 'opponent') + '.claimed'] = true;
        await wagerRef.update(updates);

        // Sync local token balance after claim (in case payout already hit cloud)
        const myDoc = await fbDB.collection('players').doc(u.uid).get();
        const tokens = parseInt(myDoc.data().saveData?.megaplexTokens || 0);
        localStorage.setItem('megaplexTokens', String(tokens));
        return { success: true, newTokens: tokens };
    } catch (err) {
        console.error('[Megaplex] markWagerClaimed failed:', err);
        return { success: false };
    }
};

/**
 * Subscribe to live wager updates for the current user.
 * Returns wagers where I'm either challenger or opponent.
 */
window.MegaplexCloud.subscribeToWagers = function(callback) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return () => {};

    // Need two queries because Firestore can't OR across fields cheaply
    let asChallenger = [];
    let asOpponent = [];

    const fireUpdate = () => {
        const all = [...asChallenger, ...asOpponent];
        // Dedupe by wager ID
        const map = new Map();
        all.forEach(w => map.set(w.id, w));
        const wagers = Array.from(map.values());
        callback(wagers);
    };

    const unsub1 = fbDB.collection('wagers')
        .where('challenger.uid', '==', u.uid)
        .onSnapshot((snap) => {
            asChallenger = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            fireUpdate();
        }, (err) => console.error('[Megaplex] wager sub (challenger) error:', err));

    const unsub2 = fbDB.collection('wagers')
        .where('opponent.uid', '==', u.uid)
        .onSnapshot((snap) => {
            asOpponent = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            fireUpdate();
        }, (err) => console.error('[Megaplex] wager sub (opponent) error:', err));

    return () => { unsub1(); unsub2(); };
};

/**
 * Auto-resolve any expired active wagers for the current user.
 * Call this on page load.
 */
window.MegaplexCloud.checkExpiredWagers = async function() {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return;
    try {
        const now = Date.now();
        const [a, b] = await Promise.all([
            fbDB.collection('wagers')
                .where('challenger.uid', '==', u.uid)
                .where('status', '==', 'active')
                .get(),
            fbDB.collection('wagers')
                .where('opponent.uid', '==', u.uid)
                .where('status', '==', 'active')
                .get()
        ]);
        const expiredIds = new Set();
        [...a.docs, ...b.docs].forEach(d => {
            if (d.data().expiresAt <= now) expiredIds.add(d.id);
        });
        for (const id of expiredIds) {
            await window.MegaplexCloud.resolveWager(id);
        }
    } catch (err) {
        console.warn('[Megaplex] checkExpiredWagers error:', err);
    }
};

// ============================================================
// ⭕ CONNECT 4 — Real-time head-to-head wager battles
// ============================================================
// Client-only (matches existing wager system). Easy to lift into
// a Cloud Function later for full anti-cheat validation.
// ============================================================

window.MegaplexCloud.C4_AMOUNTS = [50, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000];
window.MegaplexCloud.C4_HOUSE_CUT_WIN = 0.10;  // 10% of pot when there's a winner
window.MegaplexCloud.C4_HOUSE_CUT_TIE = 0.05;  // 5% per side on a draw
window.MegaplexCloud.C4_DURATION_MS = 3600000; // 1 hour expiry after BOTH accept
window.MegaplexCloud.C4_ROWS = 6;
window.MegaplexCloud.C4_COLS = 7;

// ---- Build an empty board (flattened to a string so Firestore stores it cleanly) ----
window.MegaplexCloud.c4EmptyBoard = function() {
    // 42 cells, all '0' (empty). 1 = red, 2 = yellow.
    return '0'.repeat(window.MegaplexCloud.C4_ROWS * window.MegaplexCloud.C4_COLS);
};

// ---- Convert flat board string <-> 2D array helpers ----
window.MegaplexCloud.c4ToGrid = function(boardStr) {
    const R = window.MegaplexCloud.C4_ROWS, C = window.MegaplexCloud.C4_COLS;
    const grid = [];
    for (let r = 0; r < R; r++) {
        const row = [];
        for (let c = 0; c < C; c++) row.push(parseInt(boardStr[r * C + c]));
        grid.push(row);
    }
    return grid;
};
window.MegaplexCloud.c4FromGrid = function(grid) {
    return grid.map(row => row.join('')).join('');
};

// ---- Drop a piece into a column; returns new boardStr or null if column full ----
window.MegaplexCloud.c4Drop = function(boardStr, col, player) {
    const grid = window.MegaplexCloud.c4ToGrid(boardStr);
    const R = window.MegaplexCloud.C4_ROWS;
    for (let r = R - 1; r >= 0; r--) {
        if (grid[r][col] === 0) {
            grid[r][col] = player;
            return window.MegaplexCloud.c4FromGrid(grid);
        }
    }
    return null; // column full
};

// ---- Win check: returns 0 (none), 1 (red wins), 2 (yellow wins) ----
window.MegaplexCloud.c4CheckWin = function(boardStr) {
    const grid = window.MegaplexCloud.c4ToGrid(boardStr);
    const R = window.MegaplexCloud.C4_ROWS, C = window.MegaplexCloud.C4_COLS;
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
            const p = grid[r][c];
            if (p === 0) continue;
            for (const [dr, dc] of dirs) {
                let count = 1;
                let rr = r + dr, cc = c + dc;
                while (rr >= 0 && rr < R && cc >= 0 && cc < C && grid[rr][cc] === p) {
                    count++;
                    if (count === 4) return p;
                    rr += dr; cc += dc;
                }
            }
        }
    }
    return 0;
};

// ---- Board full? (draw detection) ----
window.MegaplexCloud.c4IsFull = function(boardStr) {
    return boardStr.indexOf('0') === -1;
};

/**
 * Create a Connect 4 challenge to a friend.
 * Escrows the challenger's tokens. Challenger is always "red" and moves first.
 */
window.MegaplexCloud.createC4Challenge = async function(opponentUid, amount) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false, reason: 'not_logged_in' };
    if (u.uid === opponentUid) return { success: false, reason: 'self' };
    if (!window.MegaplexCloud.C4_AMOUNTS.includes(amount)) return { success: false, reason: 'invalid_amount' };

    const myDocRef = fbDB.collection('players').doc(u.uid);
    const oppDocRef = fbDB.collection('players').doc(opponentUid);
    const gameRef = fbDB.collection('connect4Games').doc();

    try {
        await fbDB.runTransaction(async (tx) => {
            const myDoc = await tx.get(myDocRef);
            const oppDoc = await tx.get(oppDocRef);
            if (!myDoc.exists) throw new Error('your_doc_missing');
            if (!oppDoc.exists) throw new Error('opponent_missing');

            const myData = myDoc.data();
            const oppData = oppDoc.data();
            const myFriends = myData.friends || [];
            if (!myFriends.includes(opponentUid)) throw new Error('not_friends');

            const myTokens = parseInt((myData.saveData && myData.saveData.megaplexTokens) || 0);
            if (myTokens < amount) throw new Error('insufficient_tokens');

            tx.set(myDocRef, { saveData: { megaplexTokens: String(myTokens - amount) } }, { merge: true });

            const now = Date.now();
            tx.set(gameRef, {
                red:    { uid: u.uid, username: myData.username, avatar: (myData.publicProfile && myData.publicProfile.avatar) || {} },
                yellow: { uid: opponentUid, username: oppData.username, avatar: (oppData.publicProfile && oppData.publicProfile.avatar) || {} },
                board: window.MegaplexCloud.c4EmptyBoard(),
                turn: 'red',
                moveCount: 0,
                status: 'pending',   // pending | active | completed | draw | declined | cancelled
                winner: null,        // uid of winner, or 'draw'
                amount: amount,
                pot: amount * 2,
                redClaimed: false,
                yellowClaimed: false,
                redPayout: 0,
                yellowPayout: 0,
                createdAt: now,
                acceptedAt: null,
                expiresAt: null,
                completedAt: null,
                lastMoveAt: now
            });
        });

        const myFresh = await myDocRef.get();
        const newTokens = parseInt(myFresh.data().saveData.megaplexTokens) || 0;
        localStorage.setItem('megaplexTokens', String(newTokens));
        return { success: true, gameId: gameRef.id, newTokens };
    } catch (err) {
        console.error('[Megaplex] createC4Challenge failed:', err);
        return { success: false, reason: err.message || 'error' };
    }
};

/**
 * Accept a Connect 4 challenge (escrows opponent tokens, activates game).
 */
window.MegaplexCloud.acceptC4 = async function(gameId) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false, reason: 'not_logged_in' };

    const gameRef = fbDB.collection('connect4Games').doc(gameId);
    const myDocRef = fbDB.collection('players').doc(u.uid);

    try {
        await fbDB.runTransaction(async (tx) => {
            const gDoc = await tx.get(gameRef);
            const myDoc = await tx.get(myDocRef);
            if (!gDoc.exists) throw new Error('game_missing');
            const g = gDoc.data();
            if (g.yellow.uid !== u.uid) throw new Error('not_your_game');
            if (g.status !== 'pending') throw new Error('already_resolved');

            const myTokens = parseInt((myDoc.data().saveData && myDoc.data().saveData.megaplexTokens) || 0);
            if (myTokens < g.amount) throw new Error('insufficient_tokens');

            tx.set(myDocRef, { saveData: { megaplexTokens: String(myTokens - g.amount) } }, { merge: true });

            const now = Date.now();
            tx.update(gameRef, {
                status: 'active',
                acceptedAt: now,
                expiresAt: now + window.MegaplexCloud.C4_DURATION_MS,
                lastMoveAt: now
            });
        });

        const myFresh = await myDocRef.get();
        const newTokens = parseInt(myFresh.data().saveData.megaplexTokens) || 0;
        localStorage.setItem('megaplexTokens', String(newTokens));
        return { success: true, newTokens };
    } catch (err) {
        console.error('[Megaplex] acceptC4 failed:', err);
        return { success: false, reason: err.message || 'error' };
    }
};

/**
 * Decline a Connect 4 challenge — refunds the challenger.
 */
window.MegaplexCloud.declineC4 = async function(gameId) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false, reason: 'not_logged_in' };
    const gameRef = fbDB.collection('connect4Games').doc(gameId);
    try {
        await fbDB.runTransaction(async (tx) => {
            const gDoc = await tx.get(gameRef);
            if (!gDoc.exists) throw new Error('game_missing');
            const g = gDoc.data();
            if (g.yellow.uid !== u.uid) throw new Error('not_your_game');
            if (g.status !== 'pending') throw new Error('already_resolved');

            const cRef = fbDB.collection('players').doc(g.red.uid);
            const cDoc = await tx.get(cRef);
            const cTok = parseInt((cDoc.data().saveData && cDoc.data().saveData.megaplexTokens) || 0);
            tx.set(cRef, { saveData: { megaplexTokens: String(cTok + g.amount) } }, { merge: true });

            tx.update(gameRef, { status: 'declined', completedAt: Date.now() });
        });
        return { success: true };
    } catch (err) {
        console.error('[Megaplex] declineC4 failed:', err);
        return { success: false, reason: err.message || 'error' };
    }
};

/**
 * Cancel an outgoing pending challenge — refunds yourself.
 */
window.MegaplexCloud.cancelC4 = async function(gameId) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false, reason: 'not_logged_in' };
    const gameRef = fbDB.collection('connect4Games').doc(gameId);
    const myDocRef = fbDB.collection('players').doc(u.uid);
    try {
        await fbDB.runTransaction(async (tx) => {
            const gDoc = await tx.get(gameRef);
            const myDoc = await tx.get(myDocRef);
            if (!gDoc.exists) throw new Error('game_missing');
            const g = gDoc.data();
            if (g.red.uid !== u.uid) throw new Error('not_your_game');
            if (g.status !== 'pending') throw new Error('already_resolved');

            const myTokens = parseInt((myDoc.data().saveData && myDoc.data().saveData.megaplexTokens) || 0);
            tx.set(myDocRef, { saveData: { megaplexTokens: String(myTokens + g.amount) } }, { merge: true });
            tx.update(gameRef, { status: 'cancelled', completedAt: Date.now() });
        });
        const myFresh = await myDocRef.get();
        const newTokens = parseInt(myFresh.data().saveData.megaplexTokens) || 0;
        localStorage.setItem('megaplexTokens', String(newTokens));
        return { success: true, newTokens };
    } catch (err) {
        console.error('[Megaplex] cancelC4 failed:', err);
        return { success: false, reason: err.message || 'error' };
    }
};

/**
 * Make a move (drop a piece in a column).
 * Validates turn + legal move + win/draw, then pays out on game end.
 */
window.MegaplexCloud.makeC4Move = async function(gameId, col) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false, reason: 'not_logged_in' };
    const gameRef = fbDB.collection('connect4Games').doc(gameId);

    try {
        let result = { success: true };
        await fbDB.runTransaction(async (tx) => {
            const gDoc = await tx.get(gameRef);
            if (!gDoc.exists) throw new Error('game_missing');
            const g = gDoc.data();
            if (g.status !== 'active') throw new Error('not_active');

            const mySide = (g.red.uid === u.uid) ? 'red' : (g.yellow.uid === u.uid ? 'yellow' : null);
            if (!mySide) throw new Error('not_your_game');
            if (g.turn !== mySide) throw new Error('not_your_turn');

            const player = mySide === 'red' ? 1 : 2;
            const newBoard = window.MegaplexCloud.c4Drop(g.board, col, player);
            if (newBoard === null) throw new Error('column_full');

            const winSym = window.MegaplexCloud.c4CheckWin(newBoard);
            const isFull = window.MegaplexCloud.c4IsFull(newBoard);
            const now = Date.now();

            if (winSym !== 0) {
                // Someone won — pay out pot minus house cut
                const winnerUid = (winSym === 1) ? g.red.uid : g.yellow.uid;
                const cut = Math.floor(g.pot * window.MegaplexCloud.C4_HOUSE_CUT_WIN);
                const winnings = g.pot - cut;
                const redPayout = (winnerUid === g.red.uid) ? winnings : 0;
                const yellowPayout = (winnerUid === g.yellow.uid) ? winnings : 0;

                const winnerRef = fbDB.collection('players').doc(winnerUid);
                const wDoc = await tx.get(winnerRef);
                const wTok = parseInt((wDoc.data().saveData && wDoc.data().saveData.megaplexTokens) || 0);
                tx.set(winnerRef, { saveData: { megaplexTokens: String(wTok + winnings) } }, { merge: true });

                tx.update(gameRef, {
                    board: newBoard, status: 'completed', winner: winnerUid,
                    moveCount: g.moveCount + 1, lastMoveAt: now, completedAt: now,
                    redPayout, yellowPayout
                });
                result = { success: true, gameOver: true, winner: winnerUid };
            } else if (isFull) {
                // Draw — refund each minus 5%
                const cut = Math.floor(g.amount * window.MegaplexCloud.C4_HOUSE_CUT_TIE);
                const refundEach = g.amount - cut;
                const redRef = fbDB.collection('players').doc(g.red.uid);
                const yelRef = fbDB.collection('players').doc(g.yellow.uid);
                const [redD, yelD] = await Promise.all([tx.get(redRef), tx.get(yelRef)]);
                const rTok = parseInt((redD.data().saveData && redD.data().saveData.megaplexTokens) || 0);
                const yTok = parseInt((yelD.data().saveData && yelD.data().saveData.megaplexTokens) || 0);
                tx.set(redRef, { saveData: { megaplexTokens: String(rTok + refundEach) } }, { merge: true });
                tx.set(yelRef, { saveData: { megaplexTokens: String(yTok + refundEach) } }, { merge: true });

                tx.update(gameRef, {
                    board: newBoard, status: 'draw', winner: 'draw',
                    moveCount: g.moveCount + 1, lastMoveAt: now, completedAt: now,
                    redPayout: refundEach, yellowPayout: refundEach
                });
                result = { success: true, gameOver: true, winner: 'draw' };
            } else {
                // Normal move — flip turn
                tx.update(gameRef, {
                    board: newBoard,
                    turn: mySide === 'red' ? 'yellow' : 'red',
                    moveCount: g.moveCount + 1,
                    lastMoveAt: now
                });
                result = { success: true, gameOver: false };
            }
        });

        // Sync my token balance if game ended
        if (result.gameOver) {
            const myDoc = await fbDB.collection('players').doc(u.uid).get();
            const tokens = parseInt(myDoc.data().saveData?.megaplexTokens || 0);
            localStorage.setItem('megaplexTokens', String(tokens));
            result.newTokens = tokens;
        }
        return result;
    } catch (err) {
        console.error('[Megaplex] makeC4Move failed:', err);
        return { success: false, reason: err.message || 'error' };
    }
};

/**
 * Forfeit / resolve an expired game. If expired, whoever's turn it was loses
 * (they failed to move in time). Pays the other player.
 */
window.MegaplexCloud.resolveC4Expired = async function(gameId) {
    const gameRef = fbDB.collection('connect4Games').doc(gameId);
    try {
        await fbDB.runTransaction(async (tx) => {
            const gDoc = await tx.get(gameRef);
            if (!gDoc.exists) throw new Error('game_missing');
            const g = gDoc.data();
            if (g.status !== 'active') return;
            if (Date.now() < g.expiresAt) return; // not expired yet

            // The player whose turn it is forfeits
            const loserSide = g.turn;
            const winnerUid = loserSide === 'red' ? g.yellow.uid : g.red.uid;
            const cut = Math.floor(g.pot * window.MegaplexCloud.C4_HOUSE_CUT_WIN);
            const winnings = g.pot - cut;
            const redPayout = (winnerUid === g.red.uid) ? winnings : 0;
            const yellowPayout = (winnerUid === g.yellow.uid) ? winnings : 0;

            const winnerRef = fbDB.collection('players').doc(winnerUid);
            const wDoc = await tx.get(winnerRef);
            const wTok = parseInt((wDoc.data().saveData && wDoc.data().saveData.megaplexTokens) || 0);
            tx.set(winnerRef, { saveData: { megaplexTokens: String(wTok + winnings) } }, { merge: true });

            tx.update(gameRef, {
                status: 'completed', winner: winnerUid,
                completedAt: Date.now(), redPayout, yellowPayout
            });
        });
        return { success: true };
    } catch (err) {
        console.warn('[Megaplex] resolveC4Expired error:', err);
        return { success: false };
    }
};

/**
 * Mark a finished game as claimed from this player's side, sync tokens.
 */
window.MegaplexCloud.claimC4 = async function(gameId) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return { success: false };
    const gameRef = fbDB.collection('connect4Games').doc(gameId);
    try {
        const doc = await gameRef.get();
        if (!doc.exists) return { success: false };
        const g = doc.data();
        const isRed = g.red.uid === u.uid;
        const updates = {};
        updates[isRed ? 'redClaimed' : 'yellowClaimed'] = true;
        await gameRef.update(updates);

        const myDoc = await fbDB.collection('players').doc(u.uid).get();
        const tokens = parseInt(myDoc.data().saveData?.megaplexTokens || 0);
        localStorage.setItem('megaplexTokens', String(tokens));
        return { success: true, newTokens: tokens };
    } catch (err) {
        console.error('[Megaplex] claimC4 failed:', err);
        return { success: false };
    }
};

/**
 * Subscribe to all Connect 4 games involving the current user.
 */
window.MegaplexCloud.subscribeToC4 = function(callback) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return () => {};
    let asRed = [], asYellow = [];
    const fire = () => {
        const map = new Map();
        [...asRed, ...asYellow].forEach(g => map.set(g.id, g));
        callback(Array.from(map.values()));
    };
    const unsub1 = fbDB.collection('connect4Games').where('red.uid', '==', u.uid)
        .onSnapshot(s => { asRed = s.docs.map(d => ({ id: d.id, ...d.data() })); fire(); },
                    e => console.error('[Megaplex] C4 sub (red) error:', e));
    const unsub2 = fbDB.collection('connect4Games').where('yellow.uid', '==', u.uid)
        .onSnapshot(s => { asYellow = s.docs.map(d => ({ id: d.id, ...d.data() })); fire(); },
                    e => console.error('[Megaplex] C4 sub (yellow) error:', e));
    return () => { unsub1(); unsub2(); };
};

/**
 * Subscribe to a single Connect 4 game (for the active board view).
 */
window.MegaplexCloud.subscribeToC4Game = function(gameId, callback) {
    return fbDB.collection('connect4Games').doc(gameId).onSnapshot(
        d => { if (d.exists) callback({ id: d.id, ...d.data() }); },
        e => console.error('[Megaplex] C4 game sub error:', e)
    );
};

/**
 * Auto-resolve any expired active games for the current user (call on load).
 */
window.MegaplexCloud.checkExpiredC4 = async function() {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u) return;
    try {
        const now = Date.now();
        const [a, b] = await Promise.all([
            fbDB.collection('connect4Games').where('red.uid', '==', u.uid).where('status', '==', 'active').get(),
            fbDB.collection('connect4Games').where('yellow.uid', '==', u.uid).where('status', '==', 'active').get()
        ]);
        const ids = new Set();
        [...a.docs, ...b.docs].forEach(d => { if (d.data().expiresAt <= now) ids.add(d.id); });
        for (const id of ids) await window.MegaplexCloud.resolveC4Expired(id);
    } catch (err) {
        console.warn('[Megaplex] checkExpiredC4 error:', err);
    }
};

console.log('[Megaplex] ⭕ Connect 4 module loaded');

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
setInterval(() => window.MegaplexCloud.saveToCloud(), 120000);  // every 2 minutes

document.addEventListener('visibilitychange', () => {
    if (document.hidden) window.MegaplexCloud.saveOnExit();
});

window.addEventListener('pagehide', () => window.MegaplexCloud.saveOnExit());
window.addEventListener('beforeunload', () => window.MegaplexCloud.saveOnExit());

console.log('[Megaplex] Firebase module loaded (v2.4, ' +
    window.MegaplexCloud.registeredGameKeys.length + ' keys registered, social + wager systems online)');

    // ============================================================
// 💬 GLOBAL CHAT ROOM — Real-time chat across all pages
// ============================================================

window.MegaplexCloud.CHAT_MAX_MESSAGES = 50;        // How many recent messages to show
window.MegaplexCloud.CHAT_MAX_LENGTH = 200;         // Max chars per message
window.MegaplexCloud.CHAT_COOLDOWN_MS = 1500;       // Anti-spam: 1.5s between messages
window.MegaplexCloud._lastChatSendAt = 0;

/**
 * Send a chat message to the global chat room.
 * Requires the user to be logged in (no guests).
 */
window.MegaplexCloud.sendChatMessage = async function(text) {
    const u = window.MegaplexCloud.currentFbUser;
    if (!u || window.MegaplexCloud.isGuestMode) {
        return { success: false, reason: 'not_logged_in' };
    }

    // Trim and validate
    const clean = String(text || '').trim().slice(0, window.MegaplexCloud.CHAT_MAX_LENGTH);
    if (!clean) return { success: false, reason: 'empty' };

    // Anti-spam cooldown
    const now = Date.now();
    if (now - window.MegaplexCloud._lastChatSendAt < window.MegaplexCloud.CHAT_COOLDOWN_MS) {
        return { success: false, reason: 'cooldown' };
    }

    try {
        const username = localStorage.getItem('megaplexUsername') || 'Player';
        // Pull avatar so the chat can show colors/hats next to names
        let avatar = {};
        try {
            const avatarData = JSON.parse(localStorage.getItem('avatarData')) || {};
            avatar = avatarData.equipped || {};
        } catch (e) {}

        await fbDB.collection('chatMessages').add({
            uid: u.uid,
            username: username,
            avatar: avatar,
            text: clean,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            createdAt: now  // client-side fallback for sorting before server stamps it
        });

        window.MegaplexCloud._lastChatSendAt = now;
        return { success: true };
    } catch (err) {
        console.error('[Megaplex] sendChatMessage failed:', err);
        return { success: false, reason: 'error' };
    }
};

/**
 * Subscribe to live chat messages.
 * Callback receives an array of the most recent messages, oldest first.
 * Returns an unsubscribe function.
 */
window.MegaplexCloud.subscribeToChat = function(callback) {
    return fbDB.collection('chatMessages')
        .orderBy('createdAt', 'desc')
        .limit(window.MegaplexCloud.CHAT_MAX_MESSAGES)
        .onSnapshot((snap) => {
            const messages = [];
            snap.forEach(doc => {
                messages.push({ id: doc.id, ...doc.data() });
            });
            // Reverse so oldest is first (so we can append at bottom)
            messages.reverse();
            callback(messages);
        }, (err) => {
            console.error('[Megaplex] subscribeToChat error:', err);
        });
};

console.log('[Megaplex] 💬 Chat module loaded');