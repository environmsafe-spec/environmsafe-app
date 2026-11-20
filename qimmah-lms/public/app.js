/* منصة مدارس القمة — single-page app, no framework, no build step.
   All text from the server is inserted as text nodes (never innerHTML), except
   lesson text, which goes through fmt(): it escapes first, then adds markup. */
'use strict';

const APP_VERSION = '1.0.1';
const IN_APP = /QimmahApp/.test(navigator.userAgent);
const $main = () => document.getElementById('main');
let ME = null;

// ------------------------------------------------------------------ DOM helpers
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v; // only used with fmt() output
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
// Lesson text: "## " heading, "- " bullets, **bold**, blank line = paragraph.
function fmt(text) {
  const lines = esc(text).split(/\r?\n/);
  let html = '';
  let list = false;
  let para = [];
  const flush = () => {
    if (para.length) html += '<p>' + para.join('<br>') + '</p>';
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (/^[-•]\s+/.test(line)) {
      flush();
      if (!list) html += '<ul>';
      list = true;
      html += '<li>' + line.replace(/^[-•]\s+/, '') + '</li>';
      continue;
    }
    if (list) {
      html += '</ul>';
      list = false;
    }
    if (/^#{1,3}\s+/.test(line)) {
      flush();
      html += '<h4>' + line.replace(/^#{1,3}\s+/, '') + '</h4>';
    } else if (!line) flush();
    else para.push(line);
  }
  flush();
  if (list) html += '</ul>';
  return html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
const ar = (n) => (n === null || n === undefined ? '—' : String(n));
function when(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60000) return 'الآن';
  if (diff < 3600000) return `قبل ${Math.floor(diff / 60000)} دقيقة`;
  if (diff < 86400000) return `قبل ${Math.floor(diff / 3600000)} ساعة`;
  if (diff < 7 * 86400000) return `قبل ${Math.floor(diff / 86400000)} يوم`;
  return d.toLocaleDateString('ar-YE-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' });
}
const ROLE = { principal: 'مدير المدرسة', teacher: 'المدرس', student: 'تلميذ' };
const isStaff = () => ME && (ME.role === 'teacher' || ME.role === 'principal');

// ------------------------------------------------------------------ API
class ApiError extends Error {}
async function api(method, path, data) {
  const opt = { method, headers: { 'x-qimmah': '1' }, credentials: 'same-origin' };
  if (data !== undefined) {
    opt.headers['content-type'] = 'application/json';
    opt.body = JSON.stringify(data);
  }
  let res;
  try {
    res = await fetch('/api' + path, opt);
  } catch {
    throw new ApiError('تعذّر الاتصال بالإنترنت. تأكد من الاتصال ثم حاول مرة أخرى.');
  }
  let body = {};
  try {
    body = await res.json();
  } catch {}
  if (res.status === 401 && path !== '/login') {
    ME = null;
    if (location.hash !== '#/login') location.hash = '#/login';
    throw new ApiError(body.error || 'سجّل الدخول من جديد.');
  }
  if (!res.ok) throw new ApiError(body.error || 'حدث خطأ. حاول مرة أخرى.');
  return body;
}
const GET = (p) => api('GET', p);
const POST = (p, d) => api('POST', p, d || {});
const PUT = (p, d) => api('PUT', p, d || {});
const DEL = (p) => api('DELETE', p);

// ------------------------------------------------------------------ UI helpers
let toastTimer;
function toast(msg, kind = '') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, msg);
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}
function loading() {
  return h('div', { class: 'loading' }, h('div', { class: 'spinner' }), 'جارٍ التحميل…');
}
function errorBox(err, retry) {
  return h('div', { class: 'card center' }, h('div', { class: 'empty' }, h('div', { class: 'e' }, '📶'), h('p', null, err.message || String(err))),
    retry ? h('button', { class: 'btn', onclick: retry }, '🔄 إعادة المحاولة') : null);
}
function modal(title, content, { wide = false } = {}) {
  const bg = h('div', { class: 'modal-bg', onclick: (e) => e.target === bg && close() });
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: wide ? { maxWidth: '820px' } : null }, h('h2', null, title), content);
  bg.appendChild(box);
  document.body.appendChild(bg);
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  function close() {
    bg.remove();
    document.removeEventListener('keydown', onKey);
  }
  const first = box.querySelector('input, textarea, select');
  if (first) setTimeout(() => first.focus(), 50);
  return { close, box };
}
function confirmBox(msg, { yes = 'نعم', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal('تأكيد', h('div', null, h('p', null, msg),
      h('div', { class: 'row' },
        h('button', { class: 'btn ' + (danger ? 'red' : ''), onclick: () => { m.close(); resolve(true); } }, yes),
        h('button', { class: 'btn ghost', onclick: () => { m.close(); resolve(false); } }, 'إلغاء'))));
  });
}
// Generic form modal. fields: [{name,label,type,value,options,placeholder,help,required}]
function formModal(title, fields, onSubmit, { submit = 'حفظ' } = {}) {
  const err = h('div', { class: 'err hidden' });
  const inputs = {};
  const form = h('form', { novalidate: true }, err,
    fields.map((f) => {
      if (f.type === 'checkbox') {
        inputs[f.name] = h('input', { type: 'checkbox', checked: !!f.value });
        return h('label', { class: 'check' }, inputs[f.name], f.label);
      }
      if (f.type === 'select') {
        inputs[f.name] = h('select', null, f.options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(f.value) }, l)));
      } else if (f.type === 'textarea') {
        inputs[f.name] = h('textarea', { placeholder: f.placeholder || '', rows: f.rows || 6 });
        inputs[f.name].value = f.value ?? '';
      } else {
        inputs[f.name] = h('input', { type: f.type || 'text', placeholder: f.placeholder || '', inputmode: f.inputmode, dir: f.dir, min: f.min, max: f.max });
        inputs[f.name].value = f.value ?? '';
      }
      return h('label', { class: 'f' }, h('span', null, f.label), inputs[f.name], f.help ? h('small', { class: 'muted' }, f.help) : null);
    }),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, submit), h('button', { class: 'btn ghost', type: 'button', onclick: () => m.close() }, 'إلغاء')));
  const m = modal(title, form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {};
    for (const f of fields) {
      const el = inputs[f.name];
      data[f.name] = f.type === 'checkbox' ? el.checked : f.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
    }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await onSubmit(data, m);
      m.close();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
      m.box.scrollTop = 0;
    } finally {
      btn.disabled = false;
    }
  });
  return m;
}
async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg, 'ok');
    return r;
  } catch (e) {
    toast(e.message, 'bad');
    throw e;
  }
}

// ------------------------------------------------------------------ shell
function navItems() {
  if (!ME) return [];
  if (ME.role === 'student')
    return [['#/', '🏠', 'الرئيسية'], ['#/subjects', '📚', 'دروسي'], ['#/results', '⭐', 'نتائجي'], ['#/news', '📢', 'الإعلانات'], ['#/account', '👤', 'حسابي']];
  const items = [['#/', '🏠', 'الرئيسية'], ['#/manage', '✏️', 'المحتوى'], ['#/students', '📊', 'التلاميذ'], ['#/news', '📢', 'الإعلانات']];
  if (ME.role === 'principal') items.push(['#/users', '👥', 'المستخدمون']);
  items.push(['#/account', '👤', 'حسابي']);
  return items;
}
function renderShell() {
  const root = document.getElementById('app');
  root.textContent = '';
  if (!ME) {
    root.appendChild(h('main', { id: 'main', style: { padding: 0, maxWidth: 'none' } }));
    return;
  }
  const cur = '#/' + (location.hash.slice(2).split('/')[0] || '');
  const items = navItems();
  root.appendChild(
    h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '#/' }, h('img', { src: '/icons/icon-96.png', alt: '' }), h('span', null, 'مدارس القمة النموذجية')),
      h('nav', { class: 'topnav' }, items.map(([href, ico, label]) => h('a', { href, class: cur === href ? 'on' : '' }, `${ico} ${label}`))),
      h('div', { class: 'spacer' }),
      h('div', { class: 'who' }, ME.full_name))
  );
  root.appendChild(h('div', { id: 'offline', class: 'offline ' + (navigator.onLine ? 'hidden' : '') }, '⚠️ لا يوجد اتصال بالإنترنت — بعض الصفحات قد لا تعمل'));
  root.appendChild(h('main', { id: 'main' }));
  root.appendChild(h('nav', { class: 'bottomnav' }, items.map(([href, ico, label]) => h('a', { href, class: cur === href ? 'on' : '' }, h('span', { class: 'ico' }, ico), label))));
}
window.addEventListener('online', () => document.getElementById('offline')?.classList.add('hidden'));
window.addEventListener('offline', () => document.getElementById('offline')?.classList.remove('hidden'));

// ------------------------------------------------------------------ router
const routes = [];
const on = (pattern, fn, roles) => routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(\\d+)') + '$'), fn, roles });

