// ═══════════════════════════════════════════════════════════════
// BULBUL FORUM — app.js (полная перезапись)
// ═══════════════════════════════════════════════════════════════

// Auto-detect API URL: local vs deployed
const API = 'https://bulbul-forum-production.up.railway.app';

// ─── STATE ─────────────────────────────────────────────────────
let currentView = 'list';
let currentPostId = null;
let editingPostId = null;
const postsCache = {};  // кэш постов для безопасного редактирования
let currentCat = 'all';
let currentSearch = '';
let currentTag = '';
let currentPage = 1;
let totalPages = 1;
let authMode = 'login';
let notifInterval = null;
let msgInterval = null;
let chatPollInterval = null;
let typingCheckInterval = null;
let currentChatUser = null;
let currentGroupId = null;
let avatarCache = {};
let searchTimer = null;
let userSearchTimer = null;
let globalSearchTimer = null;
let emojiPickerOpen = false;

// ─── EMOJI ─────────────────────────────────────────────────────
const EMOJIS = {
  'Часто используемые': ['😀','😂','🤣','😍','🥰','😎','🤔','😅','😭','😤','🥳','🤯','😱','😴','🥺','😏','😒','🤗','😬','🙄','😇','🤩','🥸','😤','🫡','🫥','🫠','🥹','😈'],
  'Жесты': ['👍','👎','👏','🙌','🤝','🤜','🤛','✊','👋','🤚','🖐','✌️','🤞','🤟','🤙','💪','🦾','👐','🙏','🫶','🫰','🫳','🫴','🫵','❤️‍🔥'],
  'Сердца': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💕','💞','💓','💗','💖','💘','💝','💔','❣️','❤️‍🩹','🩷','🩶'],
  'Природа': ['🌸','🌺','🌻','🌹','🌷','🍀','🌿','🌊','🌈','☀️','🌙','⭐','🌟','💫','⚡','🔥','❄️','🌪️','🌧️','🦋'],
  'Еда': ['🍕','🍔','🌮','🍜','🍣','🍩','🎂','🍫','☕','🧋','🍺','🥂','🍷','🧃','🍰','🥗','🍱','🥩','🥐'],
  'Активности': ['🎮','⚽','🏀','🎯','🏆','🎵','🎶','🎨','📚','💻','📱','🚀','✈️','🚗','🎉','🎊','🎁','🎬','🎤','🎭'],
  'Животные': ['🐶','🐱','🦊','🐻','🐼','🐨','🦁','🐯','🐮','🐸','🐙','🦋','🦄','🐳','🦋','🦊','🦝','🦥','🦦','🐾'],
  'Символы': ['💯','✨','💥','💢','💬','💡','⚡','🌀','♾️','✅','❌','⭕','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪'],
};

const VIEWS = ['listView','postView','profileView','usersView','notifView','feedView','bookmarksView','historyView','messagesView','chatView','trendingView','searchView'];

// ─── AUTH ───────────────────────────────────────────────────────
const getToken = () => localStorage.getItem('token');
const getUser  = () => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } };
function setAuth(token, user) { localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)); }
function clearAuth() { localStorage.removeItem('token'); localStorage.removeItem('user'); }
function authHeaders() {
  const t = getToken();
  return t ? {'Authorization':`Bearer ${t}`,'Content-Type':'application/json'} : {'Content-Type':'application/json'};
}

// ─── UTILS ──────────────────────────────────────────────────────
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return String(s||'').replace(/'/g,"\\'").replace(/\n/g,' ').replace(/"/g,'&quot;'); }
function buildAvatar(avatar, username, size=28) {
  const s = size;
  if (avatar && (avatar.startsWith('data:') || avatar.startsWith('http')))
    return `<img src="${escHtml(avatar)}" style="width:${s}px;height:${s}px;border-radius:50%;object-fit:cover;flex-shrink:0">`;
  const char = (avatar || username[0] || '?').toUpperCase();
  return `<span style="width:${s}px;height:${s}px;border-radius:50%;background:var(--surface2);border:1px solid var(--border);display:inline-flex;align-items:center;justify-content:center;font-size:${Math.max(9,Math.floor(s*0.38))}px;font-weight:500;flex-shrink:0;overflow:hidden">${char}</span>`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d=new Date(iso), now=new Date(), diff=(now-d)/1000;
  if(diff<60) return 'только что';
  if(diff<3600) return Math.floor(diff/60)+' мин назад';
  if(diff<86400) return Math.floor(diff/3600)+' ч назад';
  if(diff<604800) return Math.floor(diff/86400)+' д назад';
  return d.toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
}
function catLabel(cat) { return {general:'Общее',design:'Дизайн',tech:'Техно'}[cat]||cat; }
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id='toast'; t.className='toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
function animateNum(id, target) {
  const el = document.getElementById(id); if (!el) return;
  let n=0; const step=Math.ceil(target/30);
  const ti = setInterval(() => { n=Math.min(n+step,target); el.textContent=n; if(n>=target)clearInterval(ti); },30);
}

// ─── THEME ──────────────────────────────────────────────────────
function toggleTheme() {
  const next = document.documentElement.dataset.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme=next;
  localStorage.setItem('theme',next);
}
function applyTheme(t) { document.documentElement.dataset.theme=t; }

// ─── VIEWS ──────────────────────────────────────────────────────
function showViewEx(id) {
  VIEWS.forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = v===id ? 'block' : 'none';
  });
  const sb = document.getElementById('statsBar');
  if (sb) sb.style.display = id==='listView' ? 'flex' : 'none';
  window.scrollTo({top:0,behavior:'smooth'});
}

function showList() {
  currentView='list'; currentPostId=null;
  showViewEx('listView');
  loadPosts(); loadStats(); loadTagsCloud();
}

// ─── MODALS ─────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id)?.classList.add('open'); document.body.style.overflow='hidden'; }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); document.body.style.overflow=''; }
function hideModalClick(e,id) { if(e.target===document.getElementById(id)) closeModal(id); }

// ─── INIT ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'));
  renderAuthArea();
  loadStats();
  loadPosts();
  loadTagsCloud();
  // Обсудить новость: форум сам создаёт пост из URL-параметров
  (async () => {
    const p = new URLSearchParams(location.search);
    if (!p.get('discuss')) return;
    history.replaceState({}, '', location.pathname);

    const token = getToken();
    if (!token) {
      // Показываем модалку входа, потом сохраняем параметры для повтора
      sessionStorage.setItem('pendingDiscuss', location.search);
      setTimeout(() => openAuthModal('login'), 800);
      return;
    }

    const postData = {
      title:    p.get('title') || 'Обсуждение новости',
      body:     p.get('body')  || '',
      category: p.get('category') || 'general',
      tags:     (p.get('tags') || 'новости').split(',').map(t=>t.trim()).filter(Boolean),
      image_url: p.get('image') || '',
      poll_question: '',
      poll_options:  [],
    };

    try {
      const r = await fetch(`${API}/posts`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(postData),
      });
      if (!r.ok) {
        showToast('Не удалось создать пост — попробуйте вручную');
        return;
      }
      const post = await r.json();
      showToast('Пост создан! Открываем обсуждение…');
      // Ждём loadPosts, потом открываем
      setTimeout(() => openPost(post.id), 1200);
    } catch(e) {
      console.error('[forum discuss]', e);
      showToast('Ошибка создания поста');
    }
  })();
  document.addEventListener('click', e => {
    if (!e.target.closest('.user-wrap')) document.querySelector('.user-dropdown')?.classList.remove('open');
    if (!e.target.closest('.emoji-trigger-btn') && !e.target.closest('.emoji-picker-panel')) {
      const p = document.getElementById('emojiPickerPanel');
      if (p) { p.style.display='none'; emojiPickerOpen=false; }
    }
  });
  document.addEventListener('keydown', e => {
    if(e.key==='Escape') ['authModal','postModal','editModal','profileModal','createGroupModal'].forEach(closeModal);
  });
});

// ─── AUTH AREA ──────────────────────────────────────────────────
function renderAuthArea() {
  // Show/hide tag feed button based on auth
  const tagBtn = document.getElementById('tagFeedBtn');
  if (tagBtn) tagBtn.style.display = getToken() ? 'inline-block' : 'none';
  const user = getUser();
  const area = document.getElementById('authArea');
  if (!area) return;
  if (!user) {
    area.innerHTML = `<div style="display:flex;gap:8px">
      <button class="btn-new" style="background:none;border:1px solid var(--border);color:var(--text)" onclick="openAuthModal('login')">Войти</button>
      <button class="btn-new" onclick="openAuthModal('register')">Регистрация</button>
    </div>`;
    stopPolling();
  } else {
    const ava = user.avatar && (user.avatar.startsWith('data:')||user.avatar.startsWith('http'))
      ? `<img src="${escHtml(user.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : `<span style="font-size:11px">${(user.avatar||user.username[0]).toUpperCase()}</span>`;
    area.innerHTML = `<div style="display:flex;gap:8px;align-items:center">
      <button class="btn-new" onclick="openModal('postModal')">+ Пост</button>
      <div class="user-wrap">
        <button class="user-btn" onclick="toggleDropdown()">
          <div class="user-avatar">${ava}</div>
          <span>${escHtml(user.username)}</span>
          ${user.role==='admin'?'<span class="role-badge">adm</span>':''}
          <span id="notifBadge" class="notif-badge" style="display:none"></span>
        </button>
        <div class="user-dropdown" id="userDropdown">
          <button class="dropdown-item" onclick="openMyProfile()"><span class="di-dot"></span>Мой профиль</button>
          <button class="dropdown-item" onclick="showFeedView()"><span class="di-dot"></span>Лента</button>
          <button class="dropdown-item" onclick="showTrendingView()"><span class="di-dot"></span>Trending</button>
          <button class="dropdown-item" onclick="showGlobalSearch()"><span class="di-dot"></span>Поиск</button>
          <button class="dropdown-item" onclick="showMessagesView()"><span class="di-dot"></span>Сообщения <span id="msgBadge"></span></button>
          <button class="dropdown-item" onclick="showNotifView()"><span class="di-dot"></span>Уведомления <span id="notifDropBadge"></span></button>
          <button class="dropdown-item" onclick="showBookmarks()"><span class="di-dot"></span>Закладки</button>
          <button class="dropdown-item" onclick="showHistory()"><span class="di-dot"></span>История</button>
          <button class="dropdown-item" onclick="showUsersView()"><span class="di-dot"></span>Пользователи</button>
          <div class="dropdown-sep"></div>
          ${user.role==='admin' ? `<div class="dropdown-sep"></div><button class="dropdown-item" onclick="window.open('admin.html','_self');document.getElementById('userDropdown').classList.remove('open')"><span class="di-dot"></span>Админ панель</button>` : ''}
          <button class="dropdown-item" onclick="openModal('profileModal');loadProfileForm()"><span class="di-dot"></span>Редактировать профиль</button>
          <div class="dropdown-sep"></div>
          <button class="dropdown-item danger" onclick="logout()"><span class="di-dot"></span>Выйти</button>
        </div>
      </div>
    </div>`;
    startPolling();
  }
}
function toggleDropdown() { document.getElementById('userDropdown')?.classList.toggle('open'); }

// ─── AUTH LOGIC ─────────────────────────────────────────────────
function openAuthModal(mode) { authMode=mode; switchTab(mode); document.getElementById('authError').textContent=''; openModal('authModal'); }
function switchTab(mode) {
  authMode=mode;
  document.getElementById('tabLogin')?.classList.toggle('active',mode==='login');
  document.getElementById('tabRegister')?.classList.toggle('active',mode==='register');
  const title = document.getElementById('authTitle');
  const btn = document.getElementById('authSubmit');
  if(title) title.textContent = mode==='login'?'Вход':'Регистрация';
  if(btn) btn.textContent = mode==='login'?'Войти':'Зарегистрироваться';
}
async function submitAuth(e) {
  e.preventDefault();
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  errEl.textContent='';
  try {
    let res;
    if (authMode==='login') {
      res = await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username,password})});
    } else {
      res = await fetch(`${API}/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    }
    const data = await res.json();
    if (!res.ok) { errEl.textContent=data.detail||'Ошибка'; return; }
    setAuth(data.access_token,{username:data.username,role:data.role,avatar:''});
    closeModal('authModal');
    renderAuthArea(); loadPosts();
  } catch { errEl.textContent='Ошибка подключения'; }
}
function logout() { clearAuth(); stopPolling(); renderAuthArea(); showList(); }

