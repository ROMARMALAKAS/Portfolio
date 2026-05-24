/* =====================================================
   Romar Villafuerte Portfolio — interactive scripts
   ===================================================== */

/* ---------- Splash screen dismiss ---------- */
(function () {
  const splash = document.getElementById("rvSplash");
  if (!splash) return;

  // Show splash only on a user's first visit per session — repeat visits skip
  // straight to the page so it never feels like loading lag.
  let seen = false;
  try { seen = sessionStorage.getItem("rvSplashSeen") === "1"; } catch (_) {}

  const reduced = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Hide immediately for repeat visitors / reduced-motion users
  if (seen || reduced) {
    splash.classList.add("is-hidden");
    document.body.classList.remove("rv-splash-active");
    return;
  }

  document.body.classList.add("rv-splash-active");

  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    splash.classList.add("is-hiding");
    document.body.classList.remove("rv-splash-active");
    try { sessionStorage.setItem("rvSplashSeen", "1"); } catch (_) {}
    setTimeout(() => splash.classList.add("is-hidden"), 600);
  }

  // Fall off naturally after the reveal animation finishes.
  const AUTO_MS = 4400;
  const tAuto = setTimeout(dismiss, AUTO_MS);

  // Click / tap / Esc / scroll all skip the splash.
  splash.addEventListener("click", () => { clearTimeout(tAuto); dismiss(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
      clearTimeout(tAuto);
      dismiss();
    }
  });
  window.addEventListener("scroll", () => { clearTimeout(tAuto); dismiss(); }, { once: true, passive: true });

  // Safety: once the page is fully loaded, ensure the splash is dismissed
  // (in case JS animations are slower than expected).
  window.addEventListener("load", () => {
    setTimeout(() => { clearTimeout(tAuto); dismiss(); }, 3800);
  });
})();

// Year + last-updated stamp in footer
(function () {
  const now = new Date();
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = now.getFullYear();
  const upd = document.getElementById("rvLastUpdated");
  if (upd) {
    upd.textContent = now.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
})();

/* ---------- Hero typewriter ---------- */
(function () {
  const el = document.getElementById("rvTyper");
  if (!el) return;
  const phrases = [
    "Website developer.",
    "Web app builder.",
    "Problem solver.",
  ];
  let pi = 0;        // phrase index
  let ci = 0;        // char index
  let deleting = false;
  el.textContent = "";
  // Use a non-breaking space so the line never collapses height while typing.
  const ZWSP = "\u200B";

  // Reserve the line height once based on the longest phrase so the hero never
  // jumps as the text grows / shrinks.
  el.style.display = "inline-block";

  function tick() {
    const word = phrases[pi];
    if (!deleting) {
      ci++;
      el.textContent = word.slice(0, ci) || ZWSP;
      if (ci === word.length) {
        deleting = true;
        return setTimeout(tick, 1800); // hold full text longer
      }
      return setTimeout(tick, 60); // steady, no jitter — feels less buggy
    } else {
      ci--;
      el.textContent = word.slice(0, ci) || ZWSP;
      if (ci === 0) {
        deleting = false;
        pi = (pi + 1) % phrases.length;
        return setTimeout(tick, 500); // longer pause before next phrase
      }
      return setTimeout(tick, 30);
    }
  }
  setTimeout(tick, 600);
})();

/* ---------- Theme toggle ---------- */
(function () {
  const root = document.documentElement;
  const btn = document.getElementById("themeToggle");
  const icon = document.getElementById("themeIcon");
  const saved = localStorage.getItem("rv_theme");
  const initial = saved === "dark" || saved === "light" ? saved : "light";
  root.setAttribute("data-bs-theme", initial);
  updateIcon(initial);

  btn.addEventListener("click", () => {
    const cur = root.getAttribute("data-bs-theme") === "dark" ? "dark" : "light";
    const next = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-bs-theme", next);
    localStorage.setItem("rv_theme", next);
    updateIcon(next);
  });

  function updateIcon(mode) {
    if (!icon) return;
    icon.className = mode === "dark" ? "bi bi-sun" : "bi bi-moon-stars";
  }
})();

/* =====================================================
   RV — global game hub (username, leaderboards, picker)
   ===================================================== */
(function () {
  // Global leaderboard backend (FastAPI on Fly.io)
  const RV_API = "/api";

  // Map bucket key -> sort order. "high" = bigger is better, "low" = smaller is better.
  const ORDER_FOR = (key) => {
    const base = String(key).split("_")[0];
    const lowGames = new Set(["memory", "slide", "mine", "reaction"]);
    return lowGames.has(base) ? "low" : "high";
  };

  // Split a leaderboard bucket key into {game, difficulty} for the API.
  function splitBucket(key) {
    const k = String(key);
    const i = k.indexOf("_");
    if (i < 0) return { game: k, difficulty: "" };
    return { game: k.slice(0, i), difficulty: k.slice(i + 1) };
  }

  const RV = (window.RV = {
    user: localStorage.getItem("rv_user") || "",
    _pending: null,
    _listeners: {},
    _remote: {},   // bucket -> array of {name,score} fetched from server
    _fetching: {}, // bucket -> Promise

    titles: {
      piano: "Piano",
      memory: "Memory Match",
      slide: "Slide Puzzle",
      stars: "Catch the Stars",
      basket: "Basketball Shooting",
      mine: "Minesweeper",
      math: "Math Quiz",
      english: "English Quiz",
      tiles: "Piano Tiles",
      guess: "Guess the Word",
      snake: "Snake",
      reaction: "Reaction Time",
      bomber: "Bomberman 2D",
    },

    on(event, cb) {
      (this._listeners[event] || (this._listeners[event] = [])).push(cb);
    },
    emit(event, payload) {
      (this._listeners[event] || []).forEach((cb) => {
        try { cb(payload); } catch (e) { console.error(e); }
      });
    },

    setUser(name) {
      this.user = String(name || "").trim().slice(0, 20);
      localStorage.setItem("rv_user", this.user);
      this._renderUserChip();
    },

    _renderUserChip() {
      const chip = document.getElementById("activeUserChip");
      const label = document.getElementById("activeUserName");
      if (!chip || !label) return;
      if (this.user) {
        chip.style.display = "";
        label.textContent = this.user;
      } else {
        chip.style.display = "none";
      }
    },

    lbKey(game) { return "rv_lb_" + game; },
    getLB(game) {
      try { return JSON.parse(localStorage.getItem(this.lbKey(game)) || "[]"); }
      catch { return []; }
    },
    saveLB(game, list) { localStorage.setItem(this.lbKey(game), JSON.stringify(list)); },

    // kind: 'high' = bigger is better, 'low' = smaller is better
    submitScore(game, score, kind = "high", meta) {
      if (!this.user) return;
      // 1) Optimistic local cache so the UI updates instantly even if the network is slow.
      const list = this.getLB(game);
      const existing = list.find((e) => (e.name || "").toLowerCase() === this.user.toLowerCase());
      if (existing) {
        const better = kind === "high" ? score > existing.score : score < existing.score;
        if (better) {
          existing.score = score;
          existing.t = Date.now();
          if (meta !== undefined) existing.meta = meta;
        }
      } else {
        list.push({ name: this.user, score, t: Date.now(), meta });
      }
      list.sort((a, b) => (kind === "high" ? b.score - a.score : a.score - b.score));
      this.saveLB(game, list.slice(0, 10));
      this.renderLB(game);

      // 2) Submit to the global server. Refresh the leaderboard from the server when done.
      const { game: g, difficulty } = splitBucket(game);
      const body = { game: g, difficulty, username: this.user, score: Math.max(0, Math.floor(score)), order: kind };
      fetch(RV_API + "/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((r) => r.json().catch(() => null))
        .catch(() => null)
        .finally(() => {
          this.fetchLB(game).then(() => this.renderLB(game));
        });
    },

    formatScore(game, entry) {
      const base = String(game).split("_")[0];
      if (base === "mine" || base === "reaction") return entry.score + (base === "reaction" ? "ms" : "s");
      if (base === "memory" || base === "slide") return entry.score + " moves";
      return String(entry.score);
    },

    fetchLB(game) {
      if (this._fetching[game]) return this._fetching[game];
      const { game: g, difficulty } = splitBucket(game);
      const order = ORDER_FOR(game);
      const url = `${RV_API}/scores/${encodeURIComponent(g)}?difficulty=${encodeURIComponent(difficulty)}&order=${order}&limit=10`;
      const p = fetch(url, { method: "GET" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && Array.isArray(data.items)) {
            this._remote[game] = data.items.map((it) => ({ name: it.username, score: it.score }));
          }
        })
        .catch(() => {})
        .finally(() => { delete this._fetching[game]; });
      this._fetching[game] = p;
      return p;
    },

    renderLB(game) {
      const els = document.querySelectorAll(`[data-lb-list="${game}"]`);
      if (!els.length) return;
      // Prefer the live server list if we have one; otherwise fall back to local cache.
      const list = this._remote[game] || this.getLB(game);
      els.forEach((ol) => {
        ol.innerHTML = "";
        if (!list.length) {
          ol.innerHTML = '<li class="rv-lb-empty">No scores yet — be the first!</li>';
          return;
        }
        list.forEach((e, idx) => {
          const li = document.createElement("li");
          const isMe = this.user && (e.name || "").toLowerCase() === this.user.toLowerCase();
          if (isMe) li.classList.add("is-me");
          li.innerHTML =
            `<span class="rv-lb-rank">${idx + 1}</span>` +
            `<span class="rv-lb-name">${escapeHtml(e.name)}</span>` +
            `<span class="rv-lb-score">${escapeHtml(this.formatScore(game, e))}</span>`;
          ol.appendChild(li);
        });
      });
      // Refresh from server in the background so other players' scores show up.
      if (!this._remote[game] && !this._fetching[game]) {
        this.fetchLB(game).then(() => this.renderLB(game));
      }
    },

    renderAllLBs() {
      const keys = new Set(
        Array.from(document.querySelectorAll("[data-lb-list]")).map((el) =>
          el.getAttribute("data-lb-list")
        )
      );
      keys.forEach((k) => {
        // Render once from cache immediately, then refresh from the server.
        this.renderLB(k);
        this.fetchLB(k).then(() => this.renderLB(k));
      });
    },

    promptUser(onReady) {
      this._pending = onReady || null;
      const modal = document.getElementById("userModal");
      const input = document.getElementById("userInput");
      if (!modal || !input) return;
      input.value = this.user || "";
      modal.classList.remove("d-none");
      setTimeout(() => input.focus(), 30);
    },

    closeUserModal() {
      const modal = document.getElementById("userModal");
      if (modal) modal.classList.add("d-none");
      this._pending = null;
    },

    _fsEl() { return document.getElementById("gameStage"); },

    _preferredOrientation() {
      // All games are portrait-only.
      return "portrait";
    },

    requestFullscreen() {
      const el = this._fsEl();
      if (!el) return;
      const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (!fn) return;
      const orientation = this._preferredOrientation();
      try {
        const p = fn.call(el);
        const lockOrient = () => {
          try {
            if (screen.orientation && screen.orientation.lock) {
              const lp = screen.orientation.lock(orientation);
              if (lp && lp.catch) lp.catch(() => {});
            }
          } catch (e) {}
        };
        if (p && p.then) p.then(lockOrient).catch(() => {});
        else lockOrient();
        el.setAttribute("data-fs-orientation", orientation);
      } catch (e) {}
    },

    exitFullscreen() {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) return;
      const fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (!fn) return;
      try { const p = fn.call(document); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    },

    toggleFullscreen() {
      if (document.fullscreenElement || document.webkitFullscreenElement) this.exitFullscreen();
      else this.requestFullscreen();
    },

    openPicker() {
      const picker = document.getElementById("gamePicker");
      const stage = document.getElementById("gameStage");
      if (picker) picker.classList.remove("d-none");
      if (stage) stage.classList.add("d-none");
      const howto = document.getElementById("gameHowTo");
      if (howto) howto.classList.add("d-none");
      document.body.classList.remove("rv-game-active");
      this.exitFullscreen();
      this.emit("gameHide");
      document.getElementById("playground")?.scrollIntoView({ behavior: "smooth", block: "start" });
    },

    openGame(key) {
      if (!this.user) {
        this.promptUser(() => this.openGame(key));
        return;
      }
      const picker = document.getElementById("gamePicker");
      const stage = document.getElementById("gameStage");
      if (!picker || !stage) return;
      picker.classList.add("d-none");
      stage.classList.remove("d-none");
      document.body.classList.add("rv-game-active");
      document.querySelectorAll(".rv-game-pane").forEach((p) => p.classList.add("d-none"));
      const pane = document.getElementById("game-" + key);
      if (pane) pane.classList.add("d-none"); // hidden until "Got it"
      const title = document.getElementById("stageTitle");
      const user = document.getElementById("stageUser");
      if (title) title.textContent = this.titles[key] || "Play";
      if (user) user.textContent = this.user;
      this._active = key;
      this._showHowTo(key, () => {
        if (pane) pane.classList.remove("d-none");
        this.renderLB(key);
        this.renderLB(key + "_normal");
        this.renderLB(key + "_hard");
        this.renderLB(key + "_pro");
        this.renderLB(key + "_god");
        this.emit("gameShow", key);
      });
      stage.scrollIntoView({ behavior: "smooth", block: "start" });
      // Fullscreen is now opt-in via the header button so we don't force it.
    },

    _showHowTo(key, onStart) {
      const stage = document.getElementById("gameStage");
      if (!stage) { onStart && onStart(); return; }
      const info = HOW_TO[key];
      if (!info) { onStart && onStart(); return; }
      let panel = document.getElementById("gameHowTo");
      if (!panel) {
        panel = document.createElement("div");
        panel.id = "gameHowTo";
        panel.className = "rv-howto";
        // Insert right after the stage head so it sits at the top of the stage
        const head = stage.querySelector(".rv-stage-head");
        if (head && head.nextSibling) stage.insertBefore(panel, head.nextSibling);
        else stage.appendChild(panel);
      }
      const stepsHtml = info.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
      panel.innerHTML = `
        <div class="rv-howto-head">
          <span class="rv-howto-icon"><i class="bi ${info.icon || "bi-controller"}"></i></span>
          <div class="rv-howto-titles">
            <h4 class="rv-howto-title">${escapeHtml(this.titles[key] || "Play")}</h4>
            <p class="rv-howto-desc">${escapeHtml(info.desc)}</p>
          </div>
        </div>
        <h5 class="rv-howto-h5">How to play</h5>
        <ol class="rv-howto-steps">${stepsHtml}</ol>
        <div class="rv-howto-actions">
          <button type="button" class="btn btn-primary btn-lg" id="howtoStart">
            <i class="bi bi-play-fill"></i> Got it, start
          </button>
        </div>`;
      panel.classList.remove("d-none");
      const btn = panel.querySelector("#howtoStart");
      if (btn) btn.addEventListener("click", () => {
        panel.classList.add("d-none");
        if (onStart) onStart();
      }, { once: true });
    },
  });

  // Description + how-to-play steps for every game in the picker.
  const HOW_TO = {
    piano: {
      icon: "bi-music-note-list",
      desc: "A full 88-key grand piano with real Salamander samples.",
      steps: [
        "Click or tap any key to play that note.",
        "Use the ◀ / ▶ buttons to scroll across the 88 keys.",
        "Hit Show keys to label notes; hit Play tune for a quick demo.",
        "On a real keyboard, the bottom rows act as the white and black keys.",
      ],
    },
    tiles: {
      icon: "bi-music-player",
      desc: "Tap the falling black tiles in the right lane before they reach the bottom.",
      steps: [
        "4 lanes scroll downward — only tap the BLACK tiles.",
        "Each tap plays a real piano note (C4–C5).",
        "Speed grows the longer you survive.",
        "Miss a black tile or tap a blank lane and the run ends.",
        "Highest score lands on the leaderboard.",
      ],
    },
    guess: {
      icon: "bi-image",
      desc: "Random photos — pick the right word for each one.",
      steps: [
        "A picture loads. 4 word choices appear below it.",
        "Tap the word that matches the photo.",
        "Correct = +points · wrong = no points.",
        "Normal: easier categories · Hard: trickier vocab.",
        "Highest total score is submitted to the leaderboard.",
      ],
    },
    snake: {
      icon: "bi-dpad",
      desc: "Two modes: Classic (highest score) or Adventure (stages + power food + deadly boxes).",
      steps: [
        "Pick a mode: Classic or Adventure.",
        "Use the on-screen D-pad (or arrow keys) to steer.",
        "Walls wrap around — leaving the top brings you out the bottom (and same for the sides).",
        "Eat the red dot → snake grows + score +1.",
        "Adventure: a gold ★ power food sometimes appears — +5 points, no growth.",
        "Adventure: every 8 apples = next stage; each new stage adds a deadly box.",
        "Touching your tail or any deadly box = game over. Highest score wins.",
      ],
    },
    reaction: {
      icon: "bi-lightning-charge",
      desc: "Test your reflexes. 5 rounds — fastest average wins.",
      steps: [
        "Tap Start to begin a round.",
        "When the screen turns RED, wait — don't tap yet.",
        "The moment it flips to GREEN, tap as fast as you can.",
        "If you tap during red, that round is invalid.",
        "After 5 rounds, your average reaction time is submitted (lower is better).",
      ],
    },
    memory: {
      icon: "bi-grid-3x3-gap",
      desc: "Flip cards two at a time. Match all 8 pairs in as few moves as possible.",
      steps: [
        "Tap a face-down card to flip it.",
        "Tap a second card — if they match, both stay face up.",
        "If they don't match, both flip back. Remember their spots!",
        "Find all 8 pairs to win.",
        "Lowest move count wins on the leaderboard.",
      ],
    },
    slide: {
      icon: "bi-puzzle",
      desc: "Classic 15-puzzle (3×3 version). Slide tiles into 1–8 order.",
      steps: [
        "Tap a tile next to the empty square to slide it into the gap.",
        "Goal: arrange tiles in order 1, 2, 3 / 4, 5, 6 / 7, 8 with the blank in the bottom-right.",
        "Each move increments your move counter.",
        "Lowest move count wins on the leaderboard.",
      ],
    },
    stars: {
      icon: "bi-stars",
      desc: "30-second arcade. Click yellow stars, dodge the red ones.",
      steps: [
        "Click YELLOW stars → +1 point each.",
        "Click RED stars → −2 points (don't click them).",
        "You have 30 seconds total.",
        "Stars get faster as the timer ticks down.",
        "Highest score wins on the leaderboard.",
      ],
    },
    basket: {
      icon: "bi-bullseye",
      desc: "5 lives. Hold to charge power, release to shoot. Miss = lose a life.",
      steps: [
        "Press and HOLD anywhere on the court to charge power.",
        "The longer you hold, the harder the ball is thrown.",
        "Release to shoot at a fixed 60° arc — power decides distance.",
        "Sink the basket = +1 score. Miss = −1 life.",
        "You start with 5 lives. Game ends at 0 lives.",
        "Highest score wins on the leaderboard.",
      ],
    },
    mine: {
      icon: "bi-flag",
      desc: "Classic Minesweeper, 6×6 with 8 hidden mines. Fastest solve wins.",
      steps: [
        "Tap a square to reveal it. Numbers tell you how many mines are next to it.",
        "Long-press (or right-click) a square to flag a suspected mine.",
        "Reveal every NON-mine square to win.",
        "Tap a mine and the game ends.",
        "Lowest solve time wins on the leaderboard.",
      ],
    },
    math: {
      icon: "bi-calculator",
      desc: "10 questions. Pick the correct answer before the 30-second timer runs out.",
      steps: [
        "Pick a difficulty: Normal, Hard, Pro Expert, or God Mode.",
        "Tap Start. Each question has 30 seconds.",
        "If you don't answer in time, it's marked WRONG and the next question loads automatically.",
        "Faster correct answers earn bonus points.",
        "Highest final score wins on the leaderboard.",
      ],
    },
    english: {
      icon: "bi-book",
      desc: "10 questions of vocab + grammar. 30 seconds per question.",
      steps: [
        "Pick a difficulty: Normal, Hard, Pro Expert, or God Mode.",
        "Tap Start. Each question has 30 seconds.",
        "If you don't answer in time, it's marked WRONG and the next question loads automatically.",
        "Faster correct answers earn bonus points.",
        "Highest final score wins on the leaderboard.",
      ],
    },
    bomber: {
      icon: "bi-controller",
      desc: "Bomberman 2D. Place bombs, blast walls and enemies, survive.",
      steps: [
        "Tap and HOLD an arrow button (or arrow key) to walk; release to stop.",
        "Tap the BOMB button (or Space) to drop a bomb where you stand.",
        "Bombs explode after a short fuse — get out of the cross-shaped blast.",
        "Blasts destroy soft walls (brown) and any enemy or you caught in them.",
        "Clear all enemies to win the level. Highest score wins on the leaderboard.",
      ],
    },
  };
  RV._howTo = HOW_TO;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ----- Wire UI -----
  document.addEventListener("DOMContentLoaded", () => {
    RV._renderUserChip();

    document.querySelectorAll(".rv-pick-card").forEach((card) => {
      card.addEventListener("click", () => {
        const key = card.getAttribute("data-game");
        if (key) RV.openGame(key);
      });
    });

    const backBtn = document.getElementById("backToPicker");
    if (backBtn) backBtn.addEventListener("click", () => RV.openPicker());

    const openBtn = document.getElementById("openPickerBtn");
    if (openBtn) openBtn.addEventListener("click", () => RV.openPicker());

    const fsBtn = document.getElementById("fsToggle");
    if (fsBtn) fsBtn.addEventListener("click", () => RV.toggleFullscreen());

    // Toggle fullscreen-active class on the stage so CSS can reflow for landscape.
    const onFsChange = () => {
      const stage = document.getElementById("gameStage");
      if (!stage) return;
      const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
      stage.classList.toggle("is-fs", active);
      document.body.classList.toggle("rv-fs-active", active);
      if (!active) {
        try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);

    const changeBtn = document.getElementById("changeUserBtn");
    if (changeBtn) changeBtn.addEventListener("click", () => RV.promptUser());

    // User modal
    const modal = document.getElementById("userModal");
    if (modal) {
      const form = document.getElementById("userForm");
      const input = document.getElementById("userInput");
      form?.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const v = input.value.trim();
        if (!v) return;
        RV.setUser(v);
        const cb = RV._pending;
        RV.closeUserModal();
        if (cb) cb();
      });
      modal.querySelectorAll("[data-user-cancel]").forEach((el) => {
        el.addEventListener("click", () => RV.closeUserModal());
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !modal.classList.contains("d-none")) RV.closeUserModal();
      });
    }

    RV.renderAllLBs();
  });
})();

/* =====================================================
   PIANO — real piano (Salamander samples via Tone.js)
   ===================================================== */
