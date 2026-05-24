from fastapi import FastAPI, Request, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
import sqlite3
import hashlib
import hmac
import secrets
import time
import os
import json
import re
import httpx

# Stable secret for HMAC token signing (deterministic across cold starts)
_TOKEN_SECRET = os.environ.get("TOKEN_SECRET", "rv-portfolio-token-secret-2026")

# HuggingFace Hub persistence for messages (survives cold starts)
_HF_TOKEN = os.environ.get("HF_TOKEN", "")
_HF_REPO = "Romar19484/portfolio-data"
_HF_FILE = "messages.json"

_hf_headers = {"Authorization": f"Bearer {_HF_TOKEN}"}


def _hf_load(filename: str):
    try:
        r = httpx.get(
            f"https://huggingface.co/datasets/{_HF_REPO}/resolve/main/{filename}",
            headers=_hf_headers, timeout=10,
        )
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None


def _hf_save(filename: str, data, summary: str = "update"):
    try:
        httpx.post(
            f"https://huggingface.co/api/datasets/{_HF_REPO}/commit/main",
            headers={**_hf_headers, "Content-Type": "application/json"},
            json={
                "summary": summary,
                "files": [{"path": filename, "content": json.dumps(data, default=str)}],
            },
            timeout=15,
        )
    except Exception:
        pass


def _hf_load_messages() -> list:
    return _hf_load(_HF_FILE) or []


def _hf_save_messages(messages: list):
    _hf_save(_HF_FILE, messages, "update messages")


def _hf_load_visits() -> dict:
    return _hf_load("visits.json") or {"total": 0, "by_day": {}}


def _hf_save_visits(stats: dict):
    _hf_save("visits.json", stats, "update visits")


app = FastAPI(title="Romar Portfolio Leaderboard", version="1.0.0")

# Disable CORS. Do not remove this for full-stack development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
DB_PATH = "/tmp/app.db"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_db()
    c = conn.cursor()

    c.execute("""CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS tokens (
        token TEXT PRIMARY KEY,
        created_at REAL NOT NULL
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game TEXT NOT NULL,
        difficulty TEXT DEFAULT '',
        username TEXT NOT NULL,
        score INTEGER NOT NULL,
        sort_order TEXT DEFAULT 'high',
        created_at REAL
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        path TEXT DEFAULT '/',
        referrer TEXT DEFAULT '',
        user_agent TEXT DEFAULT '',
        country TEXT DEFAULT '',
        city TEXT DEFAULT '',
        device TEXT DEFAULT '',
        created_at REAL
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        note TEXT DEFAULT '',
        created_at REAL
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        subject TEXT DEFAULT '',
        body TEXT NOT NULL,
        read INTEGER DEFAULT 0,
        created_at REAL
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS profile (
        id INTEGER PRIMARY KEY DEFAULT 1,
        name TEXT DEFAULT 'Romar Villafuerte',
        title TEXT DEFAULT 'Website Developer',
        bio TEXT DEFAULT '',
        avatar_url TEXT DEFAULT '',
        resume_url TEXT DEFAULT '',
        email_public TEXT DEFAULT 'romarmalakass@gmail.com',
        github_url TEXT DEFAULT 'https://github.com/ROMARMALAKAS',
        facebook_url TEXT DEFAULT 'https://www.facebook.com/share/1BJX3bLk66/',
        linkedin_url TEXT DEFAULT '',
        location TEXT DEFAULT 'Philippines',
        updated_at REAL DEFAULT 0
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        long_description TEXT DEFAULT '',
        role TEXT DEFAULT '',
        image_url TEXT DEFAULT '',
        tech TEXT DEFAULT '[]',
        github_url TEXT DEFAULT '',
        demo_url TEXT DEFAULT '',
        featured INTEGER DEFAULT 0,
        hidden INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 100,
        views INTEGER DEFAULT 0,
        created_at REAL
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS project_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        ip TEXT NOT NULL,
        created_at REAL
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS testimonials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quote TEXT NOT NULL,
        author TEXT NOT NULL,
        role TEXT DEFAULT '',
        avatar_url TEXT DEFAULT '',
        hidden INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 100,
        created_at REAL
    )""")

    # Seed admin user — credentials from env or defaults
    admin_user = os.environ.get("ADMIN_USER", "Admin")
    admin_pass = os.environ.get("ADMIN_PASS", "Admin123")
    pw_hash = hashlib.sha256(admin_pass.encode()).hexdigest()
    c.execute("INSERT OR REPLACE INTO admin (id, username, password_hash) VALUES (1, ?, ?)", (admin_user, pw_hash))

    # Seed profile
    c.execute("SELECT COUNT(*) FROM profile")
    if c.fetchone()[0] == 0:
        c.execute("""INSERT INTO profile (id, name, title, bio, avatar_url, resume_url,
                     email_public, github_url, facebook_url, linkedin_url, location, updated_at)
                     VALUES (1, 'Romar Villafuerte', 'Website Developer', '', '', '',
                     'romarmalakass@gmail.com', 'https://github.com/ROMARMALAKAS',
                     'https://www.facebook.com/share/1BJX3bLk66/', '', 'Philippines', 0)""")

    # Seed projects
    c.execute("SELECT COUNT(*) FROM projects")
    if c.fetchone()[0] == 0:
        seed_projects = [
            ("Enrollment System",
             "A web-based enrollment system for managing students, sections, and class schedules. Streamlines registration and record-keeping for schools.",
             "Problem: my school\u2019s enrollment was still done on paper \u2014 long lines, lost forms, and clashing schedules. I wanted to give the registrar a single screen where they could enroll a student in under a minute.\n\nWhat I built: A PHP + MySQL web app with role-based logins (registrar, teacher, student), a class-schedule grid that flags conflicts, and per-student record cards with full enrollment history.\n\nResult: cut the enrollment time per student from ~10 minutes (paper) to under a minute, and made the term-end grade reports a one-click export.",
             "Solo developer \u2014 design, frontend, backend, database",
             "", '["Web App","School","PHP","MySQL"]', "", "", 1, 0, 100),
            ("Ride Hailing System",
             "A ride-hailing platform that connects riders with drivers, with live request, accept, and tracking flow \u2014 built around a clean mobile-first interface.",
             "Problem: trying to learn how the request \u2192 match \u2192 track flow of an Uber-style app actually works under the hood, end-to-end.\n\nWhat I built: a mobile-first web app where riders post a destination, nearby drivers see it on a live map, accept it, and both sides watch each other\u2019s pin in real time. Built on JavaScript + a small WebSocket backend.\n\nResult: a working clone of the core ride-request loop, with auth, live map updates, and a basic trip history. Great learning project for state sync between two clients.",
             "Solo developer \u2014 frontend, realtime backend, map integration",
             "", '["Web App","Maps","JavaScript","Realtime"]', "",
             "https://romar-web.ct.ws/login.php?skip_intro=1&i=1", 1, 0, 100),
            ("Mini-game Arcade",
             "A web arcade with 13 mini-games (Snake, Bomberman, Math Quiz, Piano Tiles, Basketball, Memory and more) sharing one global leaderboard.",
             "Problem: I wanted to learn JavaScript by building games \u2014 but most tutorials stop at one. I challenged myself to ship a whole arcade end-to-end.\n\nWhat I built: 13 mini-games (Snake with Adventure mode, Bomberman, Math Quiz, English Quiz, Piano Tiles, Basketball, Memory, Sliding Puzzle, Guess the Number, and more) on a single page. They all share one global leaderboard backed by a FastAPI backend on Fly.io with SQLite. Each game has its own how-to-play card, lives system, timed rounds, and edge-to-edge mobile play.\n\nResult: a fun, working arcade that doubles as a real codebase \u2014 vanilla JS for the games, a Python FastAPI backend, admin dashboard with auth, view tracking, and a Top Players panel that updates live as people play.",
             "Solo developer \u2014 game logic, frontend, FastAPI backend, leaderboard",
             "", '["JavaScript","Canvas","FastAPI","SQLite","Bootstrap"]',
             "https://github.com/ROMARMALAKAS/Portfolio",
             "https://romar-villafuerte.vercel.app/#playground", 1, 0, 100),
        ]
        for p in seed_projects:
            c.execute("""INSERT INTO projects (title, description, long_description, role,
                         image_url, tech, github_url, demo_url, featured, hidden, sort_order)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?)""", p)

    # Seed testimonials
    c.execute("SELECT COUNT(*) FROM testimonials")
    if c.fetchone()[0] == 0:
        seed_testimonials = [
            ("Romar shipped our enrollment system on time and made it dead simple for our registrar to use. He listens and iterates fast.",
             "School Coordinator", "Capstone client", ""),
            ("Reliable, communicates well, and writes clean code. Worked with him on a group project \u2014 he carried the realtime parts.",
             "Classmate", "Group-project teammate", ""),
            ("Took a vague brief and turned it into a working web app in a weekend. Easy to recommend.",
             "Friend / first freelance client", "Small business owner", ""),
        ]
        for t in seed_testimonials:
            c.execute("INSERT INTO testimonials (quote, author, role, avatar_url) VALUES (?,?,?,?)", t)

    # Seed bookings
    c.execute("SELECT COUNT(*) FROM bookings")
    if c.fetchone()[0] == 0:
        for d in ["2026-04-25", "2026-04-27", "2026-04-29", "2026-04-30"]:
            c.execute("INSERT INTO bookings (date, name, email) VALUES (?, 'Seed', 'seed@example.com')", (d,))

    conn.commit()
    conn.close()