// ─── POLLING ────────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  if (!getToken()) return;
  checkNotifs(); checkMessages();
  notifInterval = setInterval(() => { if(getToken()){checkNotifs();checkMessages();}else stopPolling(); }, 30000);
}
function stopPolling() {
  clearInterval(notifInterval); clearInterval(msgInterval);
  notifInterval=null; msgInterval=null;
}
async function checkNotifs() {
  if (!getToken()) return;
  try {
    const r = await fetch(`${API}/notifications/count`,{headers:authHeaders()});
    if (!r.ok) return;
    const {count} = await r.json();
    document.querySelectorAll('#notifBadge').forEach(el=>{el.textContent=count;el.style.display=count>0?'inline':'none';});
    document.querySelectorAll('#notifDropBadge').forEach(el=>{el.textContent=count>0?` (${count})`:''});
  } catch {}
}
function clearMsgBadge() { document.querySelectorAll('#msgBadge').forEach(el=>{el.textContent='';}); }
async function checkMessages() {
  if (!getToken()) return;
  try {
    const r = await fetch(`${API}/messages/unread/count`,{headers:authHeaders()});
    if (!r.ok) return;
    const {count} = await r.json();
    document.querySelectorAll('#msgBadge').forEach(el=>{el.textContent=count>0?` (${count})`:''});
  } catch {}
}

// ─── STATS ──────────────────────────────────────────────────────
async function loadStats() {
  try {
    const r = await fetch(`${API}/stats`);
    const d = await r.json();
    animateNum('statPosts',d.posts);
    animateNum('statComments',d.comments);
    animateNum('statMembers',d.members);
    const on = document.getElementById('statOnline');
    if(on) on.textContent=d.online||0;
  } catch {}
}

// ─── POSTS ──────────────────────────────────────────────────────
async function loadPosts(page=currentPage) {
  if (currentView!=='list') return;
  currentPage=page;
  const p = new URLSearchParams({page});
  if (currentCat!=='all') p.set('category',currentCat);
  if (currentSearch) p.set('search',currentSearch);
  if (currentTag) p.set('tag',currentTag);
  try {
    const r = await fetch(`${API}/posts?${p}`);
    const data = await r.json();
    totalPages=data.pages||1;
    renderPosts(data.posts||[]);
    renderPagination();
  } catch { renderPosts([]); }
}

function renderPosts(posts) {
  const list = document.getElementById('postsList');
  const empty = document.getElementById('emptyState');
  if (!posts.length) { if(list)list.innerHTML=''; if(empty)empty.style.display='block'; return; }
  if(empty) empty.style.display='none';
  list.innerHTML = posts.map((p,i) => {
    const ava = buildAvatar(p.author_avatar||'', p.author, 20);
    const pinBadge = p.pinned ? '<div class="pinned-badge">Закреплено</div>' : '';
    const tagsHtml = p.tags&&p.tags.length ? `<div class="tags-wrap">${p.tags.slice(0,4).map(t=>`<span class="tag" onclick="event.stopPropagation();filterTag('${escHtml(t)}')">${escHtml(t)}</span>`).join('')}</div>` : '';
    return `<div class="post-card${p.pinned?' post-pinned':''}" onclick="openPost('${p.id}')" style="animation-delay:${i*.04}s">
      <div class="post-card-left">
        ${p.pinned?'<div class="pinned-badge">Закреплено</div>':''}
        <div class="post-meta-top">
          <span class="cat-tag cat-${p.category}">${catLabel(p.category)}</span>
          <span class="post-date">${fmtDate(p.created_at)}</span>
        </div>
        <h2 class="post-title">${escHtml(p.title)}</h2>
        <p class="post-excerpt">${escHtml(p.body)}</p>
        ${tagsHtml}
        <div class="post-footer">
          <span class="post-author-tag" style="display:flex;align-items:center;gap:5px">${ava}<strong onclick="event.stopPropagation();openProfileView('${escHtml(p.author)}')">${escHtml(p.author)}</strong></span>
          <span class="post-stat">♡ ${p.likes}</span>
          <span class="post-stat">◎ ${p.views}</span>
        </div>
      </div>
      <div class="post-card-right"><span class="post-arrow">→</span></div>
    </div>`;
  }).join('');
}

function renderPagination() {
  const el = document.getElementById('pagination');
  if (!el || totalPages<=1) { if(el)el.innerHTML=''; return; }
  let h = `<button class="page-btn" onclick="loadPosts(${currentPage-1})" ${currentPage<=1?'disabled':''}>←</button>`;
  for(let i=1;i<=totalPages;i++) h+=`<button class="page-btn ${i===currentPage?'active':''}" onclick="loadPosts(${i})">${i}</button>`;
  h+=`<button class="page-btn" onclick="loadPosts(${currentPage+1})" ${currentPage>=totalPages?'disabled':''}>→</button>`;
  el.innerHTML=h;
}

function filterCat(btn,cat) {
  currentCat=cat; currentTag=''; currentPage=1;
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  loadPosts();
}
function filterTag(tag) {
  currentTag = currentTag===tag ? '' : tag;
  currentPage = 1;
  loadPosts();
  // Show subscribe hint if logged in
  if (getToken() && tag) {
    const tagLow = tag.toLowerCase();
    const subbed = myTagSubs.has(tagLow);
    showToast(subbed ? `Лента по #${tag}` : `Лента по #${tag} — нажми долго чтобы подписаться`);
  }
}
function debounceSearch(val) {
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>{currentSearch=val;currentPage=1;loadPosts();},280);
}

// ─── OPEN POST ───────────────────────────────────────────────────
async function openPost(id) {
  currentView='post'; currentPostId=id;
  showViewEx('postView');
  try {
    const [pr,cr] = await Promise.all([
      fetch(`${API}/posts/${id}`,{headers:authHeaders()}),
      fetch(`${API}/posts/${id}/comments`,{headers:authHeaders()})
    ]);
    const post = await pr.json();
    const comments = await cr.json();
    renderPostFull(post);
    renderComments(id,comments);
    const poll = await fetch(`${API}/polls/${id}`);
    if (poll.ok) { const pd=await poll.json(); if(pd) renderPoll(pd,id); }
  } catch {}
}