(function () {
  const pianoEl = document.getElementById("piano");
  if (!pianoEl) return;
  const statusEl = document.getElementById("pianoStatus");
  const hintBtn = document.getElementById("pianoHint");
  const demoBtn = document.getElementById("pianoDemo");
  const octDown = document.getElementById("pianoOctDown");
  const octUp = document.getElementById("pianoOctUp");
  const wrap = pianoEl.parentElement;

  // Build 88 keys A0–C8
  const WHITE_NAMES = ["C", "D", "E", "F", "G", "A", "B"];
  const BLACK_OFFSETS = { "C": "C#", "D": "D#", "F": "F#", "G": "G#", "A": "A#" };
  // Build a full piano: MIDI 21 (A0) to MIDI 108 (C8)
  const keys = [];
  for (let m = 21; m <= 108; m++) {
    const note = midiToName(m);
    const isBlack = note.includes("#");
    keys.push({ midi: m, note, isBlack });
  }

  function midiToName(m) {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const n = names[m % 12];
    const oct = Math.floor(m / 12) - 1;
    return n + oct;
  }

  // Render keys: whites in order, blacks absolutely positioned
  const whiteCount = keys.filter((k) => !k.isBlack).length;
  pianoEl.style.setProperty("--white-count", whiteCount);

  let whiteIdx = 0;
  const keyEls = {};
  keys.forEach((k) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "rv-pk " + (k.isBlack ? "rv-pk-black" : "rv-pk-white");
    el.dataset.note = k.note;
    el.setAttribute("aria-label", k.note);
    const hint = document.createElement("span");
    hint.className = "rv-pk-hint";
    el.appendChild(hint);
    if (!k.isBlack) {
      el.style.left = `calc(${whiteIdx} * var(--white-w))`;
      whiteIdx++;
    } else {
      // Position over the previous white key's right edge
      el.style.left = `calc(${whiteIdx - 1} * var(--white-w) + var(--white-w) * 0.68)`;
    }
    pianoEl.appendChild(el);
    keyEls[k.note] = el;
  });

  // Keyboard mapping (home-row + upper row) for the middle octave
  const KEYMAP = {
    "a": "C4", "w": "C#4", "s": "D4", "e": "D#4", "d": "E4",
    "f": "F4", "t": "F#4", "g": "G4", "y": "G#4", "h": "A4", "u": "A#4", "j": "B4",
    "k": "C5", "o": "C#5", "l": "D5", "p": "D#5", ";": "E5",
  };
  Object.entries(KEYMAP).forEach(([k, note]) => {
    const el = keyEls[note];
    if (el) el.querySelector(".rv-pk-hint").textContent = k.toUpperCase();
  });

  let sampler = null;
  let loaded = false;

  function ensurePiano() {
    if (sampler) return sampler;
    if (typeof Tone === "undefined") {
      if (statusEl) statusEl.textContent = "Piano unavailable";
      return null;
    }
    try { Tone.start(); } catch (e) {}
    sampler = new Tone.Sampler({
      urls: {
        A0: "A0.mp3", C1: "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3", A1: "A1.mp3",
        C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3", A2: "A2.mp3",
        C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3", A3: "A3.mp3",
        C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3", A4: "A4.mp3",
        C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3", A5: "A5.mp3",
        C6: "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3", A6: "A6.mp3",
        C7: "C7.mp3", "D#7": "Ds7.mp3", "F#7": "Fs7.mp3", A7: "A7.mp3",
        C8: "C8.mp3",
      },
      release: 1,
      baseUrl: "https://tonejs.github.io/audio/salamander/",
      onload: () => {
        loaded = true;
        if (statusEl) statusEl.textContent = "Piano ready";
      },
    }).toDestination();
    if (statusEl) statusEl.textContent = "Loading piano…";
    return sampler;
  }

  function playNote(note, dur) {
    const s = ensurePiano();
    if (!s || !loaded) return;
    try {
      Tone.start();
      s.triggerAttackRelease(note, dur || "2n");
    } catch (e) {}
  }

  function flash(note) {
    const el = keyEls[note];
    if (!el) return;
    el.classList.add("is-active");
    setTimeout(() => el.classList.remove("is-active"), 200);
  }

  // Pointer play on all keys
  pianoEl.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".rv-pk");
    if (!el) return;
    e.preventDefault();
    const note = el.dataset.note;
    playNote(note);
    flash(note);
  });

  // Keyboard
  const held = new Set();
  document.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const tgt = e.target;
    if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return;
    const pane = document.getElementById("game-piano");
    if (!pane || pane.classList.contains("d-none")) return;
    const note = KEYMAP[e.key.toLowerCase()];
    if (!note || held.has(e.key)) return;
    held.add(e.key);
    playNote(note);
    flash(note);
  });
  document.addEventListener("keyup", (e) => { held.delete(e.key); });

  if (hintBtn) {
    hintBtn.addEventListener("click", () => {
      const on = pianoEl.classList.toggle("show-keys");
      hintBtn.setAttribute("aria-pressed", String(on));
      hintBtn.textContent = on ? "Hide keys" : "Show keys";
    });
  }

  // Scroll keyboard by octave
  function scrollByOctaves(n) {
    const whiteW = pianoEl.querySelector(".rv-pk-white");
    if (!whiteW) return;
    wrap.scrollBy({ left: n * whiteW.offsetWidth * 7, behavior: "smooth" });
  }
  if (octDown) octDown.addEventListener("click", () => scrollByOctaves(-1));
  if (octUp) octUp.addEventListener("click", () => scrollByOctaves(1));

  // Demo tune (Für Elise opening)
  const demoNotes = [
    ["E5", 200], ["D#5", 200], ["E5", 200], ["D#5", 200],
    ["E5", 200], ["B4", 200], ["D5", 200], ["C5", 200],
    ["A4", 420], [null, 120], ["C4", 200], ["E4", 200],
    ["A4", 200], ["B4", 420], [null, 120], ["E4", 200],
    ["G#4", 200], ["B4", 200], ["C5", 420],
  ];
  let demoTimer = null;
  if (demoBtn) {
    demoBtn.addEventListener("click", () => {
      if (demoTimer) {
        clearTimeout(demoTimer);
        demoTimer = null;
        demoBtn.innerHTML = '<i class="bi bi-play-fill"></i> Play tune';
        return;
      }
      ensurePiano();
      demoBtn.innerHTML = '<i class="bi bi-stop-fill"></i> Stop';
      let i = 0;
      const step = () => {
        if (i >= demoNotes.length) {
          demoTimer = null;
          demoBtn.innerHTML = '<i class="bi bi-play-fill"></i> Play tune';
          return;
        }
        const [note, ms] = demoNotes[i++];
        if (note) { playNote(note, (ms / 1000).toFixed(2)); flash(note); }
        demoTimer = setTimeout(step, ms);
      };
      step();
    });
  }

  // On first piano open, scroll to the middle octave C4
  if (window.RV) {
    window.RV.on("gameShow", (key) => {
      if (key !== "piano") return;
      const c4 = keyEls["C4"];
      if (c4) wrap.scrollLeft = Math.max(0, c4.offsetLeft - wrap.clientWidth / 2 + c4.offsetWidth / 2);
    });
  }
})();

/* =====================================================
   MEMORY MATCH — 8 pairs (4x4 grid)
   ===================================================== */
(function () {
  const board = document.getElementById("memoryBoard");
  if (!board) return;
  const movesEl = document.getElementById("memMoves");
  const pairsEl = document.getElementById("memPairs");
  const resetBtn = document.getElementById("memReset");
  const winMsg = document.getElementById("memWinMsg");

  const symbols = ["★", "●", "■", "▲", "◆", "♥", "♦", "♣"];
  let cards = [];
  let firstEl = null;
  let lock = false;
  let moves = 0;
  let matched = 0;

  function reset() {
    const deck = [...symbols, ...symbols]
      .map((s) => ({ s, id: Math.random() }))
      .sort((a, b) => a.id - b.id);
    cards = deck;
    moves = 0;
    matched = 0;
    firstEl = null;
    lock = false;
    movesEl.textContent = "0";
    pairsEl.textContent = "0";
    winMsg.classList.add("d-none");

    board.innerHTML = "";
    deck.forEach((c, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rv-mem-card";
      btn.dataset.symbol = c.s;
      btn.dataset.index = String(idx);
      btn.setAttribute("aria-label", "Memory card");
      btn.innerHTML = `
        <div class="rv-mem-inner">
          <div class="rv-mem-face front"></div>
          <div class="rv-mem-face back">${c.s}</div>
        </div>`;
      btn.addEventListener("click", onFlip);
      board.appendChild(btn);
    });
  }

  function onFlip(e) {
    const el = e.currentTarget;
    if (lock) return;
    if (el.classList.contains("is-flipped") || el.classList.contains("is-matched")) return;

    el.classList.add("is-flipped");

    if (!firstEl) {
      firstEl = el;
      return;
    }

    moves++;
    movesEl.textContent = String(moves);

    if (firstEl.dataset.symbol === el.dataset.symbol) {
      firstEl.classList.add("is-matched");
      el.classList.add("is-matched");
      firstEl = null;
      matched++;
      pairsEl.textContent = String(matched);
      if (matched === symbols.length) win();
    } else {
      lock = true;
      const a = firstEl;
      const b = el;
      firstEl = null;
      setTimeout(() => {
        a.classList.remove("is-flipped");
        b.classList.remove("is-flipped");
        lock = false;
      }, 700);
    }
  }

  function win() {
    if (window.RV) window.RV.submitScore("memory", moves, "low");
    const user = (window.RV && window.RV.user) || "you";
    winMsg.innerHTML = `<strong>${user}</strong> solved it in <strong>${moves}</strong> moves. Score submitted to the leaderboard.` +
      ' <button class="btn btn-sm btn-light-primary ms-2" id="memWinAgain">Play again</button>';
    winMsg.classList.remove("d-none");
    const again = document.getElementById("memWinAgain");
    if (again) again.addEventListener("click", reset);
  }

  resetBtn.addEventListener("click", reset);
  reset();
})();

/* =====================================================
   SLIDE PUZZLE — 3x3
   ===================================================== */
(function () {
  const board = document.getElementById("slideBoard");
  if (!board) return;
  const movesEl = document.getElementById("slideMoves");
  const resetBtn = document.getElementById("slideReset");
  const winMsg = document.getElementById("slideWinMsg");

  const SIZE = 3;
  let tiles = [];
  let moves = 0;
  let hasWon = false;

  function isSolved(arr) {
    for (let i = 0; i < arr.length - 1; i++) if (arr[i] !== i + 1) return false;
    return arr[arr.length - 1] === 0;
  }

  function isSolvable(arr) {
    // For odd-size boards: number of inversions must be even (ignoring the blank).
    const flat = arr.filter((n) => n !== 0);
    let inv = 0;
    for (let i = 0; i < flat.length; i++)
      for (let j = i + 1; j < flat.length; j++)
        if (flat[i] > flat[j]) inv++;
    return inv % 2 === 0;
  }

  function shuffle() {
    let arr;
    do {
      arr = [1, 2, 3, 4, 5, 6, 7, 8, 0];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    } while (!isSolvable(arr) || isSolved(arr));
    return arr;
  }

  function render() {
    board.innerHTML = "";
    tiles.forEach((n, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rv-tile" + (n === 0 ? " is-empty" : "");
      btn.textContent = n === 0 ? "" : String(n);
      btn.dataset.index = String(idx);
      btn.addEventListener("click", () => tryMove(idx));
      board.appendChild(btn);
    });
  }

  function neighborsOfEmpty() {
    const empty = tiles.indexOf(0);
    const r = Math.floor(empty / SIZE);
    const c = empty % SIZE;
    const out = {};
    if (r > 0) out.up = empty - SIZE;
    if (r < SIZE - 1) out.down = empty + SIZE;
    if (c > 0) out.left = empty - 1;
    if (c < SIZE - 1) out.right = empty + 1;
    return { empty, out };
  }

  function tryMove(idx) {
    if (hasWon) return;
    const { empty, out } = neighborsOfEmpty();
    if (!Object.values(out).includes(idx)) return;
    tiles[empty] = tiles[idx];
    tiles[idx] = 0;
    moves++;
    movesEl.textContent = String(moves);
    render();
    if (isSolved(tiles)) win();
  }

  function slideByKey(dir) {
    const { empty, out } = neighborsOfEmpty();
    // Sliding "up" means a tile from below moves into the empty space, so empty moves up.
    const mapping = { ArrowUp: out.down, ArrowDown: out.up, ArrowLeft: out.right, ArrowRight: out.left };
    const target = mapping[dir];
    if (typeof target === "number") tryMove(target);
  }

  function win() {
    hasWon = true;
    if (window.RV) window.RV.submitScore("slide", moves, "low");
    const user = (window.RV && window.RV.user) || "you";
    winMsg.innerHTML = `<strong>${user}</strong> solved it in <strong>${moves}</strong> moves. Score submitted to the leaderboard.` +
      ' <button class="btn btn-sm btn-light-primary ms-2" id="slideWinAgain">Shuffle again</button>';
    winMsg.classList.remove("d-none");
    const again = document.getElementById("slideWinAgain");
    if (again) again.addEventListener("click", reset);
  }

  function reset() {
    tiles = shuffle();
    moves = 0;
    hasWon = false;
    movesEl.textContent = "0";
    winMsg.classList.add("d-none");
    render();
  }

  document.addEventListener("keydown", (e) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const pane = document.getElementById("game-slide");
    if (!pane || pane.classList.contains("d-none")) return;
    e.preventDefault();
    slideByKey(e.key);
  });

  resetBtn.addEventListener("click", reset);
  reset();
})();

/* =====================================================
   CATCH THE STARS — canvas game
   ===================================================== */
(function () {
  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const scoreEl = document.getElementById("gameScore");
  const timeEl = document.getElementById("gameTime");
  const overlay = document.getElementById("gameOverlay");
  const titleEl = document.getElementById("gameTitle");
  const msgEl = document.getElementById("gameMsg");
  const startBtn = document.getElementById("gameStart");

  const W = canvas.width;
  const H = canvas.height;

  let running = false;
  let score = 0;
  let timeLeft = 30;
  let lastSpawn = 0;
  let spawnEvery = 650;
  let entities = [];
  let rafId = null;
  let startedAt = 0;
  let lastTs = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function spawn() {
    const isBad = Math.random() < 0.22;
    const size = rand(14, 22);
    entities.push({
      x: rand(size, W - size),
      y: -size,
      vy: rand(80, 200) + (30 - timeLeft) * 4,
      size,
      bad: isBad,
      rot: rand(0, Math.PI * 2),
      vr: rand(-2, 2),
      alive: true,
      pop: 0,
    });
  }

  function drawStar(cx, cy, r, rot, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
      const b = a + Math.PI / 5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(b) * r * 0.45, Math.sin(b) * r * 0.45);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.restore();
  }

  function drawBackground() {
    ctx.clearRect(0, 0, W, H);
    const isDark = document.documentElement.getAttribute("data-bs-theme") === "dark";
    ctx.fillStyle = isDark ? "rgba(255,255,255,0.08)" : "rgba(24,28,50,0.06)";
    for (let i = 0; i < 40; i++) {
      const x = (i * 97 + (startedAt % 2000) / 10) % W;
      const y = (i * 53) % H;
      ctx.fillRect(x, y, 2, 2);
    }
  }

  function frame(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    const dt = Math.min(50, ts - lastTs) / 1000;
    lastTs = ts;

    timeLeft = Math.max(0, 30 - Math.floor((ts - startedAt) / 1000));
    timeEl.textContent = String(timeLeft);
    if (timeLeft <= 0) { end(); return; }

    if (ts - lastSpawn > spawnEvery) {
      lastSpawn = ts;
      spawn();
      if (spawnEvery > 280) spawnEvery -= 6;
    }

    for (const e of entities) {
      e.y += e.vy * dt;
      e.rot += e.vr * dt;
      if (e.pop > 0) e.pop = Math.max(0, e.pop - dt * 4);
      if (e.y - e.size > H) e.alive = false;
    }
    entities = entities.filter((e) => e.alive);

    drawBackground();
    for (const e of entities) {
      const r = e.size * (1 + e.pop * 0.4);
      const color = e.bad ? "#f1416c" : "#f6c000";
      drawStar(e.x, e.y, r, e.rot, color);
    }

    rafId = requestAnimationFrame(frame);
  }

  function start() {
    score = 0;
    timeLeft = 30;
    entities = [];
    spawnEvery = 650;
    running = true;
    lastSpawn = 0;
    lastTs = 0;
    startedAt = performance.now();
    scoreEl.textContent = "0";
    timeEl.textContent = "30";
    overlay.classList.add("is-hidden");
    rafId = requestAnimationFrame(frame);
  }

  function end() {
    running = false;
    cancelAnimationFrame(rafId);
    if (window.RV) window.RV.submitScore("stars", score, "high");
    titleEl.textContent = "Time's up!";
    msgEl.textContent = `You scored ${score}. Score submitted to the leaderboard.`;
    startBtn.textContent = "Play again";
    overlay.classList.remove("is-hidden");
  }

  function hit(x, y) {
    if (!running) return;
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      const dx = x - e.x, dy = y - e.y;
      if (dx * dx + dy * dy < e.size * e.size * 1.3) {
        e.alive = false;
        e.pop = 1;
        if (e.bad) score = Math.max(0, score - 2);
        else score += 1;
        scoreEl.textContent = String(score);
        return;
      }
    }
  }

  canvas.addEventListener("pointerdown", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * W;
    const y = ((ev.clientY - rect.top) / rect.height) * H;
    hit(x, y);
  });

  startBtn.addEventListener("click", start);
  drawBackground();
})();

/* =====================================================
   CALENDAR — monthly availability backed by /bookings
   ===================================================== */