init_db()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def _make_token(username: str) -> str:
    ts = str(int(time.time()))
    payload = f"{ts}:{username}"
    sig = hmac.new(_TOKEN_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{ts}:{username}:{sig}"


def _require_admin(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    token = authorization[7:]
    parts = token.split(":")
    if len(parts) != 3:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    ts, username, sig = parts
    expected = hmac.new(_TOKEN_SECRET.encode(), f"{ts}:{username}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    if time.time() - int(ts) > 86400 * 7:
        raise HTTPException(status_code=401, detail="Token expired. Please login again.")
    return token


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class AdminLoginIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=40)
    password: str = Field(..., min_length=1, max_length=200)


class ScoreIn(BaseModel):
    game: str = Field(..., min_length=1, max_length=32)
    difficulty: str = Field("", max_length=16)
    username: str = Field(..., min_length=1, max_length=20)
    score: int = Field(..., ge=0, le=10000000)
    order: str = Field("high")


class ChatIn(BaseModel):
    messages: list[dict] = Field(..., min_length=1, max_length=100)


class VisitIn(BaseModel):
    path: str = Field("/", max_length=200)
    referrer: str = Field("", max_length=300)
    user_agent: str = Field("", max_length=500)


class BookingIn(BaseModel):
    date: str = Field(..., min_length=10, max_length=10)
    name: str = Field(..., min_length=1, max_length=60)
    email: str = Field(..., min_length=3, max_length=120)
    note: str = Field("", max_length=400)


class MessageIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    email: str = Field(..., min_length=3, max_length=120)
    subject: str = Field("", max_length=140)
    body: str = Field(..., min_length=1, max_length=4000)


class MessageReadIn(BaseModel):
    read: bool = True


class ProfileUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    title: str = Field("", max_length=120)
    bio: str = Field("", max_length=2000)
    avatar_url: str = Field("", max_length=500)
    resume_url: str = Field("", max_length=500)
    email_public: str = Field("", max_length=120)
    github_url: str = Field("", max_length=300)
    facebook_url: str = Field("", max_length=300)
    linkedin_url: str = Field("", max_length=300)
    location: str = Field("", max_length=80)


class ProjectCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    description: str = Field("", max_length=2000)
    long_description: str = Field("", max_length=8000)
    role: str = Field("", max_length=200)
    image_url: str = Field("", max_length=500)
    tech: str = Field("", max_length=300)
    github_url: str = Field("", max_length=300)
    demo_url: str = Field("", max_length=300)
    featured: bool = False
    hidden: bool = False
    sort_order: int = 100


class ProjectUpdate(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    description: str = Field("", max_length=2000)
    long_description: str = Field("", max_length=8000)
    role: str = Field("", max_length=200)
    image_url: str = Field("", max_length=500)
    tech: str = Field("", max_length=300)
    github_url: str = Field("", max_length=300)
    demo_url: str = Field("", max_length=300)
    featured: bool = False
    hidden: bool = False
    sort_order: int = 100


class ProjectViewIn(BaseModel):
    project_id: int = Field(..., ge=1)


class TestimonialCreate(BaseModel):
    quote: str = Field(..., min_length=1, max_length=600)
    author: str = Field(..., min_length=1, max_length=120)
    role: str = Field("", max_length=160)
    avatar_url: str = Field("", max_length=500)
    hidden: bool = False
    sort_order: int = 100


class TestimonialUpdate(BaseModel):
    quote: str = Field(..., min_length=1, max_length=600)
    author: str = Field(..., min_length=1, max_length=120)
    role: str = Field("", max_length=160)
    avatar_url: str = Field("", max_length=500)
    hidden: bool = False
    sort_order: int = 100


# ---------------------------------------------------------------------------
# Public endpoints
# ---------------------------------------------------------------------------
@app.get("/api")
async def root():
    return {"name": "Romar Portfolio Leaderboard",
            "endpoints": ["/healthz", "/scores/{game}", "POST /scores"]}


@app.get("/api/healthz")
async def healthz():
    return {"status": "ok"}


# --- Scores ---
@app.get("/api/scores/{game}")
async def list_scores(game: str, difficulty: str = "", order: str = "high", limit: int = 10):
    conn = get_db()
    has = conn.execute("SELECT 1 FROM scores WHERE game=? LIMIT 1", (game,)).fetchone()
    if not has:
        conn.close()
        return {"game": game, "difficulty": difficulty, "scores": []}
    direction = "DESC" if order == "high" else "ASC"
    if difficulty:
        rows = conn.execute(
            f"SELECT username, score FROM scores WHERE game=? AND difficulty=? ORDER BY score {direction} LIMIT ?",
            (game, difficulty, limit)).fetchall()
    else:
        rows = conn.execute(
            f"SELECT username, score FROM scores WHERE game=? ORDER BY score {direction} LIMIT ?",
            (game, limit)).fetchall()
    conn.close()
    return {"game": game, "difficulty": difficulty,
            "scores": [{"username": r["username"], "score": r["score"]} for r in rows]}


@app.post("/api/scores")
async def submit_score(body: ScoreIn):
    conn = get_db()
    c = conn.cursor()
    now = time.time()
    c.execute("INSERT INTO scores (game, difficulty, username, score, sort_order, created_at) VALUES (?,?,?,?,?,?)",
              (body.game, body.difficulty, body.username, body.score, body.order, now))
    conn.commit()
    sid = c.lastrowid
    conn.close()
    return {"ok": True, "id": sid}


# --- Chat ---
import random as _rng

# Detect if text is mostly Tagalog
_TAGALOG_MARKERS = {
    "ako", "ko", "ka", "mo", "siya", "niya", "namin", "natin", "nila",
    "ang", "ng", "sa", "na", "pa", "po", "opo", "naman", "din", "rin",
    "lang", "lamang", "ba", "yung", "yun", "dito", "doon", "diyan",
    "ano", "sino", "saan", "bakit", "paano", "kailan", "magkano",
    "oo", "hindi", "ewan", "kasi", "pero", "at", "o", "kung",
    "gusto", "ayaw", "alam", "pano", "pwede", "puwede", "talaga",
    "grabe", "gago", "gaga", "bobo", "boba", "tanga", "tangina",
    "putangina", "pota", "puta", "ulol", "luh", "hoy", "uy",
    "sige", "tara", "diba", "noh", "eh", "nga", "kayo", "tayo",
    "kumusta", "musta", "kamusta", "maganda", "pangit", "gwapo",
    "pre", "pare", "bro", "kuya", "ate", "mars", "bes", "besh",
    "nag", "mag", "pag", "may", "wala", "meron", "mahal", "libre",
}


def _is_tagalog(text: str) -> bool:
    words = re.findall(r'\w+', text.lower())
    if not words:
        return False
    tag_count = sum(1 for w in words if w in _TAGALOG_MARKERS)
    return tag_count / len(words) > 0.25 or tag_count >= 2


def _chat_reply(text: str, history: list, is_savage: bool = False) -> str:
    t = text.lower().strip()
    words = set(re.findall(r'\w+', t))
    tl = _is_tagalog(text)
    msg_count = len(history)

    # === SAVAGE / MURA / KULIT MODE ===
    mura_words = {"gago", "gaga", "bobo", "boba", "tanga", "tangina",
                  "putangina", "pota", "puta", "ulol", "tarantado",
                  "hayop", "animal", "leche", "bwisit", "peste",
                  "pakyu", "fuck", "shit", "damn", "stupid", "idiot",
                  "dumb", "asshole", "bitch", "wtf", "stfu"}
    if words & mura_words or is_savage:
        if tl:
            return _rng.choice([
                "Oy putangina ka rin! Joke lang hahaha. Pero seryoso, ano ba kailangan mo? 😂",
                "Hoy gago, sino ka ba? Pumunta ka dito sa site ni Romar tapos magmumura ka? Tangina mo rin! 💀😂",
                "Luh palamura amputa hahaha. Sige sige, game lang. Ano tanong mo, bilis!",
                "Aba nagmumura, akala mo naman kung sino ka. Chill ka lang dyan, wag kang umasta. Ano ba kailangan mo? 😤😂",
                "Grabe ka magmura ah, sino ba nasaktan feelings mo? Dito ka na lang, tatanungin kita — okay ka ba pre? 💀",
                "Hahaha galit na galit! Tangina relax ka, inom ka muna ng tubig. Tapos tanong ka na lang ng maayos 😂",
                "Wow ang tapang mo naman magmura sa chatbot. Sige pa, di naman ako nasasaktan, robot lang ako gago 😂💀",
                "Oy ulol ka rin! Charot. Pero legit, ano gusto mong malaman? Wag pure mura lang ah 😏",
            ])
        else:
            return _rng.choice([
                "Oh wow, someone's feisty today huh? Lol chill out and ask a real question 😂",
                "Hahaha you kiss your mother with that mouth? Anyway, what do you actually want? 💀",
                "Lol okay tough guy, I've been called worse by better people. Now what do you need? 😏",
                "Damn bro calm down, it's just a portfolio website. You good? 😂",
                "Well fuck you too buddy! Jk jk. But seriously, what's your question? 💀😂",
                "Whoa there keyboard warrior! Save that energy for something useful. What do you wanna know? 🤣",
                "Lmao someone woke up and chose violence. I respect that. Now ask me something real 😂",
                "Oh shit we got a badass over here! Haha okay okay, what can I help you with? 💀",
            ])

    # Annoying / kulit / spam detection
    kulit_words = {"kulit", "annoying", "spam", "ulit", "paulit", "daldal",
                   "makulit", "shut", "tumahimik", "tahan", "stop", "quit"}
    if words & kulit_words:
        if tl:
            return _rng.choice([
                "Ako makulit?? Ikaw nga paulit ulit eh! 😂 Pero sige tanong ka pa",
                "Hoy sino makulit sa atin? Check mo sarili mo pre 💀",
                "Aba sinasabihan akong makulit, eh nandito lang naman ako para tumulong. Ingrato 😤😂",
            ])
        else:
            return _rng.choice([
                "Me annoying?? Have you met yourself? 😂 But sure, ask away",
                "Oh I'm the annoying one? That's rich coming from you 💀",
                "Lol okay I'll tone it down. What do you actually wanna know?",
            ])

    # Repeat / boring
    if msg_count > 6 and any(w in t for w in ["same", "ulit", "paulit", "boring", "lame"]):
        if tl:
            return "Hoy di ako boring! Ikaw kasi paulit ulit ang tanong. Try mo mag-ask ng iba naman! 😤"
        else:
            return "I'm not boring, YOU keep asking the same thing! Try a different question 😤"

    # === GREETINGS ===
    greet_en = ["good morning", "good afternoon", "good evening"]
    if any(p in t for p in greet_en):
        return _rng.choice([
            "Hey! Good vibes today. What can I help you with?",
            "Hello! Nice of you to drop by. Wanna know about Romar's work?",
        ])
    greet_tl = ["magandang umaga", "magandang hapon", "magandang gabi"]
    if any(p in t for p in greet_tl):
        return _rng.choice([
            "Magandang araw! Kumusta? Ano meron, curious ka sa work ni Romar?",
            "Hello! Kamusta ka? Tanong ka lang kung may gusto kang malaman!",
        ])

    if words & {"hello", "hey", "kumusta", "musta", "kamusta", "sup", "yo"}:
        if tl:
            return _rng.choice([
                "Uy kumusta! Anong balita? Tanong ka lang kung may gusto kang malaman kay Romar",
                "Hoy kamusta! Nandito lang ako, tanong mo lang kung ano man yan",
                "Musta pre! G lang tanong ka, nandito naman ako 24/7",
            ])
        else:
            return _rng.choice([
                "Hey! What's up? Feel free to ask me anything about Romar",
                "Hello there! What brings you to Romar's portfolio?",
                "Yo! Welcome. Ask me about Romar's skills, projects, whatever you want",
            ])
    if "hi" in words and len(words) <= 3:
        if tl:
            return "Uy hi! Anong meron? Tanong ka lang"
        else:
            return "Hi! What would you like to know about Romar?"

    # === ABOUT ROMAR ===
    if any(p in t for p in ["who is romar", "who's romar", "tell me about romar"]):
        return _rng.choice([
            "Romar Villafuerte is a Website Developer from the Philippines. He builds full-stack web apps — enrollment systems, ride-hailing platforms, game arcades, you name it. The guy can do front-end and back-end no problem.",
            "He's a full-stack web developer based in the Philippines. His projects include an enrollment system, a ride-hailing app, and a 13-game arcade. Pretty solid portfolio for his age honestly.",
        ])
    if any(p in t for p in ["sino si romar", "sino siya", "about romar", "kwento mo"]):
        return _rng.choice([
            "Si Romar? Full-stack web developer siya taga-Philippines. Gumawa na siya ng enrollment system, ride-hailing app, at 13-game arcade. Lahat solo dev pa.",
            "Web developer siya pre. Kaya niya front-end at back-end. Yung mga projects niya dito sa site, lahat siya gumawa mag-isa. Solid yan.",
            "Si boss Romar, website developer. PHP, JavaScript, Python — lahat kaya niya. Tingnan mo na lang yung projects niya dito sa site, makikita mo.",
        ])

    # === SKILLS / TECH ===
    if any(p in t for p in ["tech stack", "what tech", "what does he use"]):
        return "His stack:\n- Frontend: HTML, CSS, JavaScript, Bootstrap\n- Backend: PHP, Python, FastAPI, Node.js\n- Database: MySQL, SQLite\n- Real-time: WebSocket\n- Tools: Git, GitHub, Vercel\n\nFull-stack developer through and through."
    if any(p in t for p in ["ano alam", "anong alam", "ano gamit", "alam ni romar", "alam niya"]):
        return "Eto mga gamit ni Romar:\n- Frontend: HTML, CSS, JavaScript, Bootstrap\n- Backend: PHP, Python, FastAPI, Node.js\n- Database: MySQL, SQLite\n- Real-time: WebSocket\n- Tools: Git, GitHub, Vercel\n\nFull-stack talaga siya."
    if words & {"skill", "skills", "technology", "programming", "tools", "expertise", "tech", "stack", "code", "coding"}:
        if tl:
            return "Maraming alam si Romar — HTML, CSS, JS, PHP, Python, MySQL, SQLite, FastAPI, WebSocket. Full-stack dev talaga siya, kaya niya lahat from frontend to backend."
        else:
            return "Romar's skilled in HTML, CSS, JavaScript, PHP, Python, MySQL, SQLite, FastAPI, and WebSocket. He's a full-stack developer who handles both frontend and backend."

    # === PROJECTS ===
    if words & {"enrollment", "enroll", "student", "registrar"}:
        if tl:
            return "Yung Enrollment System niya, PHP at MySQL gamit. May login system per role — registrar, teacher, student. May schedule grid pa na nagde-detect ng conflicts. Dati 10 minutes mag-enroll, ngayon under 1 minute na lang."
        else:
            return "His Enrollment System is built with PHP and MySQL. It has role-based logins for registrar, teacher, and student, plus a schedule grid that detects conflicts. Cut enrollment time from 10 minutes to under 1 minute."
    if words & {"ride", "hailing", "uber", "grab", "driver"} or "ride hailing" in t:
        if tl:
            return "Yung Ride Hailing System niya, parang Grab yun. May live map, real-time tracking between driver at rider gamit WebSocket. Try mo dito: https://romar-web.ct.ws/login.php?skip_intro=1&i=1"
        else:
            return "His Ride Hailing System is basically a Grab/Uber clone. Live map, real-time driver-rider tracking via WebSocket. Check it out: https://romar-web.ct.ws/login.php?skip_intro=1&i=1"
    if words & {"game", "games", "arcade", "snake", "bomberman", "piano", "basketball", "laro", "play", "laruan"}:
        if tl:
            return "May 13 mini-games siya dito — Snake, Bomberman, Math Quiz, Piano Tiles, Basketball, Memory, at iba pa. Lahat may shared leaderboard. Scroll up sa Games section kung gusto mong maglaro."
        else:
            return "He built a web arcade with 13 mini-games — Snake, Bomberman, Math Quiz, Piano Tiles, Basketball, Memory, and more. They all share a global leaderboard. Scroll up to the Games section to try them."
    if words & {"project", "projects", "portfolio", "gawa", "ginawa", "work"}:
        if tl:
            return "Tatlong main projects ni Romar:\n1. Enrollment System — school management app\n2. Ride Hailing System — parang Grab\n3. Mini-game Arcade — 13 games na may leaderboard\n\nLahat solo dev siya. Tanong mo ko kung gusto mo malaman yung details."
        else:
            return "Romar's main projects:\n1. Enrollment System — school management app\n2. Ride Hailing System — like Grab/Uber\n3. Mini-game Arcade — 13 games with a leaderboard\n\nAll built solo. Ask me about any of them for details."

    # === CONTACT / HIRE ===
    if any(p in t for p in ["how to contact", "how to reach", "get in touch", "pano makipag", "pano mag contact"]):
        if tl:
            return "Email: romarmalakass@gmail.com\nContact form: nandyan sa baba ng page\nFacebook: https://www.facebook.com/share/1BJX3bLk66/\nGitHub: https://github.com/ROMARMALAKAS\n\nMag-message ka lang, mabilis naman siya mag-reply."
        else:
            return "Email: romarmalakass@gmail.com\nContact form: scroll down on this page\nFacebook: https://www.facebook.com/share/1BJX3bLk66/\nGitHub: https://github.com/ROMARMALAKAS\n\nHe usually replies within 24 hours."
    if any(p in t for p in ["i want to hire", "need developer", "need a website", "looking for developer", "work with"]):
        return "Romar's available for freelance work! Send him a message through the contact form or email romarmalakass@gmail.com with your project details. He'll get back to you with a quote."
    if words & {"hire", "freelance", "kumuha"}:
        if tl:
            return "Available si Romar for freelance. Message mo siya sa contact form o kaya email: romarmalakass@gmail.com. Sabihin mo lang yung project details."
        else:
            return "Romar's available for freelance work. Hit him up through the contact form or email romarmalakass@gmail.com with your project details."
    if words & {"price", "cost", "magkano", "presyo", "budget", "quote", "bayad", "rate"}:
        if tl:
            return "Depende sa project yan eh. Mag-message ka na lang sa contact form, sabihin mo yung kailangan mo tapos siya na mag-bibigay ng quote. Email: romarmalakass@gmail.com"
        else:
            return "Pricing depends on the project scope. Send your requirements through the contact form or email romarmalakass@gmail.com and he'll give you a custom quote."
    if words & {"contact", "email", "reach", "makipag"}:
        if tl:
            return "Email niya: romarmalakass@gmail.com. O kaya gamitin mo yung contact form sa baba ng page na to."
        else:
            return "You can reach him at romarmalakass@gmail.com or use the contact form at the bottom of this page."

    # === LOCATION ===
    if words & {"where", "location", "country", "saan", "based", "taga", "nasaan"}:
        if tl:
            return "Taga-Philippines si Romar. Pero tumatanggap siya ng clients kahit saan — remote work naman lahat ngayon eh."
        else:
            return "He's based in the Philippines but works with clients worldwide. Everything's remote anyway."

    # === PERSONAL ===
    if words & {"age", "edad", "old", "birthday", "bday"}:
        if tl:
            return "Di ko alam exact age niya eh. Pero bata pa siya at ang dami na niyang nagawa. Tingnan mo na lang yung projects niya."
        else:
            return "I'm not sure about his exact age. But he's young and already has an impressive portfolio. Check out his projects."
    if words & {"study", "school", "graduate", "college", "university", "aral", "nag-aaral"}:
        if tl:
            return "Passion niya talaga yung coding. Self-taught siya sa maraming tech skills. Yung mga projects niya dito, lahat real-world applications na ginawa niya habang nag-aaral."
        else:
            return "He's passionate about coding and largely self-taught. The projects on this site are all real-world applications he built while studying."
    if words & {"love", "crush", "ganda", "pogi", "cute", "guapo", "beautiful", "handsome", "gwapo"}:
        if tl:
            return _rng.choice([
                "Hala crush mo si Romar?? Hahaha message mo na sa contact form, baka type ka rin 😂",
                "Uy may crush! Wag ka lang dito sa chatbot, mag-message ka na sa kanya directly 💀😂",
                "Pogi ba? Oo naman! Pero mas pogi yung code niya, promise 😂",
            ])
        else:
            return _rng.choice([
                "Haha someone's got a crush! Why don't you message him through the contact form? 😂",
                "Oh? Interested in more than his code? Hit him up via the contact form 💀😂",
            ])
    if words & {"single", "jowa", "girlfriend", "boyfriend", "taken", "relationship", "gf", "bf"}:
        if tl:
            return "Aba ayoko na makisawsaw dyan! Tanong mo na lang siya mismo sa contact form hahaha 😂"
        else:
            return "Haha I'm not getting into that! You can ask him yourself through the contact form 😂"

    # === JOKES ===
    if words & {"joke", "jokes", "funny", "biro", "biruan", "humor", "patawa"}:
        if tl:
            return _rng.choice([
                "Bakit malungkot si HTML? Kasi walang style. Kailangan niya si CSS 😂",
                "Knock knock! Sino? Si Java. Java sino? JavaScript ka ba? Kasi pinapatubo mo puso ko 😂",
                "Bakit magaling si Romar? Kasi di siya nag-quit() kahit puno ng errors yung buhay niya 😂",
                "Ano sabi ng programmer sa jowa niya? 'You had me at Hello World' 😂",
                "Bakit di makatulog yung developer? Kasi di niya ma-catch yung bug 😂",
            ])
        else:
            return _rng.choice([
                "Why do programmers prefer dark mode? Because light attracts bugs 😂",
                "What's a programmer's favorite hangout place? Foo Bar 😂",
                "Why was the HTML sad? Because it had no style. It needed CSS 😂",
                "Why did Romar become a programmer? Because he didn't want a 9-to-5... he wanted a 9-to-undefined 😂",
                "How do you comfort a JavaScript bug? You console it 😂",
            ])

    # === THANKS ===
    if words & {"thank", "thanks", "salamat", "appreciate", "tysm"}:
        if tl:
            return _rng.choice([
                "Walang anuman! Tanong ka lang ulit kung may kailangan ka pa",
                "Sige sige, wala yun. Nandito lang ako kung may tanong ka pa",
            ])
        else:
            return _rng.choice([
                "No problem! Let me know if you have more questions",
                "You're welcome! Feel free to ask anything else",
            ])

    # === BYE ===
    if words & {"bye", "goodbye", "paalam"}:
        if tl:
            return _rng.choice([
                "Sige ingat! Balik ka ulit ha",
                "Bye! Salamat sa pagbisita. Nandito lang kami kung kailangan mo ulit",
            ])
        else:
            return _rng.choice([
                "See ya! Come back anytime",
                "Bye! Thanks for stopping by Romar's portfolio",
            ])

    # === WHAT CAN YOU DO ===
    if any(p in t for p in ["what can you do", "ano kaya mo", "what do you know", "anong alam mo"]):
        if tl:
            return "Alam ko lahat tungkol kay Romar — skills, projects, contact info. Pwede mo rin akong kausapin kung bored ka. Tanong ka lang!"
        else:
            return "I know all about Romar — his skills, projects, and how to reach him. You can also just chat with me if you're bored. Ask away!"

    # === FALLBACK ===
    if tl:
        return _rng.choice([
            "Hmm di ko alam yang exact na yan eh. Pero pwede mo itanong directly kay Romar — romarmalakass@gmail.com o gamitin yung contact form sa baba",
            "Di ko sure jan pre. Try mo i-message si Romar sa contact form, mabilis siya mag-reply",
            "Ewan ko jan ah haha. Pero seryoso, i-message mo na lang si Romar kung gusto mo ng sagot — nandyan yung contact form sa baba",
            "Wala akong alam jan. Pero kung important yan, tanong mo na lang kay Romar mismo. Email: romarmalakass@gmail.com",
        ])
    else:
        return _rng.choice([
            "Hmm I'm not sure about that one. You can ask Romar directly at romarmalakass@gmail.com or through the contact form below",
            "I don't have info on that. Try messaging Romar through the contact form — he's pretty responsive",
            "Not sure about that honestly. But Romar can probably answer it — hit him up at romarmalakass@gmail.com",
            "Can't help you with that one. But the man himself is just a message away — use the contact form below",
        ])


_ROMAR_CONTEXT = (
    "Context about Romar Villafuerte: Full-stack web developer from the Philippines. "
    "Projects: Enrollment System (PHP+MySQL), Ride Hailing System (WebSocket), "
    "Mini-game Arcade (13 games). Skills: HTML, CSS, JS, PHP, Python, FastAPI, MySQL, SQLite, WebSocket. "
    "Contact: romarmalakass@gmail.com. "
    "Facebook: https://www.facebook.com/share/1BJX3bLk66/ "
    "GitHub: https://github.com/ROMARMALAKAS "
    "All solo dev. Available for freelance. "
    "You can show Romar's profile photo by writing exactly: [IMG:assets/romar-hero.jpg] "
    "ONLY use this when they ask for Romar's picture/photo. NEVER invent other image URLs."
)

_HF_MODELS = [
    "Qwen/Qwen2.5-7B-Instruct",
    "mistralai/Mistral-7B-Instruct-v0.3",
]


def _enrich_messages(msgs: list) -> list:
    """Add Romar context and enforce short human replies."""
    enriched = list(msgs)
    # Find the instruction message and append Romar context to it
    for i, m in enumerate(enriched):
        if m.get("role") == "user" and "[INSTRUCTION]" in m.get("content", ""):
            enriched[i] = {
                "role": "user",
                "content": m["content"] + "\n\n" + _ROMAR_CONTEXT
            }
            return enriched
    # If no instruction found, add basic context
    enriched.insert(0, {
        "role": "user",
        "content": "[INSTRUCTION] Keep replies SHORT — 1 to 3 sentences, like a text message. "
                   "Talk like a real human, not an AI. " + _ROMAR_CONTEXT
    })
    enriched.insert(1, {"role": "assistant", "content": "Got it, short and human. What's up?"})
    return enriched


def _to_gemini_contents(msgs: list) -> list:
    """Convert OpenAI-style messages to Gemini contents format."""
    contents = []
    for m in msgs:
        role = m.get("role", "user")
        text = m.get("content", "")
        if role in ("user", "system"):
            contents.append({"role": "user", "parts": [{"text": text}]})
        elif role == "assistant":
            contents.append({"role": "model", "parts": [{"text": text}]})
    return contents


async def _try_ai_api(msgs: list) -> str:
    """Try Gemini first, then Grok, then OpenAI, then HuggingFace."""
    enriched = _enrich_messages(msgs)

    # 1) Google Gemini (free, high quality) — rotate across multiple API keys
    gemini_keys = [k for k in [
        os.getenv("GEMINI_API_KEY", ""),
        os.getenv("GEMINI_API_KEY_2", ""),
        os.getenv("GEMINI_API_KEY_3", ""),
        os.getenv("GEMINI_API_KEY_4", ""),
        os.getenv("GEMINI_API_KEY_5", ""),
        os.getenv("GEMINI_API_KEY_6", ""),
    ] if k]
    if gemini_keys:
        contents = _to_gemini_contents(enriched)
        safety = [
            {"category": c, "threshold": "BLOCK_NONE"}
            for c in [
                "HARM_CATEGORY_HARASSMENT",
                "HARM_CATEGORY_HATE_SPEECH",
                "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                "HARM_CATEGORY_DANGEROUS_CONTENT",
            ]
        ]
        for gemini_key in gemini_keys:
            for gemini_model in ["gemini-3.5-flash", "gemini-flash-lite-latest", "gemini-flash-latest"]:
                try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={gemini_key}"
                    async with httpx.AsyncClient(timeout=25) as client:
                        resp = await client.post(
                            url,
                            headers={"Content-Type": "application/json"},
                            json={
                                "contents": contents,
                                "safetySettings": safety,
                                "generationConfig": {"maxOutputTokens": 512}
                            }
                        )
                        if resp.status_code == 200:
                            data = resp.json()
                            cands = data.get("candidates", [])
                            if cands:
                                parts = cands[0].get("content", {}).get("parts", [])
                                if parts:
                                    reply = parts[0].get("text", "")
                                    if reply:
                                        return reply
                                finish = cands[0].get("finishReason", "")
                                if finish == "SAFETY":
                                    continue
                        elif resp.status_code == 429:
                            continue
                except Exception:
                    continue

    # 2) Grok (xAI)
    xai_key = os.getenv("XAI_API_KEY", "")
    if xai_key:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    "https://api.x.ai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {xai_key}", "Content-Type": "application/json"},
                    json={"model": "grok-3-mini-fast", "messages": enriched, "max_tokens": 512}
                )
                if resp.status_code == 200:
                    data = resp.json()
                    reply = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    if reply:
                        return reply
        except Exception:
            pass

    # 3) OpenAI (if key available)
    api_key = os.getenv("OPENAI_API_KEY", "")
    if api_key:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={"model": "gpt-4o-mini", "messages": enriched, "max_tokens": 1024}
                )
                data = resp.json()
                reply = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                if reply:
                    return reply
        except Exception:
            pass

    return ""


