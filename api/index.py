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


def _hf_load_messages() -> list:
    try:
        r = httpx.get(
            f"https://huggingface.co/datasets/{_HF_REPO}/resolve/main/{_HF_FILE}",
            headers=_hf_headers, timeout=10,
        )
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return []


def _hf_save_messages(messages: list):
    try:
        httpx.post(
            f"https://huggingface.co/api/datasets/{_HF_REPO}/commit/main",
            headers={**_hf_headers, "Content-Type": "application/json"},
            json={
                "summary": "update messages",
                "files": [{"path": _HF_FILE, "content": json.dumps(messages, default=str)}],
            },
            timeout=15,
        )
    except Exception:
        pass


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


# --- Chat (proxy to OpenAI-compatible API) ---
@app.post("/api/chat")
async def chat(body: ChatIn):
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return {"reply": "Chat is temporarily unavailable. Please try again later."}
    msgs = []
    for m in body.messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role in ("user", "assistant", "system"):
            msgs.append({"role": role, "content": content})
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": "gpt-4o-mini", "messages": msgs, "max_tokens": 1024}
            )
            data = resp.json()
            reply = data.get("choices", [{}])[0].get("message", {}).get("content",
                    "Sorry, I couldn't generate a response.")
            return {"reply": reply}
    except Exception:
        return {"reply": "Chat is temporarily unavailable. Please try again later."}


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
    # Dedup: same IP within last 30 minutes
    cutoff = time.time() - 1800
    existing = conn.execute("SELECT id FROM visits WHERE ip=? AND created_at>?", (ip, cutoff)).fetchone()
    if not existing:
        conn.execute(
            "INSERT INTO visits (ip, path, referrer, user_agent, country, city, device, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (ip, body.path, body.referrer, ua, country, city, device, time.time()))
        conn.commit()

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
    conn = get_db()
    total_visits = conn.execute("SELECT COUNT(*) FROM visits").fetchone()[0]
    today_start = int(time.time()) - (int(time.time()) % 86400)
    today_visits = conn.execute("SELECT COUNT(*) FROM visits WHERE created_at>=?", (today_start,)).fetchone()[0]
    total_messages = conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
    unread_messages = conn.execute("SELECT COUNT(*) FROM messages WHERE read=0").fetchone()[0]
    total_bookings = conn.execute("SELECT COUNT(*) FROM bookings").fetchone()[0]
    total_projects = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
    total_scores = conn.execute("SELECT COUNT(*) FROM scores").fetchone()[0]
    conn.close()
    return {
        "ok": True,
        "total_visits": total_visits,
        "today_visits": today_visits,
        "total_messages": total_messages,
        "unread_messages": unread_messages,
        "total_bookings": total_bookings,
        "total_projects": total_projects,
        "total_scores": total_scores,
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

    conn.close()
    return {
        "ok": True,
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