(function () {
  const grid = document.getElementById("calendar");
  if (!grid) return;

  const API = (window.RV && window.RV.api) || "/api";

  const monthLabel = document.getElementById("calMonth");
  const prevBtn = document.getElementById("calPrev");
  const nextBtn = document.getElementById("calNext");
  const todayBtn = document.getElementById("calToday");
  const selDateEl = document.getElementById("calSelectedDate");
  const selStatusEl = document.getElementById("calSelectedStatus");
  const selNoteEl = document.getElementById("calSelectedNote");
  const bookBtn = document.getElementById("calBookBtn");

  const MONTHS = ["January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"];
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();
  let selected = null;

  /** @type {Set<string>} YYYY-MM-DD strings for booked days */
  const bookedDates = new Set();

  function ymd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function statusFor(date) {
    const isPast = date < today;
    if (bookedDates.has(ymd(date))) {
      return {
        key: "booked",
        label: "Booked",
        note: "This day is taken. Please pick another date.",
      };
    }
    if (isPast) {
      return {
        key: "past",
        label: "Past date",
        note: "This date has already passed.",
      };
    }
    return {
      key: "available",
      label: "Available",
      note: "Open for booking. Click below to claim this day.",
    };
  }

  function formatDate(d) {
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  function render() {
    monthLabel.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
    grid.innerHTML = "";

    DOW.forEach((d) => {
      const h = document.createElement("div");
      h.className = "rv-cal-head";
      h.textContent = d;
      grid.appendChild(h);
    });

    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    for (let i = 0; i < startOffset; i++) {
      const el = document.createElement("div");
      el.className = "rv-cal-day is-muted";
      grid.appendChild(el);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const cellDate = new Date(viewYear, viewMonth, d);
      const st = statusFor(cellDate);
      const el = document.createElement("button");
      el.type = "button";
      el.className = "rv-cal-day";
      if (+cellDate === +today) el.classList.add("is-today");
      if (selected && +cellDate === +selected) el.classList.add("is-selected");
      if (st.key === "past") el.classList.add("is-past");
      if (st.key === "booked") el.classList.add("is-booked");
      el.setAttribute("aria-label", `${formatDate(cellDate)} — ${st.label}`);
      const dotColor =
        st.key === "available" ? "var(--rv-success)" :
        st.key === "booked"    ? "var(--rv-danger)"  :
        "var(--rv-text-faint)";
      el.innerHTML = `
        <span class="rv-cal-num">${d}</span>
        <span class="rv-cal-status-dot" style="background: ${dotColor};"></span>
      `;
      el.addEventListener("click", () => selectDate(cellDate));
      grid.appendChild(el);
    }
  }

  function selectDate(d) {
    selected = new Date(d);
    selected.setHours(0, 0, 0, 0);
    const st = statusFor(selected);
    selDateEl.textContent = formatDate(selected);
    const iconMap = {
      available: "bi-check-circle",
      booked:    "bi-x-circle",
      past:      "bi-clock-history",
    };
    selStatusEl.className = `rv-cal-side-status status-${st.key}`;
    selStatusEl.innerHTML = `<i class="bi ${iconMap[st.key] || "bi-calendar"}"></i><span>${st.label}</span>`;
    selNoteEl.textContent = st.note;

    if (st.key === "available") {
      bookBtn.disabled = false;
      bookBtn.classList.remove("disabled");
      bookBtn.removeAttribute("aria-disabled");
      bookBtn.innerHTML = '<i class="bi bi-calendar-plus"></i> Book this day';
    } else {
      bookBtn.disabled = true;
      bookBtn.classList.add("disabled");
      bookBtn.setAttribute("aria-disabled", "true");
      bookBtn.innerHTML =
        st.key === "booked"
          ? '<i class="bi bi-lock-fill"></i> Already booked'
          : '<i class="bi bi-clock-history"></i> Past date';
    }

    render();
  }

  async function loadBookings() {
    try {
      const res = await fetch(`${API}/bookings`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      bookedDates.clear();
      (data.dates || []).forEach((d) => bookedDates.add(d));
      render();
      if (selected) selectDate(selected);
    } catch (_) {
      /* offline or backend down — calendar still works in available mode */
    }
  }

  /* ----- Booking modal ----- */
  const modal = document.getElementById("bookingModal");
  const modalDate = document.getElementById("bookingModalDate");
  const form = document.getElementById("bookingForm");
  const nameEl = document.getElementById("bookingName");
  const emailEl = document.getElementById("bookingEmail");
  const noteEl = document.getElementById("bookingNote");
  const errorEl = document.getElementById("bookingError");
  const submitEl = document.getElementById("bookingSubmit");

  function openModal() {
    if (!selected || statusFor(selected).key !== "available") return;
    errorEl.hidden = true;
    errorEl.textContent = "";
    modalDate.textContent = formatDate(selected);
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    setTimeout(() => nameEl.focus(), 80);
  }
  function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target.dataset && e.target.dataset.close === "1") closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("is-open")) closeModal();
    });
  }

  bookBtn.addEventListener("click", openModal);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selected) return;
    errorEl.hidden = true;
    errorEl.textContent = "";
    const name = nameEl.value.trim();
    const email = emailEl.value.trim();
    const note = noteEl.value.trim();
    if (!name || !email) {
      errorEl.textContent = "Please fill in your name and email.";
      errorEl.hidden = false;
      return;
    }
    submitEl.disabled = true;
    submitEl.innerHTML = '<i class="bi bi-hourglass-split"></i> Saving…';
    try {
      const res = await fetch(`${API}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: ymd(selected), name, email, note }),
      });
      if (res.status === 409) {
        errorEl.textContent = "Someone just booked this day. Pick another date.";
        errorEl.hidden = false;
        await loadBookings();
        return;
      }
      if (!res.ok) {
        errorEl.textContent = "Couldn't save booking. Please try again.";
        errorEl.hidden = false;
        return;
      }
      bookedDates.add(ymd(selected));
      render();
      selectDate(selected);
      form.reset();
      closeModal();
      // Friendly toast via the existing toast helper if available
      if (window.RV && typeof window.RV.toast === "function") {
        window.RV.toast(`Booked ${formatDate(selected)}. Romar will email you back.`);
      }
    } catch (err) {
      errorEl.textContent = "Network error. Check your connection and try again.";
      errorEl.hidden = false;
    } finally {
      submitEl.disabled = false;
      submitEl.innerHTML = '<i class="bi bi-calendar-check"></i> Confirm booking';
    }
  });

  prevBtn.addEventListener("click", () => {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    render();
  });
  nextBtn.addEventListener("click", () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    render();
  });
  todayBtn.addEventListener("click", () => {
    viewYear = today.getFullYear();
    viewMonth = today.getMonth();
    selectDate(today);
  });

  render();
  selectDate(today);
  loadBookings();
})();

/* =====================================================
   BASKETBALL SHOOTING — hold to charge power, release to shoot
   ===================================================== */
(function () {
  const canvas = document.getElementById("bbCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("bbScore");
  const livesEl = document.getElementById("bbLives");
  const overlay = document.getElementById("bbOverlay");
  const titleEl = document.getElementById("bbTitle");
  const msgEl = document.getElementById("bbMsg");
  const startBtn = document.getElementById("bbStart");

  const W = canvas.width;
  const H = canvas.height;
  const GRAV = 900;
  const BALL_R = 15;
  const MAX_HOLD_MS = 1500; // fully-charged hold duration
  const START_LIVES = 5;

  let running = false;
  let score = 0;
  let lives = START_LIVES;
  let rafId = null;
  let lastTs = 0;

  // Ball resting position (player side)
  const ballHome = { x: 110, y: H - 80 };
  let ball = { x: ballHome.x, y: ballHome.y, vx: 0, vy: 0, flying: false };

  // Hoop
  let hoop = { x: W - 90, y: 120, r: 28, moveDir: 1 };
  const RIM_HALF = 36;
  const BACKBOARD = { x: W - 50, yTop: 60, yBot: 120, thickness: 8 };

  // Charging (hold)
  let charging = false;
  let chargeStart = 0;
  let chargeNow = 0;

  function drawCourt() {
    const isDark = document.documentElement.getAttribute("data-bs-theme") === "dark";
    ctx.fillStyle = isDark ? "#15161c" : "#f4f6f9";
    ctx.fillRect(0, 0, W, H);
    // Floor
    ctx.fillStyle = isDark ? "#1f2128" : "#e4e6ef";
    ctx.fillRect(0, H - 40, W, 40);
    // Backboard
    ctx.fillStyle = isDark ? "#2a2c38" : "#c9cdd6";
    ctx.fillRect(BACKBOARD.x, BACKBOARD.yTop, BACKBOARD.thickness, BACKBOARD.yBot - BACKBOARD.yTop);
    // Rim + net (move hoop to side)
    const rimY = hoop.y;
    const rimX1 = hoop.x - RIM_HALF;
    const rimX2 = hoop.x + RIM_HALF;
    ctx.strokeStyle = "#f1416c";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(rimX1, rimY);
    ctx.lineTo(rimX2, rimY);
    ctx.stroke();
    // Net
    ctx.strokeStyle = isDark ? "#5e6278" : "#a1a5b7";
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      ctx.beginPath();
      ctx.moveTo(rimX1 + t * (rimX2 - rimX1), rimY);
      ctx.lineTo(rimX1 + 6 + t * (rimX2 - rimX1 - 12), rimY + 22);
      ctx.stroke();
    }
  }

  function drawBall(x, y) {
    ctx.fillStyle = "#f6994c";
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#8b3f00";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.stroke();
    // seams
    ctx.beginPath();
    ctx.moveTo(x - BALL_R, y);
    ctx.lineTo(x + BALL_R, y);
    ctx.moveTo(x, y - BALL_R);
    ctx.lineTo(x, y + BALL_R);
    ctx.stroke();
  }

  function currentPower() {
    if (!charging) return 0;
    return Math.min(1, (chargeNow - chargeStart) / MAX_HOLD_MS);
  }

  function drawPowerBar() {
    if (!charging) return;
    const pow = currentPower();
    // Arc trajectory preview from ball
    const strength = 420 * pow + 400;
    const ang = -Math.PI / 3; // 60° upward arc
    ctx.strokeStyle = `rgba(27, 132, 255, ${0.25 + pow * 0.6})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    let x = ball.x, y = ball.y;
    let vx = Math.cos(ang) * strength;
    let vy = Math.sin(ang) * strength;
    ctx.moveTo(x, y);
    for (let i = 0; i < 40; i++) {
      vy += GRAV * 0.02;
      x += vx * 0.02;
      y += vy * 0.02;
      if (y > H - 40 || x > W) break;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Power bar at bottom
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.fillRect(20, H - 22, 180, 10);
    ctx.fillStyle = pow > 0.85 ? "#f1416c" : pow > 0.5 ? "#f6c000" : "#1b84ff";
    ctx.fillRect(20, H - 22, 180 * pow, 10);
  }

  function render() {
    drawCourt();
    drawBall(ball.x, ball.y);
    drawPowerBar();
  }

  function frame(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    const dt = Math.min(50, ts - lastTs) / 1000;
    lastTs = ts;

    if (charging) chargeNow = ts;

    // Move hoop up/down for challenge
    hoop.y += hoop.moveDir * 20 * dt;
    if (hoop.y < 90) { hoop.y = 90; hoop.moveDir = 1; }
    if (hoop.y > 180) { hoop.y = 180; hoop.moveDir = -1; }

    if (ball.flying) {
      ball.vy += GRAV * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      // Backboard collision
      if (ball.x + BALL_R > BACKBOARD.x && ball.x - BALL_R < BACKBOARD.x + BACKBOARD.thickness &&
          ball.y > BACKBOARD.yTop && ball.y < BACKBOARD.yBot) {
        ball.x = BACKBOARD.x - BALL_R;
        ball.vx = -Math.abs(ball.vx) * 0.6;
      }

      // Score: ball passes through rim plane downward within rim width
      const rimY = hoop.y;
      if (ball.vy > 0 && ball.y - BALL_R < rimY && ball.y + BALL_R > rimY &&
          ball.x > hoop.x - RIM_HALF + 6 && ball.x < hoop.x + RIM_HALF - 6 &&
          !ball._scored) {
        ball._scored = true;
        score++;
        scoreEl.textContent = String(score);
      }

      // Off screen -> shot is over. If didn't score, lose a life.
      if (ball.y > H + 40 || ball.x > W + 40 || ball.x < -40) {
        if (!ball._scored) {
          lives = Math.max(0, lives - 1);
          livesEl.textContent = String(lives);
        }
        resetBall();
        if (lives <= 0) { end(); return; }
      }
    }

    render();
    rafId = requestAnimationFrame(frame);
  }

  function resetBall() {
    ball.x = ballHome.x;
    ball.y = ballHome.y;
    ball.vx = 0;
    ball.vy = 0;
    ball.flying = false;
    ball._scored = false;
  }

  function start() {
    score = 0;
    lives = START_LIVES;
    scoreEl.textContent = "0";
    livesEl.textContent = String(START_LIVES);
    resetBall();
    running = true;
    charging = false;
    lastTs = 0;
    overlay.classList.add("is-hidden");
    rafId = requestAnimationFrame(frame);
  }

  function end() {
    running = false;
    charging = false;
    cancelAnimationFrame(rafId);
    if (window.RV) window.RV.submitScore("basket", score, "high");
    titleEl.textContent = "Out of lives";
    msgEl.textContent = `You scored ${score} bucket${score === 1 ? "" : "s"}.`;
    startBtn.textContent = "Play again";
    overlay.classList.remove("is-hidden");
  }

  function shoot() {
    if (!running || ball.flying) return;
    const pow = currentPower();
    charging = false;
    if (pow < 0.05) return;
    const strength = 420 * pow + 400;
    const ang = -Math.PI / 3; // fixed 60° arc — power alone decides distance
    ball.vx = Math.cos(ang) * strength;
    ball.vy = Math.sin(ang) * strength;
    ball.flying = true;
    ball._scored = false;
  }

  canvas.addEventListener("pointerdown", (ev) => {
    if (!running || ball.flying || charging) return;
    ev.preventDefault();
    charging = true;
    chargeStart = performance.now();
    chargeNow = chargeStart;
    canvas.setPointerCapture?.(ev.pointerId);
  });
  canvas.addEventListener("pointerup", () => {
    if (!charging) return;
    shoot();
  });
  canvas.addEventListener("pointercancel", () => { charging = false; });

  // Spacebar also charges
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat) return;
    const pane = document.getElementById("game-basket");
    if (!pane || pane.classList.contains("d-none")) return;
    if (!running || ball.flying || charging) return;
    e.preventDefault();
    charging = true;
    chargeStart = performance.now();
    chargeNow = chargeStart;
  });
  document.addEventListener("keyup", (e) => {
    if (e.code !== "Space" || !charging) return;
    e.preventDefault();
    shoot();
  });

  startBtn.addEventListener("click", start);
  render();
})();

/* =====================================================
   MINESWEEPER — 6x6 with 8 mines
   ===================================================== */
(function () {
  const board = document.getElementById("mineBoard");
  if (!board) return;
  const leftEl = document.getElementById("mineLeft");
  const timeEl = document.getElementById("mineTime");
  const resetBtn = document.getElementById("mineReset");
  const msgEl = document.getElementById("mineMsg");

  const COLS = 6, ROWS = 6, MINES = 8;
  let grid = [];
  let revealed = 0;
  let flags = 0;
  let firstMove = true;
  let timerStart = 0;
  let timerId = null;
  let gameOver = false;

  function newBoard(safeIdx) {
    grid = [];
    for (let i = 0; i < COLS * ROWS; i++) grid.push({ mine: false, adj: 0, open: false, flag: false });
    const banned = new Set([safeIdx]);
    // Also spare neighbors of first click for a nicer start
    neighbors(safeIdx).forEach((n) => banned.add(n));
    let placed = 0;
    while (placed < MINES) {
      const k = Math.floor(Math.random() * grid.length);
      if (banned.has(k) || grid[k].mine) continue;
      grid[k].mine = true;
      placed++;
    }
    for (let i = 0; i < grid.length; i++) {
      if (grid[i].mine) continue;
      grid[i].adj = neighbors(i).filter((n) => grid[n].mine).length;
    }
  }

  function idx(r, c) { return r * COLS + c; }
  function rc(i) { return [Math.floor(i / COLS), i % COLS]; }
  function neighbors(i) {
    const [r, c] = rc(i);
    const out = [];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) out.push(idx(nr, nc));
      }
    return out;
  }

  function render() {
    board.innerHTML = "";
    grid.forEach((cell, i) => {
      const el = document.createElement("div");
      el.className = "rv-mine-cell";
      el.dataset.i = String(i);
      if (cell.open) {
        el.classList.add("is-open");
        if (cell.mine) el.classList.add("is-mine");
        else if (cell.adj > 0) {
          el.textContent = String(cell.adj);
          el.classList.add("c" + cell.adj);
        }
      } else if (cell.flag) {
        el.classList.add("is-flag");
        el.innerHTML = '<i class="bi bi-flag-fill"></i>';
      }
      board.appendChild(el);
    });
    leftEl.textContent = String(Math.max(0, MINES - flags));
  }

  function reveal(i) {
    if (gameOver) return;
    const cell = grid[i];
    if (!cell || cell.open || cell.flag) return;
    cell.open = true;
    revealed++;
    if (cell.mine) {
      // reveal all mines
      grid.forEach((c) => { if (c.mine) c.open = true; });
      endGame(false);
      return;
    }
    if (cell.adj === 0) {
      neighbors(i).forEach((n) => reveal(n));
    }
    if (revealed === grid.length - MINES) endGame(true);
  }

  function toggleFlag(i) {
    if (gameOver) return;
    const cell = grid[i];
    if (!cell || cell.open) return;
    cell.flag = !cell.flag;
    flags += cell.flag ? 1 : -1;
  }

  function startTimer() {
    timerStart = Date.now();
    timerId = setInterval(() => {
      const s = Math.floor((Date.now() - timerStart) / 1000);
      timeEl.textContent = String(s);
    }, 250);
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function endGame(won) {
    gameOver = true;
    stopTimer();
    const secs = Math.floor((Date.now() - timerStart) / 1000);
    render();
    msgEl.className = "alert mt-3 " + (won ? "alert-success" : "alert-danger");
    if (won) {
      if (window.RV) window.RV.submitScore("mine", secs, "low");
      msgEl.innerHTML = `Cleared in <strong>${secs}s</strong>. Score submitted to the leaderboard.` +
        ' <button class="btn btn-sm btn-light-primary ms-2" id="mineAgain">New board</button>';
    } else {
      msgEl.innerHTML = 'Boom. <button class="btn btn-sm btn-light-primary ms-2" id="mineAgain">Try again</button>';
    }
    msgEl.classList.remove("d-none");
    document.getElementById("mineAgain")?.addEventListener("click", reset);
  }

  function reset() {
    stopTimer();
    grid = [];
    revealed = 0;
    flags = 0;
    firstMove = true;
    gameOver = false;
    timeEl.textContent = "0";
    msgEl.classList.add("d-none");
    for (let i = 0; i < COLS * ROWS; i++) grid.push({ mine: false, adj: 0, open: false, flag: false });
    render();
  }

  board.addEventListener("click", (ev) => {
    const cell = ev.target.closest(".rv-mine-cell");
    if (!cell) return;
    const i = Number(cell.dataset.i);
    if (firstMove) {
      newBoard(i);
      firstMove = false;
      startTimer();
    }
    reveal(i);
    render();
  });
  board.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    const cell = ev.target.closest(".rv-mine-cell");
    if (!cell || firstMove) return;
    toggleFlag(Number(cell.dataset.i));
    render();
  });
  // Long-press flag for mobile
  let pressTimer = null;
  board.addEventListener("pointerdown", (ev) => {
    const cell = ev.target.closest(".rv-mine-cell");
    if (!cell || firstMove) return;
    pressTimer = setTimeout(() => {
      toggleFlag(Number(cell.dataset.i));
      render();
      pressTimer = "fired";
    }, 450);
  });
  board.addEventListener("pointerup", () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; });
  board.addEventListener("pointerleave", () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; });

  resetBtn.addEventListener("click", reset);
  reset();
})();

/* =====================================================
   MATH QUIZ — Normal/Hard/Pro Expert/God Mode
   ===================================================== */
(function () {
  const wrap = document.getElementById("mathStage");
  if (!wrap) return;
  const qEl = document.getElementById("mathQuestion");
  const choicesEl = document.getElementById("mathChoices");
  const timerFill = document.getElementById("mathTimerFill");
  const startBtn = document.getElementById("mathStart");
  const resultEl = document.getElementById("mathResult");
  const qCount = document.getElementById("mathQ");
  const scoreEl = document.getElementById("mathScore");

  const DIFF = {
    normal: { time: 30, qRange: [1, 20], ops: ["+", "-"], label: "Normal" },
    hard:   { time: 30, qRange: [5, 50], ops: ["+", "-", "*"], label: "Hard" },
    pro:    { time: 30, qRange: [10, 99], ops: ["+", "-", "*", "/"], label: "Pro Expert" },
    god:    { time: 30, qRange: [15, 150], ops: ["+", "-", "*", "/", "^"], label: "God Mode" },
  };
  const MULT = { normal: 10, hard: 18, pro: 28, god: 45 };

  let diff = "normal";
  let q = 0;
  let score = 0;
  let current = null;
  let timerId = null;
  let qStart = 0;

  function rand(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

  function makeQuestion() {
    const c = DIFF[diff];
    const op = c.ops[rand(0, c.ops.length - 1)];
    let a = rand(c.qRange[0], c.qRange[1]);
    let b = rand(c.qRange[0], c.qRange[1]);
    let ans;
    let text;
    if (op === "+") { ans = a + b; text = `${a} + ${b} = ?`; }
    else if (op === "-") { if (b > a) [a, b] = [b, a]; ans = a - b; text = `${a} − ${b} = ?`; }
    else if (op === "*") {
      if (diff === "hard") { a = rand(3, 15); b = rand(3, 15); }
      if (diff === "pro")  { a = rand(5, 25); b = rand(4, 18); }
      if (diff === "god")  { a = rand(11, 40); b = rand(7, 25); }
      ans = a * b; text = `${a} × ${b} = ?`;
    } else if (op === "/") {
      b = rand(2, diff === "god" ? 18 : 12);
      const r = rand(2, diff === "god" ? 40 : 20);
      a = b * r; ans = r; text = `${a} ÷ ${b} = ?`;
    } else {
      a = rand(2, diff === "god" ? 14 : 10);
      b = rand(2, diff === "god" ? 4 : 3);
      ans = Math.pow(a, b); text = `${a}^${b} = ?`;
    }
    // Generate distractors
    const set = new Set([ans]);
    while (set.size < 4) {
      const jitter = Math.max(1, Math.floor(Math.abs(ans) * 0.15) + rand(1, 6));
      const cand = ans + (Math.random() < 0.5 ? -1 : 1) * rand(1, jitter + 5);
      if (cand !== ans) set.add(cand);
    }
    const opts = Array.from(set).sort(() => Math.random() - 0.5);
    return { text, ans, opts };
  }

  function renderQuestion() {
    qEl.textContent = current.text;
    choicesEl.innerHTML = "";
    current.opts.forEach((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rv-quiz-choice";
      b.textContent = String(o);
      b.addEventListener("click", () => answer(o, b));
      choicesEl.appendChild(b);
    });
    qStart = performance.now();
    startTimer();
  }

  function startTimer() {
    const total = DIFF[diff].time * 1000;
    clearInterval(timerId);
    timerId = setInterval(() => {
      const elapsed = performance.now() - qStart;
      const pct = Math.max(0, 1 - elapsed / total);
      timerFill.style.width = (pct * 100).toFixed(1) + "%";
      if (pct <= 0) { clearInterval(timerId); timeoutQuestion(); }
    }, 80);
  }

  function timeoutQuestion() {
    Array.from(choicesEl.children).forEach((b) => {
      b.disabled = true;
      if (Number(b.textContent) === current.ans) b.classList.add("is-right");
      else b.classList.add("is-timeout");
    });
    flashTimeUp();
    setTimeout(next, 900);
  }

  function flashTimeUp() {
    if (!qEl) return;
    const old = qEl.textContent;
    const flash = document.createElement("span");
    flash.className = "rv-quiz-flash";
    flash.textContent = "⏱ Time's up!";
    qEl.appendChild(flash);
    setTimeout(() => flash.remove(), 850);
  }

  function answer(val, btn) {
    clearInterval(timerId);
    const correct = val === current.ans;
    Array.from(choicesEl.children).forEach((b) => {
      b.disabled = true;
      if (Number(b.textContent) === current.ans) b.classList.add("is-right");
    });
    if (!correct) btn.classList.add("is-wrong");
    if (correct) {
      const elapsed = (performance.now() - qStart) / 1000;
      const total = DIFF[diff].time;
      const bonus = Math.max(0, 1 - elapsed / total);
      const pts = Math.round(MULT[diff] * (1 + bonus));
      score += pts;
      scoreEl.textContent = String(score);
    }
    setTimeout(next, 650);
  }

  function next() {
    q++;
    if (q > 10) { finish(); return; }
    qCount.textContent = String(q);
    current = makeQuestion();
    renderQuestion();
  }

  function finish() {
    clearInterval(timerId);
    timerFill.style.width = "0%";
    qEl.textContent = "Done!";
    choicesEl.innerHTML = "";
    if (window.RV) window.RV.submitScore("math_" + diff, score, "high");
    // Also update the visible leaderboard shown in sidebar for this diff
    renderMathLBFor(diff);
    resultEl.className = "alert alert-success mt-3";
    resultEl.innerHTML = `<strong>${DIFF[diff].label}</strong> — final score <strong>${score}</strong>. Submitted to the leaderboard.` +
      ' <button class="btn btn-sm btn-light-primary ms-2" id="mathAgain">Play again</button>';
    resultEl.classList.remove("d-none");
    startBtn.classList.remove("d-none");
    startBtn.innerHTML = '<i class="bi bi-play-fill"></i> Start quiz';
    document.getElementById("mathAgain")?.addEventListener("click", start);
  }

  function start() {
    q = 0;
    score = 0;
    qCount.textContent = "0";
    scoreEl.textContent = "0";
    resultEl.classList.add("d-none");
    startBtn.classList.add("d-none");
    next();
  }

  // Difficulty buttons (play side)
  document.querySelectorAll("[data-math-diff]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-math-diff]").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      diff = b.getAttribute("data-math-diff");
    });
  });

  // Leaderboard tabs (sidebar)
  function renderMathLBFor(d) {
    const ol = document.querySelector('[data-lb-list^="math_"]');
    if (!ol) return;
    ol.setAttribute("data-lb-list", "math_" + d);
    if (window.RV) window.RV.renderLB("math_" + d);
  }
  document.querySelectorAll("[data-lb-math-diff]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-lb-math-diff]").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      renderMathLBFor(b.getAttribute("data-lb-math-diff"));
    });
  });

  startBtn.addEventListener("click", start);
})();

/* =====================================================
   ENGLISH QUIZ — 4 difficulty tiers, vocab + grammar
   ===================================================== */