async function router() {
  const path = location.hash.replace(/^#/, '') || '/';
  if (!ME && path !== '/login') {
    try {
      ME = (await GET('/me')).user;
    } catch {
      ME = null;
    }
    if (!ME) {
      location.hash = '#/login';
      return;
    }
  }
  if (ME && path === '/login') {
    location.hash = '#/';
    return;
  }
  renderShell();
  window.scrollTo(0, 0);
  const r = routes.find((x) => x.re.test(path));
  const main = $main();
  if (!r) {
    main.appendChild(h('div', { class: 'empty' }, h('div', { class: 'e' }, '🤔'), h('p', null, 'الصفحة غير موجودة.'), h('a', { class: 'btn', href: '#/' }, 'الرئيسية')));
    return;
  }
  if (r.roles && !r.roles.includes(ME.role)) {
    location.hash = '#/';
    return;
  }
  const args = path.match(r.re).slice(1).map(Number);
  main.appendChild(loading());
  try {
    const view = await r.fn(...args);
    if (main.isConnected) {
      main.textContent = '';
      add(main, [view]);
    }
  } catch (e) {
    if (main.isConnected) {
      main.textContent = '';
      main.appendChild(errorBox(e, router));
    }
  }
}
window.addEventListener('hashchange', router);

// ------------------------------------------------------------------ login
on('/login', async () => {
  const err = h('div', { class: 'err hidden', role: 'alert' });
  const u = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', dir: 'ltr', placeholder: 'مثال: 601', required: true });
  u.value = localStorage.getItem('qimmah.lastUser') || '';
  const p = h('input', { type: 'password', autocomplete: 'current-password', dir: 'ltr', required: true });
  const eye = h('button', { type: 'button', 'aria-label': 'إظهار كلمة المرور', onclick: () => { p.type = p.type === 'password' ? 'text' : 'password'; eye.textContent = p.type === 'password' ? '👁️' : '🙈'; } }, '👁️');
  const btn = h('button', { class: 'btn block amber', type: 'submit' }, 'دخول ⬅');
  const form = h('form', { class: 'card login' },
    h('img', { class: 'logo', src: '/icons/icon-192.png', alt: 'شعار مدارس القمة' }),
    h('h1', null, 'مدارس القمة النموذجية'),
    h('div', { class: 'sub' }, 'منصة التعلّم عن بُعد — الصف السادس'),
    err,
    h('label', { class: 'f' }, h('span', null, '👤 اسم المستخدم (رقمك)'), u),
    h('label', { class: 'f' }, h('span', null, '🔑 كلمة المرور'), h('div', { class: 'pw-wrap' }, p, eye)),
    btn,
    h('p', { class: 'small muted center', style: { marginTop: '14px' } }, 'نسيت كلمة المرور؟ اطلبها من المدرس أو إدارة المدرسة.'),
    IN_APP ? null : h('p', { class: 'center small' }, h('a', { href: '/download/qimmah.apk' }, '📱 تحميل تطبيق أندرويد')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    const username = u.value.trim().replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    const password = p.value.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    if (!username || !password) {
      err.textContent = 'اكتب اسم المستخدم وكلمة المرور.';
      err.classList.remove('hidden');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'جارٍ الدخول…';
    try {
      const r = await POST('/login', { username, password });
      ME = r.user;
      try { localStorage.setItem('qimmah.lastUser', username); } catch {}
      location.hash = '#/';
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'دخول ⬅';
    }
  });
  return h('div', { class: 'login-wrap' }, form);
});

// ------------------------------------------------------------------ home
on('/', async () => {
  const d = await GET('/home');
  return isStaff() ? staffHome(d) : studentHome(d);
});

function subjectCard(s, href) {
  const pct = s.total ? Math.round((s.done * 100) / s.total) : 0;
  return h('a', { class: 'card subject-card', href, style: { borderInlineStartColor: s.color } },
    h('div', { class: 'emoji' }, s.icon),
    h('div', { class: 'grow', style: { flex: 1 } },
      h('h2', null, s.title, s.published ? null : h('span', { class: 'pill warn', style: { marginInlineStart: '8px' } }, 'مخفي')),
      h('div', { class: 'muted small' }, ME.role === 'student' ? `أنهيت ${s.done} من ${s.total} درساً` : `${s.total} درساً`),
      ME.role === 'student' ? h('div', { class: 'bar' }, h('i', { style: { width: pct + '%' } })) : null));
}
function announcementCard(a) {
  return h('div', { class: 'card tight' },
    h('div', { class: 'row between' }, h('b', null, (a.pinned ? '📌 ' : '📢 ') + a.title), h('span', { class: 'muted small' }, when(a.created_at))),
    a.body ? h('div', { class: 'prose', style: { fontSize: '1rem', marginTop: '6px' }, html: fmt(a.body) }) : null,
    a.author ? h('div', { class: 'muted small' }, '— ' + a.author) : null);
}

function studentHome(d) {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'صباح الخير' : 'مساء الخير';
  return h('div', null,
    h('div', { class: 'card hello' }, h('h1', null, `${greet} يا ${d.user.full_name} 👋`), h('p', null, 'هيا نتعلّم شيئاً جديداً اليوم!')),
    d.next
      ? h('a', { class: 'card continue', href: '#/lesson/' + d.next.id },
          h('div', { class: 'play' }, '▶'),
          h('div', null, h('div', { class: 'muted small' }, 'درسك التالي'), h('b', null, d.next.title), h('div', { class: 'small muted' }, d.next.unit_title)))
      : h('div', { class: 'card continue' }, h('div', { class: 'play' }, '🏆'), h('b', null, 'أحسنت! أنهيت كل الدروس المتاحة.')),
    h('div', { class: 'grid two' },
      h('div', { class: 'card tile' }, h('div', { class: 'num' }, d.subjects.reduce((a, s) => a + s.done, 0)), h('div', { class: 'lbl' }, 'دروس أنهيتها')),
      h('div', { class: 'card tile' }, h('div', { class: 'num' }, d.stats.avg === null ? '—' : d.stats.avg + '%'), h('div', { class: 'lbl' }, 'متوسط درجاتك'))),
    h('h2', null, '📚 المواد'),
    d.subjects.length ? d.subjects.map((s) => subjectCard(s, '#/subject/' + s.id)) : h('div', { class: 'empty' }, 'لا توجد مواد بعد.'),
    d.announcements.length ? [h('h2', null, '📢 آخر الإعلانات'), d.announcements.slice(0, 3).map(announcementCard)] : null,
    d.recent.length
      ? [h('h2', null, '⭐ آخر نتائجي'), h('div', { class: 'card tight' }, d.recent.map((a) => h('a', { class: 'lesson-row', href: '#/attempt/' + a.id, style: { borderTop: 0 } },
          h('div', { class: 'state ' + (a.passed ? 'done' : '') }, a.passed ? '✓' : '✗'),
          h('div', { class: 't' }, h('b', null, a.title), h('span', null, when(a.submitted_at))),
          h('span', { class: 'pill ' + (a.passed ? 'ok' : 'no') }, a.percent + '%'))))]
      : null);
}

async function staffHome(d) {
  const o = await GET('/staff/overview');
  return h('div', null,
    h('div', { class: 'card hello' }, h('h1', null, `أهلاً ${d.user.full_name} 👋`), h('p', null, ROLE[d.user.role] + ' — لوحة المتابعة')),
    h('div', { class: 'grid two' },
      h('div', { class: 'card tile' }, h('div', { class: 'num' }, o.students), h('div', { class: 'lbl' }, 'تلميذاً')),
      h('div', { class: 'card tile' }, h('div', { class: 'num' }, o.active_week), h('div', { class: 'lbl' }, 'دخلوا هذا الأسبوع')),
      h('div', { class: 'card tile' }, h('div', { class: 'num' }, o.lessons_published), h('div', { class: 'lbl' }, 'درساً منشوراً')),
      h('div', { class: 'card tile' }, h('div', { class: 'num' }, o.quizzes), h('div', { class: 'lbl' }, 'تمريناً واختباراً')),
      h('div', { class: 'card tile' }, h('div', { class: 'num' }, o.attempts_week), h('div', { class: 'lbl' }, 'محاولة هذا الأسبوع')),
      h('div', { class: 'card tile' }, h('div', { class: 'num' }, o.avg === null ? '—' : o.avg + '%'), h('div', { class: 'lbl' }, 'متوسط الدرجات'))),
    h('div', { class: 'row', style: { marginBottom: '16px' } },
      h('a', { class: 'btn', href: '#/manage' }, '✏️ إدارة الدروس والاختبارات'),
      h('a', { class: 'btn ghost', href: '#/students' }, '📊 تقدّم التلاميذ'),
      h('button', { class: 'btn amber', onclick: () => announcementForm() }, '📢 إعلان جديد')),
    h('h2', null, '📚 المواد'),
    d.subjects.map((s) => subjectCard(s, '#/manage/subject/' + s.id)),
    h('h2', null, '🕑 آخر نتائج التلاميذ'),
    o.recent.length
      ? h('div', { class: 'card tight table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'التلميذ'), h('th', null, 'الاختبار'), h('th', null, 'الدرجة'), h('th', null, 'الوقت'))),
          h('tbody', null, o.recent.map((a) => h('tr', { class: 'click', onclick: () => (location.hash = '#/attempt/' + a.id) },
            h('td', null, a.full_name), h('td', null, a.title), h('td', null, h('span', { class: 'pill ' + (a.passed ? 'ok' : 'no') }, a.percent + '%')), h('td', { class: 'small muted' }, when(a.submitted_at)))))))
      : h('div', { class: 'card empty' }, 'لم يحلّ أي تلميذ اختباراً بعد.'));
}

// ------------------------------------------------------------------ subjects (student view; staff can preview)
on('/subjects', async () => {
  const d = await GET('/home');
  if (d.subjects.length === 1) {
    location.replace('#/subject/' + d.subjects[0].id);
    return h('div');
  }
  return h('div', null, h('h1', null, '📚 المواد'), d.subjects.map((s) => subjectCard(s, '#/subject/' + s.id)));
});

on('/subject/:id', async (sid) => {
  const d = await GET('/subjects/' + sid);
  const firstOpen = d.units.findIndex((u) => u.lessons.some((l) => !l.done));
  return h('div', null,
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'الرئيسية'), ' ‹ ', d.subject.title),
    h('h1', null, d.subject.icon + ' ' + d.subject.title),
    isStaff() ? h('p', null, h('a', { class: 'btn sm light', href: '#/manage/subject/' + sid }, '✏️ تعديل هذه المادة')) : null,
    d.units.map((u, i) =>
      h('details', { class: 'card unit', open: i === (firstOpen < 0 ? 0 : firstOpen) },
        h('summary', null, h('span', { class: 'badge-n' }, `${u.lessons.filter((l) => l.done).length}/${u.lessons.length}`), h('span', null, u.title), h('span', { class: 'chev' }, '‹')),
        u.description ? h('div', { class: 'muted small', style: { padding: '0 18px 10px' } }, u.description) : null,
        u.lessons.map((l) =>
          h('a', { class: 'lesson-row', href: '#/lesson/' + l.id },
            h('div', { class: 'state ' + (l.done ? 'done' : '') }, l.done ? '✓' : '📖'),
            h('div', { class: 't' }, h('b', null, l.title), h('span', null, l.quiz ? (l.quiz.best !== null ? `أفضل نتيجة في التمرين: ${l.quiz.best}%` : 'فيه تمرين') : l.summary)),
            l.published ? null : h('span', { class: 'pill warn' }, 'مخفي'))),
        u.tests.map((q) =>
          h('a', { class: 'lesson-row test', href: '#/quiz/' + q.id },
            h('div', { class: 'state' }, '📝'),
            h('div', { class: 't' }, h('b', null, q.title), h('span', null, `${q.n_questions} سؤالاً`)),
            q.best !== null ? h('span', { class: 'pill blue' }, q.best + '%') : null)))));
});