function renderMarkdown(text) {
  let html = escHtml(text)
    .replace(/```([\s\S]*?)```/g,'<pre class="md-pre">$1</pre>')
    .replace(/`([^`]+)`/g,'<code class="md-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g,'<em>$1</em>')
    .replace(/^## (.+)$/gm,'<div class="md-h2">$1</div>')
    .replace(/^# (.+)$/gm,'<div class="md-h1">$1</div>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a class="md-link" href="$2" target="_blank" rel="noopener">$1</a>');
  // Convert line breaks to <br> for proper rendering
  html = html.replace(/\n/g,'<br>');
  return html;
}

function renderPostFull(post) {
  // Сохраняем пост в кэш для безопасного доступа
  postsCache[post.id] = post;
  const user=getUser();
  const canEdit=user&&(user.username===post.author||user.role==='admin');
  const liked=post.liked_by_me;
  const bookmarked=post.bookmarked;
  const tagsHtml=post.tags&&post.tags.length?`<div class="tags-wrap" style="margin-bottom:16px">${post.tags.map(t=>`<span class="tag">${escHtml(t)}</span>`).join('')}</div>`:'';
  const imgHtml=post.image_url?`<img src="${escHtml(post.image_url)}" class="post-image" onclick="openLightbox(this.src)" alt="">`:'';
  const ava = buildAvatar(post.author_avatar||'', post.author, 30);
  document.getElementById('postFull').innerHTML=`
    <div class="post-full-meta"><span class="cat-tag cat-${post.category}">${catLabel(post.category)}</span>${post.pinned?'<span class="pinned-badge">— Закреплено</span>':''}</div>
    <h1 class="post-full-title">${escHtml(post.title)}</h1>
    <div class="post-full-byline">
      ${ava}
      <span class="byline-author">от <strong onclick="openProfileView('${escHtml(post.author)}')">${escHtml(post.author)}</strong></span>
      <span>${fmtDate(post.created_at)}</span>
      <span>◎ ${post.views}</span>
    </div>
    ${imgHtml}
    <div class="post-full-body md-content">${renderMarkdown(post.body)}</div>
    ${tagsHtml}
    <div id="pollWrap"></div>
    <div class="post-actions">
      <button class="action-btn ${liked?'liked':''}" id="likeBtn" onclick="likePost('${post.id}')">♡ <span id="likeCount">${post.likes}</span></button>
      <button class="action-btn ${bookmarked?'liked':''}" id="bookmarkBtn" onclick="toggleBookmark('${post.id}')">🔖</button>
      <button class="action-btn" onclick="copyPostLink('${post.id}')">🔗</button>
      ${user?`<button class="action-btn" onclick="reportContent('post','${post.id}')">🚩</button>`:''}
      ${canEdit?`<button class="action-btn" onclick="openEditModalById('${post.id}')">Редактировать</button><button class="action-btn danger" onclick="deletePost('${post.id}')">Удалить</button>`:''}
      ${user&&user.role==='admin'?`<button class="action-btn" onclick="pinPost('${post.id}')">📌 ${post.pinned?'Открепить':'Закрепить'}</button>`:''}
    </div>`;
}

function copyPostLink(id) { navigator.clipboard.writeText(location.origin+location.pathname+'#post/'+id); showToast('Ссылка скопирована'); }

async function likePost(id) {
  try {
    const r = await fetch(`${API}/posts/${id}/like`,{method:'POST',headers:authHeaders()});
    if (!r.ok) { if(r.status===401)openAuthModal('login'); return; }
    const {likes,liked} = await r.json();
    document.getElementById('likeBtn')?.classList.toggle('liked',liked);
    const cnt=document.getElementById('likeCount'); if(cnt)cnt.textContent=likes;
  } catch {}
}
async function toggleBookmark(id) {
  try {
    const r=await fetch(`${API}/posts/${id}/bookmark`,{method:'POST',headers:authHeaders()});
    if(!r.ok)return;
    const{saved}=await r.json();
    document.getElementById('bookmarkBtn')?.classList.toggle('liked',saved);
    showToast(saved?'Добавлено в закладки':'Удалено из закладок');
  } catch {}
}
async function pinPost(id) {
  try { await fetch(`${API}/posts/${id}/pin`,{method:'POST',headers:authHeaders()}); openPost(id); } catch {}
}
async function deletePost(id) {
  if(!confirm('Удалить пост?'))return;
  try { const r=await fetch(`${API}/posts/${id}`,{method:'DELETE',headers:authHeaders()}); if(r.ok)showList(); } catch {}
}

// ─── POLLS ──────────────────────────────────────────────────────
function renderPoll(poll,postId) {
  const wrap=document.getElementById('pollWrap'); if(!wrap)return;
  const total=poll.total||0;
  wrap.innerHTML=`<div class="poll-wrap">
    <div class="poll-question">${escHtml(poll.question)}</div>
    ${poll.options.map((opt,i)=>{
      const votes=poll.votes[i]||0;
      const pct=total>0?Math.round(votes/total*100):0;
      const voted=poll.my_vote===i;
      return `<div class="poll-option ${total>0?'poll-voted':''} ${voted?'poll-my-vote':''}" onclick="${total===0?`votePoll('${postId}',${i})`:''}">
        <div class="poll-bar" style="width:${pct}%"></div>
        <span class="poll-opt-text">${escHtml(opt)}</span>
        ${voted?'<span class="poll-check">✓</span>':''}
        ${total>0?`<span class="poll-pct">${pct}%</span>`:''}
      </div>`;
    }).join('')}
    <div class="poll-total">${total} голосов</div>
  </div>`;
}
async function votePoll(postId,idx) {
  try {
    const r=await fetch(`${API}/polls/${postId}/vote`,{method:'POST',headers:authHeaders(),body:JSON.stringify({option_idx:idx})});
    if(!r.ok){if(r.status===401)openAuthModal('login');return;}
    const poll=await fetch(`${API}/polls/${postId}`).then(r=>r.json());
    renderPoll(poll,postId);
  } catch {}
}

// ─── COMMENTS ───────────────────────────────────────────────────
function renderComments(postId,comms) {
  const user=getUser();
  const h=document.getElementById('commentsTitle');
  if(h) h.textContent=`Комментарии${comms.length?' · '+comms.length:''}`;
  const list=document.getElementById('commentsList');
  list.dataset.postId=postId;

  // Строим дерево
  const byId={}, roots=[];
  comms.forEach(c=>{byId[c.id]={...c,children:[]};});
  comms.forEach(c=>{
    if(c.parent_id&&byId[c.parent_id]) byId[c.parent_id].children.push(byId[c.id]);
    else roots.push(byId[c.id]);
  });

  function renderNode(c,depth=0) {
    const canDel=user&&(user.username===c.author||user.role==='admin');
    const imgHtml=c.image_url?`<img src="${escHtml(c.image_url)}" class="comment-image" onclick="openLightbox(this.src)">`:'';
    return `<div class="comment-node" id="comment-${c.id}">
      <div class="comment-header">
        <div class="comment-avatar" onclick="openProfileView('${escHtml(c.author)}')" style="cursor:pointer;overflow:hidden">${buildAvatar(c.author_avatar||c.avatar||'', c.author, 26)}</div>
        <span class="comment-author" onclick="openProfileView('${escHtml(c.author)}')">${escHtml(c.author)}</span>
        <span class="comment-time">${fmtDate(c.created_at)}</span>
      </div>
      <div class="comment-body md-content">${renderMarkdown(c.body)}</div>
      ${imgHtml}
      <div class="comment-actions">
        ${user?`<button class="comment-like-btn ${c.liked_by_me?'liked':''}" onclick="likeComment('${c.id}')">♡ <span id="clcnt-${c.id}">${c.likes}</span></button>`:`<span class="comment-like-btn">♡ ${c.likes}</span>`}
        ${user?`<button class="comment-reply-btn" onclick="showReplyForm('${c.id}','${postId}')">↩ Ответить</button>`:''}
        ${canDel?`<button class="comment-del-btn" onclick="deleteComment('${c.id}')">удалить</button>`:''}
        ${user?`<button class="comment-del-btn" style="color:var(--muted)" onclick="reportContent('comment','${c.id}')">🚩</button>`:''}
      </div>
      <div id="reply-form-${c.id}"></div>
      ${c.children.length?`<div class="comment-replies" style="border-left-color:var(--indent-color-${Math.min(depth+1,5)})">${c.children.map(ch=>renderNode(ch,depth+1)).join('')}</div>`:''}
    </div>`;
  }

  if (!roots.length) {
    list.innerHTML='<p style="color:var(--muted);font-size:14px;padding:20px 0">Будьте первым — напишите комментарий</p>';
  } else {
    list.innerHTML=`<div class="comment-item">${roots.map(c=>renderNode(c)).join('')}</div>`;
  }

  const wrap=document.getElementById('commentFormWrap');
  if(user) {
    wrap.innerHTML=`<form class="comment-form" onsubmit="submitComment(event)">
      <textarea class="textarea" id="commentBody" placeholder="Напишите комментарий…" rows="3" required></textarea>
      <button class="btn-submit" type="submit">Отправить</button>
    </form>`;
  } else {
    wrap.innerHTML=`<p style="font-size:14px;color:var(--muted);padding:16px 0"><button onclick="openAuthModal('login')" style="background:none;border:none;color:var(--text);cursor:pointer;text-decoration:underline">Войдите</button>, чтобы написать комментарий</p>`;
  }
}

function showReplyForm(parentId,postId) {
  const wrap=document.getElementById(`reply-form-${parentId}`);
  if(!wrap)return;
  if(wrap.innerHTML) { wrap.innerHTML=''; return; }
  wrap.innerHTML=`<form class="reply-form" onsubmit="submitReply(event,'${parentId}','${postId}')">
    <textarea class="textarea" placeholder="Ваш ответ…" rows="2" required style="min-height:60px"></textarea>
    <div class="reply-form-actions">
      <button class="btn-submit" type="submit" style="padding:7px 14px;font-size:13px">Ответить</button>
      <button type="button" class="reply-cancel-btn" onclick="document.getElementById('reply-form-${parentId}').innerHTML=''">Отмена</button>
    </div>
  </form>`;
  wrap.querySelector('textarea')?.focus();
}

async function submitReply(e,parentId,postId) {
  e.preventDefault();
  const body=e.target.querySelector('textarea').value.trim();
  if(!body)return;
  try {
    const r=await fetch(`${API}/posts/${postId}/comments`,{method:'POST',headers:authHeaders(),body:JSON.stringify({body,parent_id:parentId})});
    if(!r.ok)return;
    const [cr]=await Promise.all([fetch(`${API}/posts/${postId}/comments`,{headers:authHeaders()})]);
    renderComments(postId,await cr.json());
  } catch {}
}

async function submitComment(e) {
  e.preventDefault();
  const postId=document.getElementById('commentsList').dataset.postId;
  const body=document.getElementById('commentBody').value.trim();
  if(!body)return;
  try {
    const r=await fetch(`${API}/posts/${postId}/comments`,{method:'POST',headers:authHeaders(),body:JSON.stringify({body})});
    if(!r.ok){if(r.status===401)openAuthModal('login');return;}
    const cr=await fetch(`${API}/posts/${postId}/comments`,{headers:authHeaders()});
    renderComments(postId,await cr.json());
  } catch {}
}

async function likeComment(id) {
  try {
    const r=await fetch(`${API}/comments/${id}/like`,{method:'POST',headers:authHeaders()});
    if(!r.ok)return;
    const{likes,liked}=await r.json();
    const btn=document.querySelector(`button[onclick="likeComment('${id}')"]`);
    if(btn) btn.classList.toggle('liked',liked);
    const cnt=document.getElementById(`clcnt-${id}`);
    if(cnt)cnt.textContent=likes;
  } catch {}
}

async function deleteComment(id) {
  if(!confirm('Удалить комментарий?'))return;
  try {
    const postId=document.getElementById('commentsList').dataset.postId;
    await fetch(`${API}/comments/${id}`,{method:'DELETE',headers:authHeaders()});
    const cr=await fetch(`${API}/posts/${postId}/comments`,{headers:authHeaders()});
    renderComments(postId,await cr.json());
  } catch {}
}

// ─── POSTS CRUD ──────────────────────────────────────────────────
async function submitPost(e) {
  e.preventDefault();
  const tags=document.getElementById('newTags').value.split(',').map(t=>t.trim()).filter(Boolean);
  const imgUrl=document.getElementById('imgurl-post')?.value.trim()||'';
  const imgData=document.getElementById('imgDataPost')?.value||'';
  const pollQ=document.getElementById('pollQuestion')?.value.trim()||'';
  const pollOpts=[1,2,3,4].map(i=>document.getElementById(`pollOpt${i}`)?.value.trim()).filter(Boolean);
  const body={
    title:document.getElementById('newTitle').value.trim(),
    body:document.getElementById('newBody').value.trim(),
    category:document.getElementById('newCategory').value,
    tags, image_url:imgData||imgUrl,
    poll_question:pollQ, poll_options:pollOpts
  };
  try {
    const r=await fetch(`${API}/posts`,{method:'POST',headers:authHeaders(),body:JSON.stringify(body)});
    if(!r.ok)return;
    closeModal('postModal');
    ['newTitle','newBody','newTags'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    showList();
  } catch {}
}

function openEditModal(id,title,body,category,tags,imageUrl) {
  editingPostId=id;
  const titleEl=document.getElementById('editTitle');
  const bodyEl=document.getElementById('editBody');
  const catEl=document.getElementById('editCategory');
  const tagsEl=document.getElementById('editTags');
  if(!titleEl||!bodyEl){alert('Модальное окно редактирования не найдено');return;}
  titleEl.value=title||'';
  bodyEl.value=body||'';
  if(catEl) catEl.value=category||'general';
  if(tagsEl) tagsEl.value=Array.isArray(tags)?tags.join(', '):'';
  const eu=document.getElementById('imgurl-editpost'); if(eu)eu.value=imageUrl||'';
  openModal('editModal');
}

function openEditModalById(id) {
  const post = postsCache[id];
  if(!post){
    // Если нет в кэше — делаем запрос
    fetch(`${API}/posts/${id}`).then(r=>r.json()).then(p=>{
      postsCache[p.id]=p;
      openEditModal(p.id, p.title, p.body, p.category, p.tags||[], p.image_url||'');
    }).catch(()=>alert('Не удалось загрузить пост'));
    return;
  }
  openEditModal(post.id, post.title, post.body, post.category, post.tags||[], post.image_url||'');
}
async function submitEdit(e) {
  e.preventDefault();
  if(!editingPostId){alert('ID поста не найден');return;}
  const tags=document.getElementById('editTags').value.split(',').map(t=>t.trim()).filter(Boolean);
  const imgUrl=document.getElementById('imgurl-editpost')?.value.trim()||'';
  const imgData=document.getElementById('imgDataEditpost')?.value||'';
  const payload={
    title:document.getElementById('editTitle').value.trim(),
    body:document.getElementById('editBody').value.trim(),
    category:document.getElementById('editCategory').value||'general',
    tags,
    image_url:imgData||imgUrl
  };
  if(!payload.title){alert('Введите заголовок');return;}
  if(!payload.body){alert('Введите текст поста');return;}
  try {
    const r=await fetch(`${API}/posts/${editingPostId}`,{method:'PUT',headers:authHeaders(),body:JSON.stringify(payload)});
    if(r.ok){
      closeModal('editModal');
      delete postsCache[editingPostId];
      openPost(editingPostId);
      showToast('Пост обновлён');
    } else {
      const err=await r.json().catch(()=>({}));
      alert('Ошибка: '+(err.detail||r.status));
    }
  } catch(ex){alert('Ошибка подключения: '+ex.message);}
}

// ─── IMAGE HANDLING ──────────────────────────────────────────────
function switchImgTab(prefix,tab,btn) {
  document.querySelectorAll(`.image-tab[data-prefix="${prefix}"]`).forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`imgtab-url-${prefix}`).style.display=tab==='url'?'':'none';
  document.getElementById(`imgtab-file-${prefix}`).style.display=tab==='file'?'':'none';
}
function previewFile(prefix,input) {
  const file=input.files[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const src=e.target.result;
    const prev=document.getElementById(`imgpreview-${prefix}`);
    const img=document.getElementById(`imgpreviewimg-${prefix}`);
    const hidden=document.getElementById(`imgData${prefix.charAt(0).toUpperCase()+prefix.slice(1)}`);
    if(img)img.src=src; if(prev)prev.style.display=''; if(hidden)hidden.value=src;
  };
  reader.readAsDataURL(file);
}
function removePreview(prefix) {
  const prev=document.getElementById(`imgpreview-${prefix}`);
  const img=document.getElementById(`imgpreviewimg-${prefix}`);
  const hidden=document.getElementById(`imgData${prefix.charAt(0).toUpperCase()+prefix.slice(1)}`);
  if(img)img.src=''; if(prev)prev.style.display='none'; if(hidden)hidden.value='';
}
function openLightbox(src) {
  let lb=document.getElementById('lightbox');
  if(!lb){lb=document.createElement('div');lb.id='lightbox';lb.className='lightbox';lb.innerHTML='<button class="lightbox-close" onclick="this.parentElement.classList.remove(\'open\')">✕</button><img>';document.body.appendChild(lb);}
  lb.querySelector('img').src=src; lb.classList.add('open');
  lb.onclick=e=>{if(e.target===lb)lb.classList.remove('open');};
}

// ─── PROFILE ────────────────────────────────────────────────────
function openMyProfile() { const u=getUser(); if(u) openProfileView(u.username); document.getElementById('userDropdown')?.classList.remove('open'); }

async function openProfileView(username) {
  if(!username)return;
  currentView='profile';
  document.getElementById('userDropdown')?.classList.remove('open');
  showViewEx('profileView');
  document.getElementById('profileContent').innerHTML='<p style="color:var(--muted);padding:40px 0">Загрузка…</p>';
  try {
    const r=await fetch(`${API}/users/${encodeURIComponent(username)}`,{headers:authHeaders()});
    if(!r.ok){document.getElementById('profileContent').innerHTML='<p style="color:var(--muted);padding:40px 0">Не найдено</p>';return;}
    renderProfile(await r.json());
  } catch {}
}

function renderProfile(data) {
  loadUserTagSubs(data.username);
  const me=getUser(); const isMe=me&&me.username===data.username;
  const joinDate=new Date(data.created_at).toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
  const avatarHtml=data.avatar&&(data.avatar.startsWith('data:')||data.avatar.startsWith('http'))
    ?`<img src="${data.avatar}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:2px solid var(--border)">`
    :`<div class="profile-avatar-lg" style="width:80px;height:80px;font-size:30px">${data.avatar||data.username[0].toUpperCase()}</div>`;
  const followLabel=data.is_following?'✓ Подписан':'+ Подписаться';
  const followClass=data.is_following?'action-btn liked':'action-btn';
  const followBtn=!isMe&&me?`<button class="${followClass}" id="followBtn" onclick="toggleFollow('${escHtml(data.username)}')">${followLabel}</button>`:'';
  const msgBtn=!isMe&&me?`<button class="action-btn" onclick="startDM('${escHtml(data.username)}')">✉ Написать</button>`:'';
  const badges=[];
  if(data.post_count>=1)badges.push('✍️ Автор');
  if(data.post_count>=10)badges.push('🔥 Активный');
  if((data.followers||0)>=5)badges.push('⭐ Популярный');
  if(data.role==='admin')badges.push('🛡 Админ');
  document.getElementById('profileContent').innerHTML=`
    <div class="profile-banner" style="background:linear-gradient(135deg,var(--surface) 0%,${getProfileColor(data.username)} 100%)">
      <div style="display:flex;align-items:flex-start;gap:20px;flex-wrap:wrap">
        ${avatarHtml}
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
            <div class="profile-name">${escHtml(data.username)}</div>
            ${data.role==='admin'?'<span class="role-badge">admin</span>':''}
          </div>
          <div class="profile-bio">${data.bio?escHtml(data.bio):'<span style="color:var(--muted)">Нет информации</span>'}</div>
          <div class="profile-stats-row">
            <div class="profile-stat-item"><span class="profile-stat-num">${data.post_count||0}</span><span class="profile-stat-label">постов</span></div>
            <div class="profile-stat-item"><span class="profile-stat-num">${data.level||1}</span><span class="profile-stat-label">уровень</span></div>
            <div class="profile-stat-item"><span class="profile-stat-num">${data.xp||0}</span><span class="profile-stat-label">XP</span></div>
            <div class="profile-stat-item"><span class="profile-stat-num">${data.followers||0}</span><span class="profile-stat-label">подписчиков</span></div>
            <div class="profile-stat-item"><span class="profile-stat-num">${data.following||0}</span><span class="profile-stat-label">подписок</span></div>
          </div>
          ${badges.length?`<div class="badges-wrap">${badges.map(b=>`<span class="badge-chip"><span>${b}</span></span>`).join('')}</div>`:''}
        </div>
      </div>
      <div class="post-actions" style="margin-top:16px">
        ${followBtn}${msgBtn}
        ${isMe?`<button class="action-btn" onclick="openModal('profileModal');loadProfileForm()">✏ Редактировать</button>`:''}
      </div>
    </div>
    <h3 class="profile-posts-title">Посты</h3>
    <div class="posts-list">${data.posts.length?data.posts.map((p,i)=>`
      <div class="post-card" onclick="openPost('${p.id}')" style="animation-delay:${i*.04}s">
        <div class="post-card-left">
          <div class="post-meta-top"><span class="cat-tag cat-${p.category}">${catLabel(p.category)}</span><span class="post-date">${fmtDate(p.created_at)}</span></div>
          <h2 class="post-title" style="font-size:18px">${escHtml(p.title)}</h2>
          <div class="post-footer"><span class="post-stat">♡ ${p.likes}</span><span class="post-stat">◎ ${p.views}</span></div>
        </div>
      </div>`).join(''):'<p style="color:var(--muted);font-size:14px;padding:20px 0">Постов пока нет</p>'}</div>`;
}

function startDM(username) {
  document.getElementById('userDropdown')?.classList.remove('open');
  openChat(username);
}

async function toggleFollow(username) {
  try {
    const r=await fetch(`${API}/users/${encodeURIComponent(username)}/follow`,{method:'POST',headers:authHeaders()});
    if(!r.ok)return;
    const{following}=await r.json();
    const btn=document.getElementById('followBtn');
    if(btn){btn.textContent=following?'✓ Подписан':'+ Подписаться';btn.classList.toggle('liked',following);}
    showToast(following?`Вы подписались на ${username}`:`Отписались от ${username}`);
  } catch {}
}

function loadProfileForm() {
  const u=getUser(); if(!u)return;
  fetch(`${API}/users/${u.username}`).then(r=>r.json()).then(d=>{
    const bio=document.getElementById('profileBio'); if(bio)bio.value=d.bio||'';
  }).catch(()=>{});
}

async function submitProfile(e) {
  e.preventDefault();
  const bio=document.getElementById('profileBio').value.trim();
  const imgData=document.getElementById('avatarData')?.value||'';
  const emoji=document.getElementById('profileAvatarEmoji')?.value.trim()||'';
  const avatar=imgData||emoji;
  try {
    const r=await fetch(`${API}/users/me/profile`,{method:'PUT',headers:authHeaders(),body:JSON.stringify({bio,avatar})});
    if(r.ok){
      const u=getUser(); if(u){u.avatar=avatar;localStorage.setItem('user',JSON.stringify(u));}
      closeModal('profileModal'); renderAuthArea();
      if(currentView==='profile') openProfileView(u.username);
      showToast('Профиль обновлён');
    }
  } catch {}
}

function previewAvatarFile(input) {
  const file=input.files[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const src=e.target.result;
    const prev=document.getElementById('avatarFilePreview');
    const img=document.getElementById('avatarFilePreviewImg');
    const hidden=document.getElementById('avatarData');
    if(img)img.src=src; if(prev)prev.style.display=''; if(hidden)hidden.value=src;
  };
  reader.readAsDataURL(file);
}
function removeAvatarPreview() {
  const prev=document.getElementById('avatarFilePreview');
  const img=document.getElementById('avatarFilePreviewImg');
  const hidden=document.getElementById('avatarData');
  if(img)img.src=''; if(prev)prev.style.display='none'; if(hidden)hidden.value='';
}

// ─── USERS ──────────────────────────────────────────────────────
function showUsersView() {
  currentView='users'; document.getElementById('userDropdown')?.classList.remove('open');
  showViewEx('usersView');
  document.getElementById('usersList').innerHTML='';
  document.getElementById('userSearchInput').value='';
}
function debounceUserSearch(val) {
  clearTimeout(userSearchTimer);
  if(!val.trim()){document.getElementById('usersList').innerHTML='';return;}
  userSearchTimer=setTimeout(()=>searchUsers(val),300);
}
async function searchUsers(q) {
  try {
    const r=await fetch(`${API}/users/search?q=${encodeURIComponent(q)}`);
    const users=await r.json();
    const list=document.getElementById('usersList');
    if(!users.length){list.innerHTML='<p style="color:var(--muted);font-size:14px;padding:20px 0">Никого не найдено</p>';return;}
    list.innerHTML=users.map(u=>`<div class="user-card" onclick="openProfileView('${escHtml(u.username)}')">
      <div class="conv-avatar" style="overflow:hidden">${buildAvatar(u.avatar||''  , u.username, 44)}</div>
      <div class="user-card-info">
        <div class="user-card-name">${escHtml(u.username)} ${u.role==='admin'?'<span class="role-badge">admin</span>':''}</div>
        <div class="user-card-bio">${u.bio?escHtml(u.bio.substring(0,80)):'Нет информации'}</div>
      </div>
    </div>`).join('');
  } catch {}
}

// ─── NOTIFICATIONS ───────────────────────────────────────────────
async function showNotifView() {
  document.getElementById('userDropdown')?.classList.remove('open');
  currentView='notif'; showViewEx('notifView');
  try {
    const r=await fetch(`${API}/notifications`,{headers:authHeaders()});
    const notifs=await r.json();
    await fetch(`${API}/notifications/read`,{method:'POST',headers:authHeaders()});
    checkNotifs();
    const list=document.getElementById('notifList');
    if(!notifs.length){list.innerHTML='<p style="color:var(--muted);font-size:14px;padding:20px 0">Уведомлений нет</p>';return;}
    list.innerHTML=notifs.map(n=>`<div class="notif-item ${n.read?'':'unread'}" onclick="${n.post_id?`openPost('${n.post_id}')`:''}" style="${n.post_id?'cursor:pointer':''}">
      <div class="notif-dot ${n.read?'read':''}"></div>
      <div><div class="notif-text">${escHtml(n.message)}</div><div class="notif-time">${fmtDate(n.created_at)}</div></div>
    </div>`).join('');
  } catch {}
}

// ─── FEED / BOOKMARKS / HISTORY ──────────────────────────────────
async function showFeedView() {
  document.getElementById('userDropdown')?.classList.remove('open');
  currentView='feed'; showViewEx('feedView');
  const list=document.getElementById('feedList');
  list.innerHTML='<p style="color:var(--muted);padding:20px 0">Загрузка…</p>';
  try {
    const r=await fetch(`${API}/feed`,{headers:authHeaders()});
    const data=await r.json();
    const posts=data.posts||[];
    list.innerHTML=posts.length?renderPostCards(posts):'<p style="color:var(--muted);font-size:14px;padding:20px 0">Подпишитесь на авторов чтобы видеть их посты</p>';
  } catch {}
}
async function showBookmarks() {
  document.getElementById('userDropdown')?.classList.remove('open');
  currentView='bookmarks'; showViewEx('bookmarksView');
  const list=document.getElementById('bookmarksList');
  list.innerHTML='<p style="color:var(--muted);padding:20px 0">Загрузка…</p>';
  try {
    const r=await fetch(`${API}/bookmarks`,{headers:authHeaders()});
    const posts=await r.json();
    list.innerHTML=posts.length?renderPostCards(posts):'<p style="color:var(--muted);font-size:14px;padding:20px 0">Закладок пока нет</p>';
  } catch {}
}
async function showHistory() {
  document.getElementById('userDropdown')?.classList.remove('open');
  currentView='history'; showViewEx('historyView');
  const list=document.getElementById('historyList');
  list.innerHTML='<p style="color:var(--muted);padding:20px 0">Загрузка…</p>';
  try {
    const r=await fetch(`${API}/history`,{headers:authHeaders()});
    const posts=await r.json();
    list.innerHTML=posts.length?renderPostCards(posts):'<p style="color:var(--muted);font-size:14px;padding:20px 0">История пуста</p>';
  } catch {}
}

function renderPostCards(posts) {
  return posts.map((p,i)=>`<div class="post-card" onclick="openPost('${p.id}')" style="animation-delay:${i*.04}s">
    <div class="post-card-left">
      <div class="post-meta-top"><span class="cat-tag cat-${p.category}">${catLabel(p.category)}</span><span class="post-date">${fmtDate(p.created_at)}</span></div>
      <h2 class="post-title">${escHtml(p.title)}</h2>
      <div class="post-footer"><span class="post-author-tag">от <strong>${escHtml(p.author)}</strong></span><span class="post-stat">♡ ${p.likes}</span><span class="post-stat">◎ ${p.views}</span></div>
    </div>
  </div>`).join('');
}

// ─── TRENDING ────────────────────────────────────────────────────
async function showTrendingView() {
  document.getElementById('userDropdown')?.classList.remove('open');
  currentView='trending'; showViewEx('trendingView');
  const list=document.getElementById('trendingList');
  list.innerHTML='<p style="color:var(--muted);padding:20px 0">Загрузка…</p>';
  try {
    const r=await fetch(`${API}/trending`);
    const posts=await r.json();
    list.innerHTML=posts.length?posts.map((p,i)=>`<div class="post-card" onclick="openPost('${p.id}')" style="animation-delay:${i*.04}s;display:grid;grid-template-columns:32px 1fr;gap:16px;align-items:start">
      <div style="font-family:var(--font-display);font-size:26px;color:var(--muted);min-width:32px;padding-top:4px">#${i+1}</div>
      <div style="flex:1">
        <div class="post-meta-top"><span class="cat-tag cat-${p.category}">${catLabel(p.category)}</span></div>
        <h2 class="post-title">${escHtml(p.title)}</h2>
        <div class="post-footer"><span class="post-author-tag">от <strong>${escHtml(p.author)}</strong></span><span class="post-stat">♡ ${p.likes}</span><span class="post-stat">◎ ${p.views}</span></div>
      </div>
    </div>`).join(''):'<p style="color:var(--muted)">Нет данных</p>';
  } catch {}
}

// ─── GLOBAL SEARCH ───────────────────────────────────────────────
function showGlobalSearch() {
  document.getElementById('userDropdown')?.classList.remove('open');
  currentView='search'; showViewEx('searchView');
  const inp=document.getElementById('globalSearchInput');
  if(inp){inp.value='';setTimeout(()=>inp.focus(),100);}
  document.getElementById('globalSearchResults').innerHTML='';
}
function debounceGlobalSearch(val) {
  clearTimeout(globalSearchTimer);
  if(!val.trim()){document.getElementById('globalSearchResults').innerHTML='';return;}
  globalSearchTimer=setTimeout(()=>runGlobalSearch(val),300);
}
async function runGlobalSearch(q) {
  const res=document.getElementById('globalSearchResults');
  res.innerHTML='<p style="color:var(--muted);font-size:13px">Поиск…</p>';
  try {
    const r=await fetch(`${API}/search?q=${encodeURIComponent(q)}`);
    const data=await r.json();
    let html='';
    if(data.posts.length) html+=`<div class="search-section-title">📝 Посты</div>${renderPostCards(data.posts)}`;
    if(data.users.length) html+=`<div class="search-section-title" style="margin-top:20px">👤 Пользователи</div>${data.users.map(u=>`<div class="user-card" onclick="openProfileView('${escHtml(u.username)}')"><div class="conv-avatar" style="width:40px;height:40px;overflow:hidden">${buildAvatar(u.avatar||'', u.username, 40)}</div><div class="user-card-info"><div class="user-card-name">${escHtml(u.username)}</div><div class="user-card-bio">${u.bio?escHtml(u.bio.substring(0,60)):'—'}</div></div></div>`).join('')}`;
    if(!html) html=`<div style="text-align:center;padding:40px 0;color:var(--muted)"><div style="font-size:36px;margin-bottom:8px">🔍</div><div>Ничего не найдено</div></div>`;
    res.innerHTML=html;
  } catch {}
}

// ─── TAGS CLOUD ──────────────────────────────────────────────────
async function loadTagsCloud() {
  try {
    const r=await fetch(`${API}/tags/popular`);
    const tags=await r.json();
    const wrap=document.getElementById('tagsCloud');
    if(!wrap||!tags.length)return;
    wrap.innerHTML=`<div class="tags-cloud">${tags.slice(0,20).map(t=>`<span class="tag-cloud-item" onclick="filterTag('${escHtml(t.tag)}')">#${escHtml(t.tag)}<sup style="font-size:9px;margin-left:2px;color:var(--muted)">${t.count}</sup></span>`).join('')}</div>`;
  } catch {}
}

// ─── REPORTS ─────────────────────────────────────────────────────
async function reportContent(type,id) {
  const reason=prompt('Причина жалобы:'); if(!reason?.trim())return;
  try {
    const r=await fetch(`${API}/reports`,{method:'POST',headers:authHeaders(),body:JSON.stringify({target_type:type,target_id:id,reason:reason.trim()})});
    if(r.ok)showToast('Жалоба отправлена');
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
// MESSAGES & CHAT
// ═══════════════════════════════════════════════════════════════

async function showMessagesView() {
  document.getElementById('userDropdown')?.classList.remove('open');
  currentView='messages'; showViewEx('messagesView');
  const list=document.getElementById('conversationsList');
  list.innerHTML='<p style="color:var(--muted);padding:20px 0">Загрузка…</p>';
  try {
    const [convR,groupR]=await Promise.all([
      fetch(`${API}/messages`,{headers:authHeaders()}),
      fetch(`${API}/groups`,{headers:authHeaders()})
    ]);
    const convs=await convR.json();
    const groups=groupR.ok?await groupR.json():[];

    let html='';

    if(groups.length) {
      html+=`<div class="msgs-section-label">Группы</div><div class="conv-list">`;
      html+=groups.map(g=>`<div class="conv-item" onclick="openGroupChat('${escHtml(g.id)}','${escHtml(g.name)}')">
        <div class="conv-avatar-wrap"><div class="conv-avatar conv-avatar-group">${escHtml(g.name[0].toUpperCase())}</div></div>
        <div class="conv-info">
          <div class="conv-name">${escHtml(g.name)} ${g.unread>0?`<span class="unread-dot">${g.unread}</span>`:''}</div>
          <div class="conv-last ${g.unread>0?'unread-msg':''}">${escHtml((g.last_message||'').substring(0,50))}</div>
        </div>
        <div class="conv-meta"><span class="conv-time">${g.last_at?fmtDate(g.last_at):''}</span></div>
      </div>`).join('');
      html+=`</div>`;
    }

    if(convs.length) {
      html+=`<div class="msgs-section-label" style="${groups.length?'margin-top:16px':''}">Личные сообщения</div><div class="conv-list">`;
      html+=convs.map(c=>{
        const ava = buildAvatar(c.avatar||'', c.username, 46);
        return `<div class="conv-item" onclick="openChat('${escHtml(c.username)}')">
          <div class="conv-avatar-wrap"><div class="conv-avatar">${ava}</div></div>
          <div class="conv-info">
            <div class="conv-name">${escHtml(c.username)} ${c.unread>0?`<span class="unread-dot">${c.unread}</span>`:''}</div>
            <div class="conv-last ${c.unread>0?'unread-msg':''}">${escHtml((c.last_message||'').substring(0,50))}</div>
          </div>
          <div class="conv-meta"><span class="conv-time">${c.last_at?fmtDate(c.last_at):''}</span></div>
        </div>`;
      }).join('');
      html+=`</div>`;
    }

    if(!groups.length&&!convs.length) {
      html=`<div class="chat-empty" style="padding-top:60px">
        <div style="font-size:48px;opacity:.15;margin-bottom:12px">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div class="chat-empty-text">Нет сообщений</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">Найдите пользователя и напишите ему</div>
      </div>`;
    }
    list.innerHTML=html;
  } catch {}
}

// ─── DIRECT CHAT ─────────────────────────────────────────────────
async function openChat(username) {
  currentView='chat'; currentChatUser=username; currentGroupId=null;
  clearMsgBadge();
  showViewEx('chatView');
  document.getElementById('chatWith').value=username;
  document.getElementById('chatGroupId').value='';

  const titleEl=document.getElementById('chatTitle');
  const avatarEl=document.getElementById('chatHeaderAvatar');
  const statusEl=document.getElementById('chatHeaderStatus');
  if(titleEl) titleEl.textContent=username;
  if(avatarEl){ avatarEl.innerHTML=''; avatarEl.textContent=username[0].toUpperCase(); }

  try {
    const u=await fetch(`${API}/users/${encodeURIComponent(username)}`).then(r=>r.json());
    if(u.avatar&&avatarEl){
      if(u.avatar.startsWith('data:')||u.avatar.startsWith('http')){
        avatarEl.innerHTML=`<img src="${escHtml(u.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      } else { avatarEl.textContent=u.avatar; }
    }
    if(statusEl) statusEl.textContent = u.online ? '● онлайн' : '';
  } catch {}

  await loadChatMessages(username);
  clearInterval(chatPollInterval);
  chatPollInterval=setInterval(async ()=>{
    if(currentView==='chat'&&currentChatUser===username){
      try { await loadChatMessages(username,true); } catch {}
      try {
        const tr=await fetch(`${API}/messages/typing/${encodeURIComponent(username)}`,{headers:authHeaders()});
        if(tr.ok){ const {typing}=await tr.json(); document.getElementById('typingIndicator')?.classList.toggle('visible',typing); }
      } catch {}
    } else clearInterval(chatPollInterval);
  },4000);
}

