/* ====== TOWER DEFENSE CO-OP MODULE (separate Firebase project) ====== */
/* Uses a NAMED Firebase app so it never collides with the default
   Megaplex app. All room/action sync lives here; scores/tokens still
   go through window.MegaplexCloud on the Megaplex project.            */

   (function () {
    // ✅ Your nethack-siege project config (compat style)
    const coopConfig = {
      apiKey: "AIzaSyAkGPqSWvRiTw7YMdpyAC7Sh3aMw3755dE",
      authDomain: "nethack-siege.firebaseapp.com",
      projectId: "nethack-siege",
      storageBucket: "nethack-siege.firebasestorage.app",
      messagingSenderId: "278754618453",
      appId: "1:278754618453:web:02a5644e6de442123eb8dc"
      // measurementId omitted on purpose — not needed for coop, and we
      // don't load the analytics SDK here.
    };
  
    // Initialize as a NAMED app ("coop") — default stays Megaplex.
    let coopApp;
    const existing = firebase.apps.find(a => a.name === "coop");
    coopApp = existing || firebase.initializeApp(coopConfig, "coop");
  
    const coopDB = coopApp.firestore();
    const coopAuth = coopApp.auth();
  
    const TDCoop = {
      db: coopDB,
      room: null,
      role: null,
      seed: null,
      _roomUnsub: null,
      _actionsUnsub: null,
      _appliedSeq: {},
      onAction: null,
      onRoomState: null,
      ready: false
    };
  
    TDCoop.ensureAuth = function () {
      return new Promise((resolve) => {
        if (coopAuth.currentUser) { resolve(coopAuth.currentUser); return; }
        coopAuth.signInAnonymously().catch(e => console.warn('[Coop] anon auth', e));
        const unsub = coopAuth.onAuthStateChanged(u => {
          if (u) { unsub(); TDCoop.ready = true; resolve(u); }
        });
      });
    };
  
    function genCode() {
      return Math.random().toString(36).substr(2, 5).toUpperCase();
    }
    function myName() {
      return localStorage.getItem('megaplexUsername') || 'Player';
    }
  
    TDCoop.createRoom = async function (settings) {
      await TDCoop.ensureAuth();
      const code = genCode();
      const seed = Math.floor(Math.random() * 1e9);
      TDCoop.room = code; TDCoop.role = 'host'; TDCoop.seed = seed;
  
      await coopDB.collection('coopRooms').doc(code).set({
        seed: seed,
        mapChoice: settings.mapChoice || 'serpent',
        difficulty: settings.difficulty || 'normal',
        endless: !!settings.endless,
        hostName: myName(),
        hostHero: settings.hero || 'cipher',
        guestName: null,
        guestHero: null,
        guestReady: false,
        started: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
  
      TDCoop._listen(code);
      return { code, seed };
    };
  
    TDCoop.joinRoom = async function (code, hero) {
      await TDCoop.ensureAuth();
      code = (code || '').toUpperCase().trim();
      const ref = coopDB.collection('coopRooms').doc(code);
      const doc = await ref.get();
      if (!doc.exists) return { success: false, reason: 'not_found' };
      const d = doc.data();
      if (d.started) return { success: false, reason: 'already_started' };
      if (d.guestName) return { success: false, reason: 'full' };
  
      TDCoop.room = code; TDCoop.role = 'guest'; TDCoop.seed = d.seed;
      await ref.update({
        guestName: myName(),
        guestHero: hero || 'nyx',
        guestReady: true
      });
      TDCoop._listen(code);
      return { success: true, seed: d.seed, mapChoice: d.mapChoice,
               difficulty: d.difficulty, endless: d.endless };
    };
  
    TDCoop.startGame = async function () {
      if (TDCoop.role !== 'host' || !TDCoop.room) return;
      await coopDB.collection('coopRooms').doc(TDCoop.room).update({
        started: true,
        startedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    };
  
    TDCoop.proposeAction = async function (action) {
      if (!TDCoop.room) return;
      action.by = TDCoop.role;
      action.byName = myName();
      action.ts = Date.now();
      await coopDB.collection('coopRooms').doc(TDCoop.room)
        .collection('actions').add(action);
    };
  
    TDCoop._listen = function (code) {
      TDCoop._roomUnsub = coopDB.collection('coopRooms').doc(code)
        .onSnapshot(snap => {
          const d = snap.data();
          if (!d) return;
          TDCoop.seed = d.seed;
          if (typeof TDCoop.onRoomState === 'function') TDCoop.onRoomState(d);
        }, e => console.error('[Coop] room listen', e));
  
      TDCoop._actionsUnsub = coopDB.collection('coopRooms').doc(code)
        .collection('actions').orderBy('ts')
        .onSnapshot(snap => {
          snap.docChanges().forEach(chg => {
            if (chg.type !== 'added') return;
            const id = chg.doc.id;
            if (TDCoop._appliedSeq[id]) return;
            TDCoop._appliedSeq[id] = true;
            const action = chg.doc.data();
            if (typeof TDCoop.onAction === 'function') TDCoop.onAction(action);
          });
        }, e => console.error('[Coop] actions listen', e));
    };
  
    TDCoop.leaveRoom = async function () {
      if (TDCoop._roomUnsub) { TDCoop._roomUnsub(); TDCoop._roomUnsub = null; }
      if (TDCoop._actionsUnsub) { TDCoop._actionsUnsub(); TDCoop._actionsUnsub = null; }
      if (TDCoop.role === 'host' && TDCoop.room) {
        try {
          const ref = coopDB.collection('coopRooms').doc(TDCoop.room);
          const acts = await ref.collection('actions').get();
          const batch = coopDB.batch();
          acts.forEach(d => batch.delete(d.ref));
          batch.delete(ref);
          await batch.commit();
        } catch (e) { console.warn('[Coop] cleanup', e); }
      }
      TDCoop.room = TDCoop.role = TDCoop.seed = null;
      TDCoop._appliedSeq = {};
    };
  
    window.TDCoop = TDCoop;
    console.log('[Coop] Tower Defense co-op module loaded (nethack-siege project)');
  })();