// ------------------------------------------------------------------ lesson
const KIND = {
  text: ['📄', 'نص وشرح'], video: ['🎬', 'فيديو'], audio: ['🎧', 'تسجيل صوتي'],
  file: ['📎', 'ملف مرفق'], link: ['🔗', 'رابط'], book: ['📖', 'صفحات الكتاب'],
};
function youTubeId(url) {
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
function driveId(url) {
  const m = String(url).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : null;
}
function renderItem(it) {
  const [ico, label] = KIND[it.kind] || ['📄', ''];
  const head = h('div', { class: 'item-head' }, h('div', { class: 'k' }, ico), h('h3', null, it.title || label));
  let body;
  if (it.kind === 'text') body = h('div', { class: 'prose', html: fmt(it.body) });
  else if (it.kind === 'video') {
    const yt = youTubeId(it.src);
    const dr = driveId(it.src);
    if (yt) body = h('div', { class: 'video-box' }, h('iframe', { src: `https://www.youtube-nocookie.com/embed/${yt}?rel=0`, title: it.title || 'فيديو', allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen', allowfullscreen: true, loading: 'lazy', referrerpolicy: 'strict-origin-when-cross-origin' }));
    else if (dr) body = h('div', { class: 'video-box' }, h('iframe', { src: `https://drive.google.com/file/d/${dr}/preview`, title: it.title || 'فيديو', allow: 'fullscreen', allowfullscreen: true, loading: 'lazy' }));
    else body = h('video', { class: 'plain', src: it.src, controls: true, preload: 'metadata', playsinline: true });
  } else if (it.kind === 'audio') {
    const dr = driveId(it.src);
    body = dr ? h('iframe', { src: `https://drive.google.com/file/d/${dr}/preview`, style: { width: '100%', height: '90px', border: 0 }, title: 'صوت' }) : h('audio', { src: it.src, controls: true, preload: 'none' });
  } else if (it.kind === 'file') body = h('a', { class: 'btn light', href: it.src, target: '_blank', rel: 'noopener' }, '⬇️ فتح / تحميل الملف');
  else if (it.kind === 'link') body = h('a', { class: 'btn light', href: it.src, target: '_blank', rel: 'noopener noreferrer' }, '🔗 فتح الرابط');
  else if (it.kind === 'book') body = bookPages(it.body);
  const desc = it.kind !== 'text' && it.kind !== 'book' && it.body ? h('div', { class: 'prose', style: { marginTop: '10px' }, html: fmt(it.body) }) : null;
  return h('section', { class: 'card item' }, head, body, desc);
}
function bookPages(json) {
  let b;
  try {
    b = JSON.parse(json);
  } catch {
    return h('p', { class: 'muted' }, 'تعذّر عرض الصفحات.');
  }
  const pages = [];
  for (let p = b.from; p <= b.to && pages.length < 41; p++) pages.push(p);
  const box = h('div', { class: 'pages' });
  const showFrom = (start) => {
    box.textContent = '';
    pages.slice(0, start).forEach((p) => box.appendChild(pageImg(b.book, p)));
    if (start < pages.length) box.appendChild(h('button', { class: 'btn light block', onclick: () => showFrom(pages.length) }, `عرض باقي الصفحات (${pages.length - start}) ⬇`));
  };
  showFrom(Math.min(2, pages.length));
  return h('div', null, h('p', { class: 'muted small' }, `الصفحات ${b.from}–${b.to} من الكتاب المدرسي. اضغط على الصفحة لتكبيرها.`), box);
}
function pageImg(book, p) {
  const src = `/book/${encodeURIComponent(book)}/p${String(p).padStart(3, '0')}.jpg`;
  return h('div', { class: 'page-img', onclick: () => zoom(src) }, h('img', { src, alt: `صفحة ${p}`, loading: 'lazy', width: 500, height: 680 }), h('div', { class: 'pn' }, `صفحة ${p}`));
}
function zoom(src) {
  const z = h('div', { class: 'zoom', onclick: (e) => e.target === z && z.remove() },
    h('button', { class: 'btn amber sm x', onclick: () => z.remove() }, '✕ إغلاق'), h('img', { src, alt: '' }));
  document.body.appendChild(z);
}

on('/lesson/:id', async (lid) => {
  const d = await GET('/lessons/' + lid);
  const L = d.lesson;
  const doneBtn = h('button', { class: 'btn block ' + (d.done ? 'light' : 'green'), disabled: d.done }, d.done ? '✅ أنهيت هذا الدرس' : '✔ أنهيت الدرس');
  doneBtn.addEventListener('click', async () => {
    await act(() => POST(`/lessons/${lid}/complete`), 'أحسنت! تم تسجيل إنهاء الدرس 🎉');
    doneBtn.disabled = true;
    doneBtn.className = 'btn block light';
    doneBtn.textContent = '✅ أنهيت هذا الدرس';
  });
  return h('div', null,
    h('div', { class: 'crumbs' }, h('a', { href: '#/subject/' + L.subject_id }, L.subject_title), ' ‹ ', L.unit_title),
    h('h1', null, L.title, L.published ? null : h('span', { class: 'pill warn', style: { marginInlineStart: '8px' } }, 'مخفي عن التلاميذ')),
    L.summary ? h('p', { class: 'muted' }, L.summary) : null,
    isStaff() ? h('p', null, h('a', { class: 'btn sm light', href: '#/manage/lesson/' + lid }, '✏️ تعديل الدرس')) : null,
    d.items.length ? d.items.map(renderItem) : h('div', { class: 'card empty' }, h('div', { class: 'e' }, '📭'), 'لم يُضف محتوى لهذا الدرس بعد.'),
    d.quizzes.map((q) =>
      h('a', { class: 'card continue', href: '#/quiz/' + q.id },
        h('div', { class: 'play' }, '📝'),
        h('div', null, h('b', null, q.title), h('div', { class: 'small muted' }, `${q.n_questions} أسئلة` + (q.best !== null ? ` — أفضل نتيجة: ${q.best}%` : ' — ابدأ الآن'))))),
    ME.role === 'student' ? doneBtn : null,
    h('div', { class: 'lesson-nav', style: { marginTop: '14px' } },
      d.prev ? h('a', { class: 'btn ghost', href: '#/lesson/' + d.prev.id }, '→ الدرس السابق') : h('span'),
      d.next ? h('a', { class: 'btn ghost', href: '#/lesson/' + d.next.id }, 'الدرس التالي ←') : h('span')));
});

// ------------------------------------------------------------------ quiz taking
on('/quiz/:id', async (qid) => {
  const d = await GET('/quizzes/' + qid);
  const Q = d.quiz;
  const used = d.attempts.length;
  const left = Q.max_attempts ? Q.max_attempts - used : Infinity;
  const wrap = h('div');
  const intro = () => {
    wrap.textContent = '';
    add(wrap, [
      h('div', { class: 'crumbs' }, Q.lesson_id ? h('a', { href: '#/lesson/' + Q.lesson_id }, Q.lesson_title) : h('a', { href: '#/subject/' + Q.subject_id }, Q.unit_title)),
      h('div', { class: 'card center' },
        h('div', { style: { fontSize: '3.5rem' } }, '📝'),
        h('h1', null, Q.title),
        Q.description ? h('p', null, Q.description) : null,
        h('p', { class: 'muted' }, `عدد الأسئلة: ${d.questions.length} — النجاح من ${Q.pass_percent}%`),
        Q.max_attempts ? h('p', { class: 'muted' }, `المحاولات المتبقية: ${Math.max(left, 0)} من ${Q.max_attempts}`) : null,
        !d.questions.length ? h('p', { class: 'err' }, 'لا توجد أسئلة بعد.') :
          left > 0 || ME.role !== 'student' ? h('button', { class: 'btn amber', style: { minWidth: '220px' }, onclick: () => take(0) }, used ? '🔁 حاول مرة أخرى' : '▶ ابدأ') :
          h('p', { class: 'err' }, 'انتهت المحاولات المسموح بها.')),
      used ? h('div', { class: 'card tight' }, h('h3', null, 'محاولاتي السابقة'),
        d.attempts.map((a) => h('a', { class: 'lesson-row', href: '#/attempt/' + a.id },
          h('div', { class: 'state ' + (a.passed ? 'done' : '') }, a.passed ? '✓' : '✗'),
          h('div', { class: 't' }, h('b', null, `${a.percent}%`), h('span', null, when(a.submitted_at)))))) : null,
    ]);
  };
  const answers = {};
  const take = (i) => {
    const q = d.questions[i];
    const n = d.questions.length;
    wrap.textContent = '';
    const dots = h('div', { class: 'qprogress' }, d.questions.map((x, j) =>
      h('button', { class: (j === i ? 'cur ' : '') + (answers[x.id] !== undefined && answers[x.id] !== '' ? 'ans' : ''), onclick: () => take(j), 'aria-label': `السؤال ${j + 1}` }, j + 1)));
    let input;
    if (q.kind === 'mcq') {
      input = h('div', { class: 'opts' }, q.options.map((o, k) =>
        h('button', { class: 'opt' + (answers[q.id] === k ? ' sel' : ''), onclick: () => { answers[q.id] = k; take(i); } }, h('span', { class: 'l' }, 'أبجدهوز'[k] || k + 1), h('span', null, o))));
    } else if (q.kind === 'tf') {
      input = h('div', { class: 'opts tf' },
        h('button', { class: 'opt' + (answers[q.id] === true ? ' sel' : ''), onclick: () => { answers[q.id] = true; take(i); } }, '✔ صح'),
        h('button', { class: 'opt' + (answers[q.id] === false ? ' sel' : ''), onclick: () => { answers[q.id] = false; take(i); } }, '✘ خطأ'));
    } else {
      const inp = h('input', { type: 'text', placeholder: 'اكتب إجابتك هنا', autocomplete: 'off', style: { fontSize: '1.3rem', textAlign: 'center' } });
      inp.value = answers[q.id] ?? '';
      inp.addEventListener('input', () => {
        answers[q.id] = inp.value;
        dots.children[i].classList.toggle('ans', inp.value.trim() !== '');
      });
      inp.addEventListener('keydown', (e) => e.key === 'Enter' && (i < n - 1 ? take(i + 1) : submit()));
      input = h('div', null, inp, h('p', { class: 'small muted' }, 'يمكنك كتابة الأرقام بالعربية أو الإنجليزية. للكسر اكتب مثل: 3/4'));
      setTimeout(() => inp.focus(), 50);
    }
    add(wrap, [
      h('div', { class: 'row between' }, h('b', null, Q.title), h('span', { class: 'pill blue' }, `السؤال ${i + 1} من ${n}`)),
      h('div', { class: 'bar', style: { margin: '10px 0 14px' } }, h('i', { style: { width: ((i + 1) * 100) / n + '%' } })),
      dots,
      h('div', { class: 'card' }, h('div', { class: 'qtext' }, q.text), input, q.points > 1 ? h('p', { class: 'small muted' }, `(${q.points} درجات)`) : null),
      h('div', { class: 'lesson-nav' },
        i > 0 ? h('button', { class: 'btn ghost', onclick: () => take(i - 1) }, '→ السابق') : h('button', { class: 'btn ghost', onclick: intro }, '✕ خروج'),
        i < n - 1 ? h('button', { class: 'btn', onclick: () => take(i + 1) }, 'التالي ←') : h('button', { class: 'btn green', onclick: submit }, '✔ تسليم الإجابات')),
    ]);
    window.scrollTo(0, 0);
  };
  const submit = async () => {
    const missing = d.questions.filter((q) => answers[q.id] === undefined || answers[q.id] === '').length;
    if (missing && !(await confirmBox(`لم تجب على ${missing} سؤال. هل تريد التسليم الآن؟`, { yes: 'نعم، سلّم' }))) return;
    wrap.textContent = '';
    wrap.appendChild(loading());
    try {
      const r = await POST(`/quizzes/${qid}/submit`, { answers });
      location.replace('#/attempt/' + r.attempt.id);
    } catch (e) {
      toast(e.message, 'bad');
      take(d.questions.length - 1);
    }
  };
  intro();
  return wrap;
});

on('/attempt/:id', async (aid) => {
  const { attempt: A, details } = await GET('/attempts/' + aid);
  const face = A.percent >= 90 ? '🏆' : A.percent >= 75 ? '🌟' : A.passed ? '👍' : '💪';
  const msg = A.percent >= 90 ? 'ممتاز! أداء رائع' : A.percent >= 75 ? 'أحسنت! عمل جيد جداً' : A.passed ? 'نجحت! استمر في التحسن' : 'لا بأس، راجع الدرس وحاول مرة أخرى';
  return h('div', null,
    h('div', { class: 'card result-hero' },
      h('div', { class: 'big' }, face),
      isStaff() ? h('p', { class: 'muted' }, 'التلميذ: ' + A.student_name) : null,
      h('h1', null, A.quiz_title),
      h('div', { class: 'pct' }, A.percent + '%'),
      h('p', null, `${A.score} من ${A.max_score} درجة — ${msg}`),
      h('span', { class: 'pill ' + (A.passed ? 'ok' : 'no') }, A.passed ? 'ناجح ✓' : `لم تصل إلى ${A.pass_percent}%`),
      h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '16px' } },
        h('a', { class: 'btn amber', href: '#/quiz/' + A.quiz_id }, '🔁 حاول مرة أخرى'),
        A.lesson_id ? h('a', { class: 'btn ghost', href: '#/lesson/' + A.lesson_id }, '📖 العودة للدرس') : h('a', { class: 'btn ghost', href: '#/' }, '🏠 الرئيسية'))),
    h('h2', null, 'مراجعة الإجابات'),
    details.map((q, i) =>
      h('div', { class: 'card tight review ' + (q.correct ? 'ok' : 'no') },
        h('div', { class: 'row between' }, h('b', null, `${i + 1}. ${q.correct ? '✅' : '❌'}`), h('span', { class: 'small muted' }, `${q.correct ? q.points : 0}/${q.points}`)),
        h('div', { style: { whiteSpace: 'pre-wrap', margin: '6px 0' } }, q.text),
        h('div', { class: 'small' }, 'إجابتك: ', h('b', null, q.given || '— لم تجب —')),
        !q.correct && q.answer !== null ? h('div', { class: 'small', style: { color: 'var(--green)' } }, 'الإجابة الصحيحة: ', h('b', null, q.answer)) : null,
        q.explanation ? h('div', { class: 'small muted', style: { marginTop: '4px' } }, '💡 ' + q.explanation) : null)));
});

on('/results', async () => {
  const d = await GET('/attempts/mine');
  const pct = d.lessons_total ? Math.round((d.lessons_done * 100) / d.lessons_total) : 0;
  return h('div', null,
    h('h1', null, '⭐ نتائجي'),
    h('div', { class: 'card' }, h('b', null, `أنهيت ${d.lessons_done} من ${d.lessons_total} درساً`), h('div', { class: 'bar green' }, h('i', { style: { width: pct + '%' } }))),
    d.attempts.length
      ? h('div', { class: 'card tight' }, d.attempts.map((a) =>
          h('a', { class: 'lesson-row', href: '#/attempt/' + a.id },
            h('div', { class: 'state ' + (a.passed ? 'done' : '') }, a.passed ? '✓' : '✗'),
            h('div', { class: 't' }, h('b', null, a.title), h('span', null, when(a.submitted_at))),
            h('span', { class: 'pill ' + (a.passed ? 'ok' : 'no') }, a.percent + '%'))))
      : h('div', { class: 'card empty' }, h('div', { class: 'e' }, '📝'), 'لم تحلّ أي تمرين بعد. ابدأ من صفحة الدروس!'));
});

// ------------------------------------------------------------------ announcements
on('/news', async () => {
  const d = await GET('/announcements');
  return h('div', null,
    h('div', { class: 'row between' }, h('h1', null, '📢 الإعلانات'), isStaff() ? h('button', { class: 'btn amber sm', onclick: () => announcementForm() }, '+ إعلان جديد') : null),
    d.announcements.length
      ? d.announcements.map((a) => {
          const c = announcementCard(a);
          if (isStaff())
            c.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } },
              h('button', { class: 'btn xs light', onclick: () => announcementForm(a) }, 'تعديل'),
              h('button', { class: 'btn xs red', onclick: async () => { if (await confirmBox('حذف هذا الإعلان؟', { danger: true, yes: 'حذف' })) { await act(() => DEL('/announcements/' + a.id), 'تم الحذف'); router(); } } }, 'حذف')));
          return c;
        })
      : h('div', { class: 'card empty' }, 'لا توجد إعلانات.'));
});
function announcementForm(a) {
  formModal(a ? 'تعديل الإعلان' : 'إعلان جديد', [
    { name: 'title', label: 'العنوان', value: a?.title },
    { name: 'body', label: 'النص', type: 'textarea', value: a?.body, rows: 5 },
    { name: 'pinned', label: '📌 تثبيت في الأعلى', type: 'checkbox', value: a?.pinned },
  ], async (v) => {
    if (a) await PUT('/announcements/' + a.id, v);
    else await POST('/announcements', v);
    toast('تم حفظ الإعلان ✓', 'ok');
    router();
  }, { submit: a ? 'حفظ' : 'نشر' });
}