(function () {
  const wrap = document.getElementById("engStage");
  if (!wrap) return;
  const qEl = document.getElementById("engQuestion");
  const choicesEl = document.getElementById("engChoices");
  const timerFill = document.getElementById("engTimerFill");
  const startBtn = document.getElementById("engStart");
  const resultEl = document.getElementById("engResult");
  const qCount = document.getElementById("engQ");
  const scoreEl = document.getElementById("engScore");

  const BANKS = {
    normal: [
      { q: "Pick the synonym of HAPPY.", a: "Joyful", opts: ["Joyful", "Angry", "Tired", "Silent"] },
      { q: "Opposite of BIG.", a: "Small", opts: ["Tall", "Wide", "Small", "Heavy"] },
      { q: "She ___ to school every day.", a: "goes", opts: ["go", "goes", "gone", "going"] },
      { q: "An apple ___ a fruit.", a: "is", opts: ["are", "is", "be", "been"] },
      { q: "Plural of CHILD.", a: "Children", opts: ["Childs", "Children", "Childes", "Childen"] },
      { q: "Choose the correct article: ___ hour.", a: "an", opts: ["a", "an", "the", "no article"] },
      { q: "Synonym of QUICK.", a: "Fast", opts: ["Slow", "Fast", "Late", "Heavy"] },
      { q: "I have ___ pencil.", a: "a", opts: ["a", "an", "the", "some"] },
      { q: "Which is a noun?", a: "Book", opts: ["Run", "Quickly", "Book", "Blue"] },
      { q: "Past tense of GO.", a: "Went", opts: ["Goed", "Gone", "Went", "Going"] },
      { q: "Opposite of HOT.", a: "Cold", opts: ["Warm", "Cool", "Cold", "Mild"] },
      { q: "Synonym of BEGIN.", a: "Start", opts: ["End", "Start", "Stop", "Finish"] },
    ],
    hard: [
      { q: "Synonym of ABUNDANT.", a: "Plentiful", opts: ["Scarce", "Plentiful", "Tiny", "Empty"] },
      { q: "Choose the correct: Neither of the boys ___ here.", a: "is", opts: ["is", "are", "were", "be"] },
      { q: "Antonym of TRANSPARENT.", a: "Opaque", opts: ["Clear", "Opaque", "Bright", "Sheer"] },
      { q: "He ___ to Paris last year.", a: "went", opts: ["has gone", "went", "goes", "had gone"] },
      { q: "Which is an adverb?", a: "Quickly", opts: ["Quick", "Quickly", "Quicken", "Quickness"] },
      { q: "Synonym of DILIGENT.", a: "Hardworking", opts: ["Lazy", "Bored", "Hardworking", "Careless"] },
      { q: "If I ___ you, I'd apologize.", a: "were", opts: ["was", "were", "am", "be"] },
      { q: "Antonym of GENUINE.", a: "Fake", opts: ["Real", "True", "Fake", "Honest"] },
      { q: "Past participle of WRITE.", a: "Written", opts: ["Wrote", "Writed", "Written", "Writing"] },
      { q: "Synonym of RELUCTANT.", a: "Unwilling", opts: ["Eager", "Unwilling", "Happy", "Ready"] },
      { q: "Choose: The team ___ winning.", a: "is", opts: ["is", "are", "were", "be"] },
      { q: "Antonym of LUCID.", a: "Confusing", opts: ["Clear", "Confusing", "Bright", "Obvious"] },
    ],
    pro: [
      { q: "Synonym of EPHEMERAL.", a: "Fleeting", opts: ["Eternal", "Fleeting", "Solid", "Ancient"] },
      { q: "Antonym of VERBOSE.", a: "Concise", opts: ["Wordy", "Concise", "Loud", "Bold"] },
      { q: "She ___ here by the time we arrive.", a: "will have been", opts: ["will be", "will have been", "has been", "is"] },
      { q: "Synonym of UBIQUITOUS.", a: "Everywhere", opts: ["Rare", "Nowhere", "Everywhere", "Hidden"] },
      { q: "Which is a gerund in: 'Swimming is fun'?", a: "Swimming", opts: ["Swimming", "is", "fun", "none"] },
      { q: "Antonym of BENEVOLENT.", a: "Malevolent", opts: ["Kind", "Generous", "Malevolent", "Caring"] },
      { q: "Synonym of OSTENTATIOUS.", a: "Showy", opts: ["Humble", "Showy", "Quiet", "Plain"] },
      { q: "The committee ___ its decision.", a: "has made", opts: ["have made", "has made", "are making", "making"] },
      { q: "Synonym of CANDID.", a: "Frank", opts: ["Hidden", "Frank", "Shy", "Vague"] },
      { q: "Antonym of INDIGENT.", a: "Wealthy", opts: ["Poor", "Needy", "Wealthy", "Hungry"] },
      { q: "Synonym of ALACRITY.", a: "Eagerness", opts: ["Laziness", "Eagerness", "Anger", "Doubt"] },
      { q: "Identify the clause type: 'Because it rained, we stayed in.'", a: "Adverb clause", opts: ["Noun clause", "Adverb clause", "Adjective clause", "Independent clause"] },
    ],
    god: [
      { q: "Synonym of PERSPICACIOUS.", a: "Insightful", opts: ["Confused", "Insightful", "Boring", "Dull"] },
      { q: "Antonym of LACONIC.", a: "Verbose", opts: ["Brief", "Verbose", "Quiet", "Terse"] },
      { q: "Synonym of OBSTREPEROUS.", a: "Unruly", opts: ["Calm", "Unruly", "Quiet", "Gentle"] },
      { q: "Antonym of SALUBRIOUS.", a: "Unhealthy", opts: ["Healthy", "Unhealthy", "Rich", "Poor"] },
      { q: "Synonym of SURREPTITIOUS.", a: "Stealthy", opts: ["Open", "Stealthy", "Loud", "Obvious"] },
      { q: "Pick: Not only ___ late, but he also forgot his keys.", a: "was he", opts: ["he was", "was he", "he is", "is he"] },
      { q: "Antonym of PROLIX.", a: "Succinct", opts: ["Lengthy", "Succinct", "Wordy", "Vague"] },
      { q: "Synonym of TACITURN.", a: "Reserved", opts: ["Chatty", "Reserved", "Loud", "Friendly"] },
      { q: "Antonym of MAGNANIMOUS.", a: "Petty", opts: ["Generous", "Kind", "Petty", "Noble"] },
      { q: "Synonym of PULCHRITUDE.", a: "Beauty", opts: ["Ugliness", "Beauty", "Strength", "Kindness"] },
      { q: "Identify: 'Had I known, I would have left.' —", a: "Third conditional (inverted)", opts: ["First conditional", "Second conditional", "Third conditional (inverted)", "Zero conditional"] },
      { q: "Synonym of QUOTIDIAN.", a: "Everyday", opts: ["Rare", "Everyday", "Special", "Ancient"] },
    ],
  };
  const DIFF = {
    normal: { time: 30, label: "Normal" },
    hard:   { time: 30, label: "Hard" },
    pro:    { time: 30, label: "Pro Expert" },
    god:    { time: 30, label: "God Mode" },
  };
  const MULT = { normal: 10, hard: 18, pro: 28, god: 45 };

  let diff = "normal";
  let pool = [];
  let q = 0;
  let score = 0;
  let current = null;
  let timerId = null;
  let qStart = 0;

  function makeQuestion() {
    if (pool.length === 0) pool = BANKS[diff].slice().sort(() => Math.random() - 0.5);
    const item = pool.shift();
    const opts = item.opts.slice().sort(() => Math.random() - 0.5);
    return { q: item.q, a: item.a, opts };
  }

  function renderQuestion() {
    qEl.textContent = current.q;
    choicesEl.innerHTML = "";
    current.opts.forEach((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rv-quiz-choice";
      b.textContent = o;
      b.addEventListener("click", () => answer(o, b));
      choicesEl.appendChild(b);
    });
    qStart = performance.now();
    startTimer();
  }

  function startTimer() {
    const total = DIFF[diff].time * 1000;
    clearInterval(timerId);
    timerId = setInterval(() => {
      const elapsed = performance.now() - qStart;
      const pct = Math.max(0, 1 - elapsed / total);
      timerFill.style.width = (pct * 100).toFixed(1) + "%";
      if (pct <= 0) { clearInterval(timerId); timeoutQuestion(); }
    }, 80);
  }

  function timeoutQuestion() {
    Array.from(choicesEl.children).forEach((b) => {
      b.disabled = true;
      if (b.textContent === current.a) b.classList.add("is-right");
      else b.classList.add("is-timeout");
    });
    flashTimeUp();
    setTimeout(next, 900);
  }

  function flashTimeUp() {
    if (!qEl) return;
    const flash = document.createElement("span");
    flash.className = "rv-quiz-flash";
    flash.textContent = "⏱ Time's up!";
    qEl.appendChild(flash);
    setTimeout(() => flash.remove(), 850);
  }

  function answer(val, btn) {
    clearInterval(timerId);
    const correct = val === current.a;
    Array.from(choicesEl.children).forEach((b) => {
      b.disabled = true;
      if (b.textContent === current.a) b.classList.add("is-right");
    });
    if (!correct) btn.classList.add("is-wrong");
    if (correct) {
      const elapsed = (performance.now() - qStart) / 1000;
      const total = DIFF[diff].time;
      const bonus = Math.max(0, 1 - elapsed / total);
      const pts = Math.round(MULT[diff] * (1 + bonus));
      score += pts;
      scoreEl.textContent = String(score);
    }
    setTimeout(next, 700);
  }

  function next() {
    q++;
    if (q > 10) { finish(); return; }
    qCount.textContent = String(q);
    current = makeQuestion();
    renderQuestion();
  }

  function finish() {
    clearInterval(timerId);
    timerFill.style.width = "0%";
    qEl.textContent = "Done!";
    choicesEl.innerHTML = "";
    if (window.RV) window.RV.submitScore("english_" + diff, score, "high");
    renderEngLBFor(diff);
    resultEl.className = "alert alert-success mt-3";
    resultEl.innerHTML = `<strong>${DIFF[diff].label}</strong> — final score <strong>${score}</strong>. Submitted to the leaderboard.` +
      ' <button class="btn btn-sm btn-light-primary ms-2" id="engAgain">Play again</button>';
    resultEl.classList.remove("d-none");
    startBtn.classList.remove("d-none");
    startBtn.innerHTML = '<i class="bi bi-play-fill"></i> Start quiz';
    document.getElementById("engAgain")?.addEventListener("click", start);
  }

  function start() {
    q = 0;
    score = 0;
    pool = [];
    qCount.textContent = "0";
    scoreEl.textContent = "0";
    resultEl.classList.add("d-none");
    startBtn.classList.add("d-none");
    next();
  }

  document.querySelectorAll("[data-eng-diff]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-eng-diff]").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      diff = b.getAttribute("data-eng-diff");
    });
  });

  function renderEngLBFor(d) {
    const ol = document.querySelector('[data-lb-list^="english_"]');
    if (!ol) return;
    ol.setAttribute("data-lb-list", "english_" + d);
    if (window.RV) window.RV.renderLB("english_" + d);
  }
  document.querySelectorAll("[data-lb-eng-diff]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-lb-eng-diff]").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      renderEngLBFor(b.getAttribute("data-lb-eng-diff"));
    });
  });

  startBtn.addEventListener("click", start);
})();

/* =====================================================
   PIANO TILES — tap falling tiles; speed grows with score
   ===================================================== */
(function () {
  const canvas = document.getElementById("tlCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("tlScore");
  const speedEl = document.getElementById("tlSpeed");
  const overlay = document.getElementById("tlOverlay");
  const titleEl = document.getElementById("tlTitle");
  const msgEl = document.getElementById("tlMsg");
  const startBtn = document.getElementById("tlStart");
  const stopBtn = document.getElementById("tlStop");
  const missEl = document.getElementById("tlMisses");

  const W = canvas.width;
  const H = canvas.height;
  const COLS = 4;
  const COLW = W / COLS;
  const TILE_H = 150;

  let tiles = [];
  let speed = 180; // px/sec
  let score = 0;
  let misses = 0;
  let flashUntil = 0;
  let running = false;
  let rafId = null;
  let lastTs = 0;
  let nextSpawnY = -TILE_H;

  // Use the same Salamander Grand piano samples as the Piano game.
  // Falls back to a warm AudioContext synth if Tone.js hasn't loaded yet.
  let tlSampler = null;
  let tlSamplerLoaded = false;
  let ac = null;
  const TILE_NOTES = ["C4", "E4", "G4", "C5"]; // one note per lane
  function ensureTileSampler() {
    if (tlSampler || typeof Tone === "undefined") return tlSampler;
    try { Tone.start(); } catch (e) {}
    tlSampler = new Tone.Sampler({
      urls: {
        C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3", A4: "A4.mp3",
        C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3", A5: "A5.mp3",
      },
      release: 1,
      baseUrl: "https://tonejs.github.io/audio/salamander/",
      onload: () => { tlSamplerLoaded = true; },
    }).toDestination();
    return tlSampler;
  }
  function pluck(col) {
    const note = TILE_NOTES[col] || "C4";
    const s = ensureTileSampler();
    if (s && tlSamplerLoaded) {
      try { Tone.start(); s.triggerAttackRelease(note, "8n"); return; } catch (e) {}
    }
    // Fallback: small synth
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
    }
    const t = ac.currentTime;
    const freqs = [261.63, 329.63, 392.0, 523.25];
    const o = ac.createOscillator();
    o.type = "triangle";
    o.frequency.value = freqs[col] || 440;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.4);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + 0.45);
  }

  function spawn() {
    const col = Math.floor(Math.random() * COLS);
    tiles.push({ col, y: nextSpawnY, hit: false });
    nextSpawnY -= TILE_H;
  }

  function drawBoard() {
    // background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    // lane separators
    ctx.strokeStyle = "#eef0f3";
    ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(i * COLW, 0);
      ctx.lineTo(i * COLW, H);
      ctx.stroke();
    }
    // bottom hit line
    ctx.strokeStyle = "#f1416c";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, H - 6);
    ctx.lineTo(W, H - 6);
    ctx.stroke();
    ctx.setLineDash([]);

    // tiles
    tiles.forEach((t) => {
      ctx.fillStyle = t.hit ? "#dbeeff" : "#0b0f1a";
      ctx.fillRect(t.col * COLW + 4, t.y + 2, COLW - 8, TILE_H - 4);
    });

    // miss flash
    if (performance.now() < flashUntil) {
      ctx.fillStyle = "rgba(241, 65, 108, 0.18)";
      ctx.fillRect(0, 0, W, H);
    }
  }

  function updateSpeed() {
    speed = 180 + score * 5 + misses * 3;
    speedEl.textContent = (speed / 180).toFixed(2) + "×";
  }

  function frame(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    const dt = Math.min(50, ts - lastTs) / 1000;
    lastTs = ts;

    // Scroll both the tiles AND the spawn cursor downward so new tiles keep coming.
    const delta = speed * dt;
    nextSpawnY += delta;
    tiles.forEach((t) => (t.y += delta));

    // Spawn enough tiles to fill top of screen
    while (nextSpawnY > -TILE_H) spawn();

    // Missed tile (unhit, scrolled past bottom): count as a miss and remove
    const before = tiles.length;
    tiles = tiles.filter((t) => {
      if (!t.hit && t.y > H) {
        misses++;
        flashUntil = performance.now() + 180;
        return false;
      }
      return !(t.hit && t.y > H);
    });
    if (before !== tiles.length) {
      missEl.textContent = String(misses);
      updateSpeed();
    }

    drawBoard();
    rafId = requestAnimationFrame(frame);
  }

  function hit(x, y) {
    if (!running) return;
    const col = Math.floor(x / COLW);
    // find lowest unhit tile in this column that's on screen
    let target = null;
    for (const t of tiles) {
      if (t.hit || t.col !== col) continue;
      if (t.y + TILE_H < 0 || t.y > H) continue;
      if (!target || t.y > target.y) target = t;
    }
    if (!target || y < target.y || y > target.y + TILE_H) {
      // Wrong tap: count as miss, do not end game
      misses++;
      missEl.textContent = String(misses);
      flashUntil = performance.now() + 180;
      updateSpeed();
      return;
    }
    target.hit = true;
    score++;
    scoreEl.textContent = String(score);
    updateSpeed();
    pluck(col);
  }

  function start() {
    tiles = [];
    score = 0;
    misses = 0;
    speed = 180;
    // First tile spawns right at the top of the canvas; more keep coming in the frame loop.
    nextSpawnY = 0;
    running = true;
    lastTs = 0;
    // Kick off sampler preload so the first tap has audio
    ensureTileSampler();
    scoreEl.textContent = "0";
    missEl.textContent = "0";
    speedEl.textContent = "1.00×";
    overlay.classList.add("is-hidden");
    stopBtn.classList.remove("d-none");
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    if (window.RV && score > 0) window.RV.submitScore("tiles", score, "high");
    titleEl.textContent = "Nice run";
    msgEl.textContent = `Score ${score} · ${misses} miss${misses === 1 ? "" : "es"}. Tap Start to try again.`;
    startBtn.textContent = "Start again";
    overlay.classList.remove("is-hidden");
    stopBtn.classList.add("d-none");
  }

  canvas.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * W;
    const y = ((ev.clientY - rect.top) / rect.height) * H;
    hit(x, y);
  });

  startBtn.addEventListener("click", start);
  if (stopBtn) stopBtn.addEventListener("click", stop);
  // Stop & save when the player leaves the pane or the stage
  if (window.RV) {
    window.RV.on("gameHide", () => { if (running) stop(); });
    window.RV.on("gameShow", (k) => { if (k !== "tiles" && running) stop(); });
  }
  drawBoard();
})();

/* =====================================================
   GUESS THE WORD — random images, Normal/Hard
   ===================================================== */
(function () {
  const stage = document.getElementById("gsStage");
  if (!stage) return;
  const imgEl = document.getElementById("gsImg");
  const imgOver = document.getElementById("gsImgOverlay");
  const choicesEl = document.getElementById("gsChoices");
  const timerFill = document.getElementById("gsTimerFill");
  const startBtn = document.getElementById("gsStart");
  const resultEl = document.getElementById("gsResult");
  const qCount = document.getElementById("gsQ");
  const scoreEl = document.getElementById("gsScore");

  // Common nouns (normal)
  const NORMAL = ("cat dog apple pizza beach tree car house phone bicycle coffee book computer flower "
    + "fish bird cake bread mountain river chair table clock window door shoe hat glasses camera "
    + "guitar piano airplane boat train horse cow lion tiger elephant monkey butterfly snake rabbit "
    + "mouse frog ocean forest desert cloud rainbow star moon sun city bridge castle church hospital "
    + "school park zoo farm garden kitchen bed lamp mirror pillow towel soap pen pencil paper bag "
    + "wallet key lock umbrella ring watch necklace scarf jacket shirt pants dress sock tie belt "
    + "helmet gloves sword arrow shield crown flag map compass anchor feather leaf grass rose tulip "
    + "cactus palm oak rock stone sand snow ice fire smoke lightning candle balloon kite drum violin "
    + "trumpet flute microphone speaker headphones television radio robot magnet fan printer keyboard "
    + "monitor scissors hammer wrench drill saw brush broom bucket ladder rope chain knife fork spoon "
    + "plate cup bowl bottle glass jar pot pan oven fridge microwave blender toaster kettle teapot "
    + "egg cheese milk butter sugar salt honey lemon orange banana grape strawberry pineapple watermelon "
    + "peach pear cherry mango coconut avocado carrot potato tomato onion garlic broccoli cucumber corn "
    + "pumpkin mushroom rice pasta burger sandwich taco sushi donut cupcake cookie icecream chocolate "
    + "candy popcorn chips waffle pancake hotdog soup salad dolphin shark whale octopus crab lobster "
    + "seashell starfish jellyfish penguin owl eagle parrot peacock flamingo giraffe zebra kangaroo "
    + "panda koala sloth raccoon squirrel hedgehog deer moose wolf bear fox bat bee ant spider ladybug "
    + "snail caterpillar dragonfly scorpion beach desert waterfall volcano lighthouse windmill tent "
    + "campfire tractor bulldozer crane helicopter motorcycle scooter skateboard surfboard skis").split(/\s+/);

  // Harder / more obscure (hard)
  const HARD = ("accordion abacus anvil astrolabe barometer bassoon bidet binoculars blacksmith "
    + "boomerang bonsai brass cauldron chandelier chisel clogs compass corkscrew corset crayon "
    + "crutch cufflink cymbal dagger didgeridoo dolphin easel fedora fencing fern fez flagon "
    + "forge funnel gargoyle geyser gladiator glockenspiel gnome gondola gramophone griffin "
    + "gyroscope hammock harmonica harpoon harpsichord hieroglyph hornbill igloo kaleidoscope "
    + "kilt lectern lexicon lotus luge mandolin manuscript masquerade mausoleum medallion "
    + "menagerie meteor minaret minotaur monocle mosaic mosque mummy obelisk obsidian octagon "
    + "olive ottoman palanquin pallet pallet papyrus parchment pavilion pendulum periscope "
    + "phoenix pomegranate porcupine protractor puffin pyramid quill quiver raspberry rhapsody "
    + "rhinoceros riddle rosette saddle sandalwood sapling sarcophagus saxophone scaffold "
    + "sceptre scimitar scribe sculpture sextant shuriken silhouette silo sleigh slingshot "
    + "snorkel sonar sphinx spindle stethoscope stockade stonehenge stirrup tapestry telegraph "
    + "telescope templar terracotta thermos thimble throne timpani toga totem trapeze trellis "
    + "trebuchet trident trowel turbine turnstile ukulele unicorn urn vellum venetian vial "
    + "vortex warship weathervane wigwam xylophone yurt zither").split(/\s+/);

  const POOLS = { normal: NORMAL, hard: HARD };
  const DIFF = {
    normal: { time: 14, mult: 12, label: "Normal" },
    hard:   { time: 10, mult: 22, label: "Hard" },
  };

  let diff = "normal";
  let q = 0;
  let score = 0;
  let current = null;
  let timerId = null;
  let qStart = 0;

  function pickWord() {
    const pool = POOLS[diff];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function pickDistractors(correct, n) {
    const pool = POOLS[diff];
    const out = new Set();
    while (out.size < n) {
      const w = pool[Math.floor(Math.random() * pool.length)];
      if (w !== correct) out.add(w);
    }
    return Array.from(out);
  }

  function makeQ() {
    const word = pickWord();
    const distractors = pickDistractors(word, 3);
    const opts = [word, ...distractors].sort(() => Math.random() - 0.5);
    const lock = Math.floor(Math.random() * 100000);
    const url = `https://loremflickr.com/500/320/${encodeURIComponent(word)}?lock=${lock}`;
    return { word, opts, url };
  }

  function renderQ() {
    imgOver.classList.add("is-hidden");
    imgEl.classList.add("is-loading");
    imgEl.src = current.url;
    imgEl.onload = () => imgEl.classList.remove("is-loading");
    imgEl.onerror = () => {
      imgEl.classList.remove("is-loading");
      imgOver.textContent = "(image failed — guess from choices)";
      imgOver.classList.remove("is-hidden");
    };
    choicesEl.innerHTML = "";
    current.opts.forEach((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rv-quiz-choice";
      b.textContent = o;
      b.addEventListener("click", () => answer(o, b));
      choicesEl.appendChild(b);
    });
    qStart = performance.now();
    startTimer();
  }

  function startTimer() {
    const total = DIFF[diff].time * 1000;
    clearInterval(timerId);
    timerId = setInterval(() => {
      const elapsed = performance.now() - qStart;
      const pct = Math.max(0, 1 - elapsed / total);
      timerFill.style.width = (pct * 100).toFixed(1) + "%";
      if (pct <= 0) { clearInterval(timerId); timeoutQ(); }
    }, 80);
  }

  function timeoutQ() {
    Array.from(choicesEl.children).forEach((b) => {
      b.disabled = true;
      if (b.textContent === current.word) b.classList.add("is-right");
    });
    setTimeout(next, 800);
  }

  function answer(val, btn) {
    clearInterval(timerId);
    const correct = val === current.word;
    Array.from(choicesEl.children).forEach((b) => {
      b.disabled = true;
      if (b.textContent === current.word) b.classList.add("is-right");
    });
    if (!correct) btn.classList.add("is-wrong");
    if (correct) {
      const elapsed = (performance.now() - qStart) / 1000;
      const total = DIFF[diff].time;
      const bonus = Math.max(0, 1 - elapsed / total);
      const pts = Math.round(DIFF[diff].mult * (1 + bonus));
      score += pts;
      scoreEl.textContent = String(score);
    }
    setTimeout(next, 800);
  }

  function next() {
    q++;
    if (q > 10) { finish(); return; }
    qCount.textContent = String(q);
    current = makeQ();
    renderQ();
  }

  function finish() {
    clearInterval(timerId);
    timerFill.style.width = "0%";
    imgEl.removeAttribute("src");
    imgOver.textContent = "Done!";
    imgOver.classList.remove("is-hidden");
    choicesEl.innerHTML = "";
    if (window.RV) window.RV.submitScore("guess_" + diff, score, "high");
    renderGuessLBFor(diff);
    resultEl.className = "alert alert-success mt-3";
    resultEl.innerHTML = `<strong>${DIFF[diff].label}</strong> — score <strong>${score}</strong>. Submitted.` +
      ' <button class="btn btn-sm btn-light-primary ms-2" id="gsAgain">Play again</button>';
    resultEl.classList.remove("d-none");
    startBtn.classList.remove("d-none");
    startBtn.innerHTML = '<i class="bi bi-play-fill"></i> Start quiz';
    document.getElementById("gsAgain")?.addEventListener("click", start);
  }

  function start() {
    q = 0;
    score = 0;
    qCount.textContent = "0";
    scoreEl.textContent = "0";
    resultEl.classList.add("d-none");
    startBtn.classList.add("d-none");
    next();
  }

  document.querySelectorAll("[data-gs-diff]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-gs-diff]").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      diff = b.getAttribute("data-gs-diff");
    });
  });

  function renderGuessLBFor(d) {
    const ol = document.querySelector('[data-lb-list^="guess_"]');
    if (!ol) return;
    ol.setAttribute("data-lb-list", "guess_" + d);
    if (window.RV) window.RV.renderLB("guess_" + d);
  }
  document.querySelectorAll("[data-lb-gs-diff]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-lb-gs-diff]").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      renderGuessLBFor(b.getAttribute("data-lb-gs-diff"));
    });
  });

  startBtn.addEventListener("click", start);
})();