// ─── RENDER MESSAGE ────────────────────────────────────────────────
function renderMsgHtml(m, me, isGroup=false) {
  const isMe = m.from_username===me?.username;
  const bodyText = m.deleted
    ? '<em style="opacity:.5;font-style:italic">Сообщение удалено</em>'
    : escHtml(m.body);
  const pinIcon = m.pinned ? '<span style="font-size:11px;opacity:.6;margin-right:4px">📌</span>' : '';
  const readIcon = isMe && !isGroup
    ? `<span class="read-receipt ${m.read?'read':''}">${m.read?'✓✓':'✓'}</span>` : '';
  const timeStr = new Date(m.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});

  // Reactions row
  const reactions = m.reactions||{};
  const reactHtml = Object.entries(reactions).length
    ? `<div class="chat-reactions">${Object.entries(reactions).map(([em,cnt])=>
        `<button class="reaction-chip${m.my_reaction===em?' my-reaction':''}" onclick="doReact('${m.id}','${em}')">${em}<span>${cnt}</span></button>`
      ).join('')}</div>` : '';

  // Quick reactions strip (shown on tap/hover)
  const quickReacts = !m.deleted
    ? `<div class="msg-quick-react" id="qr-${m.id}">
        ${['❤️','😂','👍','🔥','😮','😢','👎','💯'].map(em=>
          `<button class="qr-btn" onclick="doReact('${m.id}','${em}');hideQuickReact('${m.id}')">${em}</button>`
        ).join('')}
        ${isMe?`<button class="qr-btn qr-del" onclick="deleteMsgById('${m.id}');hideQuickReact('${m.id}')">🗑</button>`:''}
        <button class="qr-btn" onclick="pinMsgById('${m.id}');hideQuickReact('${m.id}')">📌</button>
        <button class="qr-btn" onclick="replyToMsg('${m.id}','${escAttr(m.from_username)}','${escAttr(m.body.substring(0,60))}');hideQuickReact('${m.id}')">↩</button>
      </div>` : '';

  const ava = buildAvatar(m.from_avatar||'', m.from_username, 28);

  return `<div class="chat-row ${isMe?'chat-row-me':'chat-row-other'}" id="msg-${m.id}"
    onclick="toggleQuickReact('${m.id}',event)"
    oncontextmenu="toggleQuickReact('${m.id}',event);event.preventDefault()">
    ${!isMe?`<div class="chat-msg-avatar">${ava}</div>`:''}
    <div class="chat-msg-body">
      ${(!isMe&&isGroup)?`<div class="chat-sender-name">${escHtml(m.from_username)}</div>`:''}
      ${m.reply_to_body?`<div class="chat-reply-preview"><span class="chat-reply-name">${escHtml(m.reply_to_user||'')}</span><span class="chat-reply-text">${escHtml(m.reply_to_body.substring(0,60))}</span></div>`:''}
      <div class="chat-bubble ${isMe?'chat-bubble-me':'chat-bubble-other'}">${pinIcon}${bodyText}</div>
      ${reactHtml}
      <div class="chat-time">${timeStr}${readIcon}</div>
    </div>
    ${isMe?`<div class="chat-msg-avatar">${ava}</div>`:''}
    ${quickReacts}
  </div>`;
}