// ------------------------------------------------------------------ account
on('/account', async () => {
  const err = h('div', { class: 'err hidden' });
  const cur = h('input', { type: 'password', autocomplete: 'current-password', dir: 'ltr' });
  const nx = h('input', { type: 'password', autocomplete: 'new-password', dir: 'ltr' });
  const nx2 = h('input', { type: 'password', autocomplete: 'new-password', dir: 'ltr' });
  const form = h('form', { class: 'card' }, h('h2', null, '🔑 تغيير كلمة المرور'), err,
    h('label', { class: 'f' }, h('span', null, 'كلمة المرور الحالية'), cur),
    h('label', { class: 'f' }, h('span', null, 'كلمة المرور الجديدة'), nx, h('small', { class: 'muted' }, ME.role === 'student' ? '4 أحرف أو أرقام على الأقل' : '8 أحرف على الأقل')),
    h('label', { class: 'f' }, h('span', null, 'أعد كتابة كلمة المرور الجديدة'), nx2),
    h('button', { class: 'btn', type: 'submit' }, 'حفظ'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    if (nx.value !== nx2.value) {
      err.textContent = 'كلمتا المرور الجديدتان غير متطابقتين.';
      err.classList.remove('hidden');
      return;
    }
    try {
      await POST('/me/password', { current: cur.value, next: nx.value });
      toast('تم تغيير كلمة المرور ✓', 'ok');
      form.reset();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });
  return h('div', null,
    h('div', { class: 'card hello' }, h('h1', null, '👤 ' + ME.full_name), h('p', null, `${ROLE[ME.role]} — اسم المستخدم: `, h('span', { class: 'ltr' }, ME.username))),
    form,
    IN_APP ? null : h('div', { class: 'card' }, h('h2', null, '📱 تطبيق أندرويد'), h('p', null, 'حمّل التطبيق وثبّته على الهاتف لتدخل بضغطة واحدة.'), h('a', { class: 'btn light', href: '/download/qimmah.apk' }, '⬇️ تحميل التطبيق')),
    h('button', { class: 'btn red block', onclick: logout }, '🚪 تسجيل الخروج'),
    h('p', { class: 'center small muted', style: { marginTop: '16px' } }, `الإصدار ${APP_VERSION}`));
});
async function logout() {
  try {
    await POST('/logout');
  } catch {}
  ME = null;
  if ('caches' in window) caches.delete('qimmah-api').catch(() => {});
  location.hash = '#/login';
}

// ------------------------------------------------------------------ staff: students & results
on('/students', async () => {
  const d = await GET('/staff/students');
  const filter = h('input', { type: 'text', placeholder: '🔍 ابحث بالاسم أو الرقم' });
  const tbody = h('tbody');
  const draw = () => {
    const f = filter.value.trim();
    tbody.textContent = '';
    d.students.filter((s) => !f || s.full_name.includes(f) || s.username.includes(f)).forEach((s) => {
      const pct = d.lessons_total ? Math.round((s.done * 100) / d.lessons_total) : 0;
      tbody.appendChild(h('tr', { class: 'click', onclick: () => (location.hash = '#/students/' + s.id) },
        h('td', null, h('b', null, s.full_name), h('div', { class: 'small muted' }, h('span', { class: 'ltr' }, s.username)), s.active ? null : h('span', { class: 'pill no' }, 'موقوف')),
        h('td', null, `${s.done}/${d.lessons_total}`, h('span', { class: 'minibar' }, h('i', { style: { width: pct + '%' } }))),
        h('td', null, s.attempts),
        h('td', null, s.avg === null ? '—' : h('span', { class: 'pill ' + (s.avg >= 50 ? 'ok' : 'no') }, s.avg + '%')),
        h('td', { class: 'small muted' }, when(s.last_login))));
    });
  };
  filter.addEventListener('input', draw);
  draw();
  return h('div', null,
    h('h1', null, '📊 تقدّم التلاميذ'),
    h('div', { class: 'card tight' }, filter),
    h('div', { class: 'card tight table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'التلميذ'), h('th', null, 'الدروس'), h('th', null, 'المحاولات'), h('th', null, 'المتوسط'), h('th', null, 'آخر دخول'))), tbody)),
    h('p', { class: 'small muted' }, 'المتوسط = متوسط أفضل نتيجة للتلميذ في كل اختبار.'));
}, ['teacher', 'principal']);

on('/students/:id', async (sid) => {
  const d = await GET('/staff/students/' + sid);
  const done = d.lessons.filter((l) => l.completed_at).length;
  return h('div', null,
    h('div', { class: 'crumbs' }, h('a', { href: '#/students' }, 'التلاميذ'), ' ‹ ', d.student.full_name),
    h('div', { class: 'card hello' }, h('h1', null, d.student.full_name), h('p', null, 'اسم المستخدم: ', h('span', { class: 'ltr' }, d.student.username), ' — آخر دخول: ', when(d.student.last_login))),
    h('div', { class: 'grid two' },
      h('div', { class: 'card tile' }, h('div', { class: 'num' }, `${done}/${d.lessons.length}`), h('div', { class: 'lbl' }, 'دروس منتهية')),
      h('div', { class: 'card tile' }, h('div', { class: 'num' }, d.attempts.length), h('div', { class: 'lbl' }, 'محاولة اختبار'))),
    h('h2', null, '📝 الاختبارات'),
    d.attempts.length
      ? h('div', { class: 'card tight table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'الاختبار'), h('th', null, 'الدرجة'), h('th', null, 'الوقت'))),
          h('tbody', null, d.attempts.map((a) => h('tr', { class: 'click', onclick: () => (location.hash = '#/attempt/' + a.id) },
            h('td', null, a.title), h('td', null, h('span', { class: 'pill ' + (a.passed ? 'ok' : 'no') }, `${a.percent}%`), ` (${a.score}/${a.max_score})`), h('td', { class: 'small muted' }, when(a.submitted_at)))))))
      : h('div', { class: 'card empty' }, 'لا توجد محاولات بعد.'),
    h('h2', null, '📖 الدروس'),
    h('div', { class: 'card tight' }, d.lessons.map((l) => h('div', { class: 'lesson-row', style: { minHeight: '48px', padding: '8px 4px' } },
      h('div', { class: 'state ' + (l.completed_at ? 'done' : '') }, l.completed_at ? '✓' : '·'),
      h('div', { class: 't' }, h('b', null, l.title), h('span', null, l.completed_at ? 'أنهاه ' + when(l.completed_at) : l.unit_title))))));
}, ['teacher', 'principal']);

on('/quiz-results/:id', async (qid) => {
  const d = await GET(`/staff/quizzes/${qid}/results`);
  const took = d.results.filter((r) => r.attempts > 0);
  const avg = took.length ? Math.round(took.reduce((a, r) => a + r.best, 0) / took.length) : null;
  return h('div', null,
    h('div', { class: 'crumbs' }, h('a', { href: '#/manage/quiz/' + qid }, 'تعديل الاختبار')),
    h('h1', null, '📊 نتائج: ' + d.quiz.title),
    h('div', { class: 'grid two' },
      h('div', { class: 'card tile' }, h('div', { class: 'num' }, `${took.length}/${d.results.length}`), h('div', { class: 'lbl' }, 'حلّوا الاختبار')),
      h('div', { class: 'card tile' }, h('div', { class: 'num' }, avg === null ? '—' : avg + '%'), h('div', { class: 'lbl' }, 'متوسط أفضل نتيجة')),
      h('div', { class: 'card tile' }, h('div', { class: 'num' }, took.filter((r) => r.best >= d.quiz.pass_percent).length), h('div', { class: 'lbl' }, 'ناجحون'))),
    h('div', { class: 'card tight table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'التلميذ'), h('th', null, 'أفضل نتيجة'), h('th', null, 'المحاولات'), h('th', null, 'آخر محاولة'))),
      h('tbody', null, d.results.map((r) => h('tr', { class: r.best_attempt ? 'click' : '', onclick: () => r.best_attempt && (location.hash = '#/attempt/' + r.best_attempt) },
        h('td', null, r.full_name), h('td', null, r.best === null ? h('span', { class: 'pill' }, 'لم يحل') : h('span', { class: 'pill ' + (r.best >= d.quiz.pass_percent ? 'ok' : 'no') }, r.best + '%')),
        h('td', null, r.attempts), h('td', { class: 'small muted' }, when(r.last_at))))))));
}, ['teacher', 'principal']);

// ------------------------------------------------------------------ staff: content management
const pubPill = (p) => h('span', { class: 'pill ' + (p ? 'ok' : 'warn') }, p ? 'منشور' : 'مخفي');
async function move(table, list, index, dir) {
  const ids = list.map((x) => x.id);
  const j = index + dir;
  if (j < 0 || j >= ids.length) return;
  [ids[index], ids[j]] = [ids[j], ids[index]];
  await act(() => POST('/manage/reorder', { table, ids }));
  router();
}
const upDown = (table, list, i) => [
  h('button', { class: 'btn xs ghost', title: 'لأعلى', disabled: i === 0, onclick: () => move(table, list, i, -1) }, '▲'),
  h('button', { class: 'btn xs ghost', title: 'لأسفل', disabled: i === list.length - 1, onclick: () => move(table, list, i, 1) }, '▼'),
];
async function del(path, what) {
  if (!(await confirmBox(`هل تريد حذف ${what}؟ لا يمكن التراجع.`, { danger: true, yes: 'نعم، احذف' }))) return;
  await act(() => DEL(path), 'تم الحذف');
  router();
}

on('/manage', async () => {
  const d = await GET('/home');
  return h('div', null,
    h('div', { class: 'row between' }, h('h1', null, '✏️ إدارة المحتوى'), h('button', { class: 'btn amber sm', onclick: () => subjectForm() }, '+ مادة جديدة')),
    h('p', { class: 'muted' }, 'اختر المادة لإضافة الوحدات والدروس والفيديوهات والصوتيات والاختبارات.'),
    d.subjects.map((s, i) =>
      h('div', { class: 'card' },
        h('div', { class: 'row' },
          h('div', { style: { fontSize: '2rem' } }, s.icon),
          h('div', { class: 'grow' }, h('h2', { style: { margin: 0 } }, s.title), h('div', { class: 'small muted' }, `${s.total} درساً`), pubPill(s.published)),
          h('a', { class: 'btn sm', href: '#/manage/subject/' + s.id }, 'فتح ←')),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          upDown('subjects', d.subjects, i),
          h('button', { class: 'btn xs light', onclick: () => subjectForm(s) }, 'تعديل'),
          h('button', { class: 'btn xs red', onclick: () => del('/manage/subjects/' + s.id, `مادة "${s.title}" بكل دروسها واختباراتها`) }, 'حذف')))));
}, ['teacher', 'principal']);

function subjectForm(s) {
  formModal(s ? 'تعديل المادة' : 'مادة جديدة', [
    { name: 'title', label: 'اسم المادة', value: s?.title, placeholder: 'مثال: العلوم' },
    { name: 'description', label: 'وصف قصير', value: s?.description },
    { name: 'icon', label: 'رمز (إيموجي)', value: s?.icon || '📘', help: 'مثل: 🔢 🔬 📖 🌍 🕌' },
    { name: 'color', label: 'اللون', type: 'select', value: s?.color || '#2563eb', options: [['#2563eb', 'أزرق'], ['#16a34a', 'أخضر'], ['#f59e0b', 'برتقالي'], ['#dc2626', 'أحمر'], ['#7c3aed', 'بنفسجي'], ['#0891b2', 'سماوي']] },
    { name: 'published', label: 'منشورة للتلاميذ', type: 'checkbox', value: s ? s.published : true },
  ], async (v) => {
    if (s) await PUT('/manage/subjects/' + s.id, v);
    else await POST('/manage/subjects', v);
    toast('تم الحفظ ✓', 'ok');
    router();
  });
}

on('/manage/subject/:id', async (sid) => {
  const d = await GET('/subjects/' + sid);
  return h('div', null,
    h('div', { class: 'crumbs' }, h('a', { href: '#/manage' }, 'إدارة المحتوى'), ' ‹ ', d.subject.title),
    h('div', { class: 'row between' }, h('h1', null, d.subject.icon + ' ' + d.subject.title),
      h('div', { class: 'row' }, h('a', { class: 'btn sm ghost', href: '#/subject/' + sid }, '👁️ معاينة'), h('button', { class: 'btn sm amber', onclick: () => unitForm(sid) }, '+ وحدة جديدة'))),
    d.units.length ? null : h('div', { class: 'card empty' }, 'لا توجد وحدات. أضف أول وحدة.'),
    d.units.map((u, i) =>
      h('div', { class: 'card' },
        h('div', null,
          h('h2', { style: { margin: 0 } }, u.title), pubPill(u.published),
          h('div', { class: 'row', style: { marginTop: '8px' } }, upDown('units', d.units, i),
            h('button', { class: 'btn xs light', onclick: () => unitForm(sid, u) }, 'تعديل'),
            h('button', { class: 'btn xs red', onclick: () => del('/manage/units/' + u.id, `الوحدة "${u.title}" بكل دروسها`) }, 'حذف'))),
        h('div', { style: { marginTop: '10px' } },
          u.lessons.map((l, j) =>
            h('div', { class: 'mrow' },
              h('div', { class: 't' }, h('b', null, '📖 ' + l.title), ' ', pubPill(l.published), l.quiz ? h('span', { class: 'pill blue', style: { marginInlineStart: '4px' } }, '📝 تمرين') : null),
              h('div', { class: 'acts' }, upDown('lessons', u.lessons, j),
                h('a', { class: 'btn xs', href: '#/manage/lesson/' + l.id }, '✏️ تعديل'),
                h('button', { class: 'btn xs red', onclick: () => del('/manage/lessons/' + l.id, `الدرس "${l.title}"`) }, 'حذف')))),
          u.tests.map((q) =>
            h('div', { class: 'mrow' },
              h('div', { class: 't' }, h('b', null, '📝 ' + q.title), ' ', pubPill(q.published), h('span', { class: 'small muted' }, ` ${q.n_questions} سؤالاً`)),
              h('div', { class: 'acts' }, h('a', { class: 'btn xs', href: '#/manage/quiz/' + q.id }, '✏️ تعديل'), h('a', { class: 'btn xs light', href: '#/quiz-results/' + q.id }, '📊 النتائج'))))),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'btn sm light', onclick: () => lessonForm(u.id) }, '+ درس جديد'),
          h('button', { class: 'btn sm light', onclick: () => quizForm({ unit_id: u.id }) }, '+ اختبار للوحدة')))));
}, ['teacher', 'principal']);