@app.post("/api/chat")
async def chat(body: ChatIn):
    last_msg = ""
    is_savage = False
    for m in body.messages:
        if m.get("role") == "user":
            content = m.get("content", "")
            if "[INSTRUCTION]" not in content:
                last_msg = content
            if "SAVAGE" in content:
                is_savage = True

    msgs = []
    for m in body.messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role in ("user", "assistant", "system"):
            msgs.append({"role": role, "content": content})

    # Try real AI
    try:
        reply = await _try_ai_api(msgs)
    except Exception as exc:
        reply = ""

    if reply:
        return {"reply": reply}

    # Fallback to built-in for Romar-specific questions
    builtin = _chat_reply(last_msg, body.messages, is_savage)
    # Use builtin only for known-good Romar responses, not generic "di ko alam"
    generic_fallbacks = ["di ko alam", "wala akong alam", "i don't have info", "hmm di ko"]
    is_generic = any(g in builtin.lower() for g in generic_fallbacks) if builtin else True
    if builtin and not is_generic:
        return {"reply": builtin}

    return {"reply": "Sandali lang pre, medyo maraming nagcha-chat sakin ngayon haha. Try mo ulit in a few seconds!"}


# --- Bookings ---
@app.get("/api/bookings")
async def list_bookings():
    conn = get_db()
    rows = conn.execute("SELECT date FROM bookings ORDER BY date").fetchall()
    conn.close()
    return {"dates": [r["date"] for r in rows]}