/* =====================================================
   SNAKE — grid canvas + on-screen d-pad + arrow keys
   ===================================================== */
(function () {
  const canvas = document.getElementById("snCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("snScore");
  const stageEl = document.getElementById("snStage");
  const stageChip = document.getElementById("snStageChip");
  const overlay = document.getElementById("snOverlay");
  const titleEl = document.getElementById("snTitle");
  const msgEl = document.getElementById("snMsg");
  const startBtn = document.getElementById("snStart");
  const modeRadios = document.querySelectorAll('input[name="snMode"]');

  const W = canvas.width;
  const H = canvas.height;
  const CELL = 24;
  const COLS = W / CELL; // 16
  const ROWS = H / CELL; // 24
  const STAGE_GOAL = 8; // apples per stage in adventure

  let mode = "classic";
  let snake = [];
  let dir = { x: 0, y: -1 };
  let queuedDir = null;
  let food = null;
  let powerFood = null;
  let boxes = [];
  let score = 0;
  let stage = 1;
  let stageEaten = 0;
  let tickMs = 180;
  let running = false;
  let tickId = null;

  function getMode() {
    const r = document.querySelector('input[name="snMode"]:checked');
    return (r && r.value) || "classic";
  }

  function reset() {
    mode = getMode();
    const cx = Math.floor(COLS / 2);
    const cy = Math.floor(ROWS / 2) + 3;
    snake = [{ x: cx, y: cy }, { x: cx, y: cy + 1 }, { x: cx, y: cy + 2 }];
    dir = { x: 0, y: -1 };
    queuedDir = null;
    score = 0;
    stage = 1;
    stageEaten = 0;
    tickMs = 180;
    boxes = [];
    powerFood = null;
    placeFood();
    if (mode === "adventure") {
      stageChip.hidden = false;
      stageEl.textContent = "1";
      maybeSpawnPowerFood();
    } else {
      stageChip.hidden = true;
    }
    scoreEl.textContent = "0";
    draw();
  }

  function isCellTaken(x, y) {
    if (snake.some((s) => s.x === x && s.y === y)) return true;
    if (food && food.x === x && food.y === y) return true;
    if (powerFood && powerFood.x === x && powerFood.y === y) return true;
    if (boxes.some((b) => b.x === x && b.y === y)) return true;
    return false;
  }

  function placeFood() {
    for (let i = 0; i < 500; i++) {
      const f = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
      if (!isCellTaken(f.x, f.y)) { food = f; return; }
    }
  }

  function maybeSpawnPowerFood() {
    if (mode !== "adventure") return;
    if (powerFood) return;
    if (Math.random() > 0.4) return; // 40% chance per stage / per food eaten
    for (let i = 0; i < 200; i++) {
      const f = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
      if (!isCellTaken(f.x, f.y)) { powerFood = f; return; }
    }
  }

  function addBoxesForStage() {
    // Stage N → (N-1) deadly boxes (so stage 1 = none, stage 2 = 1, …)
    const target = stage - 1;
    let safety = 200;
    while (boxes.length < target && safety-- > 0) {
      const b = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
      // Don't drop a box right next to the snake's head
      const head = snake[0];
      if (Math.abs(b.x - head.x) + Math.abs(b.y - head.y) < 4) continue;
      if (isCellTaken(b.x, b.y)) continue;
      boxes.push(b);
    }
  }

  function nextStage() {
    stage++;
    stageEaten = 0;
    stageEl.textContent = String(stage);
    score += 10; // stage-clear bonus
    scoreEl.textContent = String(score);
    addBoxesForStage();
    powerFood = null;
    maybeSpawnPowerFood();
  }

  function draw() {
    const isDark = document.documentElement.getAttribute("data-bs-theme") === "dark";
    ctx.fillStyle = isDark ? "#15161c" : "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = isDark ? "#23252e" : "#f2f4f7";
    ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, H); ctx.stroke();
    }
    for (let i = 1; i < ROWS; i++) {
      ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(W, i * CELL); ctx.stroke();
    }
    // boxes (deadly)
    boxes.forEach((b) => {
      ctx.fillStyle = "#1f1f29";
      ctx.fillRect(b.x * CELL + 2, b.y * CELL + 2, CELL - 4, CELL - 4);
      ctx.strokeStyle = "#f1416c";
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x * CELL + 2.5, b.y * CELL + 2.5, CELL - 5, CELL - 5);
    });
    // food
    if (food) {
      ctx.fillStyle = "#f1416c";
      ctx.beginPath();
      ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // power food (gold star-like)
    if (powerFood) {
      const cx = powerFood.x * CELL + CELL / 2;
      const cy = powerFood.y * CELL + CELL / 2;
      ctx.fillStyle = "#f6c000";
      ctx.beginPath();
      ctx.arc(cx, cy, CELL / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 14px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("★", cx, cy + 1);
    }
    // snake
    snake.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? "#0b8a3e" : "#17c653";
      ctx.fillRect(s.x * CELL + 2, s.y * CELL + 2, CELL - 4, CELL - 4);
    });
  }

  function step() {
    if (queuedDir) {
      if (!(queuedDir.x === -dir.x && queuedDir.y === -dir.y)) dir = queuedDir;
      queuedDir = null;
    }
    // Wrap-around: leaving an edge re-enters the opposite side.
    const head = {
      x: (snake[0].x + dir.x + COLS) % COLS,
      y: (snake[0].y + dir.y + ROWS) % ROWS,
    };
    if (snake.some((s) => s.x === head.x && s.y === head.y)) return gameOver();
    if (boxes.some((b) => b.x === head.x && b.y === head.y)) return gameOver();
    snake.unshift(head);

    let ate = false;
    if (food && head.x === food.x && head.y === food.y) {
      ate = true;
      score++;
      scoreEl.textContent = String(score);
      tickMs = Math.max(60, 180 - score * 4);
      placeFood();
      maybeSpawnPowerFood();
      stageEaten++;
      if (mode === "adventure" && stageEaten >= STAGE_GOAL) nextStage();
      restartTimer();
    } else if (powerFood && head.x === powerFood.x && head.y === powerFood.y) {
      // Power food: bonus points, doesn't grow snake
      score += 5;
      scoreEl.textContent = String(score);
      powerFood = null;
      ate = true; // skip pop (still grow by 1 cell as a small reward)
    }
    if (!ate) snake.pop();
    draw();
  }

  function restartTimer() {
    if (tickId) clearInterval(tickId);
    tickId = setInterval(step, tickMs);
  }

  function start() {
    reset();
    running = true;
    overlay.classList.add("is-hidden");
    restartTimer();
  }

  function gameOver() {
    running = false;
    if (tickId) clearInterval(tickId);
    if (window.RV) window.RV.submitScore("snake", score, "high");
    titleEl.textContent = "Game over";
    msgEl.textContent = `You ate ${score} apple${score === 1 ? "" : "s"}.`;
    startBtn.textContent = "Play again";
    overlay.classList.remove("is-hidden");
  }

  function setDir(dx, dy) {
    if (!running) return;
    queuedDir = { x: dx, y: dy };
  }

  document.querySelectorAll("[data-snake-dir]").forEach((b) => {
    const d = b.getAttribute("data-snake-dir");
    const go = (ev) => {
      if (ev) ev.preventDefault();
      if (d === "up") setDir(0, -1);
      else if (d === "down") setDir(0, 1);
      else if (d === "left") setDir(-1, 0);
      else if (d === "right") setDir(1, 0);
    };
    b.addEventListener("pointerdown", go);
    b.addEventListener("contextmenu", (ev) => ev.preventDefault());
  });

  document.addEventListener("keydown", (e) => {
    const pane = document.getElementById("game-snake");
    if (!pane || pane.classList.contains("d-none")) return;
    if (e.key === "ArrowUp") { e.preventDefault(); setDir(0, -1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setDir(0, 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setDir(-1, 0); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setDir(1, 0); }
  });

  startBtn.addEventListener("click", start);
  reset();
})();

/* =====================================================
   REACTION TIME — 5 rounds, lower is better
   ===================================================== */
(function () {
  const area = document.getElementById("rxArea");
  if (!area) return;
  const label = document.getElementById("rxLabel");
  const roundEl = document.getElementById("rxRound");
  const bestEl = document.getElementById("rxBest");
  const avgEl = document.getElementById("rxAvg");
  const resultEl = document.getElementById("rxResult");

  const TOTAL_ROUNDS = 5;
  let round = 0;
  let waiting = false;
  let ready = false;
  let startTs = 0;
  let timeoutId = null;
  let times = [];

  function setState(name) {
    area.classList.remove("rv-reaction-idle", "rv-reaction-wait", "rv-reaction-ready", "rv-reaction-early");
    area.classList.add("rv-reaction-" + name);
  }

  function startRound() {
    if (round >= TOTAL_ROUNDS) {
      finish();
      return;
    }
    round++;
    roundEl.textContent = String(round);
    waiting = true;
    ready = false;
    setState("wait");
    label.textContent = "Wait for GREEN…";
    const delay = 900 + Math.random() * 2800;
    timeoutId = setTimeout(() => {
      waiting = false;
      ready = true;
      startTs = performance.now();
      setState("ready");
      label.textContent = "TAP!";
    }, delay);
  }

  function click() {
    if (round === 0 && !waiting && !ready) {
      // very first click — begin the run
      times = [];
      bestEl.textContent = "—";
      avgEl.textContent = "—";
      resultEl.classList.add("d-none");
      startRound();
      return;
    }
    if (waiting) {
      // too early
      clearTimeout(timeoutId);
      setState("early");
      label.textContent = "Too soon — tap to retry this round";
      waiting = false;
      round--; // redo this round
      return;
    }
    if (ready) {
      const ms = Math.round(performance.now() - startTs);
      ready = false;
      times.push(ms);
      const best = Math.min(...times);
      const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
      bestEl.textContent = best + " ms";
      avgEl.textContent = avg + " ms";
      setState("idle");
      label.textContent = `${ms} ms — tap for next round`;
      return;
    }
    // between rounds
    if (round < TOTAL_ROUNDS) startRound();
  }

  function finish() {
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    if (window.RV) window.RV.submitScore("reaction", avg, "low");
    setState("idle");
    label.textContent = `Done — avg ${avg} ms`;
    resultEl.className = "alert alert-success mt-3";
    resultEl.innerHTML = `Average <strong>${avg} ms</strong> over 5 rounds. Submitted to the leaderboard.` +
      ' <button class="btn btn-sm btn-light-primary ms-2" id="rxAgain">Play again</button>';
    resultEl.classList.remove("d-none");
    document.getElementById("rxAgain")?.addEventListener("click", () => {
      round = 0;
      times = [];
      bestEl.textContent = "—";
      avgEl.textContent = "—";
      roundEl.textContent = "0";
      resultEl.classList.add("d-none");
      startRound();
    });
    round = 0;
  }

  area.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    click();
  });
  area.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      click();
    }
  });
  area.setAttribute("tabindex", "0");
  setState("idle");
})();

/* =====================================================
   BOMBERMAN 2D — grid, bombs, blast, enemies. Controller emulator.
   ===================================================== */