function unitForm(subjectId, u) {
  formModal(u ? 'تعديل الوحدة' : 'وحدة جديدة', [
    { name: 'title', label: 'عنوان الوحدة', value: u?.title, placeholder: 'مثال: الوحدة الخامسة: الهندسة' },
    { name: 'description', label: 'وصف قصير', type: 'textarea', rows: 3, value: u?.description },
    { name: 'published', label: 'منشورة للتلاميذ', type: 'checkbox', value: u ? u.published : true },
  ], async (v) => {
    if (u) await PUT('/manage/units/' + u.id, v);
    else await POST('/manage/units', { ...v, subject_id: subjectId });
    toast('تم الحفظ ✓', 'ok');
    router();
  });
}
function lessonForm(unitId) {
  formModal('درس جديد', [
    { name: 'title', label: 'عنوان الدرس', placeholder: 'مثال: ٥:١ المضلعات' },
    { name: 'summary', label: 'جملة قصيرة عن الدرس', placeholder: 'ماذا سيتعلم التلميذ؟' },
    { name: 'published', label: 'منشور للتلاميذ', type: 'checkbox', value: false },
  ], async (v) => {
    const r = await POST('/manage/lessons', { ...v, unit_id: unitId });
    toast('تم إنشاء الدرس ✓ أضف الآن المحتوى', 'ok');
    location.hash = '#/manage/lesson/' + r.id;
  }, { submit: 'إنشاء' });
}
function quizForm(target, q) {
  formModal(q ? 'إعدادات الاختبار' : 'اختبار جديد', [
    { name: 'title', label: 'العنوان', value: q?.title, placeholder: 'مثال: تمرين على الكسور' },
    { name: 'description', label: 'تعليمات للتلميذ (اختياري)', type: 'textarea', rows: 3, value: q?.description },
    { name: 'pass_percent', label: 'درجة النجاح %', type: 'number', value: q?.pass_percent ?? 50, inputmode: 'numeric', min: 0, max: 100 },
    { name: 'max_attempts', label: 'عدد المحاولات المسموح (0 = غير محدود)', type: 'number', value: q?.max_attempts ?? 0, inputmode: 'numeric', min: 0, max: 100 },
    { name: 'show_answers', label: 'إظهار الإجابات الصحيحة بعد التسليم', type: 'checkbox', value: q ? q.show_answers : true },
    { name: 'shuffle', label: 'ترتيب الأسئلة عشوائياً', type: 'checkbox', value: q ? q.shuffle : false },
    { name: 'published', label: 'منشور للتلاميذ', type: 'checkbox', value: q ? q.published : false },
  ], async (v) => {
    if (q) {
      await PUT('/manage/quizzes/' + q.id, v);
      toast('تم الحفظ ✓', 'ok');
      router();
    } else {
      const r = await POST('/manage/quizzes', { ...v, ...target });
      toast('تم إنشاء الاختبار ✓ أضف الأسئلة الآن', 'ok');
      location.hash = '#/manage/quiz/' + r.id;
    }
  }, { submit: q ? 'حفظ' : 'إنشاء' });
}