function toggleQuickReact(msgId, e) {
  if(e && (e.target.closest('.qr-btn')||e.target.closest('.reaction-chip'))) return;
  const panel = document.getElementById('qr-'+msgId);
  if(!panel) return;
  const isVisible = panel.classList.contains('visible');
  // Hide all others
  document.querySelectorAll('.msg-quick-react.visible').forEach(p=>p.classList.remove('visible'));
  if(!isVisible) panel.classList.add('visible');
}

function hideQuickReact(msgId) {
  document.getElementById('qr-'+msgId)?.classList.remove('visible');
}

// Reply state
let replyState = null;
function replyToMsg(msgId, username, bodyPreview) {
  replyState = {msgId, username, bodyPreview};
  let replyBar = document.getElementById('replyBar');
  if(!replyBar){
    replyBar = document.createElement('div');
    replyBar.id = 'replyBar';
    replyBar.className = 'reply-bar';
    const wrap = document.querySelector('.chat-input-wrap');
    if(wrap) wrap.prepend(replyBar);
  }
  replyBar.innerHTML = `
    <div class="reply-bar-inner">
      <div class="reply-bar-line"></div>
      <div style="flex:1;min-width:0">
        <div class="reply-bar-name">${escHtml(username)}</div>
        <div class="reply-bar-text">${escHtml(bodyPreview)}</div>
      </div>
      <button class="reply-bar-close" onclick="cancelReply()">✕</button>
    </div>`;
  document.getElementById('chatInput')?.focus();
}

