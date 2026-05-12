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

        // Determine which side I'm on
        const isChallenger = w.challenger.uid === u.uid;
        const isOpponent = w.opponent.uid === u.uid;
        if (!isChallenger && !isOpponent) return { success: false, reason: 'not_your_wager' };

        const mySide = isChallenger ? 'challenger' : 'opponent';
        if (w[mySide].score !== null) return { success: false, reason: 'already_submitted' };

        // Pull session score
        const sessions = JSON.parse(localStorage.getItem('megaplexSessionScores')) || {};
        const sessionScore = sessions[w.game.key];
        if (sessionScore === undefined || sessionScore === null) {
            return { success: false, reason: 'no_session_score' };
        }

        // Write the score
        const updates = {};
        updates[mySide + '.score'] = sessionScore;
        updates[mySide + '.submittedAt'] = Date.now();
        await wagerRef.update(updates);

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

console.log('[Megaplex] Firebase module loaded (v2.4, ' +
    window.MegaplexCloud.registeredGameKeys.length + ' keys registered, social + wager systems online)');