on('/manage/lesson/:id', async (lid) => {
  const d = await GET('/lessons/' + lid);
  const L = d.lesson;
  const subj = await GET('/subjects/' + L.subject_id);
  return h('div', null,
    h('div', { class: 'crumbs' }, h('a', { href: '#/manage/subject/' + L.subject_id }, L.subject_title), ' ‹ ', L.unit_title),
    h('div', { class: 'row between' }, h('h1', null, '✏️ ' + L.title), h('a', { class: 'btn sm ghost', href: '#/lesson/' + lid }, '👁️ معاينة كتلميذ')),
    h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('div', null, h('b', null, 'بيانات الدرس'), ' ', pubPill(L.published)),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm ' + (L.published ? 'ghost' : 'green'), onclick: async () => { await act(() => PUT('/manage/lessons/' + lid, { published: !L.published }), L.published ? 'تم إخفاء الدرس' : 'تم نشر الدرس ✓'); router(); } }, L.published ? '🙈 إخفاء' : '📢 نشر للتلاميذ'),
          h('button', { class: 'btn sm light', onclick: () => formModal('بيانات الدرس', [
            { name: 'title', label: 'العنوان', value: L.title },
            { name: 'summary', label: 'جملة قصيرة', value: L.summary },
            { name: 'unit_id', label: 'الوحدة', type: 'select', value: L.unit_id, options: subj.units.map((u) => [u.id, u.title]) },
          ], async (v) => { await PUT('/manage/lessons/' + lid, { ...v, unit_id: Number(v.unit_id) }); toast('تم الحفظ ✓', 'ok'); router(); }) }, 'تعديل'))),
      L.summary ? h('p', { class: 'muted', style: { margin: '8px 0 0' } }, L.summary) : null),
    h('div', { class: 'row between' }, h('h2', null, '📦 محتوى الدرس'), h('button', { class: 'btn amber', onclick: () => chooseKind(lid) }, '+ إضافة محتوى')),
    d.items.length
      ? d.items.map((it, i) => {
          const [ico, label] = KIND[it.kind];
          return h('div', { class: 'card tight' },
            h('div', { class: 'row' }, h('div', { style: { fontSize: '1.6rem' } }, ico),
              h('div', { class: 'grow' }, h('b', null, it.title || label), h('div', { class: 'small muted' }, label + (it.media_id ? ' — ملف مرفوع' : it.url ? ' — رابط' : '')))),
            h('div', { class: 'row', style: { marginTop: '8px' } }, upDown('items', d.items, i),
                h('button', { class: 'btn xs light', onclick: () => itemForm(lid, it.kind, it) }, 'تعديل'),
                h('button', { class: 'btn xs red', onclick: () => del('/manage/items/' + it.id, `"${it.title || label}"`) }, 'حذف')));
        })
      : h('div', { class: 'card empty' }, h('div', { class: 'e' }, '📭'), 'الدرس فارغ. اضغط "إضافة محتوى" لإضافة شرح أو فيديو أو صوت أو ملف.'),
    h('div', { class: 'row between' }, h('h2', null, '📝 تمارين الدرس'), h('button', { class: 'btn light', onclick: () => quizForm({ lesson_id: lid }) }, '+ تمرين جديد')),
    d.quizzes.length
      ? d.quizzes.map((q) => h('div', { class: 'card tight row' }, h('div', { class: 'grow' }, h('b', null, q.title), ' ', pubPill(q.published), h('div', { class: 'small muted' }, `${q.n_questions} أسئلة`)),
          h('a', { class: 'btn xs', href: '#/manage/quiz/' + q.id }, '✏️ الأسئلة'), h('a', { class: 'btn xs light', href: '#/quiz-results/' + q.id }, '📊 النتائج')))
      : h('div', { class: 'card empty' }, 'لا يوجد تمرين لهذا الدرس.'));
}, ['teacher', 'principal']);

function chooseKind(lid) {
  const m = modal('ماذا تريد أن تضيف؟', h('div', { class: 'kind-grid' }, Object.entries(KIND).map(([k, [ico, label]]) =>
    h('button', { onclick: () => { m.close(); itemForm(lid, k); } }, h('span', null, ico), label))));
}

