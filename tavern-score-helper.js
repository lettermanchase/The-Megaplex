/* ============================================================
   TAVERN SCORE HELPER — paste one <script> tag per game.
   Requires megaplex-firebase.js to be loaded FIRST.
   ============================================================ */
(function () {
    function cloudReady() {
        return window.MegaplexCloud && typeof window.MegaplexCloud.saveToCloud === 'function';
    }

    /* Standard arcadeScores keys (beastmaster, potion, gladiator,
       merchant, shadow_archer_*, etc). Keeps only the BEST score. */
    window.saveTavernScore = function (key, value, higherIsBetter) {
        if (higherIsBetter === undefined) higherIsBetter = true;
        if (typeof value !== 'number' || isNaN(value)) return;

        if (cloudReady() && window.MegaplexCloud.recordScore) {
            // recordScore writes arcadeScores + saves to cloud if it's a new best
            window.MegaplexCloud.recordScore(key, value, higherIsBetter);
        } else {
            // Fallback: write locally even if cloud isn't ready yet
            var scores = JSON.parse(localStorage.getItem('arcadeScores')) || {};
            var cur = scores[key];
            if (cur === undefined ||
                (higherIsBetter && value > cur) ||
                (!higherIsBetter && value < cur)) {
                scores[key] = value;
                localStorage.setItem('arcadeScores', JSON.stringify(scores));
            }
        }
    };

    /* Shadows of Eldrath — special object: { nightmare: X, ... } */
    window.saveEldrathScore = function (difficulty, score) {
        if (typeof score !== 'number' || isNaN(score)) return;
        var data = JSON.parse(localStorage.getItem('eldrathScores')) || {};
        if (data[difficulty] === undefined || score > data[difficulty]) {
            data[difficulty] = score;
            localStorage.setItem('eldrathScores', JSON.stringify(data));
            if (cloudReady()) window.MegaplexCloud.saveToCloud();
        }
    };

    /* Goblin Gold Rush — special array: [{difficulty, gold, date}, ...] */
    window.saveGoblinScore = function (difficulty, gold) {
        if (typeof gold !== 'number' || isNaN(gold)) return;
        var arr = JSON.parse(localStorage.getItem('goblinGoldScores')) || [];
        arr.push({ difficulty: difficulty, gold: gold, date: Date.now() });
        localStorage.setItem('goblinGoldScores', JSON.stringify(arr));
        if (cloudReady()) window.MegaplexCloud.saveToCloud();
    };

    console.log('[Tavern] Score helper loaded — saveTavernScore / saveEldrathScore / saveGoblinScore ready');
})();