function cancelReply() {
  replyState = null;
  document.getElementById('replyBar')?.remove();
}

// ─── LOAD MESSAGES ─────────────────────────────────────────────────
async function loadChatMessages(username, silent=false) {
  const msgs=document.getElementById('chatMessages'); if(!msgs)return;
  if(!silent) msgs.innerHTML='<p style="color:var(--muted);padding:20px;text-align:center;font-size:13px">Загрузка…</p>';
  try {
    const r=await fetch(`${API}/messages/${encodeURIComponent(username)}`,{headers:authHeaders()});
    const data=await r.json();
    const me=getUser();
    const wasAtBottom=msgs.scrollHeight-msgs.scrollTop-msgs.clientHeight<100;

    // Ensure data is array
    const messages = Array.isArray(data) ? data : (data.messages || []);
    if(!Array.isArray(data) && !data.messages) {
      console.error('Unexpected messages response:', data);
      msgs.innerHTML='<p style="color:#e05a5a;padding:20px;text-align:center">Ошибка загрузки сообщений</p>';
      return;
    }
    // Pinned
    const pinned=messages.filter(m=>m.pinned&&!m.deleted);
    const pinnedBlock=document.getElementById('pinnedMsgBlock');
    if(pinnedBlock){
      if(pinned.length){
        pinnedBlock.style.display='flex';
        const pc=document.getElementById('pinnedMsgContent');
        if(pc) pc.innerHTML=`<span style="font-size:10px;font-weight:700;color:var(--cat-general);text-transform:uppercase;letter-spacing:.05em;flex-shrink:0">PIN</span><span style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(pinned[pinned.length-1].body)}</span>`;
      } else { pinnedBlock.style.display='none'; }
    }

    if(!messages.length){
      msgs.innerHTML=`<div class="chat-empty">
        <div style="font-size:44px;opacity:.12;margin-bottom:12px">💬</div>
        <div class="chat-empty-text">Начните разговор</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">Нажмите на сообщение чтобы отреагировать</div>
      </div>`;
      return;
    }

    let html=''; let lastDate='';
    messages.forEach(m=>{
      const d=new Date(m.created_at).toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
      if(d!==lastDate){html+=`<div class="chat-date-sep"><span>${d}</span></div>`;lastDate=d;}
      html += renderMsgHtml(m, me, false);
    });
    msgs.innerHTML=html;
    if(!silent||wasAtBottom) msgs.scrollTop=msgs.scrollHeight;
    clearMsgBadge(); setTimeout(checkMessages,600);
  } catch {}
}

async function doReact(msgId, emoji) {
  try {
    const r=await fetch(`${API}/messages/${msgId}/react?emoji=${encodeURIComponent(emoji)}`,{method:'POST',headers:authHeaders()});
    if(!r.ok)return;
    if(currentGroupId) loadGroupMessages(currentGroupId,true);
    else if(currentChatUser) loadChatMessages(currentChatUser,true);
  } catch {}
}