function itemForm(lid, kind, it) {
  const [ico, label] = KIND[kind];
  const err = h('div', { class: 'err hidden' });
  const title = h('input', { type: 'text', placeholder: 'عنوان يظهر للتلميذ' });
  title.value = it?.title || '';
  const fields = [h('label', { class: 'f' }, h('span', null, 'العنوان'), title)];
  let get;
  if (kind === 'text') {
    const ta = h('textarea', { rows: 12, placeholder: 'اكتب الشرح هنا…' });
    ta.value = it?.body || '';
    fields.push(h('label', { class: 'f' }, h('span', null, 'النص'), ta,
      h('small', { class: 'muted' }, 'تنسيق بسيط: سطر يبدأ بـ ## عنوان صغير — سطر يبدأ بـ - نقطة — **كلمة** بخط عريض — سطر فارغ بين الفقرات.')));
    get = () => ({ body: ta.value });
  } else if (kind === 'book') {
    let b = { book: 'math6', from: '', to: '' };
    try { if (it) b = JSON.parse(it.body); } catch {}
    const from = h('input', { type: 'number', inputmode: 'numeric', min: 1 });
    const to = h('input', { type: 'number', inputmode: 'numeric', min: 1 });
    from.value = b.from;
    to.value = b.to;
    fields.push(h('p', { class: 'muted small' }, 'تُعرض صفحات كتاب الرياضيات (الجزء الأول) المرفوعة على المنصة. اكتب أرقام الصفحات كما هي مطبوعة في الكتاب.'),
      h('div', { class: 'row' }, h('label', { class: 'f grow' }, h('span', null, 'من صفحة'), from), h('label', { class: 'f grow' }, h('span', null, 'إلى صفحة'), to)));
    get = () => ({ book: b.book || 'math6', from: Number(from.value), to: Number(to.value) });
  } else {
    // video / audio / file / link: either upload or URL
    const canUpload = kind !== 'link';
    let mode = it ? (it.media_id ? 'upload' : 'url') : canUpload ? 'upload' : 'url';
    let mediaId = it?.media_id || null;
    const url = h('input', { type: 'url', dir: 'ltr', placeholder: kind === 'video' ? 'https://www.youtube.com/watch?v=…' : 'https://…' });
    url.value = it?.url || '';
    const accept = kind === 'video' ? 'video/*' : kind === 'audio' ? 'audio/*' : 'application/pdf,image/*,audio/*,video/*,.doc,.docx,.ppt,.pptx,.xls,.xlsx';
    const file = h('input', { type: 'file', accept, class: 'hidden' });
    const bar = h('i');
    const prog = h('div', { class: 'progress-up hidden' }, bar);
    const status = h('div', { class: 'small' }, mediaId ? '✅ يوجد ملف مرفوع. اختر ملفاً آخر لاستبداله.' : '');
    const pick = h('button', { type: 'button', class: 'btn light block', onclick: () => file.click() }, '📁 اختر ملفاً من الجهاز');
    file.addEventListener('change', () => {
      const f = file.files[0];
      if (!f) return;
      if (f.size > 95 * 1024 * 1024) {
        status.textContent = '❌ الملف أكبر من 95 ميغابايت. ارفعه على يوتيوب وضع الرابط.';
        return;
      }
      prog.classList.remove('hidden');
      pick.disabled = true;
      status.textContent = `جارٍ رفع ${f.name}…`;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/manage/upload');
      xhr.setRequestHeader('x-qimmah', '1');
      xhr.setRequestHeader('content-type', f.type || 'application/octet-stream');
      xhr.setRequestHeader('x-filename', encodeURIComponent(f.name));
      xhr.upload.onprogress = (e) => e.lengthComputable && (bar.style.width = Math.round((e.loaded * 100) / e.total) + '%');
      xhr.onload = () => {
        pick.disabled = false;
        let r = {};
        try { r = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status === 200) {
          mediaId = r.id;
          status.textContent = `✅ تم رفع ${f.name}`;
          if (!title.value) title.value = f.name.replace(/\.[^.]+$/, '');
        } else status.textContent = '❌ ' + (r.error || 'فشل الرفع');
      };
      xhr.onerror = () => { pick.disabled = false; status.textContent = '❌ انقطع الاتصال أثناء الرفع. حاول مرة أخرى.'; };
      xhr.send(f);
    });
    const upBox = h('div', null, pick, file, prog, status, h('p', { class: 'small muted' }, 'الحد الأقصى 95 ميغابايت. للفيديو الطويل يُفضّل رفعه على يوتيوب (غير مُدرج) ووضع الرابط، فهو أخف على إنترنت التلاميذ.'));
    const urlBox = h('div', null, h('label', { class: 'f' }, h('span', null, 'الرابط'), url,
      h('small', { class: 'muted' }, kind === 'video' ? 'رابط يوتيوب أو Google Drive أو رابط مباشر لملف mp4' : kind === 'audio' ? 'رابط مباشر لملف mp3 أو رابط Google Drive' : 'أي رابط يبدأ بـ https://')));
    const tabs = h('div', { class: 'tabs' });
    const desc = h('textarea', { rows: 3, placeholder: 'ملاحظة للتلميذ (اختياري)' });
    desc.value = it?.body || '';
    const drawTabs = () => {
      tabs.textContent = '';
      if (canUpload) {
        tabs.appendChild(h('button', { type: 'button', class: mode === 'upload' ? 'on' : '', onclick: () => { mode = 'upload'; drawTabs(); } }, '📁 رفع من الجهاز'));
        tabs.appendChild(h('button', { type: 'button', class: mode === 'url' ? 'on' : '', onclick: () => { mode = 'url'; drawTabs(); } }, '🔗 رابط'));
      }
      upBox.classList.toggle('hidden', mode !== 'upload');
      urlBox.classList.toggle('hidden', mode !== 'url');
    };
    drawTabs();
    fields.push(tabs, upBox, urlBox, h('label', { class: 'f' }, h('span', null, 'ملاحظة'), desc));
    get = () => {
      if (mode === 'upload' && !mediaId) throw new Error('اختر ملفاً وانتظر حتى يكتمل الرفع.');
      return mode === 'upload' ? { media_id: mediaId, body: desc.value } : { url: url.value, media_id: null, body: desc.value };
    };
  }
  const save = h('button', { class: 'btn', type: 'submit' }, 'حفظ');
  const form = h('form', null, err, fields, h('div', { class: 'row' }, save, h('button', { class: 'btn ghost', type: 'button', onclick: () => m.close() }, 'إلغاء')));
  const m = modal(`${ico} ${it ? 'تعديل' : 'إضافة'} ${label}`, form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true;
    try {
      const v = { title: title.value, ...get() };
      if (it) await PUT('/manage/items/' + it.id, v);
      else await POST('/manage/items', { ...v, lesson_id: lid, kind });
      m.close();
      toast('تم الحفظ ✓', 'ok');
      router();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
      m.box.scrollTop = 0;
    } finally {
      save.disabled = false;
    }
  });
}

on('/manage/quiz/:id', async (qid) => {
  const d = await GET('/manage/quizzes/' + qid);
  const Q = d.quiz;
  const KQ = { mcq: 'اختيار من متعدد', tf: 'صح أو خطأ', short: 'إجابة قصيرة' };
  return h('div', null,
    h('div', { class: 'crumbs' }, h('a', { href: '#/manage/subject/' + Q.subject_id }, 'المادة'), ' ‹ ',
      Q.lesson_id ? h('a', { href: '#/manage/lesson/' + Q.lesson_id }, Q.lesson_title) : Q.unit_title),
    h('h1', null, '📝 ' + Q.title),
    h('div', { class: 'card' },
      h('div', { class: 'row' }, pubPill(Q.published), h('span', { class: 'pill blue' }, `النجاح ${Q.pass_percent}%`),
        h('span', { class: 'pill' }, Q.max_attempts ? `${Q.max_attempts} محاولات` : 'محاولات غير محدودة'), Q.show_answers ? h('span', { class: 'pill' }, 'تظهر الإجابات') : null),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn sm ' + (Q.published ? 'ghost' : 'green'), onclick: async () => { await act(() => PUT('/manage/quizzes/' + qid, { published: !Q.published }), Q.published ? 'تم الإخفاء' : 'تم النشر ✓'); router(); } }, Q.published ? '🙈 إخفاء' : '📢 نشر للتلاميذ'),
        h('button', { class: 'btn sm light', onclick: () => quizForm(null, Q) }, '⚙️ الإعدادات'),
        h('a', { class: 'btn sm light', href: '#/quiz/' + qid }, '👁️ تجربة'),
        h('a', { class: 'btn sm light', href: '#/quiz-results/' + qid }, '📊 النتائج'),
        h('button', { class: 'btn sm red', onclick: async () => {
          if (!(await confirmBox('حذف هذا الاختبار بكل أسئلته ونتائجه؟', { danger: true, yes: 'حذف' }))) return;
          await act(() => DEL('/manage/quizzes/' + qid), 'تم الحذف');
          location.hash = Q.lesson_id ? '#/manage/lesson/' + Q.lesson_id : '#/manage/subject/' + Q.subject_id;
        } }, 'حذف'))),
    h('div', { class: 'row between' }, h('h2', null, `الأسئلة (${d.questions.length})`), h('button', { class: 'btn amber', onclick: () => questionForm(qid) }, '+ سؤال جديد')),
    d.questions.length
      ? d.questions.map((q, i) =>
          h('div', { class: 'card tight' },
            h('div', { class: 'row between' }, h('span', { class: 'pill blue' }, `${i + 1} — ${KQ[q.kind]}`), h('span', { class: 'small muted' }, `${q.points} درجة`)),
            h('div', { style: { whiteSpace: 'pre-wrap', margin: '8px 0', fontWeight: 600 } }, q.text),
            q.kind === 'mcq' ? h('ol', { style: { margin: '0 0 8px' } }, q.options.map((o, k) => h('li', { style: k === q.answer ? { color: 'var(--green)', fontWeight: 700 } : null }, o, k === q.answer ? ' ✔' : ''))) : null,
            q.kind === 'tf' ? h('div', { class: 'small' }, 'الإجابة: ', h('b', null, q.answer ? 'صح' : 'خطأ')) : null,
            q.kind === 'short' ? h('div', { class: 'small' }, 'الإجابات المقبولة: ', h('b', null, q.answer.join(' | '))) : null,
            h('div', { class: 'row', style: { marginTop: '8px' } }, upDown('questions', d.questions, i),
              h('button', { class: 'btn xs light', onclick: () => questionForm(qid, q) }, 'تعديل'),
              h('button', { class: 'btn xs red', onclick: () => del('/manage/questions/' + q.id, 'هذا السؤال') }, 'حذف'))))
      : h('div', { class: 'card empty' }, 'لا توجد أسئلة. أضف أول سؤال.'));
}, ['teacher', 'principal']);

function questionForm(quizId, q) {
  let kind = q?.kind || 'mcq';
  const err = h('div', { class: 'err hidden' });
  const text = h('textarea', { rows: 3, placeholder: 'اكتب السؤال' });
  text.value = q?.text || '';
  const points = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 100 });
  points.value = q?.points || 1;
  const expl = h('input', { type: 'text', placeholder: 'يظهر للتلميذ بعد التسليم (اختياري)' });
  expl.value = q?.explanation || '';
  const area = h('div');
  let opts = q?.kind === 'mcq' ? [...q.options] : ['', '', '', ''];
  let correct = q?.kind === 'mcq' ? q.answer : 0;
  let tf = q?.kind === 'tf' ? q.answer : true;
  const shortAns = h('input', { type: 'text', placeholder: 'مثال: 0.5 | 1/2' });
  shortAns.value = q?.kind === 'short' ? q.answer.join(' | ') : '';
  const tabs = h('div', { class: 'tabs' });
  const draw = () => {
    tabs.textContent = '';
    for (const [k, l] of [['mcq', 'اختيار من متعدد'], ['tf', 'صح / خطأ'], ['short', 'إجابة قصيرة']])
      tabs.appendChild(h('button', { type: 'button', class: kind === k ? 'on' : '', onclick: () => { kind = k; draw(); } }, l));
    area.textContent = '';
    if (kind === 'mcq') {
      area.appendChild(h('p', { class: 'small muted' }, 'اكتب الخيارات واضغط الدائرة بجانب الإجابة الصحيحة.'));
      opts.forEach((o, i) => {
        const inp = h('input', { type: 'text', placeholder: `الخيار ${i + 1}` });
        inp.value = o;
        inp.addEventListener('input', () => (opts[i] = inp.value));
        area.appendChild(h('div', { class: 'opt-edit' },
          h('input', { type: 'radio', name: 'correct', checked: correct === i, onchange: () => (correct = i), 'aria-label': 'الإجابة الصحيحة' }), inp,
          opts.length > 2 ? h('button', { type: 'button', class: 'btn xs ghost', onclick: () => { opts.splice(i, 1); if (correct >= opts.length) correct = 0; draw(); } }, '✕') : null));
      });
      if (opts.length < 6) area.appendChild(h('button', { type: 'button', class: 'btn xs light', onclick: () => { opts.push(''); draw(); } }, '+ خيار'));
    } else if (kind === 'tf') {
      area.appendChild(h('div', { class: 'opts tf' },
        h('button', { type: 'button', class: 'opt' + (tf ? ' sel' : ''), onclick: () => { tf = true; draw(); } }, '✔ صح'),
        h('button', { type: 'button', class: 'opt' + (!tf ? ' sel' : ''), onclick: () => { tf = false; draw(); } }, '✘ خطأ')));
    } else {
      area.appendChild(h('label', { class: 'f' }, h('span', null, 'الإجابة الصحيحة'), shortAns,
        h('small', { class: 'muted' }, 'إذا كان هناك أكثر من شكل صحيح افصل بينها بالعلامة | . التصحيح يقبل الأرقام العربية والإنجليزية ويتجاهل المسافات، ويقبل الكسر المساوي مثل 1/2 = 0.5.')));
    }
  };
  draw();
  const save = h('button', { class: 'btn', type: 'submit' }, 'حفظ السؤال');
  const form = h('form', null, err, tabs, h('label', { class: 'f' }, h('span', null, 'نص السؤال'), text), area,
    h('div', { class: 'row' }, h('label', { class: 'f', style: { width: '120px' } }, h('span', null, 'الدرجة'), points), h('label', { class: 'f grow' }, h('span', null, 'شرح الإجابة'), expl)),
    h('div', { class: 'row' }, save, h('button', { class: 'btn ghost', type: 'button', onclick: () => m.close() }, 'إلغاء')));
  const m = modal(q ? 'تعديل السؤال' : 'سؤال جديد', form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = { kind, text: text.value, points: Number(points.value) || 1, explanation: expl.value };
    if (kind === 'mcq') {
      const filled = opts.map((o, i) => [o.trim(), i]).filter(([o]) => o);
      v.options = filled.map(([o]) => o);
      v.answer = filled.findIndex(([, i]) => i === correct);
      if (v.answer < 0) {
        err.textContent = 'الخيار المحدد كإجابة صحيحة فارغ.';
        err.classList.remove('hidden');
        return;
      }
    } else if (kind === 'tf') v.answer = tf;
    else v.answer = shortAns.value.split('|').map((x) => x.trim()).filter(Boolean);
    save.disabled = true;
    try {
      if (q) await PUT('/manage/questions/' + q.id, v);
      else await POST('/manage/questions', { ...v, quiz_id: quizId });
      m.close();
      toast('تم حفظ السؤال ✓', 'ok');
      router();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
      m.box.scrollTop = 0;
    } finally {
      save.disabled = false;
    }
  });
}