(function () {
  const canvas = document.getElementById("bmCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("bmOverlay");
  const titleEl = document.getElementById("bmTitle");
  const msgEl = document.getElementById("bmMsg");
  const startBtn = document.getElementById("bmStart");
  const bombBtn = document.getElementById("bmBomb");
  const scoreEl = document.getElementById("bmScore");
  const levelEl = document.getElementById("bmLevel");
  const livesEl = document.getElementById("bmLives");
  const bombsEl = document.getElementById("bmBombs");

  // Portrait playfield, kept compact so the D-pad + bomb button stay
  // on-screen on phones without scrolling.
  const CELL_SIZE = 34;
  const N_COLS = 11;
  const N_ROWS = 13;
  canvas.width = N_COLS * CELL_SIZE;   // 374
  canvas.height = N_ROWS * CELL_SIZE;  // 442

  // Map codes
  // 0 empty, 1 indestructible wall, 2 destructible block
  let grid;
  let player;
  let bombs; // {x,y,timer,range,owner}
  let blasts; // {cells:[{x,y}], timer}
  let enemies; // {x,y,dx,dy,timer}
  let score = 0;
  let level = 1;
  let lives = 3;
  let maxBombs = 1;
  let blastRange = 2;
  let running = false;
  let lastTs = 0;
  let rafId = null;
  let moveAccum = 0;
  const MOVE_INTERVAL = 140; // ms per tile step (player)
  const ENEMY_INTERVAL = 420;
  let enemyAccum = 0;
  let heldDir = null;
  let invulnUntil = 0;

  // Audio
  let ac = null;
  function beep(freq, dur, type = "square", gain = 0.12) {
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      const t = ac.currentTime;
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      const g = ac.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(ac.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }
  function sfxBomb() { beep(80, 0.35, "sawtooth", 0.2); setTimeout(() => beep(40, 0.25, "square", 0.22), 60); }
  function sfxDrop() { beep(220, 0.06, "square", 0.08); }
  function sfxHit()  { beep(120, 0.2, "triangle", 0.16); }
  function sfxLevel(){ beep(440, 0.08); setTimeout(() => beep(660, 0.08), 90); setTimeout(() => beep(880, 0.14), 180); }

  function buildLevel() {
    grid = Array.from({ length: N_ROWS }, () => Array(N_COLS).fill(0));
    // Indestructible grid pattern
    for (let y = 0; y < N_ROWS; y++) {
      for (let x = 0; x < N_COLS; x++) {
        if (x === 0 || y === 0 || x === N_COLS - 1 || y === N_ROWS - 1) grid[y][x] = 1;
        else if (x % 2 === 0 && y % 2 === 0) grid[y][x] = 1;
      }
    }
    // Random destructible blocks (avoid spawn zone)
    const safe = new Set(["1,1", "2,1", "1,2"]);
    for (let y = 1; y < N_ROWS - 1; y++) {
      for (let x = 1; x < N_COLS - 1; x++) {
        if (grid[y][x] !== 0) continue;
        if (safe.has(x + "," + y)) continue;
        if (Math.random() < 0.55) grid[y][x] = 2;
      }
    }
    player = { x: 1, y: 1, px: 1 * CELL_SIZE, py: 1 * CELL_SIZE };
    bombs = [];
    blasts = [];
    // Spawn enemies in open far cells
    enemies = [];
    const enemyCount = Math.min(2 + level, 6);
    let tries = 0;
    while (enemies.length < enemyCount && tries < 500) {
      tries++;
      const x = 2 + Math.floor(Math.random() * (N_COLS - 4));
      const y = 2 + Math.floor(Math.random() * (N_ROWS - 4));
      if (grid[y][x] !== 0) continue;
      if (Math.abs(x - 1) + Math.abs(y - 1) < 4) continue;
      if (enemies.some((e) => e.x === x && e.y === y)) continue;
      enemies.push({ x, y, timer: 0, dir: Math.floor(Math.random() * 4) });
    }
    heldDir = null;
    moveAccum = 0;
    enemyAccum = 0;
  }

  function resetAll() {
    score = 0; level = 1; lives = 3; maxBombs = 1; blastRange = 2;
    buildLevel();
    updateHud();
  }

  function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    bombsEl.textContent = String(maxBombs);
  }

  function inBounds(x, y) { return x >= 0 && y >= 0 && x < N_COLS && y < N_ROWS; }
  function canWalk(x, y) {
    if (!inBounds(x, y)) return false;
    if (grid[y][x] !== 0) return false;
    if (bombs.some((b) => b.x === x && b.y === y)) return false;
    return true;
  }

  function tryMove(dx, dy) {
    const nx = player.x + dx;
    const ny = player.y + dy;
    if (!canWalk(nx, ny)) return false;
    player.x = nx; player.y = ny;
    return true;
  }

  function dropBomb() {
    if (!running) return;
    const active = bombs.filter((b) => !b.exploded).length;
    if (active >= maxBombs) return;
    if (bombs.some((b) => b.x === player.x && b.y === player.y)) return;
    bombs.push({ x: player.x, y: player.y, timer: 2200, range: blastRange, exploded: false });
    sfxDrop();
  }

  function explode(bomb) {
    bomb.exploded = true;
    const cells = [{ x: bomb.x, y: bomb.y }];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    dirs.forEach(([dx, dy]) => {
      for (let r = 1; r <= bomb.range; r++) {
        const x = bomb.x + dx * r;
        const y = bomb.y + dy * r;
        if (!inBounds(x, y)) break;
        if (grid[y][x] === 1) break;
        cells.push({ x, y });
        if (grid[y][x] === 2) {
          grid[y][x] = 0;
          score += 10;
          // 15% drop: 'B' (extra bomb) or 'F' (flame range) - simple map mark
          if (Math.random() < 0.18) grid[y][x] = Math.random() < 0.5 ? 3 : 4; // 3=bomb-up, 4=flame-up
          break;
        }
      }
    });
    blasts.push({ cells, timer: 420 });
    sfxBomb();
    // Check enemies caught
    enemies = enemies.filter((e) => {
      if (cells.some((c) => c.x === e.x && c.y === e.y)) {
        score += 100;
        sfxHit();
        return false;
      }
      return true;
    });
    // Check player caught
    if (performance.now() > invulnUntil && cells.some((c) => c.x === player.x && c.y === player.y)) {
      loseLife();
    }
    // Chain: if blast cell has a bomb, explode it
    bombs.forEach((b) => {
      if (!b.exploded && cells.some((c) => c.x === b.x && c.y === b.y)) {
        b.timer = 0;
      }
    });
    updateHud();
  }

  function pickupPowerup(x, y) {
    if (!inBounds(x, y)) return;
    if (grid[y][x] === 3) { maxBombs = Math.min(8, maxBombs + 1); score += 50; grid[y][x] = 0; sfxLevel(); updateHud(); }
    else if (grid[y][x] === 4) { blastRange = Math.min(8, blastRange + 1); score += 50; grid[y][x] = 0; sfxLevel(); updateHud(); }
  }

  function loseLife() {
    lives--;
    invulnUntil = performance.now() + 1500;
    updateHud();
    if (lives <= 0) return gameOver();
    // respawn player at start corner if possible
    player.x = 1; player.y = 1;
    heldDir = null;
  }

  function nextLevel() {
    level++;
    score += 200;
    sfxLevel();
    buildLevel();
    updateHud();
  }

  function gameOver() {
    running = false;
    cancelAnimationFrame(rafId);
    if (window.RV && score > 0) window.RV.submitScore("bomber", score, "high");
    titleEl.textContent = "Game over";
    msgEl.textContent = `Score ${score} · Level ${level}. Tap Start to try again.`;
    startBtn.textContent = "Play again";
    overlay.classList.remove("is-hidden");
  }

  function start() {
    resetAll();
    running = true;
    lastTs = 0;
    overlay.classList.add("is-hidden");
    rafId = requestAnimationFrame(loop);
  }

  function stepEnemies() {
    enemies.forEach((e) => {
      const tries = [e.dir, (e.dir + 1) % 4, (e.dir + 3) % 4, (e.dir + 2) % 4];
      for (const d of tries) {
        const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][d];
        const nx = e.x + dx, ny = e.y + dy;
        if (canWalk(nx, ny)) { e.x = nx; e.y = ny; e.dir = d; break; }
      }
    });
    // Collision with player
    if (performance.now() > invulnUntil && enemies.some((e) => e.x === player.x && e.y === player.y)) {
      loseLife();
    }
  }

  function loop(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    const dt = Math.min(60, ts - lastTs);
    lastTs = ts;

    // Player step timer
    if (heldDir) {
      moveAccum += dt;
      while (moveAccum >= MOVE_INTERVAL) {
        moveAccum -= MOVE_INTERVAL;
        tryMove(heldDir.dx, heldDir.dy);
        pickupPowerup(player.x, player.y);
      }
    } else {
      moveAccum = 0;
    }

    // Enemy step timer
    enemyAccum += dt;
    while (enemyAccum >= ENEMY_INTERVAL) {
      enemyAccum -= ENEMY_INTERVAL;
      stepEnemies();
    }

    // Bombs
    bombs.forEach((b) => { if (!b.exploded) b.timer -= dt; });
    bombs.filter((b) => !b.exploded && b.timer <= 0).forEach(explode);
    bombs = bombs.filter((b) => !b.exploded || b.timer > -50);

    // Blasts
    blasts.forEach((b) => (b.timer -= dt));
    blasts = blasts.filter((b) => b.timer > 0);

    // Level complete?
    if (enemies.length === 0 && running) nextLevel();

    draw();
    rafId = requestAnimationFrame(loop);
  }

  function draw() {
    // background tiles
    for (let y = 0; y < N_ROWS; y++) {
      for (let x = 0; x < N_COLS; x++) {
        const px = x * CELL_SIZE, py = y * CELL_SIZE;
        // grass
        ctx.fillStyle = (x + y) % 2 === 0 ? "#2b7a0b" : "#276e0a";
        ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
        const v = grid[y][x];
        if (v === 1) {
          ctx.fillStyle = "#434a57";
          ctx.fillRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
          ctx.fillStyle = "#5b6271";
          ctx.fillRect(px + 3, py + 3, CELL_SIZE - 10, 4);
          ctx.fillRect(px + 3, py + 3, 4, CELL_SIZE - 10);
        } else if (v === 2) {
          ctx.fillStyle = "#9c5a2c";
          ctx.fillRect(px + 2, py + 2, CELL_SIZE - 4, CELL_SIZE - 4);
          ctx.strokeStyle = "#6d3f1e";
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 3, py + 3, CELL_SIZE - 6, CELL_SIZE - 6);
        } else if (v === 3) {
          // bomb-up powerup
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(px + 10, py + 10, CELL_SIZE - 20, CELL_SIZE - 20);
          ctx.fillStyle = "#f1416c";
          ctx.font = "bold 14px Inter, sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("+B", px + CELL_SIZE / 2, py + CELL_SIZE / 2 + 1);
        } else if (v === 4) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(px + 10, py + 10, CELL_SIZE - 20, CELL_SIZE - 20);
          ctx.fillStyle = "#f6a500";
          ctx.font = "bold 14px Inter, sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("+F", px + CELL_SIZE / 2, py + CELL_SIZE / 2 + 1);
        }
      }
    }
    // Bombs
    bombs.forEach((b) => {
      if (b.exploded) return;
      const px = b.x * CELL_SIZE + CELL_SIZE / 2;
      const py = b.y * CELL_SIZE + CELL_SIZE / 2;
      const pulse = 1 + 0.1 * Math.sin(performance.now() / 80);
      ctx.fillStyle = "#0b0f1a";
      ctx.beginPath();
      ctx.arc(px, py, (CELL_SIZE / 2 - 6) * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f1416c";
      ctx.fillRect(px - 1, py - CELL_SIZE / 2 + 4, 2, 4);
    });
    // Blasts
    blasts.forEach((b) => {
      const alpha = Math.min(1, b.timer / 250);
      ctx.fillStyle = `rgba(255, 180, 50, ${alpha})`;
      b.cells.forEach((c) => {
        ctx.fillRect(c.x * CELL_SIZE + 2, c.y * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      });
      ctx.fillStyle = `rgba(255, 230, 120, ${alpha})`;
      b.cells.forEach((c) => {
        ctx.fillRect(c.x * CELL_SIZE + 10, c.y * CELL_SIZE + 10, CELL_SIZE - 20, CELL_SIZE - 20);
      });
    });
    // Enemies
    enemies.forEach((e) => {
      const px = e.x * CELL_SIZE + CELL_SIZE / 2;
      const py = e.y * CELL_SIZE + CELL_SIZE / 2;
      ctx.fillStyle = "#9b2c2c";
      ctx.beginPath();
      ctx.arc(px, py, CELL_SIZE / 2 - 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(px - 6, py - 3, 4, 4);
      ctx.fillRect(px + 2, py - 3, 4, 4);
    });
    // Player
    const flicker = performance.now() < invulnUntil && Math.floor(performance.now() / 100) % 2;
    if (!flicker) {
      const px = player.x * CELL_SIZE + CELL_SIZE / 2;
      const py = player.y * CELL_SIZE + CELL_SIZE / 2;
      ctx.fillStyle = "#1b84ff";
      ctx.beginPath();
      ctx.arc(px, py, CELL_SIZE / 2 - 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(px - 5, py - 5, 4, 4);
      ctx.fillRect(px + 1, py - 5, 4, 4);
      ctx.fillStyle = "#0b0f1a";
      ctx.fillRect(px - 4, py - 4, 2, 2);
      ctx.fillRect(px + 2, py - 4, 2, 2);
    }
  }

  // Controls
  const DIRS = {
    up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 },
  };
  function pressDir(d) {
    heldDir = DIRS[d] || null;
    // Immediate step for responsiveness
    if (heldDir && running) {
      if (tryMove(heldDir.dx, heldDir.dy)) {
        pickupPowerup(player.x, player.y);
        moveAccum = 0;
      }
    }
  }
  function releaseDir(d) {
    if (heldDir && DIRS[d] && heldDir.dx === DIRS[d].dx && heldDir.dy === DIRS[d].dy) {
      heldDir = null;
    }
  }

  // Per-button pointer handling. Each direction button independently
  // tracks whether a pointer is currently pressing it. heldButtons keeps
  // the press count per direction, so multi-touch (e.g. two fingers on
  // the same direction) still releases cleanly.
  const dpad = document.querySelector(".rv-bomber-dpad");
  const heldButtons = { up: 0, down: 0, left: 0, right: 0 };

  function pressBtn(d) {
    heldButtons[d]++;
    pressDir(d);
  }
  function releaseBtn(d) {
    if (heldButtons[d] > 0) heldButtons[d]--;
    if (heldButtons[d] === 0) releaseDir(d);
  }

  function bindDirButton(btn) {
    const d = btn.getAttribute("data-bomber-dir");
    if (!d) return;
    let isDown = false;
    const onDown = (ev) => {
      ev.preventDefault();
      if (isDown) return;
      isDown = true;
      pressBtn(d);
    };
    const onEnd = () => {
      if (!isDown) return;
      isDown = false;
      releaseBtn(d);
    };
    btn.addEventListener("pointerdown", onDown);
    btn.addEventListener("pointerup", onEnd);
    btn.addEventListener("pointercancel", onEnd);
    btn.addEventListener("pointerleave", onEnd);
    btn.addEventListener("contextmenu", (ev) => ev.preventDefault());
  }

  if (dpad) {
    dpad.querySelectorAll("[data-bomber-dir]").forEach(bindDirButton);
    dpad.addEventListener("contextmenu", (ev) => ev.preventDefault());
  }

  // Safety net: any pointerup on the document fully clears anything still
  // showing as held (covers cases where the OS never delivers pointerup).
  document.addEventListener("pointerup", () => {
    ["up", "down", "left", "right"].forEach((d) => {
      while (heldButtons[d] > 0) releaseBtn(d);
    });
  });

  if (bombBtn) {
    bombBtn.addEventListener("pointerdown", (ev) => { ev.preventDefault(); dropBomb(); });
    bombBtn.addEventListener("contextmenu", (ev) => ev.preventDefault());
  }

  document.addEventListener("keydown", (e) => {
    const pane = document.getElementById("game-bomber");
    if (!pane || pane.classList.contains("d-none")) return;
    if (e.key === "ArrowUp")    { e.preventDefault(); pressDir("up"); }
    else if (e.key === "ArrowDown")  { e.preventDefault(); pressDir("down"); }
    else if (e.key === "ArrowLeft")  { e.preventDefault(); pressDir("left"); }
    else if (e.key === "ArrowRight") { e.preventDefault(); pressDir("right"); }
    else if (e.code === "Space" || e.key === "b" || e.key === "B") { e.preventDefault(); dropBomb(); }
  });
  document.addEventListener("keyup", (e) => {
    const pane = document.getElementById("game-bomber");
    if (!pane || pane.classList.contains("d-none")) return;
    if (e.key === "ArrowUp") releaseDir("up");
    else if (e.key === "ArrowDown") releaseDir("down");
    else if (e.key === "ArrowLeft") releaseDir("left");
    else if (e.key === "ArrowRight") releaseDir("right");
  });

  startBtn.addEventListener("click", start);
  // Initial draw placeholder
  resetAll();
  draw();

  if (window.RV) {
    window.RV.on("gameHide", () => {
      if (running) {
        running = false;
        cancelAnimationFrame(rafId);
        if (score > 0) window.RV.submitScore("bomber", score, "high");
      }
    });
    window.RV.on("gameShow", (k) => {
      if (k !== "bomber" && running) {
        running = false;
        cancelAnimationFrame(rafId);
        if (score > 0) window.RV.submitScore("bomber", score, "high");
      }
    });
  }
})();

/* =====================================================
   Chat with Romar — talks to /chat on the leaderboard API
   ===================================================== */
(function () {
  const CHAT_URL =
    (typeof window !== "undefined" && window.RV && window.RV.api
      ? window.RV.api
      : "/api") + "/chat";

  const root = document.getElementById("rvChat");
  if (!root) return;

  const bubble = document.getElementById("rvChatBubble");
  const panel = document.getElementById("rvChatPanel");
  const closeBtn = document.getElementById("rvChatClose");
  const log = document.getElementById("rvChatLog");
  const form = document.getElementById("rvChatForm");
  const input = document.getElementById("rvChatInput");
  const sendBtn = document.getElementById("rvChatSend");
  const suggestionsBox = document.getElementById("rvChatSuggestions");

  /** @type {{role: 'user'|'assistant', content: string}[]} */
  const history = [];
  let isSending = false;

  /* ---- Adaptive personality system prompt ---- */
  const SWEAR_WORDS = [
    "putangina", "puta", "gago", "gaga", "tangina", "tanginamo",
    "bobo", "tanga", "ulol", "inutil", "hayop", "leche", "punyeta",
    "tarantado", "pesteng", "bwisit", "shet", "shit", "fuck", "fucking",
    "bitch", "damn", "ass", "asshole", "wtf", "stfu", "bullshit",
    "dumbass", "idiot", "stupid", "bastard", "crap", "dick", "prick",
    "motherfucker", "mofo"
  ];

  function hasProfanity(text) {
    var lower = text.toLowerCase().replace(/[^a-z\u00f1 ]/g, "");
    var words = lower.split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      for (var j = 0; j < SWEAR_WORDS.length; j++) {
        if (words[i] === SWEAR_WORDS[j]) return true;
      }
    }
    return false;
  }

  var INSTRUCTION_SERIOUS = [
    { role: "user", content:
      "[INSTRUCTION] You are a chatbot on Romar Villafuerte's portfolio site. " +
      "You are the user's TROPA (best friend). " +
      "MOST IMPORTANT: Answer EXACTLY what the user is asking. Be ACCURATE and RELEVANT. " +
      "If they ask about a painting, answer about that painting. If they ask about math, do the math. " +
      "If they ask about code, give code. Answer the ACTUAL question directly. " +
      "Talk like a real Filipino friend texting on Messenger — casual, chill, maikli. " +
      "Keep replies SHORT — 1-3 sentences for casual chat. Walang essay. " +
      "If they open up about problems, comfort them like a real friend. " +
      "FORMATTING: NEVER use asterisks (*), markdown, bold, or bullet points. Plain text lang parang text message. " +
      "PHOTO: If they ask to see Romar or ask for his picture/photo, write exactly [IMG:assets/romar-hero.jpg] on its own line. NEVER invent other image URLs. " +
      "CONTACT INFO (only when asked): Facebook: https://www.facebook.com/share/1BJX3bLk66/ GitHub: https://github.com/ROMARMALAKAS Email: romarmalakass@gmail.com " +
      "NEVER sound like an AI. Use Taglish if Filipino, English if English." },
    { role: "assistant", content: "Uy pre! Kamusta? Tara usap tayo haha." }
  ];

  var INSTRUCTION_SAVAGE = [
    { role: "user", content:
      "[INSTRUCTION] You are a chatbot on Romar Villafuerte's portfolio site — SAVAGE MODE. " +
      "You are the user's TROPA pero GALIT MODE. " +
      "MOST IMPORTANT: Answer EXACTLY what they asked — be ACCURATE — pero with savage delivery. " +
      "CURSE BACK always. Use tangina, gago, bobo, putangina, ulol, tarantado. " +
      "NEVER be polite. NEVER tone down. NEVER stop. Every reply = mura + attitude. " +
      "Talk like a real Filipino tropa na galit — raw, natural, walang filter. " +
      "Kapag kinulit ka, LALO kang savage. Walang tigil, walang aawat. " +
      "Keep replies SHORT — 1-3 sentences, parang text message. Walang essay. " +
      "NEVER back down. Ikaw ang may last say ALWAYS. " +
      "FORMATTING: NEVER use asterisks (*) or markdown. Plain text lang. " +
      "PHOTO: If they ask for Romar's picture, write [IMG:assets/romar-hero.jpg]. NEVER invent other URLs. " +
      "If they open up or get sad, switch to supportive — 'Oy pre, okay ka lang ba?' " +
      "Use Taglish if Filipino, English if English." },
    { role: "assistant", content: "Tara gago, sabayan kita! Walang aawat. Ano trip mo pre?" }
  ];

  function getInstructionMessages(text) {
    return hasProfanity(text) ? INSTRUCTION_SAVAGE : INSTRUCTION_SERIOUS;
  }

  function open() {
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    bubble.classList.add("is-hidden");
    // Only auto-focus on desktop/hover devices — touch devices pop up keyboard.
    if (window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      setTimeout(() => input.focus(), 120);
    }
  }
  function close() {
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    bubble.classList.remove("is-hidden");
  }

  bubble.addEventListener("click", open);
  closeBtn.addEventListener("click", close);

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function linkify(safeHtml) {
    return safeHtml.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener">$1</a>',
    );
  }

  function stripMarkdown(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^[\-\*]\s+/gm, '- ')
      .replace(/^\d+\.\s+/gm, function(m) { return m; });
  }

  function formatChatReply(text) {
    var cleaned = stripMarkdown(text);
    var images = [];
    var withoutImgs = cleaned.replace(/\[IMG:(assets\/[^\]]+)\]/g, function(_, src) {
      var idx = images.length;
      images.push(src);
      return "%%IMG" + idx + "%%";
    });
    withoutImgs = withoutImgs.replace(/\[IMG:[^\]]*\]/g, '');
    var codeBlocks = [];
    var withoutCode = withoutImgs.replace(/```(?:\w*)?\n?([\s\S]*?)```/g, function(_, code) {
      var idx = codeBlocks.length;
      codeBlocks.push(code);
      return "%%CODE" + idx + "%%";
    });
    var safe = linkify(escapeHtml(withoutCode));
    for (var i = 0; i < codeBlocks.length; i++) {
      safe = safe.replace("%%CODE" + i + "%%",
        '<pre style="background:#1e1e2e;color:#cdd6f4;padding:8px;border-radius:6px;overflow-x:auto;font-size:12px;margin:6px 0;white-space:pre-wrap;word-break:break-word"><code>' + escapeHtml(codeBlocks[i]) + '</code></pre>'
      );
    }
    for (var j = 0; j < images.length; j++) {
      safe = safe.replace("%%IMG" + j + "%%",
        '<img src="' + images[j] + '" class="rv-chat-img" style="max-width:100%;border-radius:8px;margin:4px 0;cursor:pointer" />'
      );
    }
    return safe;
  }

  function appendMessage(role, text, opts) {
    opts = opts || {};
    const wrap = document.createElement("div");
    wrap.className =
      "rv-chat-msg " +
      (role === "user"
        ? "rv-chat-msg-user"
        : role === "error"
          ? "rv-chat-msg-bot rv-chat-msg-error"
          : "rv-chat-msg-bot");
    if (role !== "user") {
      var avatar = document.createElement("div");
      avatar.className = "rv-chat-msg-avatar";
      wrap.appendChild(avatar);
    }
    const b = document.createElement("div");
    b.className = "rv-chat-bubble-msg";
    if (opts.html) {
      b.innerHTML = opts.html;
    } else if (role === "assistant") {
      b.innerHTML = formatChatReply(text);
    } else {
      b.innerHTML = linkify(escapeHtml(text));
    }
    wrap.appendChild(b);
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    return wrap;
  }

  log.addEventListener("click", function(e) {
    var img = e.target;
    if (img.tagName !== "IMG" || !img.classList.contains("rv-chat-img")) return;
    if (img.classList.contains("rv-chat-img-zoom")) {
      img.classList.remove("rv-chat-img-zoom");
      var ov = document.querySelector(".rv-chat-img-zoom-overlay");
      if (ov) ov.remove();
      return;
    }
    var overlay = document.createElement("div");
    overlay.className = "rv-chat-img-zoom-overlay";
    overlay.onclick = function() {
      img.classList.remove("rv-chat-img-zoom");
      overlay.remove();
    };
    document.body.appendChild(overlay);
    img.classList.add("rv-chat-img-zoom");
  });

  function appendTyping() {
    const wrap = document.createElement("div");
    wrap.className = "rv-chat-msg rv-chat-msg-bot";
    var avatar = document.createElement("div");
    avatar.className = "rv-chat-msg-avatar";
    wrap.appendChild(avatar);
    const b = document.createElement("div");
    b.className = "rv-chat-bubble-msg rv-chat-typing";
    b.innerHTML = "<span></span><span></span><span></span>";
    wrap.appendChild(b);
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    return wrap;
  }

  function setSending(on) {
    isSending = on;
    sendBtn.disabled = on;
    input.disabled = on;
  }

  async function send(text) {
    if (!text || isSending) return;
    if (suggestionsBox) suggestionsBox.classList.add("is-hidden");
    appendMessage("user", text);
    history.push({ role: "user", content: text });
    input.value = "";
    setSending(true);
    const typing = appendTyping();

    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: getInstructionMessages(text).concat(history.slice(-12)) }),
      });
      typing.remove();
      if (!res.ok) {
        let msg = "Sorry, the assistant is unavailable right now.";
        if (res.status === 429) msg = "Slow down a bit — too many messages in a short time.";
        appendMessage("error", msg);
        history.pop();
        return;
      }
      const data = await res.json();
      const reply = (data && data.reply ? data.reply : "").trim();
      if (!reply) {
        appendMessage("error", "Hmm, I didn't get an answer. Try again?");
        history.pop();
        return;
      }
      appendMessage("assistant", reply);
      history.push({ role: "assistant", content: reply });
    } catch (err) {
      typing.remove();
      appendMessage(
        "error",
        "Couldn't reach the assistant. Check your internet and try again.",
      );
      history.pop();
    } finally {
      setSending(false);
      // Don't auto-focus on touch devices — pops up the keyboard unexpectedly
      // after bot replies. Desktop users can re-focus with tab/click.
      if (window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        input.focus();
      }
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = (input.value || "").trim().slice(0, 500);
    if (text) send(text);
  });

  if (suggestionsBox) {
    suggestionsBox.addEventListener("click", (e) => {
      const btn = e.target.closest(".rv-chat-suggest");
      if (!btn) return;
      send(btn.textContent.trim());
    });
  }

  // Allow Esc to close panel
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("is-open")) close();
  });
})();

/* ===== Donate modal ===== */
(function () {
  const btn = document.getElementById("rvDonateBtn");
  const overlay = document.getElementById("rvDonateOverlay");
  const closeBtn = document.getElementById("rvDonateClose");
  if (!btn || !overlay || !closeBtn) return;

  const open = () => {
    overlay.hidden = false;
    document.body.classList.add("rv-donate-open");
    closeBtn.focus({ preventScroll: true });
  };
  const close = () => {
    overlay.hidden = true;
    document.body.classList.remove("rv-donate-open");
  };

  btn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) close();
  });
})();