async function sendMessage(e) {
  e.preventDefault();
  const username=document.getElementById('chatWith').value;
  const groupId=document.getElementById('chatGroupId').value;
  const input=document.getElementById('chatInput');
  const body=input.value.trim(); if(!body)return;
  input.value='';
  const ep=document.getElementById('emojiPickerPanel'); if(ep)ep.style.display='none'; emojiPickerOpen=false;

  // Build payload
  const payload = {body};
  if(replyState) { payload.reply_to_id = replyState.msgId; cancelReply(); }

  try {
    if(groupId){
      const gr = await fetch(`${API}/groups/${groupId}/messages`,{method:'POST',headers:authHeaders(),body:JSON.stringify({group_id:groupId,body})});
      if(gr.ok) await loadGroupMessages(groupId,true);
    } else if(username){
      const mr = await fetch(`${API}/messages`,{method:'POST',headers:authHeaders(),body:JSON.stringify({to_username:username,body})});
      if(!mr.ok){
        const err = await mr.json().catch(()=>({}));
        showToast('Ошибка: '+(err.detail||mr.status));
        return;
      }
      await loadChatMessages(username,true);
    }
  } catch(e){ showToast('Ошибка подключения'); console.error(e); }

  // Typing stop
  sendTypingStop(username||groupId);
}

async function deleteMsgById(msgId) {
  if(!confirm('Удалить сообщение?')) return;
  try {
    await fetch(`${API}/messages/${msgId}`,{method:'DELETE',headers:authHeaders()});
    if(currentGroupId) loadGroupMessages(currentGroupId,true);
    else if(currentChatUser) loadChatMessages(currentChatUser,true);
  } catch {}
}

async function pinMsgById(msgId) {
  try {
    await fetch(`${API}/messages/${msgId}/pin`,{method:'POST',headers:authHeaders()});
    if(currentGroupId) loadGroupMessages(currentGroupId,true);
    else if(currentChatUser) loadChatMessages(currentChatUser,true);
    showToast('Сообщение закреплено');
  } catch {}
}

async function forwardMsg(msgId, body) {
  const to=prompt(`Переслать кому?
"${body.substring(0,60)}"`); if(!to?.trim())return;
  try {
    const r=await fetch(`${API}/messages/forward`,{method:'POST',headers:authHeaders(),body:JSON.stringify({msg_id:msgId,to_username:to.trim()})});
    showToast(r.ok?`Переслано ${to}`:'Пользователь не найден');
  } catch {}
}

// Typing indicator
function sendTypingStop(target) { /* placeholder */ }
function handleChatTyping() {
  const username = document.getElementById('chatWith')?.value;
  if(!username) return;
  onChatInput();
}

// ─── GROUP CHAT ──────────────────────────────────────────────────
async function openGroupChat(groupId, groupName) {
  currentView='chat'; currentGroupId=groupId; currentChatUser=null;
  showViewEx('chatView');
  document.getElementById('chatWith').value='';
  document.getElementById('chatGroupId').value=groupId;
  const titleEl=document.getElementById('chatTitle');
  const avatarEl=document.getElementById('chatHeaderAvatar');
  if(titleEl) titleEl.textContent=groupName;
  if(avatarEl){ avatarEl.innerHTML=''; avatarEl.style.background='linear-gradient(135deg,#9bb5c8,#7da8c8)'; avatarEl.textContent=groupName[0].toUpperCase(); avatarEl.style.color='#0a0a0b'; avatarEl.style.fontWeight='600'; }
  const statusEl=document.getElementById('chatHeaderStatus');
  if(statusEl) statusEl.textContent='Группа';
  await loadGroupMessages(groupId);
  clearInterval(chatPollInterval);
  chatPollInterval=setInterval(()=>{
    if(currentView==='chat'&&currentGroupId===groupId) loadGroupMessages(groupId,true);
    else clearInterval(chatPollInterval);
  },4000);
}

async function loadGroupMessages(groupId, silent=false) {
  const msgs=document.getElementById('chatMessages'); if(!msgs)return;
  if(!silent) msgs.innerHTML='<p style="color:var(--muted);padding:20px;text-align:center;font-size:13px">Загрузка…</p>';
  try {
    const r=await fetch(`${API}/groups/${groupId}/messages`,{headers:authHeaders()});
    const data=await r.json();
    const me=getUser();
    const wasAtBottom=msgs.scrollHeight-msgs.scrollTop-msgs.clientHeight<100;
    if(!data.length){
      msgs.innerHTML=`<div class="chat-empty"><div style="font-size:44px;opacity:.12;margin-bottom:12px">👥</div><div class="chat-empty-text">Напишите первым!</div></div>`;
      return;
    }
    let html=''; let lastDate='';
    data.forEach(m=>{
      const d=new Date(m.created_at).toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
      if(d!==lastDate){html+=`<div class="chat-date-sep"><span>${d}</span></div>`;lastDate=d;}
      html += renderMsgHtml(m, me, true);
    });
    msgs.innerHTML=html;
    if(!silent||wasAtBottom) msgs.scrollTop=msgs.scrollHeight;
  } catch {}
}

function openCreateGroupModal() { openModal('createGroupModal'); }
async function submitCreateGroup(e) {
  e.preventDefault();
  const name=document.getElementById('groupName').value.trim();
  const members=document.getElementById('groupMembers').value.split(',').map(s=>s.trim()).filter(Boolean);
  if(!name)return;
  try {
    const r=await fetch(`${API}/groups`,{method:'POST',headers:authHeaders(),body:JSON.stringify({name,member_usernames:members})});
    if(r.ok){
      const g=await r.json();
      closeModal('createGroupModal');
      document.getElementById('groupName').value='';
      document.getElementById('groupMembers').value='';
      openGroupChat(g.id,name);
      showToast(`Группа "${name}" создана`);
    }
  } catch {}
}

// ─── EMOJI PICKER ────────────────────────────────────────────────
function toggleEmojiPicker() {
  const panel=document.getElementById('emojiPickerPanel'); if(!panel)return;
  emojiPickerOpen=!emojiPickerOpen;
  panel.style.display=emojiPickerOpen?'flex':'none';
  if(emojiPickerOpen){
    renderEmojiPicker();
    setTimeout(()=>{const s=panel.querySelector('.emoji-search');if(s)s.focus();},80);
  }
}

function renderEmojiPicker(filter='') {
  const grid=document.getElementById('emojiPickerGrid'); if(!grid)return;
  let html='';
  const fLow=filter.toLowerCase();
  Object.entries(EMOJIS).forEach(([cat,emojis])=>{
    const filtered=fLow?emojis.filter(e=>{
      try{ return [...e].some(cp=>cp.codePointAt(0).toString(16).includes(fLow)); } catch{return false;}
    }):emojis;
    if(!filtered.length)return;
    html+=`<div class="emoji-cat-label">${cat}</div><div class="emoji-cat-grid">`;
    html+=filtered.map(em=>`<button type="button" class="emoji-grid-btn" onclick="insertEmoji('${em}')">${em}</button>`).join('');
    html+=`</div>`;
  });
  grid.innerHTML=html||'<div style="color:var(--muted);font-size:13px;padding:16px;text-align:center">Ничего не найдено</div>';
}

function insertEmoji(emoji) {
  const inp=document.getElementById('chatInput'); if(!inp)return;
  const pos=inp.selectionStart||inp.value.length;
  inp.value=inp.value.slice(0,pos)+emoji+inp.value.slice(pos);
  inp.focus(); inp.setSelectionRange(pos+emoji.length,pos+emoji.length);
  const p=document.getElementById('emojiPickerPanel'); if(p)p.style.display='none'; emojiPickerOpen=false;
}


// ─── MOBILE NAV ──────────────────────────────────────────────────
function setMobileNav(id) {
  document.querySelectorAll('.mobile-nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById(`mbn-${id}`)?.classList.add('active');
}
function installPWA() { if(window._pwaPrompt){window._pwaPrompt.prompt();} }
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  window._pwaPrompt = e;
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'flex';
});

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Handle PWA shortcuts (?action=...)
window.addEventListener('DOMContentLoaded', () => {
  const action = new URLSearchParams(location.search).get('action');
  if (action === 'new-post' && getToken()) {
    setTimeout(() => openModal('postModal'), 500);
  } else if (action === 'messages' && getToken()) {
    setTimeout(() => showMessagesView(), 500);
  }
});

// ─── TAGS (CUSTOM) ───────────────────────────────────────────────
function addCustomTag(inputId) {
  const inp=document.getElementById(inputId); if(!inp)return;
  const cur=inp.value;
  // Просто фокус — пользователь вводит свои теги через запятую
  inp.focus();
  showToast('Введите теги через запятую');
}

// ─── PWA/MISC ────────────────────────────────────────────────────
function exportPostPDF() {
  const title=document.querySelector('.post-full-title')?.textContent||'Пост';
  const body=document.querySelector('.post-full-body')?.innerHTML||'';
  const w=window.open('','_blank');
  if(!w)return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:0 20px;line-height:1.7}h1{margin-bottom:8px}code{background:#f0f0f0;padding:2px 5px;border-radius:3px}pre{background:#f0f0f0;padding:14px;border-radius:6px;overflow-x:auto}</style></head><body><h1>${title}</h1>${body}</body></html>`);
  w.document.close(); setTimeout(()=>w.print(),400);
}

// ═══════════════════════════════════════════════════════════════
// НОВЫЕ ФИЧИ v2
// ═══════════════════════════════════════════════════════════════