@app.post("/api/bookings")
async def create_booking(body: BookingIn):
    conn = get_db()
    try:
        conn.execute("INSERT INTO bookings (date, name, email, note, created_at) VALUES (?,?,?,?,?)",
                      (body.date, body.name, body.email, body.note, time.time()))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(409, detail="Date already booked.")
    conn.close()
    return {"ok": True}


# --- Visit tracking (with location & device info) ---
@app.post("/api/track/visit")
async def track_visit(body: VisitIn, request: Request):
    ip = _get_client_ip(request)
    ua = body.user_agent or request.headers.get("user-agent", "")

    # Parse device from user-agent
    device = "Unknown"
    ua_lower = ua.lower()
    if "iphone" in ua_lower:
        device = "iPhone"
    elif "ipad" in ua_lower:
        device = "iPad"
    elif "android" in ua_lower:
        m = re.search(r"android[^;]*;\s*([^)]+)", ua_lower)
        if m:
            raw = m.group(1).strip()
            parts = raw.split(" build")
            device = parts[0].strip().title() if parts else "Android"
        else:
            device = "Android"
    elif "windows" in ua_lower:
        device = "Windows PC"
    elif "macintosh" in ua_lower or "mac os" in ua_lower:
        device = "Mac"
    elif "linux" in ua_lower:
        device = "Linux PC"

    # Geo lookup via free API
    country = ""
    city = ""
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            geo = await client.get(f"http://ip-api.com/json/{ip}?fields=country,city")
            if geo.status_code == 200:
                gdata = geo.json()
                country = gdata.get("country", "")
                city = gdata.get("city", "")
    except Exception:
        pass

    conn = get_db()
    # Dedup: same IP + device within last 24 hours (prevents repeat counting)
    cutoff = time.time() - 86400
    existing = conn.execute(
        "SELECT id FROM visits WHERE ip=? AND device=? AND created_at>?",
        (ip, device, cutoff)
    ).fetchone()
    # Also check persistent storage for dedup across cold starts
    import datetime
    vstats = _hf_load_visits()
    today_str = datetime.datetime.utcfromtimestamp(time.time()).strftime("%Y-%m-%d")
    seen_ips = vstats.get("seen_today", {})
    ip_device_key = f"{ip}:{device}"
    already_counted = seen_ips.get(ip_device_key) == today_str

    if not existing and not already_counted:
        now = time.time()
        conn.execute(
            "INSERT INTO visits (ip, path, referrer, user_agent, country, city, device, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (ip, body.path, body.referrer, ua, country, city, device, now))
        conn.commit()
        # Persist visit count + dedup info to HuggingFace Hub
        vstats["total"] = vstats.get("total", 0) + 1
        by_day = vstats.get("by_day", {})
        by_day[today_str] = by_day.get(today_str, 0) + 1
        vstats["by_day"] = by_day
        # Track seen IPs for today (clean up old entries)
        seen_ips = {k: v for k, v in seen_ips.items() if v == today_str}
        seen_ips[ip_device_key] = today_str
        vstats["seen_today"] = seen_ips
        _hf_save_visits(vstats)

    today_start = int(time.time()) - (int(time.time()) % 86400)
    count = conn.execute("SELECT COUNT(*) FROM visits WHERE created_at>=?", (today_start,)).fetchone()[0]
    conn.close()
    return {"ok": True, "today": count}


# --- Project view tracking ---
@app.post("/api/track/project-view")
async def track_project_view(body: ProjectViewIn, request: Request):
    ip = _get_client_ip(request)
    conn = get_db()
    cutoff = time.time() - 1800
    existing = conn.execute("SELECT id FROM project_views WHERE project_id=? AND ip=? AND created_at>?",
                             (body.project_id, ip, cutoff)).fetchone()
    if not existing:
        conn.execute("INSERT INTO project_views (project_id, ip, created_at) VALUES (?,?,?)", (body.project_id, ip, time.time()))
        conn.execute("UPDATE projects SET views = views + 1 WHERE id=?", (body.project_id,))
        conn.commit()
    views = conn.execute("SELECT views FROM projects WHERE id=?", (body.project_id,)).fetchone()
    conn.close()
    return {"ok": True, "views": views["views"] if views else 0}


# --- Profile ---
@app.get("/api/profile")
async def get_profile():
    conn = get_db()
    row = conn.execute("SELECT * FROM profile WHERE id=1").fetchone()
    conn.close()
    if not row:
        return {"ok": True, "profile": {}}
    return {"ok": True, "profile": dict(row)}


# --- Projects ---
@app.get("/api/projects")
async def list_projects(all: bool = False):
    conn = get_db()
    if all:
        rows = conn.execute("SELECT * FROM projects ORDER BY sort_order, id").fetchall()
    else:
        rows = conn.execute("SELECT * FROM projects WHERE hidden=0 ORDER BY sort_order, id").fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        tech_raw = d.get("tech", "[]")
        try:
            d["tech"] = json.loads(tech_raw) if isinstance(tech_raw, str) else tech_raw
        except Exception:
            d["tech"] = []
        d.pop("hidden", None)
        d.pop("sort_order", None)
        d.pop("created_at", None)
        result.append(d)
    return {"ok": True, "projects": result}


# --- Messages (public submit) ---
@app.post("/api/messages")
async def post_message(body: MessageIn):
    now = time.time()
    conn = get_db()
    conn.execute("INSERT INTO messages (name, email, subject, body, created_at) VALUES (?,?,?,?,?)",
                  (body.name, body.email, body.subject, body.body, now))
    conn.commit()
    conn.close()
    # Persist to HuggingFace Hub (survives cold starts)
    msgs = _hf_load_messages()
    msgs.append({
        "id": int(now * 1000),
        "name": body.name, "email": body.email,
        "subject": body.subject, "body": body.body,
        "read": 0, "created_at": now,
    })
    _hf_save_messages(msgs)
    return {"ok": True}


# --- Testimonials ---
@app.get("/api/testimonials")
async def list_testimonials(all: bool = False):
    conn = get_db()
    if all:
        rows = conn.execute("SELECT * FROM testimonials ORDER BY sort_order, id").fetchall()
    else:
        rows = conn.execute(
            "SELECT id, quote, author, role, avatar_url FROM testimonials WHERE hidden=0 ORDER BY sort_order, id"
        ).fetchall()
    conn.close()
    return {"ok": True, "items": [dict(r) for r in rows]}


# ---------------------------------------------------------------------------
# Admin endpoints (NO rate limit)
# ---------------------------------------------------------------------------
@app.post("/api/admin/login")
async def admin_login(body: AdminLoginIn):
    conn = get_db()
    pw_hash = hashlib.sha256(body.password.encode()).hexdigest()
    row = conn.execute("SELECT id FROM admin WHERE username=? AND password_hash=?",
                        (body.username, pw_hash)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(401, detail="Invalid username or password.")
    conn.close()
    token = _make_token(body.username)
    return {"ok": True, "token": token}


@app.post("/api/admin/logout")
async def admin_logout(authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    return {"ok": True}


@app.get("/api/admin/check")
async def admin_check(authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    return {"ok": True}


@app.get("/api/admin/stats")
async def admin_stats(authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    import datetime
    vstats = _hf_load_visits()
    total_visits = vstats.get("total", 0)
    by_day = vstats.get("by_day", {})
    today_str = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    today_visits = by_day.get(today_str, 0)
    # Week visits (last 7 days)
    week_visits = 0
    for i in range(7):
        d = (datetime.datetime.utcnow() - datetime.timedelta(days=i)).strftime("%Y-%m-%d")
        week_visits += by_day.get(d, 0)
    # Build by_day list for sparkline (last 30 days)
    by_day_list = []
    for i in range(29, -1, -1):
        d = (datetime.datetime.utcnow() - datetime.timedelta(days=i)).strftime("%Y-%m-%d")
        by_day_list.append({"day": d, "count": by_day.get(d, 0)})
    # Also merge local SQLite visits for current warm session
    conn = get_db()
    local_today_start = int(time.time()) - (int(time.time()) % 86400)
    local_today = conn.execute("SELECT COUNT(*) FROM visits WHERE created_at>=?", (local_today_start,)).fetchone()[0]
    conn.close()
    today_visits = max(today_visits, local_today)
    return {
        "ok": True,
        "visits": {
            "today": today_visits,
            "week": week_visits,
            "total": total_visits,
            "by_day": by_day_list,
        },
    }


@app.get("/api/admin/stats2")
async def admin_stats2(authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    conn = get_db()
    visitors = conn.execute(
        "SELECT ip, path, referrer, user_agent, country, city, device, created_at "
        "FROM visits ORDER BY created_at DESC LIMIT 100"
    ).fetchall()
    visitor_list = []
    for v in visitors:
        visitor_list.append({
            "ip": v["ip"],
            "path": v["path"],
            "referrer": v["referrer"],
            "user_agent": v["user_agent"],
            "country": v["country"],
            "city": v["city"],
            "device": v["device"],
            "created_at": v["created_at"],
        })

    thirty_days_ago = time.time() - (30 * 86400)
    daily = conn.execute(
        "SELECT date(created_at, 'unixepoch') as day, COUNT(*) as cnt "
        "FROM visits WHERE created_at>=? GROUP BY day ORDER BY day",
        (thirty_days_ago,)).fetchall()

    countries = conn.execute(
        "SELECT country, COUNT(*) as cnt FROM visits WHERE country!='' "
        "GROUP BY country ORDER BY cnt DESC LIMIT 10"
    ).fetchall()

    devices = conn.execute(
        "SELECT device, COUNT(*) as cnt FROM visits WHERE device!='' "
        "GROUP BY device ORDER BY cnt DESC LIMIT 10"
    ).fetchall()

    # Message stats from HF persistent storage
    hf_msgs = _hf_load_messages()
    messages_total = len(hf_msgs)
    messages_unread = sum(1 for m in hf_msgs if not m.get("read"))

    # Month visits from HF
    import datetime
    vstats = _hf_load_visits()
    month_visits = 0
    by_day = vstats.get("by_day", {})
    for i in range(30):
        d = (datetime.datetime.utcnow() - datetime.timedelta(days=i)).strftime("%Y-%m-%d")
        month_visits += by_day.get(d, 0)

    conn.close()
    return {
        "ok": True,
        "visits_month": month_visits,
        "messages_total": messages_total,
        "messages_unread": messages_unread,
        "most_viewed_projects": [],
        "visitors": visitor_list,
        "daily_visits": [{"day": d["day"], "count": d["cnt"]} for d in daily],
        "top_countries": [{"country": c["country"], "count": c["cnt"]} for c in countries],
        "top_devices": [{"device": d["device"], "count": d["cnt"]} for d in devices],
    }


# --- Admin profile ---
@app.put("/api/admin/profile")
async def admin_update_profile(body: ProfileUpdate, authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    conn = get_db()
    conn.execute("""UPDATE profile SET name=?, title=?, bio=?, avatar_url=?, resume_url=?,
                    email_public=?, github_url=?, facebook_url=?, linkedin_url=?, location=?,
                    updated_at=? WHERE id=1""",
                  (body.name, body.title, body.bio, body.avatar_url, body.resume_url,
                   body.email_public, body.github_url, body.facebook_url, body.linkedin_url,
                   body.location, time.time()))
    conn.commit()
    conn.close()
    return {"ok": True}


# --- Admin projects ---
@app.post("/api/admin/projects")
async def admin_create_project(body: ProjectCreate, authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    tech_json = body.tech if body.tech.startswith("[") else json.dumps(
        [t.strip() for t in body.tech.split(",") if t.strip()])
    conn = get_db()
    c = conn.cursor()
    c.execute("""INSERT INTO projects (title, description, long_description, role, image_url,
                 tech, github_url, demo_url, featured, hidden, sort_order)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
              (body.title, body.description, body.long_description, body.role, body.image_url,
               tech_json, body.github_url, body.demo_url, int(body.featured), int(body.hidden),
               body.sort_order))
    conn.commit()
    pid = c.lastrowid
    conn.close()
    return {"ok": True, "id": pid}


@app.put("/api/admin/projects/{pid}")
async def admin_update_project(pid: int, body: ProjectUpdate, authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    tech_json = body.tech if body.tech.startswith("[") else json.dumps(
        [t.strip() for t in body.tech.split(",") if t.strip()])
    conn = get_db()
    conn.execute("""UPDATE projects SET title=?, description=?, long_description=?, role=?,
                    image_url=?, tech=?, github_url=?, demo_url=?, featured=?, hidden=?,
                    sort_order=? WHERE id=?""",
                  (body.title, body.description, body.long_description, body.role, body.image_url,
                   tech_json, body.github_url, body.demo_url, int(body.featured), int(body.hidden),
                   body.sort_order, pid))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/admin/projects/{pid}")
async def admin_delete_project(pid: int, authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    conn = get_db()
    conn.execute("DELETE FROM projects WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    return {"ok": True}


# --- Admin messages ---
@app.get("/api/admin/messages")
async def admin_list_messages(authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    # Load from HF Hub (persistent) and merge with local SQLite
    hf_msgs = _hf_load_messages()
    conn = get_db()
    local_rows = conn.execute("SELECT * FROM messages ORDER BY created_at DESC").fetchall()
    conn.close()
    # Merge: use HF as source of truth, add any local-only messages
    hf_times = {m.get("created_at") for m in hf_msgs}
    for row in local_rows:
        d = dict(row)
        if d.get("created_at") not in hf_times:
            hf_msgs.append(d)
    hf_msgs.sort(key=lambda m: m.get("created_at", 0), reverse=True)
    return {"ok": True, "messages": hf_msgs}


@app.put("/api/admin/messages/{mid}")
async def admin_update_message(mid: int, body: MessageReadIn, authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    conn = get_db()
    conn.execute("UPDATE messages SET read=? WHERE id=?", (int(body.read), mid))
    conn.commit()
    conn.close()
    # Also update in HF persistent storage
    msgs = _hf_load_messages()
    for m in msgs:
        if m.get("id") == mid:
            m["read"] = int(body.read)
    _hf_save_messages(msgs)
    return {"ok": True}


@app.delete("/api/admin/messages/{mid}")
async def admin_delete_message(mid: int, authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    conn = get_db()
    conn.execute("DELETE FROM messages WHERE id=?", (mid,))
    conn.commit()
    conn.close()
    # Also remove from HF persistent storage
    msgs = _hf_load_messages()
    msgs = [m for m in msgs if m.get("id") != mid]
    _hf_save_messages(msgs)
    return {"ok": True}


# --- Admin testimonials ---
@app.post("/api/admin/testimonials")
async def admin_create_testimonial(body: TestimonialCreate, authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO testimonials (quote, author, role, avatar_url, hidden, sort_order, created_at) VALUES (?,?,?,?,?,?,?)",
              (body.quote, body.author, body.role, body.avatar_url, int(body.hidden), body.sort_order, time.time()))
    conn.commit()
    tid = c.lastrowid
    conn.close()
    return {"ok": True, "id": tid}


@app.put("/api/admin/testimonials/{tid}")
async def admin_update_testimonial(tid: int, body: TestimonialUpdate,
                                    authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    conn = get_db()
    conn.execute(
        "UPDATE testimonials SET quote=?, author=?, role=?, avatar_url=?, hidden=?, sort_order=? WHERE id=?",
        (body.quote, body.author, body.role, body.avatar_url, int(body.hidden), body.sort_order, tid))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/admin/testimonials/{tid}")
async def admin_delete_testimonial(tid: int, authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    conn = get_db()
    conn.execute("DELETE FROM testimonials WHERE id=?", (tid,))
    conn.commit()
    conn.close()
    return {"ok": True}


# --- Admin bookings ---
@app.delete("/api/_admin/bookings/{date}")
async def admin_delete_booking(date: str, authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    conn = get_db()
    conn.execute("DELETE FROM bookings WHERE date=?", (date,))
    conn.commit()
    conn.close()
    return {"ok": True}