// ------------------------------------------------------------------ principal: users
function showPassword(u) {
  modal('🔑 كلمة المرور الجديدة', h('div', { class: 'stack' },
    h('p', null, `${u.full_name} — اسم المستخدم: `, h('b', { class: 'ltr' }, u.username)),
    h('div', { class: 'newpw' }, u.password),
    h('p', { class: 'small muted' }, 'اكتبها أو اطبعها الآن، لن تظهر مرة أخرى. سيُطلب من صاحب الحساب الدخول بها.'),
    h('button', { class: 'btn light', onclick: () => window.print() }, '🖨️ طباعة')));
}
on('/users', async () => {
  const d = await GET('/admin/users');
  const tbody = h('tbody', null, d.users.map((u) =>
    h('tr', null,
      h('td', null, h('b', null, u.full_name), h('div', { class: 'small muted' }, h('span', { class: 'ltr' }, u.username))),
      h('td', null, h('span', { class: 'pill ' + (u.role === 'student' ? '' : 'blue') }, ROLE[u.role]), u.active ? null : h('span', { class: 'pill no' }, 'موقوف')),
      h('td', { class: 'small muted' }, when(u.last_login)),
      h('td', { style: { minWidth: '250px' } }, h('div', { class: 'row', style: { gap: '4px' } },
        h('button', { class: 'btn xs light', onclick: () => formModal('تعديل الاسم', [{ name: 'full_name', label: 'الاسم الكامل', value: u.full_name }], async (v) => { await PUT('/admin/users/' + u.id, v); toast('تم الحفظ ✓', 'ok'); router(); }) }, 'الاسم'),
        u.id !== ME.id ? h('button', { class: 'btn xs amber', onclick: async () => {
          if (!(await confirmBox(`إنشاء كلمة مرور جديدة لـ ${u.full_name}؟ ستتوقف كلمة المرور القديمة.`))) return;
          showPassword(await act(() => POST(`/admin/users/${u.id}/reset`)));
        } }, '🔑 كلمة مرور') : null,
        u.id !== ME.id ? h('button', { class: 'btn xs ghost', onclick: async () => { await act(() => PUT('/admin/users/' + u.id, { active: !u.active }), u.active ? 'تم إيقاف الحساب' : 'تم تفعيل الحساب'); router(); } }, u.active ? 'إيقاف' : 'تفعيل') : null,
        u.id !== ME.id ? h('button', { class: 'btn xs red', onclick: () => del('/admin/users/' + u.id, `حساب ${u.full_name} وكل نتائجه`) }, 'حذف') : null)))));
  return h('div', null,
    h('div', { class: 'row between' }, h('h1', null, '👥 المستخدمون'),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm amber', onclick: () => formModal('حساب جديد', [
          { name: 'full_name', label: 'الاسم الكامل' },
          { name: 'username', label: 'اسم المستخدم (أرقام أو حروف إنجليزية)', dir: 'ltr', placeholder: 'مثال: 631' },
          { name: 'role', label: 'الدور', type: 'select', value: 'student', options: [['student', 'تلميذ'], ['teacher', 'مدرس'], ['principal', 'مدير']] },
        ], async (v) => { const r = await POST('/admin/users', v); router(); showPassword({ ...v, ...r }); }, { submit: 'إنشاء' }) }, '+ حساب جديد'),
        h('a', { class: 'btn sm', href: '#/cards' }, '🖨️ بطاقات الدخول'),
        h('a', { class: 'btn sm ghost', href: '#/audit' }, '🧾 السجل'))),
    h('div', { class: 'card tight table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'الاسم'), h('th', null, 'الدور'), h('th', null, 'آخر دخول'), h('th', null, 'إجراءات'))), tbody)));
}, ['principal']);

on('/cards', async () => {
  const d = await GET('/admin/users');
  const students = d.users.filter((u) => u.role === 'student' && u.active);
  const chosen = new Set(students.map((s) => s.id));
  const out = h('div');
  const list = h('div', { class: 'card tight' }, students.map((s) => {
    const cb = h('input', { type: 'checkbox', checked: true, onchange: () => (cb.checked ? chosen.add(s.id) : chosen.delete(s.id)) });
    return h('label', { class: 'check', style: { margin: '4px 0' } }, cb, `${s.full_name} (${s.username})`);
  }));
  const go = h('button', { class: 'btn amber', onclick: async () => {
    const ids = [...chosen];
    if (!ids.length) return toast('اختر تلميذاً واحداً على الأقل', 'bad');
    if (!(await confirmBox(`سيتم إنشاء كلمات مرور جديدة لـ ${ids.length} تلميذ، وتتوقف كلمات المرور القديمة. متابعة؟`))) return;
    go.disabled = true;
    const cards = [];
    try {
      for (let i = 0; i < ids.length; i += 2) {
        go.textContent = `جارٍ الإنشاء… ${Math.min(i + 2, ids.length)}/${ids.length}`;
        const r = await POST('/admin/reset-batch', { ids: ids.slice(i, i + 2) });
        cards.push(...r.users);
      }
    } catch (e) {
      toast(e.message, 'bad');
    }
    go.disabled = false;
    go.textContent = '🔑 إنشاء كلمات مرور جديدة وطباعة البطاقات';
    list.classList.add('noprint');
    out.textContent = '';
    add(out, [
      h('div', { class: 'row noprint', style: { margin: '12px 0' } }, h('button', { class: 'btn', onclick: () => window.print() }, '🖨️ طباعة البطاقات')),
      h('div', { class: 'cards' }, cards.map((u) => h('div', { class: 'lcard' },
        h('div', { class: 's' }, 'مدارس القمة النموذجية — منصة التعلّم عن بُعد'),
        h('div', { class: 'n' }, u.full_name),
        h('div', { class: 'kv' }, h('span', null, 'اسم المستخدم'), h('b', null, u.username)),
        h('div', { class: 'kv' }, h('span', null, 'كلمة المرور'), h('b', null, u.password)),
        h('div', { class: 's', style: { marginTop: '6px', direction: 'ltr', textAlign: 'center' } }, location.host)))),
    ]);
  } }, '🔑 إنشاء كلمات مرور جديدة وطباعة البطاقات');
  return h('div', null,
    h('div', { class: 'crumbs noprint' }, h('a', { href: '#/users' }, 'المستخدمون')),
    h('h1', { class: 'noprint' }, '🖨️ بطاقات الدخول للتلاميذ'),
    h('p', { class: 'muted noprint' }, 'كلمات المرور محفوظة مشفّرة ولا يمكن عرضها. لطباعة بطاقات، تُنشأ كلمات مرور جديدة للتلاميذ المختارين.'),
    h('div', { class: 'noprint' }, go), list, out);
}, ['principal']);

on('/audit', async () => {
  const d = await GET('/admin/audit');
  const A = { login: 'دخول', 'password.change': 'تغيير كلمة مروره', 'user.reset': 'إعادة تعيين كلمة مرور', 'user.reset-batch': 'بطاقات دخول جديدة', 'user.create': 'إنشاء حساب', 'user.update': 'تعديل حساب', 'user.delete': 'حذف حساب', 'media.upload': 'رفع ملف', 'lesson.create': 'إنشاء درس', 'lesson.delete': 'حذف درس', 'quiz.create': 'إنشاء اختبار', 'quiz.delete': 'حذف اختبار', 'unit.create': 'إنشاء وحدة', 'unit.delete': 'حذف وحدة', 'subject.create': 'إنشاء مادة', 'subject.delete': 'حذف مادة', 'announcement.create': 'إعلان جديد' };
  return h('div', null, h('div', { class: 'crumbs' }, h('a', { href: '#/users' }, 'المستخدمون')), h('h1', null, '🧾 سجل العمليات'),
    h('div', { class: 'card tight table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'الوقت'), h('th', null, 'المستخدم'), h('th', null, 'العملية'), h('th', null, 'تفاصيل'))),
      h('tbody', null, d.audit.map((a) => h('tr', null, h('td', { class: 'small muted' }, when(a.created_at)), h('td', null, a.full_name || '—'), h('td', null, A[a.action] || a.action), h('td', { class: 'small muted' }, a.detail)))))));
}, ['principal']);

// ------------------------------------------------------------------ start
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
router();
