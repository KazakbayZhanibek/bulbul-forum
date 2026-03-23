from fastapi import FastAPI, HTTPException, Depends, status, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta
from jose import JWTError, jwt
import bcrypt as _bcrypt
import sqlite3
import uuid, os, json, time

app = FastAPI(title="Forum API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

SECRET_KEY = "forum-super-secret-key-2025"
ALGORITHM  = "HS256"
TOKEN_EXPIRE_HOURS = 24 * 7
PAGE_SIZE = 10
# На деплое база хранится в /data/forum.db (Railway volume)
# Локально — в домашней папке
DB_PATH = os.environ.get('DB_PATH', os.path.join(os.path.expanduser("~"), "forum.db"))

online_users = {}
ONLINE_TIMEOUT = 120

class pwd_ctx:
    @staticmethod
    def hash(p): return _bcrypt.hashpw(p.encode(), _bcrypt.gensalt()).decode()
    @staticmethod
    def verify(p, h): return _bcrypt.checkpw(p.encode(), h.encode())

oauth2 = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=False)

def mark_online(u): online_users[u] = time.time()
def get_online_count(): return sum(1 for t in online_users.values() if time.time()-t < ONLINE_TIMEOUT)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def init_db():
    conn = get_db(); cur = conn.cursor()
    cur.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user', bio TEXT DEFAULT '', avatar TEXT DEFAULT '',
            created_at TEXT NOT NULL, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS tag_subscriptions (
            user_id TEXT NOT NULL, tag TEXT NOT NULL,
            PRIMARY KEY (user_id, tag)
        );
        CREATE TABLE IF NOT EXISTS posts (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
            author_id TEXT NOT NULL, author TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general',
            tags TEXT DEFAULT '[]', created_at TEXT NOT NULL, likes INTEGER NOT NULL DEFAULT 0,
            views INTEGER NOT NULL DEFAULT 0, image_url TEXT DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY, post_id TEXT NOT NULL, parent_id TEXT DEFAULT NULL,
            author_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL,
            created_at TEXT NOT NULL, likes INTEGER NOT NULL DEFAULT 0, image_url TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS comment_likes (
            user_id TEXT NOT NULL, comment_id TEXT NOT NULL, PRIMARY KEY (user_id, comment_id)
        );
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
            message TEXT NOT NULL, post_id TEXT, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bookmarks (
            user_id TEXT NOT NULL, post_id TEXT NOT NULL, created_at TEXT NOT NULL,
            PRIMARY KEY (user_id, post_id)
        );
        CREATE TABLE IF NOT EXISTS follows (
            follower_id TEXT NOT NULL, following_id TEXT NOT NULL,
            created_at TEXT NOT NULL, PRIMARY KEY (follower_id, following_id)
        );
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
            body TEXT NOT NULL, created_at TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0,
            deleted INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
            group_id TEXT DEFAULT NULL
        );
        CREATE TABLE IF NOT EXISTS message_reactions (
            msg_id TEXT NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL,
            PRIMARY KEY (msg_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT DEFAULT '',
            created_by TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS group_members (
            group_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at TEXT NOT NULL,
            PRIMARY KEY (group_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS polls (
            id TEXT PRIMARY KEY, post_id TEXT NOT NULL UNIQUE,
            question TEXT NOT NULL, options TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS poll_votes (
            user_id TEXT NOT NULL, poll_id TEXT NOT NULL, option_idx INTEGER NOT NULL,
            PRIMARY KEY (user_id, poll_id)
        );
        CREATE TABLE IF NOT EXISTS history (
            user_id TEXT NOT NULL, post_id TEXT NOT NULL, viewed_at TEXT NOT NULL,
            PRIMARY KEY (user_id, post_id)
        );
        CREATE TABLE IF NOT EXISTS post_likes (
            user_id TEXT NOT NULL, post_id TEXT NOT NULL,
            PRIMARY KEY (user_id, post_id)
        );
        CREATE TABLE IF NOT EXISTS typing_status (
            user_id TEXT NOT NULL, chat_partner TEXT NOT NULL,
            updated_at TEXT NOT NULL, PRIMARY KEY (user_id, chat_partner)
        );
        CREATE TABLE IF NOT EXISTS user_status (
            user_id TEXT PRIMARY KEY, status TEXT DEFAULT 'online',
            last_seen TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS post_drafts (
            user_id TEXT NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id)
        );
        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL, target_type TEXT NOT NULL,
            target_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL,
            resolved INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS typing_status (
            username TEXT PRIMARY KEY, typing_to TEXT NOT NULL, updated_at TEXT NOT NULL
        );
    """)
    conn.commit()

    # migrations
    migrations = [
        ("posts","pinned","INTEGER NOT NULL DEFAULT 0"),
        ("messages","deleted","INTEGER NOT NULL DEFAULT 0"),
        ("messages","pinned","INTEGER NOT NULL DEFAULT 0"),
        ("messages","group_id","TEXT DEFAULT NULL"),
    ]
    for col in migrations:
        try: cur.execute(f"ALTER TABLE {col[0]} ADD COLUMN {col[1]} {col[2]}"); conn.commit()
        except: pass

    # Migration: add xp/level columns if not exist
    try: cur.execute("ALTER TABLE users ADD COLUMN xp INTEGER DEFAULT 0")
    except: pass
    try: cur.execute("ALTER TABLE users ADD COLUMN level INTEGER DEFAULT 1")
    except: pass
    cur.execute("SELECT 1 FROM users WHERE username='admin'")
    if not cur.fetchone():
        cur.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)",
            (str(uuid.uuid4())[:8],"admin",pwd_ctx.hash("admin123"),"admin","Администратор форума","",datetime.now().isoformat()))
        conn.commit()

    cur.execute("SELECT 1 FROM posts LIMIT 1")
    if not cur.fetchone():
        cur.execute("SELECT id FROM users WHERE username='admin'")
        aid = cur.fetchone()[0]
        seed = [
            ("p1","Добро пожаловать в форум","Здесь мы обсуждаем всё — от дизайна до кода.",aid,"admin","general",'["форум","общее"]',"2025-03-10T09:00:00",12,84,"",1),
            ("p2","Почему минимализм в UI — это сложно","Минимализм — это про каждый пиксель.",aid,"admin","design",'["дизайн","ui"]',"2025-03-11T14:22:00",31,210,"",0),
            ("p3","FastAPI vs Django — что выбрать?","Сравниваю два фреймворка.",aid,"admin","tech",'["python","backend"]',"2025-03-12T18:05:00",45,390,"",0),
        ]
        cur.executemany("INSERT INTO posts VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", seed)
        conn.commit()
    cur.close(); conn.close()

init_db()

PKEYS = ["id","title","body","author_id","author","category","tags","created_at","likes","views","image_url","pinned","author_avatar"]

def make_token(uid, username, role):
    exp = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode({"sub":uid,"username":username,"role":role,"exp":exp}, SECRET_KEY, ALGORITHM)

def get_current_user(token: str = Depends(oauth2)):
    if not token: return None
    try:
        d = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        u = {"id":d["sub"],"username":d["username"],"role":d["role"]}
        mark_online(u["username"]); return u
    except JWTError: return None

def require_user(user=Depends(get_current_user)):
    if not user: raise HTTPException(status.HTTP_401_UNAUTHORIZED,"Необходима авторизация")
    return user

def require_admin(user=Depends(require_user)):
    if user["role"]!="admin": raise HTTPException(403,"Только для администратора")
    return user

def row_to_dict(row, keys):
    if not row: return None
    d = dict(zip(keys, row))
    if "tags" in d:
        try: d["tags"] = json.loads(d["tags"])
        except: d["tags"] = []
    return d

# ─── MODELS ────────────────────────────────────────────────────
class RegisterData(BaseModel):
    username: str; password: str

class ProfileUpdate(BaseModel):
    bio: Optional[str]=""; avatar: Optional[str]=""

class PostCreate(BaseModel):
    title: str; body: str; category: str="general"
    tags: List[str]=[]; image_url: Optional[str]=""
    poll_question: Optional[str]=""; poll_options: Optional[List[str]]=[]

class PostUpdate(BaseModel):
    title: str; body: str; category: str
    tags: List[str]=[]; image_url: Optional[str]=""

class CommentCreate(BaseModel):
    body: str; parent_id: Optional[str]=None; image_url: Optional[str]=""

class MessageCreate(BaseModel):
    to_username: str; body: str

class GroupMessageCreate(BaseModel):
    group_id: str; body: str

class GroupCreate(BaseModel):
    name: str; member_usernames: List[str]

class PollVote(BaseModel):
    option_idx: int

class ReportCreate(BaseModel):
    target_type: str  # post, comment, message
    target_id: str
    reason: str

class RoleUpdate(BaseModel):
    role: str

# ─── XP SYSTEM ────────────────────────────────────────────────
def add_xp(conn, user_id: str, amount: int):
    """Начислить XP и пересчитать уровень."""
    try:
        conn.execute("UPDATE users SET xp=xp+? WHERE id=?", (amount, user_id))
        cur = conn.cursor()
        cur.execute("SELECT xp FROM users WHERE id=?", (user_id,))
        row = cur.fetchone()
        if row:
            new_level = max(1, int(row[0]**0.5) // 5 + 1)
            conn.execute("UPDATE users SET level=? WHERE id=?", (new_level, user_id))
        cur.close()
    except: pass

# ─── AUTH ──────────────────────────────────────────────────────
@app.post("/auth/register")
def register(data: RegisterData):
    if len(data.username)<3: raise HTTPException(400,"Имя минимум 3 символа")
    if len(data.password)<6: raise HTTPException(400,"Пароль минимум 6 символов")
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT 1 FROM users WHERE username=?",(data.username,))
    if cur.fetchone(): cur.close(); conn.close(); raise HTTPException(400,"Имя уже занято")
    uid=str(uuid.uuid4())[:8]
    cur.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?)",
        (uid,data.username,pwd_ctx.hash(data.password),"user","","",datetime.now().isoformat()))
    conn.commit(); cur.close(); conn.close()
    return {"access_token":make_token(uid,data.username,"user"),"token_type":"bearer","username":data.username,"role":"user"}

@app.post("/auth/login")
def login(form: OAuth2PasswordRequestForm=Depends()):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT id,username,password,role FROM users WHERE username=?",(form.username,))
    user=cur.fetchone(); cur.close(); conn.close()
    if not user or not pwd_ctx.verify(form.password,user[2]): raise HTTPException(400,"Неверный логин или пароль")
    return {"access_token":make_token(user[0],user[1],user[3]),"token_type":"bearer","username":user[1],"role":user[3]}

@app.get("/auth/me")
def me(user=Depends(require_user)): return user

# ─── USERS ─────────────────────────────────────────────────────
@app.get("/users/search")
def search_users(q: str=Query(...,min_length=1)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT id,username,bio,avatar,role,created_at FROM users WHERE username LIKE ? LIMIT 20",(f"%{q}%",))
    rows=cur.fetchall(); cur.close(); conn.close()
    return [dict(zip(["id","username","bio","avatar","role","created_at"],r)) for r in rows]

@app.get("/users/{username}")
def get_profile(username: str, user=Depends(get_current_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT id,username,bio,avatar,role,created_at,COALESCE(xp,0),COALESCE(level,1) FROM users WHERE username=?",(username,))
    u=cur.fetchone()
    if not u: cur.close(); conn.close(); raise HTTPException(404,"Пользователь не найден")
    cur.execute("SELECT id,title,category,tags,created_at,likes,views FROM posts WHERE author=? ORDER BY created_at DESC",(username,))
    posts=cur.fetchall()
    cur.execute("SELECT COUNT(*) FROM follows WHERE following_id=?",(u[0],))
    followers=cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM follows WHERE follower_id=?",(u[0],))
    following=cur.fetchone()[0]
    is_following=False
    if user:
        cur.execute("SELECT 1 FROM follows WHERE follower_id=? AND following_id=?",(user["id"],u[0]))
        is_following=bool(cur.fetchone())
    cur.close(); conn.close()
    ukeys=["id","username","bio","avatar","role","created_at","xp","level"]
    pkeys=["id","title","category","tags","created_at","likes","views"]
    return {**dict(zip(ukeys,u)),"posts":[row_to_dict(p,pkeys) for p in posts],"post_count":len(posts),
            "followers":followers,"following":following,"is_following":is_following}

@app.put("/users/me/profile")
def update_profile(data: ProfileUpdate, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("UPDATE users SET bio=?,avatar=? WHERE id=?",(data.bio,data.avatar,user["id"]))
    conn.commit(); cur.close(); conn.close()
    return {"ok":True}

# ─── FOLLOW ────────────────────────────────────────────────────
@app.post("/users/{username}/follow")
def toggle_follow(username: str, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT id FROM users WHERE username=?",(username,))
    target=cur.fetchone()
    if not target: cur.close(); conn.close(); raise HTTPException(404,"Не найдено")
    if target[0]==user["id"]: cur.close(); conn.close(); raise HTTPException(400,"Нельзя подписаться на себя")
    cur.execute("SELECT 1 FROM follows WHERE follower_id=? AND following_id=?",(user["id"],target[0]))
    if cur.fetchone():
        cur.execute("DELETE FROM follows WHERE follower_id=? AND following_id=?",(user["id"],target[0]))
        following=False
    else:
        cur.execute("INSERT INTO follows VALUES (?,?,?)",(user["id"],target[0],datetime.now().isoformat()))
        following=True
    conn.commit(); cur.close(); conn.close()
    return {"following":following}

# ─── BOOKMARKS ─────────────────────────────────────────────────
@app.post("/posts/{post_id}/bookmark")
def toggle_bookmark(post_id: str, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT 1 FROM bookmarks WHERE user_id=? AND post_id=?",(user["id"],post_id))
    if cur.fetchone():
        cur.execute("DELETE FROM bookmarks WHERE user_id=? AND post_id=?",(user["id"],post_id)); saved=False
    else:
        cur.execute("INSERT INTO bookmarks VALUES (?,?,?)",(user["id"],post_id,datetime.now().isoformat())); saved=True
    conn.commit(); cur.close(); conn.close()
    return {"saved":saved}

@app.get("/bookmarks")
def get_bookmarks(user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("""SELECT p.id,p.title,p.body,p.author_id,p.author,p.category,p.tags,p.created_at,p.likes,p.views,p.image_url,p.pinned,COALESCE(u.avatar,'')
        FROM posts p JOIN bookmarks b ON p.id=b.post_id LEFT JOIN users u ON u.username=p.author WHERE b.user_id=? ORDER BY b.created_at DESC""",(user["id"],))
    rows=cur.fetchall(); cur.close(); conn.close()
    return [row_to_dict(r,PKEYS) for r in rows]

@app.get("/history")
def get_history(user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("""SELECT p.id,p.title,p.body,p.author_id,p.author,p.category,p.tags,p.created_at,p.likes,p.views,p.image_url,p.pinned,COALESCE(u.avatar,'')
        FROM posts p JOIN history h ON p.id=h.post_id LEFT JOIN users u ON u.username=p.author WHERE h.user_id=? ORDER BY h.viewed_at DESC LIMIT 50""",(user["id"],))
    rows=cur.fetchall(); cur.close(); conn.close()
    return [row_to_dict(r,PKEYS) for r in rows]

@app.get("/feed")
def get_feed(user=Depends(require_user), page: int=1):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT following_id FROM follows WHERE follower_id=?",(user["id"],))
    ids=[r[0] for r in cur.fetchall()]
    if not ids: cur.close(); conn.close(); return {"posts":[],"total":0,"pages":1}
    placeholders=",".join("?"*len(ids))
    cur.execute(f"""SELECT p.id,p.title,p.body,p.author_id,p.author,p.category,p.tags,p.created_at,p.likes,p.views,p.image_url,p.pinned,COALESCE(u.avatar,'')
        FROM posts p LEFT JOIN users u ON u.username=p.author WHERE p.author_id IN ({placeholders}) ORDER BY p.created_at DESC""",(ids))
    all_rows=cur.fetchall(); total=len(all_rows)
    offset=(page-1)*PAGE_SIZE; rows=all_rows[offset:offset+PAGE_SIZE]
    cur.close(); conn.close()
    return {"posts":[row_to_dict(r,PKEYS) for r in rows],"total":total,"pages":max(1,(total+PAGE_SIZE-1)//PAGE_SIZE)}

# ─── DIRECT MESSAGES ───────────────────────────────────────────
@app.post("/messages")
def send_message(data: MessageCreate, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT id FROM users WHERE username=?",(data.to_username,))
    to=cur.fetchone()
    if not to: cur.close(); conn.close(); raise HTTPException(404,"Пользователь не найден")
    mid=str(uuid.uuid4())[:8]; now=datetime.now().isoformat()
    cur.execute("INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)",(mid,user["id"],to[0],data.body,now,0,0,0,None))
    conn.commit(); cur.close(); conn.close()
    return {"id":mid,"ok":True}

@app.get("/messages")
def get_conversations(user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("""SELECT DISTINCT CASE WHEN from_id=? THEN to_id ELSE from_id END as other_id
        FROM messages WHERE (from_id=? OR to_id=?) AND group_id IS NULL""",(user["id"],user["id"],user["id"]))
    other_ids=[r[0] for r in cur.fetchall()]
    result=[]
    for oid in other_ids:
        cur.execute("SELECT username,avatar FROM users WHERE id=?",(oid,))
        u=cur.fetchone()
        if not u: continue
        cur.execute("""SELECT body,created_at,from_id FROM messages WHERE ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))
            AND group_id IS NULL AND deleted=0 ORDER BY created_at DESC LIMIT 1""",(user["id"],oid,oid,user["id"]))
        last=cur.fetchone()
        cur.execute("SELECT COUNT(*) FROM messages WHERE from_id=? AND to_id=? AND read=0 AND deleted=0",(oid,user["id"]))
        unread=cur.fetchone()[0]
        result.append({"user_id":oid,"username":u[0],"avatar":u[1],"last_message":last[0] if last else "","last_at":last[1] if last else "","unread":unread})
    cur.close(); conn.close()
    return sorted(result,key=lambda x:x["last_at"],reverse=True)

@app.get("/messages/{username}")
def get_chat(username: str, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT id FROM users WHERE username=?",(username,))
    other=cur.fetchone()
    if not other: cur.close(); conn.close(); raise HTTPException(404,"Не найдено")
    oid=other[0]
    cur.execute("""SELECT m.id,m.from_id,m.to_id,m.body,m.created_at,m.read,u.username as from_username,m.deleted,m.pinned,COALESCE(u.avatar,'')
        FROM messages m JOIN users u ON m.from_id=u.id
        WHERE ((m.from_id=? AND m.to_id=?) OR (m.from_id=? AND m.to_id=?)) AND m.group_id IS NULL
        ORDER BY m.created_at""",(user["id"],oid,oid,user["id"]))
    msgs=cur.fetchall()
    # mark read
    cur.execute("UPDATE messages SET read=1 WHERE from_id=? AND to_id=? AND group_id IS NULL",(oid,user["id"]))
    conn.commit()
    keys=["id","from_id","to_id","body","created_at","read","from_username","deleted","pinned","from_avatar"]
    result=[]
    for m in msgs:
        d=dict(zip(keys,m))
        cur.execute("SELECT emoji,COUNT(*) FROM message_reactions WHERE msg_id=? GROUP BY emoji",(m[0],))
        d["reactions"]={r[0]:r[1] for r in cur.fetchall()}
        cur.execute("SELECT 1 FROM message_reactions WHERE msg_id=? AND user_id=?",(m[0],user["id"]))
        d["my_reaction"]=None
        cur.execute("SELECT emoji FROM message_reactions WHERE msg_id=? AND user_id=?",(m[0],user["id"]))
        r=cur.fetchone(); d["my_reaction"]=r[0] if r else None
        result.append(d)
    cur.close(); conn.close()
    return result

@app.delete("/messages/{msg_id}")
def delete_message(msg_id: str, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT from_id FROM messages WHERE id=?",(msg_id,))
    msg=cur.fetchone()
    if not msg: cur.close(); conn.close(); raise HTTPException(404,"Не найдено")
    if msg[0]!=user["id"]: cur.close(); conn.close(); raise HTTPException(403,"Нет прав")
    cur.execute("UPDATE messages SET deleted=1,body='Сообщение удалено' WHERE id=?",(msg_id,))
    conn.commit(); cur.close(); conn.close()
    return {"ok":True}

@app.post("/messages/{msg_id}/pin")
def pin_message(msg_id: str, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT from_id,to_id,pinned FROM messages WHERE id=?",(msg_id,))
    msg=cur.fetchone()
    if not msg: cur.close(); conn.close(); raise HTTPException(404,"Не найдено")
    if msg[0]!=user["id"] and msg[1]!=user["id"]:
        cur.close(); conn.close(); raise HTTPException(403,"Нет прав")
    new_pinned=0 if msg[2] else 1
    cur.execute("UPDATE messages SET pinned=? WHERE id=?",(new_pinned,msg_id))
    conn.commit(); cur.close(); conn.close()
    return {"pinned":bool(new_pinned)}

@app.get("/messages/unread/count")
def unread_messages(user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    # только личные (не групповые)
    cur.execute("SELECT COUNT(*) FROM messages WHERE to_id=? AND read=0 AND deleted=0 AND group_id IS NULL",(user["id"],))
    n=cur.fetchone()[0]; cur.close(); conn.close()
    return {"count":n}

@app.post("/messages/{msg_id}/react")
def react_message(msg_id: str, emoji: str=Query(...), user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT 1 FROM messages WHERE id=?",(msg_id,))
    if not cur.fetchone(): cur.close(); conn.close(); raise HTTPException(404,"Не найдено")
    cur.execute("SELECT emoji FROM message_reactions WHERE msg_id=? AND user_id=?",(msg_id,user["id"]))
    existing=cur.fetchone()
    if existing:
        if existing[0]==emoji:
            cur.execute("DELETE FROM message_reactions WHERE msg_id=? AND user_id=?",(msg_id,user["id"]))
        else:
            cur.execute("UPDATE message_reactions SET emoji=? WHERE msg_id=? AND user_id=?",(emoji,msg_id,user["id"]))
    else:
        cur.execute("INSERT INTO message_reactions VALUES (?,?,?)",(msg_id,user["id"],emoji))
    conn.commit()
    cur.execute("SELECT emoji,COUNT(*) FROM message_reactions WHERE msg_id=? GROUP BY emoji",(msg_id,))
    reactions={r[0]:r[1] for r in cur.fetchall()}
    cur.close(); conn.close()
    return {"reactions":reactions}

# ─── GROUP CHATS ───────────────────────────────────────────────
@app.post("/groups")
def create_group(data: GroupCreate, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    gid=str(uuid.uuid4())[:8]; now=datetime.now().isoformat()
    cur.execute("INSERT INTO groups VALUES (?,?,?,?,?)",(gid,data.name,"",user["id"],now))
    # add creator
    cur.execute("INSERT INTO group_members VALUES (?,?,?)",(gid,user["id"],now))
    # add members
    for uname in data.member_usernames:
        cur.execute("SELECT id FROM users WHERE username=?",(uname,))
        u=cur.fetchone()
        if u and u[0]!=user["id"]:
            try: cur.execute("INSERT INTO group_members VALUES (?,?,?)",(gid,u[0],now))
            except: pass
    conn.commit(); cur.close(); conn.close()
    return {"id":gid,"name":data.name,"ok":True}

@app.get("/groups")
def get_groups(user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("""SELECT g.id,g.name,g.avatar,g.created_by,g.created_at
        FROM groups g JOIN group_members gm ON g.id=gm.group_id WHERE gm.user_id=?""",(user["id"],))
    groups=cur.fetchall()
    result=[]
    for g in groups:
        gid=g[0]
        cur.execute("SELECT COUNT(*) FROM group_members WHERE group_id=?",(gid,))
        member_count=cur.fetchone()[0]
        cur.execute("SELECT body,created_at FROM messages WHERE group_id=? AND deleted=0 ORDER BY created_at DESC LIMIT 1",(gid,))
        last=cur.fetchone()
        cur.execute("SELECT COUNT(*) FROM messages WHERE group_id=? AND read=0 AND to_id=? AND deleted=0",(gid,user["id"]))
        unread=cur.fetchone()[0]
        result.append({"id":gid,"name":g[1],"avatar":g[2],"created_by":g[3],"created_at":g[4],
                       "member_count":member_count,"last_message":last[0] if last else "","last_at":last[1] if last else "","unread":unread})
    cur.close(); conn.close()
    return result

@app.get("/groups/{group_id}/messages")
def get_group_messages(group_id: str, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?",(group_id,user["id"]))
    if not cur.fetchone(): cur.close(); conn.close(); raise HTTPException(403,"Вы не в этой группе")
    cur.execute("""SELECT m.id,m.from_id,m.to_id,m.body,m.created_at,m.read,u.username,m.deleted,m.pinned,COALESCE(u.avatar,'')
        FROM messages m JOIN users u ON m.from_id=u.id WHERE m.group_id=? ORDER BY m.created_at""",(group_id,))
    msgs=cur.fetchall()
    keys=["id","from_id","to_id","body","created_at","read","from_username","deleted","pinned","from_avatar"]
    result=[]
    for m in msgs:
        d=dict(zip(keys,m))
        cur.execute("SELECT emoji,COUNT(*) FROM message_reactions WHERE msg_id=? GROUP BY emoji",(m[0],))
        d["reactions"]={r[0]:r[1] for r in cur.fetchall()}
        cur.execute("SELECT emoji FROM message_reactions WHERE msg_id=? AND user_id=?",(m[0],user["id"]))
        r=cur.fetchone(); d["my_reaction"]=r[0] if r else None
        result.append(d)
    cur.close(); conn.close()
    return result

@app.post("/groups/{group_id}/messages")
def send_group_message(group_id: str, data: GroupMessageCreate, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?",(group_id,user["id"]))
    if not cur.fetchone(): cur.close(); conn.close(); raise HTTPException(403,"Вы не в этой группе")
    mid=str(uuid.uuid4())[:8]; now=datetime.now().isoformat()
    cur.execute("INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)",(mid,user["id"],"group",data.body,now,0,0,0,group_id))
    conn.commit(); cur.close(); conn.close()
    return {"id":mid,"ok":True}

@app.get("/groups/{group_id}/members")
def get_group_members(group_id: str, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("""SELECT u.id,u.username,u.avatar,u.role FROM users u
        JOIN group_members gm ON u.id=gm.user_id WHERE gm.group_id=?""",(group_id,))
    rows=cur.fetchall(); cur.close(); conn.close()
    return [dict(zip(["id","username","avatar","role"],r)) for r in rows]

# ─── REPORTS ───────────────────────────────────────────────────
@app.post("/reports")
def create_report(data: ReportCreate, user=Depends(require_user)):
    if data.target_type not in ["post","comment","message"]:
        raise HTTPException(400,"Неверный тип")
    conn=get_db(); cur=conn.cursor()
    cur.execute("INSERT INTO reports VALUES (?,?,?,?,?,?,?)",
        (str(uuid.uuid4())[:8],user["id"],data.target_type,data.target_id,data.reason,datetime.now().isoformat(),0))
    conn.commit(); cur.close(); conn.close()
    return {"ok":True}

@app.get("/admin/reports")
def get_reports(user=Depends(require_admin)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("""SELECT r.id,r.reporter_id,u.username as reporter,r.target_type,r.target_id,r.reason,r.created_at,r.resolved
        FROM reports r JOIN users u ON r.reporter_id=u.id ORDER BY r.created_at DESC""")
    rows=cur.fetchall(); cur.close(); conn.close()
    keys=["id","reporter_id","reporter","target_type","target_id","reason","created_at","resolved"]
    return [dict(zip(keys,r)) for r in rows]

@app.post("/admin/reports/{report_id}/resolve")
def resolve_report(report_id: str, user=Depends(require_admin)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("UPDATE reports SET resolved=1 WHERE id=?",(report_id,))
    conn.commit(); cur.close(); conn.close()
    return {"ok":True}

# ─── POLLS ─────────────────────────────────────────────────────
@app.get("/polls/{post_id}")
def get_poll(post_id: str, user=Depends(get_current_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT id,question,options FROM polls WHERE post_id=?",(post_id,))
    poll=cur.fetchone()
    if not poll: cur.close(); conn.close(); return None
    options=json.loads(poll[2])
    votes=[]
    for i in range(len(options)):
        cur.execute("SELECT COUNT(*) FROM poll_votes WHERE poll_id=? AND option_idx=?",(poll[0],i))
        votes.append(cur.fetchone()[0])
    my_vote=None
    if user:
        cur.execute("SELECT option_idx FROM poll_votes WHERE poll_id=? AND user_id=?",(poll[0],user["id"]))
        r=cur.fetchone(); my_vote=r[0] if r else None
    cur.close(); conn.close()
    return {"id":poll[0],"question":poll[1],"options":options,"votes":votes,"my_vote":my_vote,"total":sum(votes)}

@app.post("/polls/{post_id}/vote")
def vote_poll(post_id: str, data: PollVote, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT id,options FROM polls WHERE post_id=?",(post_id,))
    poll=cur.fetchone()
    if not poll: cur.close(); conn.close(); raise HTTPException(404,"Опрос не найден")
    options=json.loads(poll[1])
    if data.option_idx<0 or data.option_idx>=len(options): raise HTTPException(400,"Неверный вариант")
    cur.execute("SELECT 1 FROM poll_votes WHERE poll_id=? AND user_id=?",(poll[0],user["id"]))
    if cur.fetchone(): cur.close(); conn.close(); raise HTTPException(400,"Уже проголосовали")
    cur.execute("INSERT INTO poll_votes VALUES (?,?,?)",(user["id"],poll[0],data.option_idx))
    conn.commit(); cur.close(); conn.close()
    return {"ok":True}

# ─── POSTS ─────────────────────────────────────────────────────
@app.get("/posts")
def get_posts(category: Optional[str]=None, search: Optional[str]=None, tag: Optional[str]=None, page: int=1, limit: int=PAGE_SIZE):
    conn=get_db(); cur=conn.cursor()
    q="SELECT p.id,p.title,p.body,p.author_id,p.author,p.category,p.tags,p.created_at,p.likes,p.views,p.image_url,p.pinned,COALESCE(u.avatar,'') FROM posts p LEFT JOIN users u ON u.username=p.author WHERE 1=1"
    params=[]
    if category and category!="all": q+=" AND p.category=?"; params.append(category)
    if search: q+=" AND (p.title LIKE ? OR p.body LIKE ?)"; params.extend([f"%{search}%"]*2)
    if tag:
        tag_lower = tag.lower().strip()
        tag_orig = tag.strip()
        # Ищем все варианты: с кавычками JSON, без, разный регистр
        q += """ AND (
            LOWER(p.tags) LIKE ? OR
            LOWER(p.tags) LIKE ? OR
            LOWER(p.tags) LIKE ? OR
            LOWER(p.tags) LIKE ?
        )"""
        params.extend([
            f'%"{tag_lower}"%',
            f'%{tag_lower}%',
            f'%"{tag_orig}"%',
            f'%{tag_orig}%',
        ])
    q+=" ORDER BY p.pinned DESC,p.created_at DESC"
    cur.execute(q,params); all_rows=cur.fetchall(); total=len(all_rows)
    offset=(page-1)*limit; rows=all_rows[offset:offset+limit]
    cur.close(); conn.close()
    return {"posts":[row_to_dict(r,PKEYS) for r in rows],"total":total,"page":page,"pages":max(1,(total+limit-1)//limit)}

@app.get("/posts/{post_id}")
def get_post(post_id: str, user=Depends(get_current_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT p.id,p.title,p.body,p.author_id,p.author,p.category,p.tags,p.created_at,p.likes,p.views,p.image_url,p.pinned,COALESCE(u.avatar,'') FROM posts p LEFT JOIN users u ON u.username=p.author WHERE p.id=?",(post_id,))
    post=cur.fetchone()
    if not post: cur.close(); conn.close(); raise HTTPException(404,"Не найдено")
    cur.execute("UPDATE posts SET views=views+1 WHERE id=?",(post_id,))
    if user:
        cur.execute("INSERT OR REPLACE INTO history VALUES (?,?,?)",(user["id"],post_id,datetime.now().isoformat()))
    bookmarked=False; liked_by_me=False
    if user:
        cur.execute("SELECT 1 FROM bookmarks WHERE user_id=? AND post_id=?",(user["id"],post_id))
        bookmarked=bool(cur.fetchone())
        cur.execute("SELECT 1 FROM post_likes WHERE user_id=? AND post_id=?",(user["id"],post_id))
        liked_by_me=bool(cur.fetchone())
    conn.commit(); result=row_to_dict(post,PKEYS); result["views"]+=1; result["bookmarked"]=bookmarked; result["liked_by_me"]=liked_by_me
    cur.close(); conn.close(); return result

@app.post("/posts")
def create_post(data: PostCreate, user=Depends(require_user)):
    post_id=str(uuid.uuid4())[:8]; now=datetime.now().isoformat()
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT avatar FROM users WHERE id=?",(user["id"],))
    ava_row=cur.fetchone()
    cur.execute("INSERT INTO posts VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (post_id,data.title,data.body,user["id"],user["username"],data.category,json.dumps(data.tags[:5]),now,0,0,data.image_url or "",0))
    add_xp(conn, user["id"], 10)  # +10 XP за новый пост
    if data.poll_question and data.poll_options and len(data.poll_options)>=2:
        poll_id=str(uuid.uuid4())[:8]
        cur.execute("INSERT INTO polls VALUES (?,?,?,?,?)",(poll_id,post_id,data.poll_question,json.dumps(data.poll_options[:6]),now))
    conn.commit(); cur.close(); conn.close()
    return {"id":post_id,"title":data.title,"body":data.body,"author_id":user["id"],"author":user["username"],
            "category":data.category,"tags":data.tags,"created_at":now,"likes":0,"views":0,
            "image_url":data.image_url or "","pinned":0,"author_avatar":ava_row[0] if ava_row else ""}

@app.put("/posts/{post_id}")
def update_post(post_id: str, data: PostUpdate, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT author_id FROM posts WHERE id=?",(post_id,))
    post=cur.fetchone()
    if not post: cur.close(); conn.close(); raise HTTPException(404,"Не найдено")
    if post[0]!=user["id"] and user["role"]!="admin": cur.close(); conn.close(); raise HTTPException(403,"Нет прав")
    cur.execute("UPDATE posts SET title=?,body=?,category=?,tags=?,image_url=? WHERE id=?",
                (data.title,data.body,data.category,json.dumps(data.tags[:5]),data.image_url or "",post_id))
    conn.commit(); cur.close(); conn.close(); return {"ok":True}

@app.delete("/posts/{post_id}")
def delete_post(post_id: str, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT author_id FROM posts WHERE id=?",(post_id,))
    post=cur.fetchone()
    if not post: cur.close(); conn.close(); raise HTTPException(404,"Не найдено")
    if post[0]!=user["id"] and user["role"]!="admin": cur.close(); conn.close(); raise HTTPException(403,"Нет прав")
    cur.execute("DELETE FROM posts WHERE id=?",(post_id,))
    cur.execute("DELETE FROM comments WHERE post_id=?",(post_id,))
    cur.execute("DELETE FROM notifications WHERE post_id=?",(post_id,))
    cur.execute("DELETE FROM bookmarks WHERE post_id=?",(post_id,))
    cur.execute("DELETE FROM polls WHERE post_id=?",(post_id,))
    conn.commit(); cur.close(); conn.close(); return {"ok":True}

@app.post("/posts/{post_id}/like")
def like_post(post_id: str, user=Depends(get_current_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT 1 FROM posts WHERE id=?",(post_id,))
    if not cur.fetchone(): cur.close(); conn.close(); raise HTTPException(404,"Не найдено")
    if user:
        cur.execute("SELECT 1 FROM post_likes WHERE user_id=? AND post_id=?",(user["id"],post_id))
        if cur.fetchone():
            cur.execute("DELETE FROM post_likes WHERE user_id=? AND post_id=?",(user["id"],post_id))
            cur.execute("UPDATE posts SET likes=MAX(0,likes-1) WHERE id=?",(post_id,)); liked=False
        else:
            cur.execute("INSERT OR IGNORE INTO post_likes VALUES (?,?)",(user["id"],post_id))
            cur.execute("UPDATE posts SET likes=likes+1 WHERE id=?",(post_id,)); liked=True
    else:
        cur.execute("UPDATE posts SET likes=likes+1 WHERE id=?",(post_id,)); liked=True
    conn.commit()
    cur.execute("SELECT likes FROM posts WHERE id=?",(post_id,))
    likes=cur.fetchone()[0]; cur.close(); conn.close()
    return {"likes":likes,"liked":liked}

@app.post("/posts/{post_id}/pin")
def pin_post(post_id: str, user=Depends(require_admin)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT pinned FROM posts WHERE id=?",(post_id,))
    row=cur.fetchone()
    if not row: cur.close(); conn.close(); raise HTTPException(404,"Не найдено")
    new_pinned=0 if row[0] else 1
    cur.execute("UPDATE posts SET pinned=? WHERE id=?",(new_pinned,post_id))
    conn.commit(); cur.close(); conn.close(); return {"pinned":bool(new_pinned)}

# ─── COMMENTS ──────────────────────────────────────────────────
@app.get("/posts/{post_id}/comments")
def get_comments(post_id: str, user=Depends(get_current_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT id,post_id,parent_id,author_id,author,body,created_at,likes,image_url FROM comments WHERE post_id=? ORDER BY created_at",(post_id,))
    rows=cur.fetchall(); keys=["id","post_id","parent_id","author_id","author","body","created_at","likes","image_url"]
    result=[]
    for r in rows:
        d=dict(zip(keys,r))
        if user:
            cur.execute("SELECT 1 FROM comment_likes WHERE user_id=? AND comment_id=?",(user["id"],r[0]))
            d["liked_by_me"]=bool(cur.fetchone())
        else: d["liked_by_me"]=False
        result.append(d)
    cur.close(); conn.close(); return result

@app.post("/posts/{post_id}/comments")
def add_comment(post_id: str, data: CommentCreate, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT id,title,author_id FROM posts WHERE id=?",(post_id,))
    post=cur.fetchone()
    if not post: cur.close(); conn.close(); raise HTTPException(404,"Не найдено")
    cid=str(uuid.uuid4())[:8]; now=datetime.now().isoformat()
    cur.execute("INSERT INTO comments VALUES (?,?,?,?,?,?,?,?,?)",
                (cid,post_id,data.parent_id,user["id"],user["username"],data.body,now,0,data.image_url or ""))
    if post[2]!=user["id"]:
        cur.execute("INSERT INTO notifications VALUES (?,?,?,?,?,?,?)",
            (str(uuid.uuid4())[:8],post[2],"comment",f"{user['username']} ответил на ваш пост «{post[1][:40]}»",post_id,0,now))
    if data.parent_id:
        cur.execute("SELECT author_id FROM comments WHERE id=?",(data.parent_id,))
        parent=cur.fetchone()
        if parent and parent[0]!=user["id"] and parent[0]!=post[2]:
            cur.execute("INSERT INTO notifications VALUES (?,?,?,?,?,?,?)",
                (str(uuid.uuid4())[:8],parent[0],"reply",f"{user['username']} ответил на ваш комментарий",post_id,0,now))
    add_xp(conn, user["id"], 3)  # +3 XP за комментарий
    conn.commit(); cur.close(); conn.close()
    return {"id":cid,"post_id":post_id,"parent_id":data.parent_id,"author_id":user["id"],"author":user["username"],
            "body":data.body,"created_at":now,"likes":0,"image_url":data.image_url or "","liked_by_me":False}

@app.post("/comments/{comment_id}/like")
def like_comment(comment_id: str, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT 1 FROM comments WHERE id=?",(comment_id,))
    if not cur.fetchone(): cur.close(); conn.close(); raise HTTPException(404,"Не найдено")
    cur.execute("SELECT 1 FROM comment_likes WHERE user_id=? AND comment_id=?",(user["id"],comment_id))
    if cur.fetchone():
        cur.execute("DELETE FROM comment_likes WHERE user_id=? AND comment_id=?",(user["id"],comment_id))
        cur.execute("UPDATE comments SET likes=likes-1 WHERE id=?",(comment_id,)); liked=False
    else:
        cur.execute("INSERT INTO comment_likes VALUES (?,?)",(user["id"],comment_id))
        cur.execute("UPDATE comments SET likes=likes+1 WHERE id=?",(comment_id,)); liked=True
    conn.commit()
    cur.execute("SELECT likes FROM comments WHERE id=?",(comment_id,))
    likes=max(0,cur.fetchone()[0]); cur.close(); conn.close(); return {"likes":likes,"liked":liked}

@app.delete("/comments/{comment_id}")
def delete_comment(comment_id: str, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT author_id FROM comments WHERE id=?",(comment_id,))
    comment=cur.fetchone()
    if not comment: cur.close(); conn.close(); raise HTTPException(404,"Не найдено")
    if comment[0]!=user["id"] and user["role"]!="admin": cur.close(); conn.close(); raise HTTPException(403,"Нет прав")
    cur.execute("DELETE FROM comments WHERE id=? OR parent_id=?",(comment_id,comment_id))
    cur.execute("DELETE FROM comment_likes WHERE comment_id=?",(comment_id,))
    conn.commit(); cur.close(); conn.close(); return {"ok":True}

# ─── NOTIFICATIONS ─────────────────────────────────────────────
@app.get("/notifications")
def get_notifications(user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT id,user_id,type,message,post_id,read,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30",(user["id"],))
    rows=cur.fetchall(); cur.close(); conn.close()
    return [dict(zip(["id","user_id","type","message","post_id","read","created_at"],r)) for r in rows]

@app.post("/notifications/read")
def mark_read(user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("UPDATE notifications SET read=1 WHERE user_id=?",(user["id"],))
    conn.commit(); cur.close(); conn.close(); return {"ok":True}

@app.get("/notifications/count")
def notif_count(user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT COUNT(*) FROM notifications WHERE user_id=? AND read=0",(user["id"],))
    n=cur.fetchone()[0]; cur.close(); conn.close(); return {"count":n}

# ─── STATS ─────────────────────────────────────────────────────
@app.get("/stats")
def get_stats():
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT COUNT(*) FROM posts"); posts=cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM comments"); comments=cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM users"); members=cur.fetchone()[0]
    cur.close(); conn.close()
    return {"posts":posts,"comments":comments,"members":members,"online":get_online_count()}

# ─── TAG SUBSCRIPTIONS ────────────────────────────────────────
@app.get("/tags/subscriptions")
def get_tag_subscriptions(user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT tag FROM tag_subscriptions WHERE user_id=? ORDER BY tag",(user["id"],))
    tags=[r[0] for r in cur.fetchall()]
    cur.close(); conn.close()
    return {"tags": tags}

@app.post("/tags/subscribe/{tag}")
def subscribe_tag(tag: str, user=Depends(require_user)):
    tag=tag.strip().lower()
    if not tag: raise HTTPException(400,"Тег пустой")
    conn=get_db(); cur=conn.cursor()
    cur.execute("INSERT OR IGNORE INTO tag_subscriptions VALUES (?,?)",(user["id"],tag))
    conn.commit(); cur.close(); conn.close()
    return {"ok":True,"tag":tag}

@app.delete("/tags/subscribe/{tag}")
def unsubscribe_tag(tag: str, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("DELETE FROM tag_subscriptions WHERE user_id=? AND tag=?",(user["id"],tag.strip().lower()))
    conn.commit(); cur.close(); conn.close()
    return {"ok":True}

@app.get("/feed/tags")
def tag_feed(user=Depends(require_user), page: int=1):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT tag FROM tag_subscriptions WHERE user_id=?",(user["id"],))
    tags=[r[0] for r in cur.fetchall()]
    if not tags: cur.close(); conn.close(); return {"posts":[],"total":0,"pages":1}
    where=" OR ".join(["LOWER(p.tags) LIKE ?" for _ in tags])
    params=[f'%{t}%' for t in tags]
    cur.execute(f"""SELECT p.id,p.title,p.body,p.author_id,p.author,p.category,p.tags,
        p.created_at,p.likes,p.views,p.image_url,p.pinned,COALESCE(u.avatar,'')
        FROM posts p LEFT JOIN users u ON u.username=p.author
        WHERE {where} ORDER BY p.created_at DESC""", params)
    all_rows=cur.fetchall(); total=len(all_rows)
    offset=(page-1)*PAGE_SIZE; rows=all_rows[offset:offset+PAGE_SIZE]
    cur.close(); conn.close()
    return {{"posts":[row_to_dict(r,PKEYS) for r in rows],"total":total,"pages":max(1,(total+PAGE_SIZE-1)//PAGE_SIZE)}}

# ─── ADMIN ─────────────────────────────────────────────────────
@app.get("/admin/users")
def admin_get_users(user=Depends(require_admin)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT id,username,bio,avatar,role,created_at FROM users ORDER BY created_at DESC")
    rows=cur.fetchall(); cur.close(); conn.close()
    return [dict(zip(["id","username","bio","avatar","role","created_at"],r)) for r in rows]

@app.put("/admin/users/{user_id}/role")
def admin_set_role(user_id: str, data: RoleUpdate, user=Depends(require_admin)):
    if data.role not in ["user","admin"]: raise HTTPException(400,"Неверная роль")
    conn=get_db(); cur=conn.cursor()
    cur.execute("UPDATE users SET role=? WHERE id=?",(data.role,user_id))
    conn.commit(); cur.close(); conn.close(); return {"ok":True}

@app.delete("/admin/users/{user_id}")
def admin_delete_user(user_id: str, user=Depends(require_admin)):
    if user_id==user["id"]: raise HTTPException(400,"Нельзя удалить себя")
    conn=get_db(); cur=conn.cursor()
    for table in ["posts","comments","notifications","bookmarks","messages"]:
        col="author_id" if table in ["posts","comments"] else ("user_id" if table in ["notifications","bookmarks"] else "from_id")
        cur.execute(f"DELETE FROM {table} WHERE {col}=?",(user_id,))
    cur.execute("DELETE FROM follows WHERE follower_id=? OR following_id=?",(user_id,user_id))
    cur.execute("DELETE FROM users WHERE id=?",(user_id,))
    conn.commit(); cur.close(); conn.close(); return {"ok":True}
# ─── TRENDING ──────────────────────────────────────────────────
@app.get("/trending")
def get_trending():
    conn=get_db(); cur=conn.cursor()
    # посты за последние 7 дней, сортировка по лайкам+просмотрам
    from datetime import timedelta
    week_ago=(datetime.now()-timedelta(days=7)).isoformat()
    cur.execute("""SELECT p.id,p.title,p.body,p.author_id,p.author,p.category,p.tags,p.created_at,p.likes,p.views,p.image_url,p.pinned,COALESCE(u.avatar,'')
        FROM posts p LEFT JOIN users u ON u.username=p.author
        WHERE p.created_at > ? ORDER BY (p.likes*3 + p.views) DESC LIMIT 10""",(week_ago,))
    rows=cur.fetchall(); cur.close(); conn.close()
    return [row_to_dict(r,["id","title","body","author_id","author","category","tags","created_at","likes","views","image_url","pinned","author_avatar"]) for r in rows]

# ─── GLOBAL SEARCH ─────────────────────────────────────────────
@app.get("/search")
def global_search(q: str=Query(...,min_length=1)):
    conn=get_db(); cur=conn.cursor()
    like=f"%{q}%"
    cur.execute("""SELECT p.id,p.title,p.body,p.author_id,p.author,p.category,p.tags,p.created_at,p.likes,p.views,p.image_url,p.pinned,COALESCE(u.avatar,'')
        FROM posts p LEFT JOIN users u ON u.username=p.author
        WHERE p.title LIKE ? OR p.body LIKE ? OR p.tags LIKE ? ORDER BY p.created_at DESC LIMIT 15""",(like,like,like))
    posts=cur.fetchall()
    cur.execute("SELECT id,username,bio,avatar,role FROM users WHERE username LIKE ? LIMIT 8",(like,))
    users=cur.fetchall(); cur.close(); conn.close()
    pkeys=["id","title","body","author_id","author","category","tags","created_at","likes","views","image_url","pinned","author_avatar"]
    return {
        "posts":[row_to_dict(r,pkeys) for r in posts],
        "users":[dict(zip(["id","username","bio","avatar","role"],u)) for u in users]
    }

# ─── FORWARD MESSAGE ───────────────────────────────────────────
class ForwardMessage(BaseModel):
    msg_id: str
    to_username: str

@app.post("/messages/forward")
def forward_message(data: ForwardMessage, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT body FROM messages WHERE id=?",(data.msg_id,))
    msg=cur.fetchone()
    if not msg: cur.close(); conn.close(); raise HTTPException(404,"Сообщение не найдено")
    cur.execute("SELECT id FROM users WHERE username=?",(data.to_username,))
    to=cur.fetchone()
    if not to: cur.close(); conn.close(); raise HTTPException(404,"Пользователь не найден")
    mid=str(uuid.uuid4())[:8]; now=datetime.now().isoformat()
    forwarded_body=f"↩ Переслано: {msg[0]}"
    cur.execute("INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)",(mid,user["id"],to[0],forwarded_body,now,0,0,0,None))
    conn.commit(); cur.close(); conn.close()
    return {"id":mid,"ok":True}

# ─── POPULAR TAGS ───────────────────────────────────────────────
@app.get("/tags/popular")
def popular_tags():
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT tags FROM posts WHERE tags != '[]' ORDER BY created_at DESC LIMIT 200")
    rows=cur.fetchall(); cur.close(); conn.close()
    from collections import Counter
    tag_counts=Counter()
    for r in rows:
        try:
            tags=json.loads(r[0])
            for t in tags: tag_counts[t]+=1
        except: pass
    return [{"tag":t,"count":c} for t,c in tag_counts.most_common(30)]


# ─── USER STATUS ───────────────────────────────────────────────
class StatusUpdate(BaseModel):
    status: str  # online, away, dnd

@app.put("/users/me/status")
def set_status(data: StatusUpdate, user=Depends(require_user)):
    if data.status not in ["online","away","dnd","offline"]:
        raise HTTPException(400,"Неверный статус")
    conn=get_db(); cur=conn.cursor()
    now=datetime.now().isoformat()
    cur.execute("INSERT OR REPLACE INTO user_status VALUES (?,?,?)",(user["id"],data.status,now))
    conn.commit(); cur.close(); conn.close()
    return {"ok":True}

@app.get("/users/{username}/status")
def get_user_status(username: str):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT u.id FROM users WHERE u.username=?",(username,))
    u=cur.fetchone()
    if not u: cur.close(); conn.close(); raise HTTPException(404,"Не найдено")
    cur.execute("SELECT status,last_seen FROM user_status WHERE user_id=?",(u[0],))
    s=cur.fetchone(); cur.close(); conn.close()
    if not s: return {"status":"offline","last_seen":None}
    # check if recently online
    try:
        last=datetime.fromisoformat(s[1])
        diff=(datetime.now()-last).total_seconds()
        if diff < 120: return {"status":s[0],"last_seen":s[1],"online":True}
    except: pass
    return {"status":s[0],"last_seen":s[1],"online":False}

# ─── TYPING ────────────────────────────────────────────────────
@app.post("/messages/typing")
def set_typing(to_username: str=Query(...), user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT id FROM users WHERE username=?",(to_username,))
    to=cur.fetchone()
    if not to: cur.close(); conn.close(); raise HTTPException(404,"Не найдено")
    now=datetime.now().isoformat()
    cur.execute("INSERT OR REPLACE INTO typing_status VALUES (?,?,?)",(user["id"],to[0],now))
    conn.commit(); cur.close(); conn.close()
    return {"ok":True}

@app.get("/messages/typing/{username}")
def get_typing(username: str, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT id FROM users WHERE username=?",(username,))
    other=cur.fetchone()
    if not other: cur.close(); conn.close(); return {"typing":False}
    # Check if other person is typing to us
    cur.execute("SELECT updated_at FROM typing_status WHERE user_id=? AND chat_partner=?",(other[0],user["id"]))
    row=cur.fetchone(); cur.close(); conn.close()
    if not row: return {"typing":False}
    try:
        diff=(datetime.now()-datetime.fromisoformat(row[0])).total_seconds()
        return {"typing":diff<3}
    except: return {"typing":False}

# ─── DRAFT ─────────────────────────────────────────────────────
class DraftUpdate(BaseModel):
    content: str

@app.put("/drafts")
def save_draft(data: DraftUpdate, user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("INSERT OR REPLACE INTO post_drafts VALUES (?,?,?)",(user["id"],data.content,datetime.now().isoformat()))
    conn.commit(); cur.close(); conn.close()
    return {"ok":True}

@app.get("/drafts")
def get_draft(user=Depends(require_user)):
    conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT content,updated_at FROM post_drafts WHERE user_id=?",(user["id"],))
    row=cur.fetchone(); cur.close(); conn.close()
    if not row: return None
    return {"content":row[0],"updated_at":row[1]}

# ─── ADMIN EXTRAS ──────────────────────────────────────────────
@app.get("/admin/comments")
def admin_get_comments(user=Depends(require_admin), page: int=1):
    conn=get_db(); cur=conn.cursor()
    offset=(page-1)*30
    cur.execute("""SELECT c.id,c.post_id,c.author_id,c.author,c.body,c.created_at,c.likes
        FROM comments c ORDER BY c.created_at DESC LIMIT 30 OFFSET ?""",(offset,))
    rows=cur.fetchall()
    cur.execute("SELECT COUNT(*) FROM comments"); total=cur.fetchone()[0]
    cur.close(); conn.close()
    return {"comments":[dict(zip(["id","post_id","author_id","author","body","created_at","likes"],r)) for r in rows],"total":total}

@app.get("/admin/posts")
def admin_get_posts(user=Depends(require_admin), page: int=1, search: str=""):
    conn=get_db(); cur=conn.cursor()
    if search:
        cur.execute("""SELECT p.id,p.title,p.body,p.author_id,p.author,p.category,p.tags,p.created_at,p.likes,p.views,p.image_url,p.pinned,COALESCE(u.avatar,'')
            FROM posts p LEFT JOIN users u ON u.username=p.author WHERE p.title LIKE ? OR p.author LIKE ?
            ORDER BY p.created_at DESC LIMIT 30""",(f"%{search}%",f"%{search}%"))
    else:
        offset=(page-1)*30
        cur.execute("""SELECT p.id,p.title,p.body,p.author_id,p.author,p.category,p.tags,p.created_at,p.likes,p.views,p.image_url,p.pinned,COALESCE(u.avatar,'')
            FROM posts p LEFT JOIN users u ON u.username=p.author ORDER BY p.created_at DESC LIMIT 30 OFFSET ?""",(offset,))
    rows=cur.fetchall()
    cur.execute("SELECT COUNT(*) FROM posts"); total=cur.fetchone()[0]
    cur.close(); conn.close()
    return {"posts":[row_to_dict(r,PKEYS) for r in rows],"total":total}
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)