// ─── PROFILE COLORS ──────────────────────────────────────────────
function getProfileColor(username) {
  const colors = [
    'rgba(155,181,200,.08)','rgba(200,155,181,.08)',
    'rgba(155,200,171,.08)','rgba(200,200,155,.08)',
    'rgba(181,155,200,.08)','rgba(200,171,155,.08)'
  ];
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ─── DRAFT SAVING ────────────────────────────────────────────────
function saveDraft() {
  const title = document.getElementById('newTitle')?.value || '';
  const body = document.getElementById('newBody')?.value || '';
  const tags = document.getElementById('newTags')?.value || '';
  if (title || body) localStorage.setItem('postDraft', JSON.stringify({title, body, tags, ts: Date.now()}));
}

function restoreDraft() {
  try {
    const d = JSON.parse(localStorage.getItem('postDraft') || 'null');
    if (!d) return;
    const age = (Date.now() - d.ts) / 1000 / 3600;
    if (age > 24) { localStorage.removeItem('postDraft'); return; }
    // Show restore banner when modal opens
    const observer = new MutationObserver(() => {
      const modal = document.getElementById('postModal');
      if (modal?.classList.contains('open')) {
        observer.disconnect();
        if (!document.getElementById('draftBanner') && (d.title || d.body)) {
          const banner = document.createElement('div');
          banner.id = 'draftBanner';
          banner.className = 'draft-banner';
          banner.innerHTML = `Найден черновик <button onclick="applyDraft()" style="background:none;border:none;color:var(--cat-general);cursor:pointer;font-size:12px;font-family:var(--font-body)">Восстановить</button> <button onclick="discardDraft()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px">Удалить</button>`;
          modal.querySelector('.modal')?.prepend(banner);
        }
      }
    });
    observer.observe(document.body, {attributes:true, subtree:true, attributeFilter:['class']});
  } catch {}
}

function applyDraft() {
  try {
    const d = JSON.parse(localStorage.getItem('postDraft') || 'null');
    if (!d) return;
    const t = document.getElementById('newTitle'); if(t) t.value = d.title;
    const b = document.getElementById('newBody'); if(b) b.value = d.body;
    const tg = document.getElementById('newTags'); if(tg) tg.value = d.tags;
    document.getElementById('draftBanner')?.remove();
  } catch {}
}

function discardDraft() {
  localStorage.removeItem('postDraft');
  document.getElementById('draftBanner')?.remove();
}

// ─── TYPING INDICATOR ────────────────────────────────────────────
let typingTimer = null;
let isTyping = false;

async function onChatInput() {
  if (!isTyping && currentChatUser && getToken()) {
    isTyping = true;
    try {
      await fetch(`${API}/messages/typing?to_username=${encodeURIComponent(currentChatUser)}`,{method:'POST',headers:authHeaders()});
    } catch {}
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 2000);
}

function stopTyping() {
  isTyping = false;
  clearTimeout(typingTimer);
}

// ─── ПОИСК ПО ЧАТУ ───────────────────────────────────────────────
function toggleChatSearch() {
  const wrap = document.getElementById('chatSearchWrap');
  if (!wrap) return;
  const visible = wrap.classList.toggle('visible');
  if (visible) {
    const inp = document.getElementById('chatSearchInput');
    if (inp) { inp.value = ''; inp.focus(); }
  }
}

async function searchInChat(q) {
  if (!q.trim()) {
    // restore normal chat view
    if (currentChatUser) loadChatMessages(currentChatUser, true);
    else if (currentGroupId) loadGroupMessages(currentGroupId, true);
    return;
  }
  const msgs = document.getElementById('chatMessages'); if (!msgs) return;
  // Client-side search in current messages
  const rows = msgs.querySelectorAll('.chat-row');
  let found = 0;
  rows.forEach(row => {
    const bubble = row.querySelector('.chat-bubble');
    if (!bubble) return;
    const text = bubble.textContent.toLowerCase();
    if (text.includes(q.toLowerCase())) {
      row.style.opacity = '1';
      const hl = bubble.innerHTML.replace(new RegExp(q, 'gi'), m => `<mark style="background:rgba(155,181,200,.3);border-radius:2px">${m}</mark>`);
      bubble.innerHTML = hl;
      found++;
      row.scrollIntoView({behavior:'smooth', block:'nearest'});
    } else {
      row.style.opacity = '0.3';
    }
  });
  if (!found) showToast('Ничего не найдено');
}

function clearChatSearch() {
  // Restore original rendering
  if (currentChatUser) loadChatMessages(currentChatUser, true);
  else if (currentGroupId) loadGroupMessages(currentGroupId, true);
  const inp = document.getElementById('chatSearchInput'); if(inp) inp.value = '';
  const wrap = document.getElementById('chatSearchWrap'); if(wrap) wrap.classList.remove('visible');
}

// ─── ПОДЕЛИТЬСЯ ПОСТОМ (красивая карточка) ───────────────────────
function sharePost(postId, title) {
  const url = `${window.location.origin}${window.location.pathname}?post=${postId}`;
  if (navigator.share) {
    navigator.share({title, url}).catch(()=>{});
  } else {
    navigator.clipboard?.writeText(url);
    showToast('Ссылка скопирована');
  }
}

// ─── ЧЕРНОВИКИ ───────────────────────────────────────────────────
// Auto-save draft on input
document.addEventListener('input', e => {
  if (e.target.id === 'newTitle' || e.target.id === 'newBody' || e.target.id === 'newTags') {
    clearTimeout(window._draftTimer);
    window._draftTimer = setTimeout(saveDraft, 1000);
  }
  if (e.target.id === 'chatInput') onChatInput();
});

// Clear draft on successful post
const _origSubmitPost = submitPost;
submitPost = async function(e) {
  await _origSubmitPost(e);
  localStorage.removeItem('postDraft');
};

// ─── URL-BASED POST OPENING & DISCUSS FROM NEWS ──────────────────
(function() {
  const params = new URLSearchParams(window.location.search);

  // Open specific post by ID
  const postId = params.get('post');
  if (postId) {
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => openPost(postId), 300);
    });
    return;
  }

  // Open pre-filled post modal from news site (?discuss=1&title=...&body=...)
  if (params.get('discuss') === '1') {
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        const user = getUser();
        if (!user) {
          // Not logged in — open auth modal, save pending post
          const pending = {
            title: params.get('title') || '',
            body: params.get('body') || '',
            category: params.get('category') || 'general',
            tags: params.get('tags') || '',
            image_url: params.get('image_url') || '',
          };
          localStorage.setItem('pendingNewsPost', JSON.stringify(pending));
          showToast('Войдите чтобы опубликовать обсуждение');
          openAuthModal('login');
          return;
        }
        // Logged in — fill the modal and open it
        openModalWithNewsData({
          title: params.get('title') || '',
          body: params.get('body') || '',
          category: params.get('category') || 'general',
          tags: params.get('tags') || '',
          image_url: params.get('image_url') || '',
        });
      }, 500);
    });
  }
})();

function openModalWithNewsData(data) {
  const t = document.getElementById('newTitle'); if(t) t.value = data.title;
  const b = document.getElementById('newBody'); if(b) b.value = data.body;
  const c = document.getElementById('newCategory'); if(c) c.value = data.category;
  const tg = document.getElementById('newTags'); if(tg) tg.value = data.tags;
  const img = document.getElementById('imgurl-post'); if(img) img.value = data.image_url;
  openModal('postModal');
  showToast('Пост заполнен — проверьте и опубликуйте!');
  // Clean URL
  history.replaceState({}, '', location.pathname);
}

// Check pending news post after login
const _origRenderAuthArea = renderAuthArea;
renderAuthArea = function() {
  _origRenderAuthArea();
  const user = getUser();
  if (user) {
    const pending = localStorage.getItem('pendingNewsPost');
    if (pending) {
      localStorage.removeItem('pendingNewsPost');
      try {
        const data = JSON.parse(pending);
        setTimeout(() => openModalWithNewsData(data), 300);
      } catch(e) {}
    }
  }
};

// ─── MOBILE SWIPE BACK ───────────────────────────────────────────
let touchStartX = 0;
document.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, {passive:true});
document.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (dx > 80 && touchStartX < 40) {
    // swipe right from edge = go back
    if (currentView === 'post') showList();
    else if (currentView === 'chat') showMessagesView();
    else if (['profile','users','notif','feed','bookmarks','history','trending','search','admin'].includes(currentView)) showList();
  }
}, {passive:true});

// ─── KEYBOARD SHORTCUTS ──────────────────────────────────────────
document.addEventListener('keydown', e => {
  // Ctrl+K = global search
  if ((e.ctrlKey||e.metaKey) && e.key === 'k') {
    e.preventDefault();
    showGlobalSearch();
  }
  // Ctrl+Enter = submit post form if open
  if ((e.ctrlKey||e.metaKey) && e.key === 'Enter') {
    const modal = document.getElementById('postModal');
    if (modal?.classList.contains('open')) {
      document.getElementById('postModal')?.querySelector('form')?.requestSubmit();
    }
  }
});
// Добавляем typing listener на chatInput
document.addEventListener('DOMContentLoaded', ()=>{
  const ci = document.getElementById('chatInput');
  if(ci) ci.addEventListener('input', onChatInput);
});

// ─── TAG SUBSCRIPTIONS ───────────────────────────────────────────
let myTagSubs = new Set();

async function loadMyTagSubs() {
  if (!getToken()) return;
  try {
    const r = await fetch(`${API}/tags/subscriptions`, {headers: authHeaders()});
    if (!r.ok) return;
    const {tags} = await r.json();
    myTagSubs = new Set(tags.map(t => t.toLowerCase()));
  } catch {}
}

async function loadUserTagSubs(username) {
  // Only show tag sub UI for current user's profile
  const me = getUser();
  if (!me || me.username !== username) return;
  await loadMyTagSubs();
  renderTagSubsUI();
}

function renderTagSubsUI() {
  const el = document.getElementById('tagSubsSection');
  if (!el) return;
  el.innerHTML = myTagSubs.size > 0
    ? `<div style="margin-top:16px">
        <div style="font-size:12px;color:var(--muted);letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px">Мои теги</div>
        <div class="tags-wrap">${[...myTagSubs].map(t =>
          `<span class="tag" style="cursor:pointer;border-color:var(--cat-general);color:var(--cat-general)" onclick="unsubscribeTag('${escHtml(t)}')">${escHtml(t)} ×</span>`
        ).join('')}</div>
       </div>`
    : `<div style="font-size:13px;color:var(--muted);margin-top:12px">Нет подписок на теги. Нажми на тег в посте чтобы подписаться.</div>`;
}

async function toggleTagSubscription(tag) {
  if (!getToken()) { openAuthModal('login'); return; }
  const tagLow = tag.toLowerCase();
  try {
    if (myTagSubs.has(tagLow)) {
      await fetch(`${API}/tags/subscribe/${encodeURIComponent(tagLow)}`, {method:'DELETE', headers:authHeaders()});
      myTagSubs.delete(tagLow);
      showToast(`Отписан от #${tagLow}`);
    } else {
      await fetch(`${API}/tags/subscribe/${encodeURIComponent(tagLow)}`, {method:'POST', headers:authHeaders()});
      myTagSubs.add(tagLow);
      showToast(`Подписан на #${tagLow}`);
    }
  } catch {}
}

async function unsubscribeTag(tag) {
  await fetch(`${API}/tags/subscribe/${encodeURIComponent(tag)}`, {method:'DELETE', headers:authHeaders()});
  myTagSubs.delete(tag);
  renderTagSubsUI();
  showToast(`Отписан от #${tag}`);
}

async function showTagFeed() {
  if (!getToken()) { openAuthModal('login'); return; }
  currentView='list'; currentCat='tags'; currentTag=''; currentPage=1;
  showViewEx('listView');
  const list=document.getElementById('postsList');
  const empty=document.getElementById('emptyState');
  list.innerHTML='<p style="color:var(--muted);padding:20px 0">Загрузка ленты по тегам…</p>';
  empty.style.display='none';
  try {
    const r = await fetch(`${API}/feed/tags?page=1`, {headers:authHeaders()});
    const data = await r.json();
    if (!data.posts?.length) {
      list.innerHTML='';
      empty.style.display='block';
      empty.innerHTML='<p style="color:var(--muted)">Нет постов по твоим тегам. <a href="#" onclick="openMyProfile()" style="color:var(--text)">Подпишись на теги</a> в профиле.</p>';
      return;
    }
    totalPages = data.pages || 1;
    renderPosts(data.posts);
    renderPagination();
  } catch {}
}

// Load tag subs on init if logged in
document.addEventListener('DOMContentLoaded', () => {
  if (getToken()) loadMyTagSubs();
});