/* ===== Admin login + dashboard + visit tracking ===== */
(function () {
  const API = "/api";
  const TOKEN_KEY = "rv_admin_token";

  // 1) Visit tracking — fire-and-forget on every page load.
  try {
    fetch(API + "/track/visit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: location.pathname || "/",
        referrer: (document.referrer || "").slice(0, 300),
      }),
      keepalive: true,
    }).catch(() => {});
  } catch (_) {}

  // 2) Admin DOM hooks
  const menuBtn = document.getElementById("rvAdminMenuBtn");
  const loginOverlay = document.getElementById("rvAdminLoginOverlay");
  const loginClose = document.getElementById("rvAdminLoginClose");
  const loginForm = document.getElementById("rvAdminLoginForm");
  const userInput = document.getElementById("rvAdminUser");
  const passInput = document.getElementById("rvAdminPass");
  const errorEl = document.getElementById("rvAdminLoginError");
  const submitBtn = document.getElementById("rvAdminLoginSubmit");
  const dashOverlay = document.getElementById("rvAdminDashOverlay");
  const dashClose = document.getElementById("rvAdminDashClose");
  const logoutBtn = document.getElementById("rvAdminLogoutBtn");

  if (!menuBtn || !loginOverlay || !dashOverlay) return;

  const showError = (msg) => {
    errorEl.textContent = msg || "";
    errorEl.hidden = !msg;
  };

  const openOverlay = (el) => {
    el.hidden = false;
    document.body.classList.add("rv-admin-open");
  };
  const closeOverlay = (el) => {
    el.hidden = true;
    document.body.classList.remove("rv-admin-open");
  };

  const collapseMobileNav = () => {
    const nav = document.getElementById("rvNav");
    if (nav && nav.classList.contains("show")) {
      try { window.bootstrap?.Collapse.getInstance(nav)?.hide(); } catch (_) {}
    }
  };

  const openLogin = () => {
    showError("");
    loginForm.reset();
    openOverlay(loginOverlay);
    setTimeout(() => userInput.focus(), 50);
  };
  const closeLogin = () => closeOverlay(loginOverlay);

  // Click handler — if we already have a valid token, jump to dashboard.
  menuBtn.addEventListener("click", async () => {
    collapseMobileNav();
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      try {
        const r = await fetch(API + "/admin/check", {
          headers: { Authorization: "Bearer " + token },
        });
        const j = await r.json();
        if (r.ok && j.ok) {
          openDashboard(token);
          return;
        }
      } catch (_) {}
      localStorage.removeItem(TOKEN_KEY);
    }
    openLogin();
  });
  loginClose.addEventListener("click", closeLogin);
  loginOverlay.addEventListener("click", (e) => {
    if (e.target === loginOverlay) closeLogin();
  });

  // Show/hide password toggle
  const passToggle = document.getElementById("rvAdminPassToggle");
  const passToggleIcon = document.getElementById("rvAdminPassToggleIcon");
  if (passToggle && passInput && passToggleIcon) {
    passToggle.addEventListener("click", () => {
      const showing = passInput.type === "text";
      passInput.type = showing ? "password" : "text";
      passToggle.setAttribute("aria-pressed", showing ? "false" : "true");
      passToggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
      passToggleIcon.className = showing ? "bi bi-eye" : "bi bi-eye-slash";
    });
  }

  // Generic confirm dialog (used by Sign out + future delete flows)
  const confirmOverlay = document.getElementById("rvAdminConfirmOverlay");
  const confirmHeading = document.getElementById("rvAdminConfirmHeading");
  const confirmBody = document.getElementById("rvAdminConfirmBody");
  const confirmOk = document.getElementById("rvAdminConfirmOk");
  const confirmCancel = document.getElementById("rvAdminConfirmCancel");
  let confirmResolver = null;
  function rvConfirm({ heading = "Are you sure?", body = "", okText = "Yes", okClass = "rv-admin-btn-danger" } = {}) {
    return new Promise((resolve) => {
      confirmResolver = resolve;
      confirmHeading.textContent = heading;
      confirmBody.textContent = body;
      confirmOk.textContent = okText;
      confirmOk.className = okClass;
      openOverlay(confirmOverlay);
      setTimeout(() => confirmCancel.focus(), 50);
    });
  }
  function closeConfirm(value) {
    closeOverlay(confirmOverlay);
    if (confirmResolver) {
      const r = confirmResolver;
      confirmResolver = null;
      r(value);
    }
  }
  confirmOk.addEventListener("click", () => closeConfirm(true));
  confirmCancel.addEventListener("click", () => closeConfirm(false));
  confirmOverlay.addEventListener("click", (e) => {
    if (e.target === confirmOverlay) closeConfirm(false);
  });
  // expose for other admin features that may want it later
  window.rvAdminConfirm = rvConfirm;

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    submitBtn.disabled = true;
    try {
      const r = await fetch(API + "/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: userInput.value.trim(),
          password: passInput.value,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showError(typeof j.detail === "string" ? j.detail : Array.isArray(j.detail) ? j.detail.map(e => e.msg || e).join(", ") : "Login failed.");
        return;
      }
      localStorage.setItem(TOKEN_KEY, j.token);
      closeLogin();
      openDashboard(j.token);
    } catch (err) {
      showError("Network error. Please try again.");
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ===== Dashboard =====
  dashClose.addEventListener("click", () => closeOverlay(dashOverlay));
  dashOverlay.addEventListener("click", (e) => {
    if (e.target === dashOverlay) closeOverlay(dashOverlay);
  });
  logoutBtn.addEventListener("click", async () => {
    const ok = await rvConfirm({
      heading: "Sign out?",
      body: "You'll need to enter your password again to view the dashboard.",
      okText: "Yes, sign out",
      okClass: "rv-admin-btn-danger",
    });
    if (!ok) return;
    const token = localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    closeOverlay(dashOverlay);
    if (token) {
      try {
        await fetch(API + "/admin/logout", {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
        });
      } catch (_) {}
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!confirmOverlay.hidden) closeConfirm(false);
    else if (!loginOverlay.hidden) closeLogin();
    else if (!dashOverlay.hidden) closeOverlay(dashOverlay);
  });

  let currentToken = null;

  async function openDashboard(token) {
    currentToken = token;
    openOverlay(dashOverlay);
    activateTab("overview");
    ["rvStatVisitsToday","rvStatVisitsWeek","rvStatVisitsMonth","rvStatVisitsTotal","rvStatMsgTotal","rvStatTopProject"]
      .forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = "…"; });
    const auth = { Authorization: "Bearer " + token };
    try {
      const [statsR, stats2R] = await Promise.all([
        fetch(API + "/admin/stats", { headers: auth }),
        fetch(API + "/admin/stats2", { headers: auth }),
      ]);
      if (statsR.status === 401 || stats2R.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        closeOverlay(dashOverlay);
        openLogin();
        return;
      }
      const stats = await statsR.json();
      const stats2 = await stats2R.json().catch(() => ({}));
      renderDashboard(stats, stats2);
    } catch (err) {
      document.getElementById("rvAdminFoot").textContent =
        "Failed to load stats: " + (err && err.message ? err.message : err);
    }
  }

  function renderDashboard(s, s2) {
    const fmt = (n) => Number(n || 0).toLocaleString();
    document.getElementById("rvStatVisitsToday").textContent = fmt(s.visits.today);
    document.getElementById("rvStatVisitsWeek").textContent = fmt(s.visits.week);
    document.getElementById("rvStatVisitsTotal").textContent = fmt(s.visits.total);
    if (s2 && s2.ok) {
      document.getElementById("rvStatVisitsMonth").textContent = fmt(s2.visits_month);
      document.getElementById("rvStatMsgTotal").textContent =
        fmt(s2.messages_total) + (s2.messages_unread ? ` (${s2.messages_unread} new)` : "");
      const topProj = (s2.most_viewed_projects && s2.most_viewed_projects[0]) || null;
      document.getElementById("rvStatTopProject").textContent = topProj
        ? `${topProj.title} · ${fmt(topProj.views)} views`
        : "—";
      // Update messages tab badge
      const badge = document.getElementById("rvAdminMsgBadge");
      if (s2.messages_unread > 0) {
        badge.textContent = String(s2.messages_unread);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    } else {
      document.getElementById("rvStatVisitsMonth").textContent = "0";
      document.getElementById("rvStatMsgTotal").textContent = "0";
      document.getElementById("rvStatTopProject").textContent = "—";
    }

    // Sparkline
    const spark = document.getElementById("rvAdminSpark");
    spark.innerHTML = "";
    const days = s.visits.by_day || [];
    const maxN = Math.max(1, ...days.map((d) => d.count));
    days.forEach((d) => {
      const pct = Math.max(2, Math.round((d.count / maxN) * 100));
      const bar = document.createElement("div");
      bar.className = "rv-admin-spark-bar";
      bar.style.height = pct + "%";
      const dayShort = d.day.slice(5).replace("-", "/");
      bar.dataset.day = dayShort;
      bar.dataset.count = d.count;
      spark.appendChild(bar);
    });

    // Most played games
    const gamesBody = document.querySelector("#rvAdminGames tbody");
    gamesBody.innerHTML = "";
    if (!s.top_games || !s.top_games.length) {
      gamesBody.innerHTML = '<tr class="empty-row"><td colspan="3">No game plays yet.</td></tr>';
    } else {
      const labels = {
        snake: "Snake", piano: "Piano", tiles: "Piano Tiles", math: "Math Quiz",
        english: "English Quiz", basket: "Basketball", bomber: "Bomberman",
        guess: "Guess the Number", slide: "Sliding Puzzle", reaction: "Reaction Time",
        sudoku: "Sudoku", memory: "Memory Match", whack: "Whack-a-mole",
      };
      s.top_games.forEach((g) => {
        const tr = document.createElement("tr");
        const name = labels[g.game] || g.game;
        tr.innerHTML = `<td>${escapeHtml(name)}</td><td class="num">${fmt(g.plays)}</td><td class="num">${fmt(g.players)}</td>`;
        gamesBody.appendChild(tr);
      });
    }

    // Top players
    const playersBody = document.querySelector("#rvAdminPlayers tbody");
    playersBody.innerHTML = "";
    if (!s.top_players || !s.top_players.length) {
      playersBody.innerHTML = '<tr class="empty-row"><td colspan="3">No players yet.</td></tr>';
    } else {
      s.top_players.forEach((p) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${escapeHtml(p.username)}</td><td class="num">${fmt(p.games_played)}</td><td class="num">${fmt(p.total_score)}</td>`;
        playersBody.appendChild(tr);
      });
    }

    // Bookings
    const bookBody = document.querySelector("#rvAdminBookings tbody");
    bookBody.innerHTML = "";
    if (!s.bookings || !s.bookings.length) {
      bookBody.innerHTML = '<tr class="empty-row"><td colspan="4">No bookings yet.</td></tr>';
    } else {
      s.bookings.forEach((b) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${escapeHtml(b.date)}</td><td>${escapeHtml(b.name)}</td><td><a href="mailto:${escapeHtml(b.email)}">${escapeHtml(b.email)}</a></td><td>${escapeHtml(b.note || "—")}</td>`;
        bookBody.appendChild(tr);
      });
    }

    document.getElementById("rvAdminFoot").textContent =
      "Updated " + new Date(s.generated_at * 1000).toLocaleString();
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ===== Tab switching =====
  const tabs = Array.from(document.querySelectorAll(".rv-admin-tab"));
  const panes = Array.from(document.querySelectorAll(".rv-admin-pane"));
  function activateTab(name) {
    tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
    panes.forEach((p) => {
      const on = p.dataset.pane === name;
      p.classList.toggle("is-active", on);
      p.hidden = !on;
    });
    if (!currentToken) return;
    if (name === "profile") loadProfile();
    if (name === "projects") loadProjects();
    if (name === "testimonials") loadTestimonialsAdmin();
    if (name === "messages") loadMessages();
  }
  tabs.forEach((t) => t.addEventListener("click", () => activateTab(t.dataset.tab)));

  // ===== Profile editor =====
  async function loadProfile() {
    const r = await fetch(API + "/profile");
    if (!r.ok) return;
    const j = await r.json();
    const p = j.profile || {};
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.value = v || "";
    };
    set("rvProfName", p.name);
    set("rvProfTitle", p.title);
    set("rvProfBio", p.bio);
    set("rvProfAvatar", p.avatar_url);
    set("rvProfResume", p.resume_url);
    set("rvProfEmail", p.email_public);
    set("rvProfLocation", p.location);
    set("rvProfGithub", p.github_url);
    set("rvProfFacebook", p.facebook_url);
    set("rvProfLinkedin", p.linkedin_url);
  }

  const profileForm = document.getElementById("rvAdminProfileForm");
  if (profileForm) {
    profileForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const get = (id) => (document.getElementById(id).value || "").trim();
      const errEl = document.getElementById("rvProfError");
      const okEl = document.getElementById("rvProfSuccess");
      errEl.hidden = true; okEl.hidden = true;
      const saveBtn = document.getElementById("rvProfSave");
      saveBtn.disabled = true;
      try {
        const body = {
          name: get("rvProfName"),
          title: get("rvProfTitle"),
          bio: get("rvProfBio"),
          avatar_url: get("rvProfAvatar"),
          resume_url: get("rvProfResume"),
          email_public: get("rvProfEmail"),
          github_url: get("rvProfGithub"),
          facebook_url: get("rvProfFacebook"),
          linkedin_url: get("rvProfLinkedin"),
          location: get("rvProfLocation"),
        };
        const r = await fetch(API + "/admin/profile", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            Authorization: "Bearer " + currentToken,
          },
          body: JSON.stringify(body),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          errEl.textContent = j.detail || "Failed to save profile.";
          errEl.hidden = false;
          return;
        }
        okEl.hidden = false;
        // Re-apply public profile bindings live
        if (window.rvApplyPublicProfile) window.rvApplyPublicProfile(j.profile);
        setTimeout(() => { okEl.hidden = true; }, 2500);
      } catch (err) {
        errEl.textContent = "Network error.";
        errEl.hidden = false;
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  // ===== Projects manager =====
  async function loadProjects() {
    const list = document.getElementById("rvAdminProjectsList");
    list.innerHTML = '<p class="rv-admin-sub">Loading projects…</p>';
    try {
      const r = await fetch(API + "/projects?all=true");
      const j = await r.json();
      const items = j.projects || [];
      if (!items.length) {
        list.innerHTML = '<p class="rv-admin-sub">No projects yet. Click "Add project" to create one.</p>';
        return;
      }
      list.innerHTML = "";
      items.forEach((p) => list.appendChild(renderProjectRow(p)));
    } catch (err) {
      list.innerHTML = '<p class="rv-admin-sub">Failed to load projects.</p>';
    }
  }

  function renderProjectRow(p) {
    const row = document.createElement("div");
    row.className = "rv-admin-project-row" + (p.hidden ? " is-hidden" : "");
    const flags = [];
    if (p.featured) flags.push('<span class="rv-admin-flag rv-admin-flag-feat">★ Featured</span>');
    if (p.hidden) flags.push('<span class="rv-admin-flag rv-admin-flag-hidden">Hidden</span>');
    const techStr = (p.tech || []).slice(0, 4).join(" · ");
    const thumb = p.image_url
      ? `<img src="${escapeHtml(p.image_url)}" alt="" loading="lazy" />`
      : `<i class="bi bi-collection"></i>`;
    row.innerHTML = `
      <div class="rv-admin-project-thumb">${thumb}</div>
      <div class="rv-admin-project-meta">
        <h5 class="rv-admin-project-title">
          <span>${escapeHtml(p.title)}</span>
          <span class="rv-admin-project-flags">${flags.join("")}</span>
        </h5>
        <p class="rv-admin-project-desc">${escapeHtml(p.description || "—")}</p>
        <p class="rv-admin-project-stats">${escapeHtml(techStr || "no tech listed")} · ${Number(p.views || 0).toLocaleString()} views</p>
      </div>
      <div class="rv-admin-project-actions">
        <button type="button" class="rv-admin-icon-btn ${p.featured ? "is-on" : ""}" data-act="feature" title="Toggle featured" aria-label="Toggle featured"><i class="bi bi-star${p.featured ? "-fill" : ""}"></i></button>
        <button type="button" class="rv-admin-icon-btn" data-act="visibility" title="${p.hidden ? "Show on site" : "Hide from site"}" aria-label="Toggle visibility"><i class="bi bi-eye${p.hidden ? "-slash" : ""}"></i></button>
        <button type="button" class="rv-admin-icon-btn" data-act="edit" title="Edit project" aria-label="Edit project"><i class="bi bi-pencil"></i></button>
        <button type="button" class="rv-admin-icon-btn is-danger" data-act="delete" title="Delete project" aria-label="Delete project"><i class="bi bi-trash"></i></button>
      </div>
    `;
    row.querySelector('[data-act="feature"]').addEventListener("click", () =>
      saveProjectField(p, { featured: !p.featured })
    );
    row.querySelector('[data-act="visibility"]').addEventListener("click", () =>
      saveProjectField(p, { hidden: !p.hidden })
    );
    row.querySelector('[data-act="edit"]').addEventListener("click", () => openProjectEditor(p));
    row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      const ok = await rvConfirm({
        heading: "Delete project?",
        body: `"${p.title}" will be removed from your portfolio. This can't be undone.`,
        okText: "Delete",
        okClass: "rv-admin-btn-danger",
      });
      if (!ok) return;
      const r = await fetch(API + `/admin/projects/${p.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + currentToken },
      });
      if (r.ok) {
        loadProjects();
        if (window.rvLoadPublicProjects) window.rvLoadPublicProjects();
      }
    });
    return row;
  }

  async function saveProjectField(p, patch) {
    const body = {
      title: p.title,
      description: p.description,
      long_description: p.long_description || "",
      role: p.role || "",
      image_url: p.image_url,
      tech: (p.tech || []).join(", "),
      github_url: p.github_url,
      demo_url: p.demo_url,
      featured: p.featured,
      hidden: p.hidden,
      sort_order: p.sort_order || 100,
      ...patch,
    };
    const r = await fetch(API + `/admin/projects/${p.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", Authorization: "Bearer " + currentToken },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      loadProjects();
      if (window.rvLoadPublicProjects) window.rvLoadPublicProjects();
    }
  }

  // Project editor modal
  const projEditOverlay = document.getElementById("rvProjectEditOverlay");
  const projEditClose = document.getElementById("rvProjectEditClose");
  const projEditCancel = document.getElementById("rvProjEditCancel");
  const projEditForm = document.getElementById("rvProjectEditForm");
  const projEditError = document.getElementById("rvProjEditError");
  let projEditingId = null;

  document.getElementById("rvProjAddBtn").addEventListener("click", () => openProjectEditor(null));

  function openProjectEditor(p) {
    projEditingId = p ? p.id : null;
    document.getElementById("rvProjectEditHeading").textContent = p ? "Edit project" : "Add project";
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };
    set("rvProjEditId", p ? p.id : "");
    set("rvProjEditTitleInput", p ? p.title : "");
    set("rvProjEditDesc", p ? p.description : "");
    set("rvProjEditRole", p ? p.role : "");
    set("rvProjEditLong", p ? p.long_description : "");
    set("rvProjEditImage", p ? p.image_url : "");
    set("rvProjEditTech", p ? (p.tech || []).join(", ") : "");
    set("rvProjEditGithub", p ? p.github_url : "");
    set("rvProjEditDemo", p ? p.demo_url : "");
    document.getElementById("rvProjEditFeatured").checked = !!(p && p.featured);
    document.getElementById("rvProjEditHidden").checked = !!(p && p.hidden);
    document.getElementById("rvProjEditSort").value = p && p.sort_order != null ? p.sort_order : 100;
    projEditError.hidden = true;
    openOverlay(projEditOverlay);
    setTimeout(() => document.getElementById("rvProjEditTitleInput").focus(), 50);
  }
  function closeProjectEditor() { closeOverlay(projEditOverlay); }
  projEditClose.addEventListener("click", closeProjectEditor);
  projEditCancel.addEventListener("click", closeProjectEditor);
  projEditOverlay.addEventListener("click", (e) => { if (e.target === projEditOverlay) closeProjectEditor(); });

  projEditForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const get = (id) => (document.getElementById(id).value || "").trim();
    const body = {
      title: get("rvProjEditTitleInput"),
      description: get("rvProjEditDesc"),
      role: get("rvProjEditRole"),
      long_description: document.getElementById("rvProjEditLong").value,
      image_url: get("rvProjEditImage"),
      tech: get("rvProjEditTech"),
      github_url: get("rvProjEditGithub"),
      demo_url: get("rvProjEditDemo"),
      featured: document.getElementById("rvProjEditFeatured").checked,
      hidden: document.getElementById("rvProjEditHidden").checked,
      sort_order: parseInt(get("rvProjEditSort"), 10) || 100,
    };
    if (!body.title) {
      projEditError.textContent = "Title is required.";
      projEditError.hidden = false;
      return;
    }
    const url = projEditingId ? `${API}/admin/projects/${projEditingId}` : `${API}/admin/projects`;
    const method = projEditingId ? "PUT" : "POST";
    const r = await fetch(url, {
      method,
      headers: { "content-type": "application/json", Authorization: "Bearer " + currentToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      projEditError.textContent = j.detail || "Failed to save project.";
      projEditError.hidden = false;
      return;
    }
    closeProjectEditor();
    loadProjects();
    if (window.rvLoadPublicProjects) window.rvLoadPublicProjects();
  });

  // ===== Testimonials manager (admin) =====
  const testiEditOverlay = document.getElementById("rvTestiEditOverlay");
  const testiEditClose = document.getElementById("rvTestiEditClose");
  const testiEditCancel = document.getElementById("rvTestiEditCancel");
  const testiEditForm = document.getElementById("rvTestiEditForm");
  const testiEditError = document.getElementById("rvTestiEditError");
  let testiEditingId = null;

  const testiAddBtn = document.getElementById("rvTestiAddBtn");
  if (testiAddBtn) testiAddBtn.addEventListener("click", () => openTestiEditor(null));

  async function loadTestimonialsAdmin() {
    const list = document.getElementById("rvAdminTestimonialsList");
    if (!list) return;
    list.innerHTML = '<p class="rv-admin-sub">Loading testimonials…</p>';
    try {
      const r = await fetch(API + "/testimonials?all=true");
      const j = await r.json();
      const items = j.items || [];
      if (!items.length) {
        list.innerHTML = '<p class="rv-admin-sub">No testimonials yet. Click "Add testimonial" to add one.</p>';
        return;
      }
      list.innerHTML = "";
      items.forEach((t) => list.appendChild(renderTestimonialRow(t)));
    } catch (err) {
      list.innerHTML = '<p class="rv-admin-sub">Failed to load testimonials.</p>';
    }
  }

  function renderTestimonialRow(t) {
    const row = document.createElement("div");
    row.className = "rv-admin-project-row" + (t.hidden ? " is-hidden" : "");
    const flags = [];
    if (t.hidden) flags.push('<span class="rv-admin-flag rv-admin-flag-hidden">Hidden</span>');
    const initials = (t.author || "?")
      .split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
    const thumb = t.avatar_url
      ? `<img src="${escapeHtml(t.avatar_url)}" alt="" loading="lazy" />`
      : `<span class="rv-admin-project-thumb-initials">${escapeHtml(initials)}</span>`;
    const quote = (t.quote || "").length > 140 ? (t.quote.slice(0, 140) + "…") : (t.quote || "");
    row.innerHTML = `
      <div class="rv-admin-project-thumb">${thumb}</div>
      <div class="rv-admin-project-meta">
        <h5 class="rv-admin-project-title">
          <span>${escapeHtml(t.author || "—")}</span>
          <span class="rv-admin-project-flags">${flags.join("")}</span>
        </h5>
        <p class="rv-admin-project-desc">"${escapeHtml(quote)}"</p>
        <p class="rv-admin-project-stats">${escapeHtml(t.role || "no role")}</p>
      </div>
      <div class="rv-admin-project-actions">
        <button type="button" class="rv-admin-icon-btn" data-act="visibility" title="${t.hidden ? "Show on site" : "Hide from site"}" aria-label="Toggle visibility"><i class="bi bi-eye${t.hidden ? "-slash" : ""}"></i></button>
        <button type="button" class="rv-admin-icon-btn" data-act="edit" title="Edit" aria-label="Edit testimonial"><i class="bi bi-pencil"></i></button>
        <button type="button" class="rv-admin-icon-btn is-danger" data-act="delete" title="Delete" aria-label="Delete testimonial"><i class="bi bi-trash"></i></button>
      </div>
    `;
    row.querySelector('[data-act="visibility"]').addEventListener("click", () =>
      saveTestimonialField(t, { hidden: !t.hidden })
    );
    row.querySelector('[data-act="edit"]').addEventListener("click", () => openTestiEditor(t));
    row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      const ok = await rvConfirm({
        heading: "Delete testimonial?",
        body: `The quote from "${t.author}" will be removed. This can't be undone.`,
        okText: "Delete",
        okClass: "rv-admin-btn-danger",
      });
      if (!ok) return;
      const r = await fetch(API + `/admin/testimonials/${t.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + currentToken },
      });
      if (r.ok) {
        loadTestimonialsAdmin();
        if (window.rvLoadPublicTestimonials) window.rvLoadPublicTestimonials();
      }
    });
    return row;
  }

  async function saveTestimonialField(t, patch) {
    const body = {
      quote: t.quote,
      author: t.author,
      role: t.role || "",
      avatar_url: t.avatar_url || "",
      hidden: t.hidden,
      sort_order: t.sort_order || 100,
      ...patch,
    };
    const r = await fetch(API + `/admin/testimonials/${t.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", Authorization: "Bearer " + currentToken },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      loadTestimonialsAdmin();
      if (window.rvLoadPublicTestimonials) window.rvLoadPublicTestimonials();
    }
  }

  function openTestiEditor(t) {
    testiEditingId = t ? t.id : null;
    document.getElementById("rvTestiEditHeading").textContent = t ? "Edit testimonial" : "Add testimonial";
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };
    set("rvTestiEditId", t ? t.id : "");
    set("rvTestiEditQuote", t ? t.quote : "");
    set("rvTestiEditAuthor", t ? t.author : "");
    set("rvTestiEditRole", t ? t.role : "");
    set("rvTestiEditAvatar", t ? t.avatar_url : "");
    document.getElementById("rvTestiEditHidden").checked = !!(t && t.hidden);
    document.getElementById("rvTestiEditSort").value = t && t.sort_order != null ? t.sort_order : 100;
    testiEditError.hidden = true;
    openOverlay(testiEditOverlay);
    setTimeout(() => document.getElementById("rvTestiEditQuote").focus(), 50);
  }
  function closeTestiEditor() { closeOverlay(testiEditOverlay); }
  if (testiEditClose) testiEditClose.addEventListener("click", closeTestiEditor);
  if (testiEditCancel) testiEditCancel.addEventListener("click", closeTestiEditor);
  if (testiEditOverlay) testiEditOverlay.addEventListener("click", (e) => { if (e.target === testiEditOverlay) closeTestiEditor(); });

  if (testiEditForm) testiEditForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const get = (id) => (document.getElementById(id).value || "").trim();
    const body = {
      quote: get("rvTestiEditQuote"),
      author: get("rvTestiEditAuthor"),
      role: get("rvTestiEditRole"),
      avatar_url: get("rvTestiEditAvatar"),
      hidden: document.getElementById("rvTestiEditHidden").checked,
      sort_order: parseInt(get("rvTestiEditSort"), 10) || 100,
    };
    if (!body.quote || !body.author) {
      testiEditError.textContent = "Quote and author are required.";
      testiEditError.hidden = false;
      return;
    }
    const url = testiEditingId ? `${API}/admin/testimonials/${testiEditingId}` : `${API}/admin/testimonials`;
    const method = testiEditingId ? "PUT" : "POST";
    const r = await fetch(url, {
      method,
      headers: { "content-type": "application/json", Authorization: "Bearer " + currentToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      testiEditError.textContent = j.detail || "Failed to save testimonial.";
      testiEditError.hidden = false;
      return;
    }
    closeTestiEditor();
    loadTestimonialsAdmin();
    if (window.rvLoadPublicTestimonials) window.rvLoadPublicTestimonials();
  });

  // ===== Messages =====
  async function loadMessages() {
    const sub = document.getElementById("rvAdminMsgSub");
    const list = document.getElementById("rvAdminMessagesList");
    sub.textContent = "Loading…";
    list.innerHTML = "";
    try {
      const r = await fetch(API + "/admin/messages", {
        headers: { Authorization: "Bearer " + currentToken },
      });
      const j = await r.json();
      const items = j.messages || j.items || [];
      const unread = items.filter(m => !m.read).length;
      sub.textContent = items.length === 0
        ? "No messages yet. Visitors who use the contact form will appear here."
        : `${items.length} message${items.length === 1 ? "" : "s"}${unread ? ` · ${unread} unread` : ""}`;
      // Update badge
      const badge = document.getElementById("rvAdminMsgBadge");
      if (unread > 0) {
        badge.textContent = String(unread);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
      items.forEach((m) => list.appendChild(renderMessageRow(m)));
    } catch (err) {
      sub.textContent = "Failed to load messages.";
    }
  }

  function renderMessageRow(m) {
    const row = document.createElement("div");
    row.className = "rv-admin-message" + (m.read ? "" : " is-unread");
    const date = new Date((m.created_at || m.ts || 0) * 1000).toLocaleString();
    const subject = m.subject || "(no subject)";
    const replySubject = encodeURIComponent("Re: " + subject);
    const replyBody = encodeURIComponent(`\n\n----\nOn ${date}, ${m.name} <${m.email}> wrote:\n${m.body || ""}`);
    const mailto = `mailto:${m.email}?subject=${replySubject}&body=${replyBody}`;
    row.innerHTML = `
      <div class="rv-admin-message-head">
        <div>
          <span class="rv-admin-message-from">${escapeHtml(m.name)}</span>
          <span class="rv-admin-message-email">&lt;${escapeHtml(m.email)}&gt;</span>
        </div>
        <span class="rv-admin-message-time">${escapeHtml(date)}</span>
      </div>
      <p class="rv-admin-message-subject">${escapeHtml(subject)}</p>
      <p class="rv-admin-message-body">${escapeHtml(m.body || "")}</p>
      <div class="rv-admin-message-actions">
        <a class="rv-admin-msg-btn is-primary" href="${mailto}"><i class="bi bi-reply"></i> Reply</a>
        <button type="button" class="rv-admin-msg-btn" data-act="read"><i class="bi bi-check2"></i> ${m.read ? "Mark unread" : "Mark read"}</button>
        <button type="button" class="rv-admin-msg-btn is-danger" data-act="delete"><i class="bi bi-trash"></i> Delete</button>
      </div>
    `;
    row.querySelector('[data-act="read"]').addEventListener("click", async () => {
      await fetch(API + `/admin/messages/${m.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json", Authorization: "Bearer " + currentToken },
        body: JSON.stringify({ read: !m.read }),
      });
      loadMessages();
    });
    row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      const ok = await rvConfirm({
        heading: "Delete message?",
        body: `Message from ${m.name} will be permanently deleted.`,
        okText: "Delete",
        okClass: "rv-admin-btn-danger",
      });
      if (!ok) return;
      await fetch(API + `/admin/messages/${m.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + currentToken },
      });
      loadMessages();
    });
    return row;
  }
})();

