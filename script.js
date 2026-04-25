/* =====================================================
   Romar Villafuerte Portfolio — interactive scripts
   ===================================================== */

// Year in footer
document.getElementById("year").textContent = new Date().getFullYear();

/* ---------- Hero typewriter ---------- */
(function () {
  const el = document.getElementById("rvTyper");
  if (!el) return;
  const phrases = ["A website developer.", "A web app builder.", "A problem solver."];
  let pi = 0;        // phrase index
  let ci = 0;        // char index
  let deleting = false;
  el.textContent = "";

  function tick() {
    const word = phrases[pi];
    if (!deleting) {
      ci++;
      el.textContent = word.slice(0, ci);
      if (ci === word.length) {
        deleting = true;
        return setTimeout(tick, 1400); // hold full text
      }
      return setTimeout(tick, 70 + Math.random() * 50);
    } else {
      ci--;
      el.textContent = word.slice(0, ci);
      if (ci === 0) {
        deleting = false;
        pi = (pi + 1) % phrases.length;
        return setTimeout(tick, 350); // pause before next word
      }
      return setTimeout(tick, 35 + Math.random() * 25);
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
  const RV_API = "https://leaderboard-api-zgbqyajg.fly.dev";

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
      document.querySelectorAll(".rv-game-pane").forEach((p) => p.classList.add("d-none"));
      const pane = document.getElementById("game-" + key);
      if (pane) pane.classList.remove("d-none");
      const title = document.getElementById("stageTitle");
      const user = document.getElementById("stageUser");
      if (title) title.textContent = this.titles[key] || "Play";
      if (user) user.textContent = this.user;
      this._active = key;
      this.renderLB(key);
      this.renderLB(key + "_normal");
      this.renderLB(key + "_hard");
      this.renderLB(key + "_pro");
      this.renderLB(key + "_god");
      this.emit("gameShow", key);
      stage.scrollIntoView({ behavior: "smooth", block: "start" });
      // Fullscreen is now opt-in via the header button so we don't force it.
    },
  });

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
   CALENDAR — monthly availability
   ===================================================== */
(function () {
  const grid = document.getElementById("calendar");
  if (!grid) return;

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

  function ymd(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  // Deterministic pseudo-random availability based on date, so the calendar looks realistic
  // and consistent across reloads.
  function statusFor(date) {
    const day = date.getDay(); // 0 Sun .. 6 Sat
    if (day === 0 || day === 6) return { key: "off", label: "Day off", note: "Weekends are usually offline — but I answer email." };
    const seed = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
    const h = (Math.sin(seed) * 10000) % 1;
    const r = Math.abs(h);
    if (r < 0.35) return { key: "available", label: "Available — calls welcome", note: "Morning and afternoon slots are open." };
    if (r < 0.72) return { key: "few", label: "A few slots left", note: "Limited availability — best to confirm early." };
    return { key: "booked", label: "Booked", note: "Fully booked this day. Please pick another." };
  }

  function formatDate(d) {
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  function render() {
    monthLabel.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
    grid.innerHTML = "";

    // Day-of-week headers
    DOW.forEach((d) => {
      const h = document.createElement("div");
      h.className = "rv-cal-head";
      h.textContent = d;
      grid.appendChild(h);
    });

    // Calculate first day (Monday-first week)
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    // getDay: 0 Sun - 6 Sat. Convert to Mon-first (0 Mon .. 6 Sun).
    const startOffset = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    // Leading muted cells
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
      el.setAttribute("aria-label", `${formatDate(cellDate)} — ${st.label}`);
      el.innerHTML = `
        <span class="rv-cal-num">${d}</span>
        <span class="rv-cal-status-dot" style="background: var(--rv-${st.key === "available" ? "success" : st.key === "few" ? "warning" : st.key === "booked" ? "danger" : "text-faint"});"></span>
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
      few:       "bi-hourglass-split",
      booked:    "bi-x-circle",
      off:       "bi-cup-hot",
    };
    selStatusEl.className = `rv-cal-side-status status-${st.key}`;
    selStatusEl.innerHTML = `<i class="bi ${iconMap[st.key] || "bi-calendar"}"></i><span>${st.label}</span>`;
    selNoteEl.textContent = st.note;

    // Update mailto with selected date
    const prettyDate = selected.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const subject = encodeURIComponent(`Booking request — ${prettyDate}`);
    const body = encodeURIComponent(`Hi Romar,\n\nI'd like to book some time on ${prettyDate}. Here's what I have in mind:\n\n[Describe your project or question]\n\nThanks!`);
    bookBtn.href = `mailto:romarmalakass@gmail.com?subject=${subject}&body=${body}`;

    // Disable the book button for unavailable days
    if (st.key === "booked" || st.key === "off") {
      bookBtn.classList.add("disabled");
      bookBtn.setAttribute("aria-disabled", "true");
    } else {
      bookBtn.classList.remove("disabled");
      bookBtn.removeAttribute("aria-disabled");
    }

    render();
  }

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
})();

/* =====================================================
   BASKETBALL SHOOTING — hold to charge power, release to shoot
   ===================================================== */
(function () {
  const canvas = document.getElementById("bbCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("bbScore");
  const timeEl = document.getElementById("bbTime");
  const overlay = document.getElementById("bbOverlay");
  const titleEl = document.getElementById("bbTitle");
  const msgEl = document.getElementById("bbMsg");
  const startBtn = document.getElementById("bbStart");

  const W = canvas.width;
  const H = canvas.height;
  const GRAV = 900;
  const BALL_R = 15;
  const MAX_HOLD_MS = 1500; // fully-charged hold duration

  let running = false;
  let score = 0;
  let timeLeft = 30;
  let rafId = null;
  let startedAt = 0;
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

    timeLeft = Math.max(0, 30 - Math.floor((ts - startedAt) / 1000));
    timeEl.textContent = String(timeLeft);
    if (timeLeft <= 0) { end(); return; }

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

      // Off screen -> reset ball
      if (ball.y > H + 40 || ball.x > W + 40 || ball.x < -40) {
        resetBall();
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
    timeLeft = 30;
    scoreEl.textContent = "0";
    timeEl.textContent = "30";
    resetBall();
    running = true;
    charging = false;
    startedAt = performance.now();
    lastTs = 0;
    overlay.classList.add("is-hidden");
    rafId = requestAnimationFrame(frame);
  }

  function end() {
    running = false;
    charging = false;
    cancelAnimationFrame(rafId);
    if (window.RV) window.RV.submitScore("basket", score, "high");
    titleEl.textContent = "Time's up!";
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
    normal: { time: 12, qRange: [1, 20], ops: ["+", "-"], label: "Normal" },
    hard:   { time: 10, qRange: [5, 50], ops: ["+", "-", "*"], label: "Hard" },
    pro:    { time: 8,  qRange: [10, 99], ops: ["+", "-", "*", "/"], label: "Pro Expert" },
    god:    { time: 6,  qRange: [15, 150], ops: ["+", "-", "*", "/", "^"], label: "God Mode" },
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
    });
    setTimeout(next, 650);
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
    normal: { time: 12, label: "Normal" },
    hard:   { time: 10, label: "Hard" },
    pro:    { time: 8,  label: "Pro Expert" },
    god:    { time: 6,  label: "God Mode" },
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
    });
    setTimeout(next, 700);
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
  const overlay = document.getElementById("snOverlay");
  const titleEl = document.getElementById("snTitle");
  const msgEl = document.getElementById("snMsg");
  const startBtn = document.getElementById("snStart");

  const W = canvas.width;
  const H = canvas.height;
  const CELL = 24;
  const COLS = W / CELL; // 16
  const ROWS = H / CELL; // 24

  let snake = [];
  let dir = { x: 0, y: -1 };
  let queuedDir = null;
  let food = null;
  let score = 0;
  let tickMs = 180;
  let running = false;
  let tickId = null;

  function reset() {
    const cx = Math.floor(COLS / 2);
    const cy = Math.floor(ROWS / 2) + 3;
    // Start snake going up (portrait friendly)
    snake = [{ x: cx, y: cy }, { x: cx, y: cy + 1 }, { x: cx, y: cy + 2 }];
    dir = { x: 0, y: -1 };
    queuedDir = null;
    score = 0;
    tickMs = 180;
    placeFood();
    scoreEl.textContent = "0";
    draw();
  }

  function placeFood() {
    while (true) {
      const f = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
      if (!snake.some((s) => s.x === f.x && s.y === f.y)) { food = f; return; }
    }
  }

  function draw() {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    // subtle grid
    ctx.strokeStyle = "#f2f4f7";
    ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, H); ctx.stroke();
    }
    for (let i = 1; i < ROWS; i++) {
      ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(W, i * CELL); ctx.stroke();
    }
    // food
    ctx.fillStyle = "#f1416c";
    ctx.beginPath();
    ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 3, 0, Math.PI * 2);
    ctx.fill();
    // snake
    snake.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? "#0b8a3e" : "#17c653";
      ctx.fillRect(s.x * CELL + 2, s.y * CELL + 2, CELL - 4, CELL - 4);
    });
  }

  function step() {
    if (queuedDir) {
      // Prevent reversing into self
      if (!(queuedDir.x === -dir.x && queuedDir.y === -dir.y)) dir = queuedDir;
      queuedDir = null;
    }
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) return gameOver();
    if (snake.some((s) => s.x === head.x && s.y === head.y)) return gameOver();
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score++;
      scoreEl.textContent = String(score);
      tickMs = Math.max(60, 180 - score * 4);
      placeFood();
      restartTimer();
    } else {
      snake.pop();
    }
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

  // Portrait playfield (taller than wide). CELL_SIZE chosen so canvas pixel
  // size is around 440 x 600 — same proportions as Snake (2:3) for a consistent
  // big-screen-in-portrait look.
  const CELL_SIZE = 40;
  const N_COLS = 11;
  const N_ROWS = 15;
  canvas.width = N_COLS * CELL_SIZE;   // 440
  canvas.height = N_ROWS * CELL_SIZE;  // 600

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

  // D-pad pointer model: each active pointer (finger / mouse) maps to the
  // direction button it is currently over. Sliding the finger across buttons
  // updates the direction. Lifting the finger releases it. Using document-level
  // pointermove + elementsFromPoint avoids the touch-capture issue where
  // pointerenter on sibling buttons doesn't fire on Android Chrome / iOS Safari.
  const activePointers = new Map(); // pointerId -> dir
  const dpad = document.querySelector(".rv-bomber-dpad");

  function dirFromPoint(x, y) {
    if (!dpad) return null;
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      const btn = el && el.closest ? el.closest("[data-bomber-dir]") : null;
      if (btn && dpad.contains(btn)) return btn.getAttribute("data-bomber-dir");
    }
    return null;
  }

  function setPointerDir(pointerId, d) {
    const prev = activePointers.get(pointerId);
    if (prev === d) return;
    if (prev) {
      activePointers.delete(pointerId);
      if (![...activePointers.values()].includes(prev)) releaseDir(prev);
    }
    if (d) {
      activePointers.set(pointerId, d);
      pressDir(d);
    }
  }
  function clearPointer(pointerId) { setPointerDir(pointerId, null); }

  if (dpad) {
    dpad.addEventListener("pointerdown", (ev) => {
      const d = dirFromPoint(ev.clientX, ev.clientY);
      if (!d) return;
      ev.preventDefault();
      // Release implicit pointer capture so pointermove keeps firing as the
      // finger slides between buttons (otherwise touch is captured by the
      // first button hit).
      try { ev.target.releasePointerCapture && ev.target.releasePointerCapture(ev.pointerId); } catch (e) {}
      setPointerDir(ev.pointerId, d);
    });
    dpad.addEventListener("contextmenu", (ev) => ev.preventDefault());
  }

  document.addEventListener("pointermove", (ev) => {
    if (!activePointers.has(ev.pointerId)) return;
    const d = dirFromPoint(ev.clientX, ev.clientY);
    setPointerDir(ev.pointerId, d);
  });
  document.addEventListener("pointerup", (ev) => clearPointer(ev.pointerId));
  document.addEventListener("pointercancel", (ev) => clearPointer(ev.pointerId));

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
      : "https://leaderboard-api-zgbqyajg.fly.dev") + "/chat";

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

  function open() {
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    bubble.classList.add("is-hidden");
    setTimeout(() => input.focus(), 120);
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
    const b = document.createElement("div");
    b.className = "rv-chat-bubble-msg";
    if (opts.html) {
      b.innerHTML = opts.html;
    } else {
      b.innerHTML = linkify(escapeHtml(text));
    }
    wrap.appendChild(b);
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    return wrap;
  }

  function appendTyping() {
    const wrap = document.createElement("div");
    wrap.className = "rv-chat-msg rv-chat-msg-bot";
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
        body: JSON.stringify({ messages: history.slice(-12) }),
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
      input.focus();
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