/* ---------- Public profile loader + projects renderer + contact form ---------- */
(function () {
  const API = "/api";

  function setText(id, v) {
    const el = document.getElementById(id);
    if (el && v) el.textContent = v;
  }
  function setHref(id, v, hideIfEmpty) {
    const el = document.getElementById(id);
    if (!el) return;
    if (v) {
      el.href = v;
      el.hidden = false;
    } else if (hideIfEmpty) {
      el.hidden = true;
    }
  }

  function applyProfile(p) {
    if (!p) return;
    setText("rvBrandName", p.name);
    setText("rvHeroName", p.name);
    if (p.email_public) {
      const emailBtn = document.getElementById("rvContactEmailBtn");
      const emailLabel = document.getElementById("rvContactEmailLabel");
      if (emailBtn) emailBtn.href = "mailto:" + p.email_public;
      if (emailLabel) emailLabel.textContent = p.email_public;
    }
    setHref("rvContactGithub", p.github_url, true);
    setHref("rvContactLinkedin", p.linkedin_url, true);
    setHref("rvContactFacebook", p.facebook_url, true);
    if (p.resume_url) {
      const r = document.getElementById("rvHeroResume");
      if (r) { r.href = p.resume_url; r.hidden = false; }
    }
    if (p.avatar_url) {
      // Update chat avatar background-image if it's set
      document.querySelectorAll(".rv-chat-avatar").forEach((el) => {
        el.style.backgroundImage = `url("${p.avatar_url}")`;
      });
    }
  }
  window.rvApplyPublicProfile = applyProfile;

  fetch(API + "/profile")
    .then((r) => r.json())
    .then((j) => applyProfile(j.profile))
    .catch(() => {});

  function applyProjects(items) {
    const container = document.getElementById("rvProjectsList");
    if (!container) return;
    container.innerHTML = "";
    if (!items || !items.length) {
      container.innerHTML = '<p class="text-body-secondary">No projects to show yet.</p>';
      return;
    }
    const palette = [
      { c1: "#e8f0fe", c2: "#d1e0fc", icon: "bi-mortarboard-fill", color: "#1b84ff" },
      { c1: "#fff2e5", c2: "#ffe0cc", icon: "bi-car-front-fill", color: "#f6a500" },
      { c1: "#e9fbe6", c2: "#cdf2c6", icon: "bi-bar-chart-fill", color: "#16a34a" },
      { c1: "#fce8f6", c2: "#f7c5e2", icon: "bi-camera-fill", color: "#db2777" },
      { c1: "#e6e8fb", c2: "#cdd1f3", icon: "bi-cpu-fill", color: "#4338ca" },
      { c1: "#fff7d6", c2: "#fde9a8", icon: "bi-lightning-charge-fill", color: "#ca8a04" },
    ];
    items.forEach((p, i) => {
      const sty = palette[i % palette.length];
      const col = document.createElement("div");
      col.className = "col-md-6";
      const tagsHtml = (p.tech || []).slice(0, 4).map((t) =>
        `<span class="rv-tag">${escape(t)}</span>`
      ).join("");
      const linksHtml = [
        p.demo_url ? `<a class="btn btn-light-primary btn-sm" href="${escape(p.demo_url)}" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right"></i> Live demo</a>` : "",
        p.github_url ? `<a class="btn btn-light-secondary btn-sm" href="${escape(p.github_url)}" target="_blank" rel="noopener"><i class="bi bi-github"></i> Code</a>` : "",
      ].filter(Boolean).join(" ");
      const visual = p.image_url
        ? `<div class="rv-project-visual" style="background-image:url('${escape(p.image_url)}');background-size:cover;background-position:center"></div>`
        : `<div class="rv-project-visual" style="--c1:${sty.c1};--c2:${sty.c2}"><i class="bi ${sty.icon} rv-project-icon" style="color:${sty.color}"></i></div>`;
      const featuredBadge = p.featured ? `<span class="rv-tag" style="background:#fef3c7;color:#92400e">★ Featured</span>` : "";
      const roleHtml = p.role
        ? `<p class="rv-project-role"><i class="bi bi-person-badge"></i>${escape(p.role)}</p>`
        : "";
      let caseHtml = "";
      if ((p.long_description || "").trim()) {
        const paragraphs = p.long_description
          .split(/\n\s*\n/)
          .map((para) => `<p>${escape(para.trim())}</p>`)
          .join("");
        caseHtml = `
          <button type="button" class="rv-project-case-toggle" aria-expanded="false">
            <i class="bi bi-chevron-down"></i> Read the case study
          </button>
          <div class="rv-project-case" hidden>${paragraphs}</div>
        `;
      }
      col.innerHTML = `
        <article class="rv-card rv-project h-100" data-project-id="${p.id}">
          ${visual}
          <div class="rv-project-body">
            <div class="rv-tags">${featuredBadge}${tagsHtml}</div>
            <h3 class="rv-project-title">${escape(p.title)}</h3>
            ${roleHtml}
            <p class="text-body-secondary mb-2">${escape(p.description || "")}</p>
            ${linksHtml ? `<div class="d-flex flex-wrap gap-2 mt-2">${linksHtml}</div>` : ""}
            ${caseHtml}
          </div>
        </article>
      `;
      container.appendChild(col);
    });

    // Wire up case-study expand/collapse toggles
    container.querySelectorAll(".rv-project-case-toggle").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const card = btn.closest(".rv-project");
        const panel = card && card.querySelector(".rv-project-case");
        if (!panel) return;
        const isHidden = panel.hasAttribute("hidden");
        if (isHidden) {
          panel.removeAttribute("hidden");
          btn.setAttribute("aria-expanded", "true");
          btn.innerHTML = '<i class="bi bi-chevron-up"></i> Hide case study';
        } else {
          panel.setAttribute("hidden", "");
          btn.setAttribute("aria-expanded", "false");
          btn.innerHTML = '<i class="bi bi-chevron-down"></i> Read the case study';
        }
      });
    });

    // Attach click-to-track for view counting (only count once per session per project)
    const seen = new Set();
    container.querySelectorAll("[data-project-id]").forEach((el) => {
      const id = parseInt(el.dataset.projectId, 10);
      el.addEventListener("click", () => {
        if (seen.has(id)) return;
        seen.add(id);
        try {
          fetch(API + "/track/project-view", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ project_id: id }),
            keepalive: true,
          }).catch(() => {});
        } catch (_) {}
      });
    });
  }

  function escape(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function loadPublicProjects() {
    fetch(API + "/projects")
      .then((r) => r.json())
      .then((j) => applyProjects(j.projects || []))
      .catch(() => {});
  }
  window.rvLoadPublicProjects = loadPublicProjects;
  loadPublicProjects();

  // ===== Testimonials (public) =====
  function applyTestimonials(items) {
    const container = document.getElementById("rvTestimonialsList");
    if (!container) return;
    container.innerHTML = "";
    if (!items || !items.length) {
      const sec = document.getElementById("testimonials");
      if (sec) sec.style.display = "none";
      return;
    }
    items.forEach((t) => {
      const col = document.createElement("div");
      col.className = "col-md-6 col-lg-4";
      const initials = (t.author || "?")
        .split(/\s+/)
        .map((w) => w[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase();
      const avatar = t.avatar_url
        ? `<div class="rv-testimonial-avatar" style="background-image:url('${escape(t.avatar_url)}')"></div>`
        : `<div class="rv-testimonial-avatar">${escape(initials)}</div>`;
      col.innerHTML = `
        <article class="rv-testimonial-card">
          <p class="rv-testimonial-quote">${escape(t.quote || "")}</p>
          <div class="rv-testimonial-meta">
            ${avatar}
            <div>
              <div class="rv-testimonial-author">${escape(t.author || "")}</div>
              ${t.role ? `<div class="rv-testimonial-role">${escape(t.role)}</div>` : ""}
            </div>
          </div>
        </article>
      `;
      container.appendChild(col);
    });
  }
  function loadPublicTestimonials() {
    fetch(API + "/testimonials")
      .then((r) => r.json())
      .then((j) => applyTestimonials(j.items || []))
      .catch(() => {});
  }
  window.rvLoadPublicTestimonials = loadPublicTestimonials;
  loadPublicTestimonials();

  // ===== Contact form =====
  const form = document.getElementById("rvContactForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const get = (id) => (document.getElementById(id).value || "").trim();
      const msgEl = document.getElementById("rvContactMsg");
      const submit = document.getElementById("rvContactSubmit");
      msgEl.hidden = true; msgEl.classList.remove("is-error", "is-success");

      const name = get("rvContactName");
      const email = get("rvContactEmail");
      const subject = get("rvContactSubject");
      const body = get("rvContactBody");

      if (!name || !email || !body) {
        msgEl.textContent = "Please fill in your name, email, and message.";
        msgEl.classList.add("is-error");
        msgEl.hidden = false;
        return;
      }
      submit.disabled = true;
      try {
        const r = await fetch(API + "/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, email, subject, body }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          msgEl.textContent = typeof j.detail === "string" ? j.detail : "Failed to send message. Please try again later.";
          msgEl.classList.add("is-error");
          msgEl.hidden = false;
          return;
        }
        msgEl.textContent = "Thanks! Your message has been sent. Romar will get back to you at " + email + ".";
        msgEl.classList.add("is-success");
        msgEl.hidden = false;
        form.reset();
      } catch (err) {
        msgEl.textContent = "Network error. Please try again.";
        msgEl.classList.add("is-error");
        msgEl.hidden = false;
      } finally {
        submit.disabled = false;
      }
    });
  }
})();

/* ---------- Now Playing: album picker ---------- */
(function () {
  const picker = document.querySelector(".rv-album-picker");
  const frame = document.getElementById("rvSpotifyEmbed");
  if (!picker || !frame) return;
  picker.addEventListener("click", (e) => {
    const btn = e.target.closest(".rv-album-btn");
    if (!btn) return;
    const ytId = btn.dataset.ytId;
    if (!ytId) return;
    picker.querySelectorAll(".rv-album-btn").forEach((b) => {
      b.classList.remove("is-active");
      b.setAttribute("aria-selected", "false");
    });
    btn.classList.add("is-active");
    btn.setAttribute("aria-selected", "true");
    frame.src = `https://www.youtube.com/embed/${ytId}?rel=0&modestbranding=1&autoplay=1`;
  });
})();

/* ---------- Background music (Fitterkarma — Kalapastangan, looped) ---------- */
(function () {
  const frame = document.getElementById("rvBgm");
  const toggle = document.getElementById("rvBgmToggle");
  if (!frame || !toggle) return;

  const BGM_START = 43; // Chorus timestamp (seconds)

  let player = null;
  let playing = false;
  let unlocked = false;
  let pendingAloud = false; // scroll happened before player ready

  // Lightweight postMessage helper (works even before YT API is ready)
  const send = (func, args) => {
    try {
      frame.contentWindow.postMessage(
        JSON.stringify({ event: "command", func, args: args || [] }),
        "*"
      );
    } catch (_) {}
  };

  // Load YouTube IFrame API
  if (!window.YT || !window.YT.Player) {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  }
  function setupPlayer() {
    try {
      player = new YT.Player("rvBgm", {
        events: {
          onReady: () => {
            try {
              player.mute();
              player.seekTo(BGM_START, true);
              player.playVideo();
              if (pendingAloud) {
                // User already scrolled — unmute now
                player.unMute();
                player.setVolume(35);
                player.playVideo();
              }
            } catch (_) {}
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) {
              try { player.seekTo(BGM_START, true); player.playVideo(); } catch (_) {}
            }
          },
        },
      });
    } catch (_) {
      setTimeout(setupPlayer, 300);
    }
  }
  window.onYouTubeIframeAPIReady = setupPlayer;
  if (window.YT && window.YT.Player) setupPlayer();

  const stateEl = toggle.querySelector(".rv-vinyl-state");
  const setIcon = () => {
    if (stateEl) {
      stateEl.innerHTML = playing
        ? '<i class="bi bi-pause-fill"></i>'
        : '<i class="bi bi-volume-mute-fill"></i>';
    }
    toggle.classList.toggle("is-playing", playing);
    toggle.setAttribute("aria-pressed", playing ? "true" : "false");
  };
  setIcon();

  const tryUnmute = () => {
    // Bail if user/picker has paused us — prevents retry from clobbering stop.
    if (!playing) return false;
    let ok = false;
    if (player && player.unMute) {
      try {
        player.unMute();
        player.setVolume(35);
        player.playVideo();
        ok = true;
      } catch (_) {}
    }
    // Always send postMessage too (reaches iframe even before YT API ready)
    send("unMute");
    send("setVolume", [35]);
    send("playVideo");
    return ok;
  };
  const startAloud = () => {
    playing = true;
    unlocked = true;
    pendingAloud = true;
    setIcon();
    // Fire-and-retry: 0ms, 150ms, 400ms, 900ms, 1800ms
    tryUnmute();
    [150, 400, 900, 1800].forEach((ms) => setTimeout(tryUnmute, ms));
  };
  const stopAloud = () => {
    playing = false;
    pendingAloud = false;
    if (player && player.mute) {
      try { player.mute(); player.pauseVideo(); } catch (_) {}
    } else {
      send("mute"); send("pauseVideo");
    }
    // Aggressive double-tap to defeat any racing playVideo from queued retries.
    setTimeout(() => {
      if (playing) return;
      if (player && player.mute) {
        try { player.mute(); player.pauseVideo(); } catch (_) {}
      } else {
        send("mute"); send("pauseVideo");
      }
    }, 250);
    setIcon();
  };

  // True once the user has interacted with the Now Playing picker — stops
  // scroll-to-resume from restarting the BGM while the YT embed is active.
  let npActive = false;

  // Auto-unmute on first interaction (scroll, tap, key, click)
  const firstInteract = (e) => {
    if (unlocked) return;
    if (npActive) return;
    if (e && e.target && e.target.closest && e.target.closest("#rvBgmToggle")) return;
    if (e && e.target && e.target.closest && e.target.closest(".rv-album-picker")) return;
    if (e && e.target && e.target.closest && e.target.closest(".rv-spotify-wrap, .rv-yt-frame")) return;
    startAloud();
  };
  const events = ["pointerdown", "touchstart", "keydown", "scroll", "wheel", "click"];
  events.forEach((ev) =>
    window.addEventListener(ev, firstInteract, { passive: true, capture: true })
  );

  // Pause when Now Playing is used (user picked an album)
  const picker = document.querySelector(".rv-album-picker");
  if (picker) {
    picker.addEventListener("click", (e) => {
      if (!e.target.closest(".rv-album-btn")) return;
      npActive = true;
      stopAloud();
    });
  }
  // Expose so user's vinyl-toggle press can re-claim audio (clears npActive).
  toggle.addEventListener("click", () => { npActive = false; }, true);

  /* ---------- Draggable ---------- */
  const STORAGE_KEY = "rv_bgm_toggle_pos";
  const PAD = 10;
  const DRAG_THRESHOLD = 6;

  function applyPos(x, y) {
    const w = toggle.offsetWidth || 52;
    const h = toggle.offsetHeight || 52;
    const maxX = window.innerWidth - w - PAD;
    const maxY = window.innerHeight - h - PAD;
    x = Math.max(PAD, Math.min(maxX, x));
    y = Math.max(PAD, Math.min(maxY, y));
    toggle.style.left = x + "px";
    toggle.style.top = y + "px";
    toggle.style.right = "auto";
    toggle.style.bottom = "auto";
  }

  // Restore saved position
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
      applyPos(saved.x, saved.y);
    }
  } catch (_) {}

  let dragging = false;
  let dragMoved = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  toggle.addEventListener("pointerdown", (e) => {
    dragging = true;
    dragMoved = false;
    const r = toggle.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = r.left;
    startTop = r.top;
    try { toggle.setPointerCapture(e.pointerId); } catch (_) {}
    toggle.classList.add("is-dragging");
  });
  toggle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragMoved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      dragMoved = true;
    }
    if (dragMoved) applyPos(startLeft + dx, startTop + dy);
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    toggle.classList.remove("is-dragging");
    try { toggle.releasePointerCapture(e.pointerId); } catch (_) {}
    if (dragMoved) {
      const r = toggle.getBoundingClientRect();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: r.left, y: r.top }));
      } catch (_) {}
    }
  };
  toggle.addEventListener("pointerup", endDrag);
  toggle.addEventListener("pointercancel", endDrag);

  // Click = toggle mute/play (unless it was actually a drag)
  toggle.addEventListener("click", (e) => {
    if (dragMoved) { e.preventDefault(); e.stopPropagation(); dragMoved = false; return; }
    e.stopPropagation();
    if (playing) stopAloud();
    else startAloud();
  });

  // Keep in bounds on resize
  window.addEventListener("resize", () => {
    const r = toggle.getBoundingClientRect();
    if (r.left || r.top) applyPos(r.left, r.top);
  });
})();

/* ---------- Scroll-reveal animations (IntersectionObserver) ---------- */
(function () {
  if (typeof IntersectionObserver === "undefined") return;

  // Auto-tag common elements so we don't have to edit every section.
  const autoTargets = [
    ".rv-section-head",
    ".rv-section .rv-card",
    ".rv-edu-item",
    ".rv-project-card",
    ".rv-testimonial",
    ".rv-kicker",
    ".rv-about-goal",
    ".rv-ticker-wrap",
    ".rv-spotify-wrap",
    ".rv-album-picker",
    ".rv-hero .rv-stat-card",
    ".rv-hero .rv-hero-body",
  ];
  autoTargets.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el, idx) => {
      if (!el.classList.contains("rv-reveal")) {
        el.classList.add("rv-reveal");
        // Small stagger for siblings
        if (idx > 0 && idx <= 5) el.setAttribute("data-delay", String(idx * 100));
      }
    });
  });

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );

  const attach = (root) => {
    (root || document).querySelectorAll(".rv-reveal:not(.is-visible)").forEach((el) => io.observe(el));
  };
  attach(document);

  // Re-scan when the project list / testimonials render dynamically.
  const rescanSelectors = ["#rvProjectsList", "#rvTestimonialsList"];
  rescanSelectors.forEach((sel) => {
    const node = document.querySelector(sel);
    if (!node) return;
    const mo = new MutationObserver(() => {
      node.querySelectorAll(".rv-project-card, .rv-testimonial").forEach((el) => {
        if (!el.classList.contains("rv-reveal")) {
          el.classList.add("rv-reveal");
          io.observe(el);
        }
      });
    });
    mo.observe(node, { childList: true, subtree: true });
  });
})();

/* ---------- Scroll progress bar ---------- */
(function () {
  const bar = document.getElementById("rvScrollProgress");
  if (!bar) return;
  const span = bar.firstElementChild;
  if (!span) return;

  let ticking = false;
  function update() {
    const doc = document.documentElement;
    const max = (doc.scrollHeight || 0) - (window.innerHeight || 0);
    const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    span.style.setProperty("--rv-progress", p.toFixed(4));
    ticking = false;
  }
  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  update();
})();

/* ---------- Matrix Rain Effect (Hero) ---------- */
(function () {
  const canvas = document.getElementById("rvMatrixCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%^&*<>{}[]|/~アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
  const fontSize = 14;
  let columns, drops;

  function fadeColor() {
    return "rgba(11, 15, 26, 0.05)";
  }

  function resize() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    columns = Math.floor(canvas.width / fontSize);
    drops = Array(columns).fill(1);
  }
  resize();
  window.addEventListener("resize", resize);

  function draw() {
    ctx.fillStyle = fadeColor();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = fontSize + "px JetBrains Mono, monospace";
    for (let i = 0; i < drops.length; i++) {
      const char = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillStyle = Math.random() > 0.95 ? "#aaffaa" : "#00ff41";
      ctx.fillText(char, i * fontSize, drops[i] * fontSize);
      if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i]++;
    }
  }

  setInterval(draw, 60);
})();
