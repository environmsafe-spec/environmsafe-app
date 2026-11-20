// منصة مدارس القمة — API (Cloudflare Worker + D1 + R2)
// Everything under /api/* is handled here; all other paths are static files
// from ./public served by Workers Static Assets.

import {
  HttpError, json, withSecurityHeaders, hashPassword, verifyPassword, sha256,
  randomToken, randomDigits, randomPassword, cookieName, readCookie, sessionCookie,
  SESSION_DAYS, checkLocked, recordFailure, clearFailures,
} from './security.js';
import { gradeQuestion } from './grading.js';

const STAFF = ['teacher', 'principal'];
const ALL = ['student', 'teacher', 'principal'];
const PRINCIPAL = ['principal'];
const DAY = 86400000;
const MAX_UPLOAD = 95 * 1024 * 1024; // Workers free plan accepts request bodies up to 100 MB

// ---------------------------------------------------------------- routing

const routes = [];
function route(method, path, roles, handler) {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '(\\d+|[A-Za-z0-9_-]+)')) + '$');
  routes.push({ method, re, keys, roles, handler });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isHttps = url.protocol === 'https:';
    let resp;
    try {
      if (url.pathname.startsWith('/api/')) resp = await handleApi(request, env, ctx, url, isHttps);
      else resp = await env.ASSETS.fetch(request);
    } catch (err) {
      if (err instanceof HttpError) resp = json({ error: err.message }, err.status);
      else {
        console.error('Unhandled', err && err.stack ? err.stack : err);
        resp = json({ error: 'حدث خطأ غير متوقع. حاول مرة أخرى.' }, 500);
      }
    }
    return withSecurityHeaders(resp, isHttps);
  },
};

async function handleApi(request, env, ctx, url, isHttps) {
  const method = request.method.toUpperCase();
  if (!env.DB) throw new HttpError(503, 'قاعدة البيانات غير مهيأة.');

  // CSRF: state-changing requests must come from our own pages.
  if (!['GET', 'HEAD'].includes(method)) {
    if (request.headers.get('x-qimmah') !== '1') throw new HttpError(403, 'طلب غير مسموح.');
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'طلب غير مسموح.');
  }

  const path = url.pathname.slice(4); // strip "/api"
  let matched = null;
  let params = {};
  let pathExists = false;
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    pathExists = true;
    if (r.method !== method && !(r.method === 'GET' && method === 'HEAD')) continue;
    matched = r;
    r.keys.forEach((k, i) => (params[k] = m[i + 1]));
    break;
  }
  if (!matched) throw new HttpError(pathExists ? 405 : 404, 'غير موجود.');

  const c = {
    env, request, url, params, isHttps, ctx,
    db: env.DB,
    now: Date.now(),
    ip: request.headers.get('cf-connecting-ip') || 'local',
    user: null,
    setCookie: null,
  };

  if (matched.roles) {
    c.user = await loadSession(c);
    if (!c.user) throw new HttpError(401, 'انتهت الجلسة. سجّل الدخول من جديد.');
    if (!matched.roles.includes(c.user.role)) throw new HttpError(403, 'ليست لديك صلاحية لهذا الإجراء.');
  }

  let resp = await matched.handler(c);
  if (!(resp instanceof Response)) resp = json(resp ?? { ok: true });
  if (c.setCookie) {
    resp = new Response(resp.body, resp);
    resp.headers.append('set-cookie', c.setCookie);
  }
  return resp;
}

async function loadSession(c) {
  const token = readCookie(c.request, cookieName(c.isHttps));
  if (!token || token.length > 100) return null;
  const th = await sha256(token);
  const row = await c.db
    .prepare(
      `SELECT s.expires_at, u.id, u.username, u.full_name, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND u.active = 1`
    )
    .bind(th)
    .first();
  if (!row || row.expires_at < c.now) return null;
  const life = SESSION_DAYS[row.role] * DAY;
  if (row.expires_at - c.now < life / 2) {
    // sliding renewal
    await c.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(c.now + life, th).run();
    c.setCookie = sessionCookie(c.isHttps, token, life / 1000);
  }
  return { id: row.id, username: row.username, full_name: row.full_name, role: row.role, tokenHash: th };
}

// ---------------------------------------------------------------- input helpers

async function body(c) {
  const len = Number(c.request.headers.get('content-length') || 0);
  if (len > 1024 * 1024) throw new HttpError(413, 'البيانات كبيرة جداً.');
  try {
    const data = await c.request.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('x');
    return data;
  } catch {
    throw new HttpError(400, 'بيانات غير صالحة.');
  }
}

function str(v, label, { min = 0, max = 500, optional = false } = {}) {
  if (v === undefined || v === null) {
    if (optional) return undefined;
    v = '';
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, `قيمة غير صالحة: ${label}`);
  const s = String(v).replace(/\u0000/g, '').trim();
  if (s.length < min) throw new HttpError(400, min <= 1 ? `الرجاء إدخال ${label}.` : `${label} قصير جداً.`);
  if (s.length > max) throw new HttpError(400, `${label} طويل جداً.`);
  return s;
}
function int(v, label, { min = 0, max = 1e9, optional = false } = {}) {
  if ((v === undefined || v === null || v === '') && optional) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `قيمة غير صالحة: ${label}`);
  return n;
}
function bool(v, optional = true) {
  if (v === undefined || v === null) return optional ? undefined : 0;
  return v === true || v === 1 || v === '1' ? 1 : 0;
}
function httpUrl(v, label) {
  const s = str(v, label, { min: 1, max: 2000 });
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new HttpError(400, `${label} غير صحيح.`);
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, `${label} يجب أن يبدأ بـ https://`);
  return u.toString();
}
function id(c, key = 'id') {
  return int(c.params[key], 'المعرّف', { min: 1 });
}
async function mustExist(db, table, rid) {
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(rid).first();
  if (!row) throw new HttpError(404, 'العنصر غير موجود.');
  return row;
}
async function nextPos(db, table, col, val) {
  const r = await db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM ${table} WHERE ${col} = ?`).bind(val).first();
  return r.p;
}
function audit(c, action, detail = '') {
  const p = c.db
    .prepare('INSERT INTO audit (user_id, action, detail, created_at) VALUES (?, ?, ?, ?)')
    .bind(c.user ? c.user.id : null, action, String(detail).slice(0, 500), c.now)
    .run();
  c.ctx.waitUntil(p.catch(() => {}));
}
const isStaff = (u) => u && STAFF.includes(u.role);

// ---------------------------------------------------------------- auth

route('POST', '/login', null, async (c) => {
  const b = await body(c);
  const username = str(b.username, 'اسم المستخدم', { min: 1, max: 40 }).toLowerCase();
  const password = str(b.password, 'كلمة المرور', { min: 1, max: 128 });
  const keys = ['u:' + username, 'ip:' + c.ip];
  const locked = await checkLocked(c.db, keys, c.now);
  if (locked) throw new HttpError(429, `محاولات كثيرة خاطئة. انتظر ${locked} دقيقة ثم حاول مرة أخرى.`);

  const user = await c.db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  const ok = await verifyPassword(password, user ? user.pass_hash : null, iterations(c));
  if (!user || !ok || !user.active) {
    await recordFailure(c.db, keys, c.now);
    if (user && ok && !user.active) throw new HttpError(403, 'هذا الحساب موقوف. راجع إدارة المدرسة.');
    throw new HttpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة.');
  }
  await clearFailures(c.db, 'u:' + username);

  const token = randomToken();
  const life = SESSION_DAYS[user.role] * DAY;
  await c.db.batch([
    c.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(token), user.id, c.now, c.now + life),
    c.db.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(c.now, user.id),
    c.db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(c.now),
  ]);
  c.user = user;
  audit(c, 'login', c.ip);
  c.setCookie = sessionCookie(c.isHttps, token, life / 1000);
  return { user: publicUser(user) };
});

route('POST', '/logout', null, async (c) => {
  const token = readCookie(c.request, cookieName(c.isHttps));
  if (token && token.length <= 100) await c.db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  c.setCookie = sessionCookie(c.isHttps, '', 0);
  return { ok: true };
});

route('GET', '/me', ALL, async (c) => ({ user: publicUser(c.user), school: c.env.SCHOOL_NAME || '' }));

route('POST', '/me/password', ALL, async (c) => {
  const b = await body(c);
  const current = str(b.current, 'كلمة المرور الحالية', { min: 1, max: 128 });
  const minLen = c.user.role === 'student' ? 4 : 8;
  const next = str(b.next, 'كلمة المرور الجديدة', { min: minLen, max: 128 });
  const row = await c.db.prepare('SELECT pass_hash FROM users WHERE id = ?').bind(c.user.id).first();
  if (!(await verifyPassword(current, row.pass_hash))) throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة.');
  const h = await hashPassword(next, iterations(c));
  await c.db.batch([
    c.db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').bind(h, c.user.id),
    c.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(c.user.id, c.user.tokenHash),
  ]);
  audit(c, 'password.change');
  return { ok: true };
});

function publicUser(u) {
  return { id: u.id, username: u.username, full_name: u.full_name, role: u.role };
}
function iterations(c) {
  return Math.min(Math.max(parseInt(c.env.PBKDF2_ITERATIONS, 10) || 20000, 10000), 100000);
}

// ---------------------------------------------------------------- learning (all roles)

// SQL fragments: what a student may see
const PUB_LESSON = 'l.published = 1 AND un.published = 1 AND s.published = 1';

async function lessonCounts(c, subjectId) {
  const pub = isStaff(c.user) ? '1=1' : PUB_LESSON;
  return c.db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN p.lesson_id IS NOT NULL THEN 1 ELSE 0 END) AS done
         FROM lessons l JOIN units un ON un.id = l.unit_id JOIN subjects s ON s.id = un.subject_id
         LEFT JOIN progress p ON p.lesson_id = l.id AND p.user_id = ?
        WHERE ${pub} ${subjectId ? 'AND s.id = ?' : ''}`
    )
    .bind(...(subjectId ? [c.user.id, subjectId] : [c.user.id]))
    .first();
}

route('GET', '/home', ALL, async (c) => {
  const staff = isStaff(c.user);
  const { results: subjects } = await c.db
    .prepare(`SELECT * FROM subjects ${staff ? '' : 'WHERE published = 1'} ORDER BY position, id`)
    .all();
  for (const s of subjects) {
    const k = await lessonCounts(c, s.id);
    s.total = k.total || 0;
    s.done = k.done || 0;
  }
  const { results: announcements } = await c.db
    .prepare(
      `SELECT a.id, a.title, a.body, a.pinned, a.created_at, u.full_name AS author
         FROM announcements a LEFT JOIN users u ON u.id = a.author_id
        ORDER BY a.pinned DESC, a.created_at DESC LIMIT 5`
    )
    .all();
  const out = { user: publicUser(c.user), subjects, announcements };
  if (!staff) {
    out.next = await c.db
      .prepare(
        `SELECT l.id, l.title, un.title AS unit_title, s.title AS subject_title, s.icon
           FROM lessons l JOIN units un ON un.id = l.unit_id JOIN subjects s ON s.id = un.subject_id
          WHERE ${PUB_LESSON}
            AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.lesson_id = l.id AND p.user_id = ?)
          ORDER BY s.position, s.id, un.position, un.id, l.position, l.id LIMIT 1`
      )
      .bind(c.user.id)
      .first();
    const { results: recent } = await c.db
      .prepare(
        `SELECT a.id, a.percent, a.passed, a.submitted_at, q.title
           FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
          WHERE a.user_id = ? ORDER BY a.submitted_at DESC LIMIT 3`
      )
      .bind(c.user.id)
      .all();
    out.recent = recent;
    const st = await c.db
      .prepare('SELECT COUNT(*) AS n, AVG(percent) AS avg FROM attempts WHERE user_id = ?')
      .bind(c.user.id)
      .first();
    out.stats = { attempts: st.n || 0, avg: st.avg === null ? null : Math.round(st.avg) };
  }
  return out;
});

route('GET', '/subjects/:id', ALL, async (c) => {
  const staff = isStaff(c.user);
  const subject = await mustExist(c.db, 'subjects', id(c));
  if (!staff && !subject.published) throw new HttpError(404, 'غير متاح.');
  const { results: units } = await c.db
    .prepare(`SELECT * FROM units WHERE subject_id = ? ${staff ? '' : 'AND published = 1'} ORDER BY position, id`)
    .bind(subject.id)
    .all();
  const { results: lessons } = await c.db
    .prepare(
      `SELECT l.id, l.unit_id, l.title, l.summary, l.published, l.position,
              (SELECT 1 FROM progress p WHERE p.lesson_id = l.id AND p.user_id = ?) AS done
         FROM lessons l JOIN units un ON un.id = l.unit_id
        WHERE un.subject_id = ? ${staff ? '' : 'AND l.published = 1'}
        ORDER BY l.position, l.id`
    )
    .bind(c.user.id, subject.id)
    .all();
  const { results: quizzes } = await c.db
    .prepare(
      `SELECT q.id, q.unit_id, q.lesson_id, q.title, q.published, q.position,
              (SELECT COUNT(*) FROM questions x WHERE x.quiz_id = q.id) AS n_questions,
              (SELECT MAX(percent) FROM attempts a WHERE a.quiz_id = q.id AND a.user_id = ?) AS best
         FROM quizzes q JOIN units un ON un.id = q.unit_id
        WHERE un.subject_id = ? ${staff ? '' : 'AND q.published = 1'}
        ORDER BY q.position, q.id`
    )
    .bind(c.user.id, subject.id)
    .all();
  for (const u of units) {
    u.lessons = lessons.filter((l) => l.unit_id === u.id);
    for (const l of u.lessons) l.quiz = quizzes.find((q) => q.lesson_id === l.id) || null;
    u.tests = quizzes.filter((q) => q.unit_id === u.id && !q.lesson_id);
  }
  return { subject, units };
});

async function loadLessonForUser(c, lessonId) {
  const lesson = await c.db
    .prepare(
      `SELECT l.*, un.title AS unit_title, un.published AS unit_published, un.subject_id,
              s.title AS subject_title, s.published AS subject_published
         FROM lessons l JOIN units un ON un.id = l.unit_id JOIN subjects s ON s.id = un.subject_id
        WHERE l.id = ?`
    )
    .bind(lessonId)
    .first();
  if (!lesson) throw new HttpError(404, 'الدرس غير موجود.');
  if (!isStaff(c.user) && !(lesson.published && lesson.unit_published && lesson.subject_published))
    throw new HttpError(404, 'الدرس غير متاح حالياً.');
  return lesson;
}

route('GET', '/lessons/:id', ALL, async (c) => {
  const lesson = await loadLessonForUser(c, id(c));
  const { results: items } = await c.db
    .prepare('SELECT id, kind, title, body, url, media_id, position FROM items WHERE lesson_id = ? ORDER BY position, id')
    .bind(lesson.id)
    .all();
  const staff = isStaff(c.user);
  const { results: quizzes } = await c.db
    .prepare(
      `SELECT q.id, q.title, q.published,
              (SELECT COUNT(*) FROM questions x WHERE x.quiz_id = q.id) AS n_questions,
              (SELECT MAX(percent) FROM attempts a WHERE a.quiz_id = q.id AND a.user_id = ?) AS best
         FROM quizzes q WHERE q.lesson_id = ? ${staff ? '' : 'AND q.published = 1'} ORDER BY q.position, q.id`
    )
    .bind(c.user.id, lesson.id)
    .all();
  const done = await c.db
    .prepare('SELECT completed_at FROM progress WHERE user_id = ? AND lesson_id = ?')
    .bind(c.user.id, lesson.id)
    .first();
  // previous / next lesson within the subject, in reading order
  const { results: order } = await c.db
    .prepare(
      `SELECT l.id, l.title FROM lessons l JOIN units un ON un.id = l.unit_id
        WHERE un.subject_id = ? ${staff ? '' : 'AND l.published = 1 AND un.published = 1'}
        ORDER BY un.position, un.id, l.position, l.id`
    )
    .bind(lesson.subject_id)
    .all();
  const i = order.findIndex((o) => o.id === lesson.id);
  return {
    lesson,
    items: items.map((it) => ({ ...it, src: it.media_id ? `/api/media/${it.media_id}` : it.url })),
    quizzes,
    done: !!done,
    prev: i > 0 ? order[i - 1] : null,
    next: i >= 0 && i < order.length - 1 ? order[i + 1] : null,
  };
});

route('POST', '/lessons/:id/complete', ALL, async (c) => {
  const lesson = await loadLessonForUser(c, id(c));
  await c.db
    .prepare('INSERT OR IGNORE INTO progress (user_id, lesson_id, completed_at) VALUES (?, ?, ?)')
    .bind(c.user.id, lesson.id, c.now)
    .run();
  return { ok: true };
});

async function loadQuizForUser(c, quizId) {
  const quiz = await c.db
    .prepare(
      `SELECT q.*, un.published AS unit_published, s.published AS subject_published, s.id AS subject_id,
              l.published AS lesson_published, l.title AS lesson_title, un.title AS unit_title
         FROM quizzes q JOIN units un ON un.id = q.unit_id JOIN subjects s ON s.id = un.subject_id
         LEFT JOIN lessons l ON l.id = q.lesson_id
        WHERE q.id = ?`
    )
    .bind(quizId)
    .first();
  if (!quiz) throw new HttpError(404, 'الاختبار غير موجود.');
  const visible =
    quiz.published && quiz.unit_published && quiz.subject_published && (quiz.lesson_id === null || quiz.lesson_published);
  if (!isStaff(c.user) && !visible) throw new HttpError(404, 'الاختبار غير متاح حالياً.');
  return quiz;
}

route('GET', '/quizzes/:id', ALL, async (c) => {
  const quiz = await loadQuizForUser(c, id(c));
  const { results: qs } = await c.db
    .prepare('SELECT id, kind, text, options, points FROM questions WHERE quiz_id = ? ORDER BY position, id')
    .bind(quiz.id)
    .all();
  const questions = qs.map((q) => ({ id: q.id, kind: q.kind, text: q.text, points: q.points, options: q.kind === 'mcq' ? JSON.parse(q.options) : [] }));
  if (quiz.shuffle) {
    for (let i = questions.length - 1; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [questions[i], questions[j]] = [questions[j], questions[i]];
    }
  }
  const { results: attempts } = await c.db
    .prepare('SELECT id, percent, passed, submitted_at FROM attempts WHERE quiz_id = ? AND user_id = ? ORDER BY submitted_at DESC')
    .bind(quiz.id, c.user.id)
    .all();
  return {
    quiz: {
      id: quiz.id, title: quiz.title, description: quiz.description, pass_percent: quiz.pass_percent,
      max_attempts: quiz.max_attempts, lesson_id: quiz.lesson_id, lesson_title: quiz.lesson_title,
      unit_title: quiz.unit_title, subject_id: quiz.subject_id, published: quiz.published,
    },
    questions,
    attempts,
  };
});

function displayAnswer(q, ans) {
  if (q.kind === 'mcq') return JSON.parse(q.options)[ans] ?? '';
  if (q.kind === 'tf') return ans ? 'صح' : 'خطأ';
  return Array.isArray(ans) ? ans[0] : String(ans);
}
function displayGiven(q, given) {
  if (given === null || given === undefined || given === '') return '';
  if (q.kind === 'mcq') return JSON.parse(q.options)[Number(given)] ?? '';
  if (q.kind === 'tf') return given === true ? 'صح' : given === false ? 'خطأ' : '';
  return String(given);
}

route('POST', '/quizzes/:id/submit', ['student', 'teacher', 'principal'], async (c) => {
  const quiz = await loadQuizForUser(c, id(c));
  const b = await body(c);
  const answers = b.answers && typeof b.answers === 'object' ? b.answers : {};
  if (quiz.max_attempts > 0 && c.user.role === 'student') {
    const n = await c.db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE quiz_id = ? AND user_id = ?').bind(quiz.id, c.user.id).first();
    if (n.n >= quiz.max_attempts) throw new HttpError(403, 'لقد استنفدت عدد المحاولات المسموح بها لهذا الاختبار.');
  }
  const { results: qs } = await c.db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position, id').bind(quiz.id).all();
  if (!qs.length) throw new HttpError(400, 'لا توجد أسئلة في هذا الاختبار بعد.');
  let score = 0;
  let max = 0;
  const stored = {};
  for (const q of qs) {
    let given = answers[q.id];
    if (q.kind === 'short') given = typeof given === 'string' || typeof given === 'number' ? String(given).slice(0, 200) : '';
    else if (q.kind === 'mcq') given = Number.isInteger(given) ? given : null;
    else given = typeof given === 'boolean' ? given : null;
    const { correct } = gradeQuestion(q, given);
    max += q.points;
    if (correct) score += q.points;
    stored[q.id] = { g: given, c: correct ? 1 : 0 };
  }
  const percent = max ? Math.round((score * 100) / max) : 0;
  const passed = percent >= quiz.pass_percent ? 1 : 0;
  const r = await c.db
    .prepare('INSERT INTO attempts (quiz_id, user_id, score, max_score, percent, passed, answers, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(quiz.id, c.user.id, score, max, percent, passed, JSON.stringify(stored), c.now)
    .first();
  return attemptView(c, r.id);
});

async function attemptView(c, attemptId) {
  const a = await c.db
    .prepare(
      `SELECT a.*, q.title AS quiz_title, q.show_answers, q.pass_percent, q.lesson_id, q.max_attempts,
              u.full_name AS student_name
         FROM attempts a JOIN quizzes q ON q.id = a.quiz_id JOIN users u ON u.id = a.user_id WHERE a.id = ?`
    )
    .bind(attemptId)
    .first();
  if (!a) throw new HttpError(404, 'غير موجود.');
  if (a.user_id !== c.user.id && !isStaff(c.user)) throw new HttpError(403, 'ليست لديك صلاحية.');
  const reveal = a.show_answers || isStaff(c.user);
  const { results: qs } = await c.db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position, id').bind(a.quiz_id).all();
  const stored = JSON.parse(a.answers);
  const details = qs.map((q) => {
    const s = stored[q.id] || { g: null, c: 0 };
    return {
      id: q.id, kind: q.kind, text: q.text, points: q.points,
      correct: !!s.c,
      given: displayGiven(q, s.g),
      answer: reveal ? displayAnswer(q, JSON.parse(q.answer)) : null,
      explanation: reveal ? q.explanation : '',
    };
  });
  return {
    attempt: {
      id: a.id, quiz_id: a.quiz_id, quiz_title: a.quiz_title, score: a.score, max_score: a.max_score,
      percent: a.percent, passed: !!a.passed, pass_percent: a.pass_percent, submitted_at: a.submitted_at,
      lesson_id: a.lesson_id, student_name: a.student_name, max_attempts: a.max_attempts,
    },
    details,
  };
}

route('GET', '/attempts/mine', ALL, async (c) => {
  const { results } = await c.db
    .prepare(
      `SELECT a.id, a.quiz_id, a.percent, a.passed, a.score, a.max_score, a.submitted_at, q.title, q.lesson_id
         FROM attempts a JOIN quizzes q ON q.id = a.quiz_id WHERE a.user_id = ? ORDER BY a.submitted_at DESC LIMIT 200`
    )
    .bind(c.user.id)
    .all();
  const done = await lessonCounts(c, null);
  return { attempts: results, lessons_total: done.total || 0, lessons_done: done.done || 0 };
});

route('GET', '/attempts/:id', ALL, async (c) => attemptView(c, id(c)));

route('GET', '/announcements', ALL, async (c) => {
  const { results } = await c.db
    .prepare(
      `SELECT a.id, a.title, a.body, a.pinned, a.created_at, u.full_name AS author
         FROM announcements a LEFT JOIN users u ON u.id = a.author_id ORDER BY a.pinned DESC, a.created_at DESC LIMIT 100`
    )
    .all();
  return { announcements: results };
});

// ---------------------------------------------------------------- media

const SAFE_INLINE = /^(audio|video|image)\/|^application\/pdf$/;
const ALLOWED_UPLOAD = /^(audio|video|image)\/[\w.+-]+$|^application\/(pdf|msword|vnd\.openxmlformats-officedocument\.[\w.]+|vnd\.ms-[\w.]+|zip)$|^text\/plain$/;

route('GET', '/media/:id', ALL, async (c) => {
  const mid = c.params.id;
  const meta = await c.db.prepare('SELECT * FROM media WHERE id = ?').bind(mid).first();
  if (!meta || !c.env.MEDIA) throw new HttpError(404, 'الملف غير موجود.');
  const range = parseRange(c.request.headers.get('range'), meta.size);
  const obj = await c.env.MEDIA.get('m/' + mid, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined);
  if (!obj) throw new HttpError(404, 'الملف غير موجود.');
  const inline = SAFE_INLINE.test(meta.mime) && !/svg/.test(meta.mime);
  const headers = {
    'content-type': meta.mime,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=86400',
    'content-security-policy': "default-src 'none'; sandbox",
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(meta.filename)}`,
  };
  if (range) {
    headers['content-range'] = `bytes ${range.start}-${range.end}/${meta.size}`;
    headers['content-length'] = String(range.end - range.start + 1);
    return new Response(obj.body, { status: 206, headers });
  }
  headers['content-length'] = String(meta.size);
  return new Response(obj.body, { status: 200, headers });
});

function parseRange(h, size) {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m) return null;
  let start, end;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (!n) return null;
    start = Math.max(size - n, 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return null;
  return { start, end };
}

route('POST', '/manage/upload', STAFF, async (c) => {
  if (!c.env.MEDIA) throw new HttpError(503, 'تخزين الملفات غير مهيأ على الخادم.');
  const mime = (c.request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_UPLOAD.test(mime) || /svg|html|xml/.test(mime))
    throw new HttpError(415, 'نوع الملف غير مسموح. المسموح: صوت، فيديو، صور، PDF، ملفات Word/PowerPoint.');
  const size = Number(c.request.headers.get('content-length') || 0);
  if (!size) throw new HttpError(411, 'الملف فارغ.');
  if (size > MAX_UPLOAD) throw new HttpError(413, 'حجم الملف أكبر من 95 ميغابايت. للفيديوهات الكبيرة استخدم رابط يوتيوب.');
  let filename = '';
  try {
    filename = decodeURIComponent(c.request.headers.get('x-filename') || '');
  } catch {}
  filename = (filename.replace(/[\\/\u0000-\u001f]/g, '_').slice(-120) || 'file').trim();
  const mid = randomToken(12);
  await c.env.MEDIA.put('m/' + mid, c.request.body, { httpMetadata: { contentType: mime } });
  await c.db
    .prepare('INSERT INTO media (id, filename, mime, size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(mid, filename, mime, size, c.user.id, c.now)
    .run();
  audit(c, 'media.upload', `${filename} (${size})`);
  return { id: mid, url: `/api/media/${mid}`, filename, mime, size };
});

async function dropMediaIfUnused(c, mid) {
  if (!mid) return;
  const used = await c.db.prepare('SELECT 1 FROM items WHERE media_id = ? LIMIT 1').bind(mid).first();
  if (used) return;
  await c.db.prepare('DELETE FROM media WHERE id = ?').bind(mid).run();
  if (c.env.MEDIA) await c.env.MEDIA.delete('m/' + mid);
}

// ---------------------------------------------------------------- content management (teacher + principal)

route('POST', '/manage/subjects', STAFF, async (c) => {
  const b = await body(c);
  const r = await c.db
    .prepare('INSERT INTO subjects (title, description, icon, color, position, published) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position),-1)+1 FROM subjects), ?) RETURNING id')
    .bind(str(b.title, 'اسم المادة', { min: 1, max: 100 }), str(b.description, 'الوصف', { max: 500 }),
      str(b.icon || '📘', 'الأيقونة', { max: 8 }), color(b.color), bool(b.published) ?? 1)
    .first();
  audit(c, 'subject.create', r.id);
  return { id: r.id };
});
route('PUT', '/manage/subjects/:id', STAFF, async (c) => {
  const s = await mustExist(c.db, 'subjects', id(c));
  const b = await body(c);
  await c.db
    .prepare('UPDATE subjects SET title = ?, description = ?, icon = ?, color = ?, published = ? WHERE id = ?')
    .bind(str(b.title ?? s.title, 'اسم المادة', { min: 1, max: 100 }), str(b.description ?? s.description, 'الوصف', { max: 500 }),
      str(b.icon ?? s.icon, 'الأيقونة', { max: 8 }), color(b.color ?? s.color), bool(b.published) ?? s.published, s.id)
    .run();
  return { ok: true };
});
route('DELETE', '/manage/subjects/:id', STAFF, async (c) => {
  const s = await mustExist(c.db, 'subjects', id(c));
  await c.db.prepare('DELETE FROM subjects WHERE id = ?').bind(s.id).run();
  audit(c, 'subject.delete', s.title);
  return { ok: true };
});
function color(v) {
  const s = String(v || '#2563eb');
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw new HttpError(400, 'لون غير صالح.');
  return s;
}

route('POST', '/manage/units', STAFF, async (c) => {
  const b = await body(c);
  const subjectId = int(b.subject_id, 'المادة', { min: 1 });
  await mustExist(c.db, 'subjects', subjectId);
  const r = await c.db
    .prepare('INSERT INTO units (subject_id, title, description, position, published) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(subjectId, str(b.title, 'عنوان الوحدة', { min: 1, max: 200 }), str(b.description, 'الوصف', { max: 1000 }),
      await nextPos(c.db, 'units', 'subject_id', subjectId), bool(b.published) ?? 1)
    .first();
  audit(c, 'unit.create', r.id);
  return { id: r.id };
});
route('PUT', '/manage/units/:id', STAFF, async (c) => {
  const u = await mustExist(c.db, 'units', id(c));
  const b = await body(c);
  await c.db
    .prepare('UPDATE units SET title = ?, description = ?, published = ? WHERE id = ?')
    .bind(str(b.title ?? u.title, 'عنوان الوحدة', { min: 1, max: 200 }), str(b.description ?? u.description, 'الوصف', { max: 1000 }),
      bool(b.published) ?? u.published, u.id)
    .run();
  return { ok: true };
});
route('DELETE', '/manage/units/:id', STAFF, async (c) => {
  const u = await mustExist(c.db, 'units', id(c));
  await c.db.prepare('DELETE FROM units WHERE id = ?').bind(u.id).run();
  audit(c, 'unit.delete', u.title);
  return { ok: true };
});

route('POST', '/manage/lessons', STAFF, async (c) => {
  const b = await body(c);
  const unitId = int(b.unit_id, 'الوحدة', { min: 1 });
  await mustExist(c.db, 'units', unitId);
  const r = await c.db
    .prepare('INSERT INTO lessons (unit_id, title, summary, position, published, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(unitId, str(b.title, 'عنوان الدرس', { min: 1, max: 200 }), str(b.summary, 'الملخص', { max: 1000 }),
      await nextPos(c.db, 'lessons', 'unit_id', unitId), bool(b.published) ?? 1, c.now)
    .first();
  audit(c, 'lesson.create', r.id);
  return { id: r.id };
});
route('PUT', '/manage/lessons/:id', STAFF, async (c) => {
  const l = await mustExist(c.db, 'lessons', id(c));
  const b = await body(c);
  let unitId = l.unit_id;
  if (b.unit_id !== undefined) {
    unitId = int(b.unit_id, 'الوحدة', { min: 1 });
    await mustExist(c.db, 'units', unitId);
  }
  await c.db
    .prepare('UPDATE lessons SET title = ?, summary = ?, published = ?, unit_id = ?, updated_at = ? WHERE id = ?')
    .bind(str(b.title ?? l.title, 'عنوان الدرس', { min: 1, max: 200 }), str(b.summary ?? l.summary, 'الملخص', { max: 1000 }),
      bool(b.published) ?? l.published, unitId, c.now, l.id)
    .run();
  if (unitId !== l.unit_id) await c.db.prepare('UPDATE quizzes SET unit_id = ? WHERE lesson_id = ?').bind(unitId, l.id).run();
  return { ok: true };
});
route('DELETE', '/manage/lessons/:id', STAFF, async (c) => {
  const l = await mustExist(c.db, 'lessons', id(c));
  const { results: media } = await c.db.prepare('SELECT media_id FROM items WHERE lesson_id = ? AND media_id IS NOT NULL').bind(l.id).all();
  await c.db.prepare('DELETE FROM lessons WHERE id = ?').bind(l.id).run();
  for (const m of media) await dropMediaIfUnused(c, m.media_id);
  audit(c, 'lesson.delete', l.title);
  return { ok: true };
});

const ITEM_KINDS = ['text', 'video', 'audio', 'file', 'link', 'book'];
async function itemFields(c, b, kind) {
  const f = { title: str(b.title, 'العنوان', { max: 200 }), body: '', url: '', media_id: null };
  if (kind === 'text') f.body = str(b.body, 'النص', { min: 1, max: 60000 });
  else if (kind === 'book') {
    const from = int(b.from, 'من صفحة', { min: 1, max: 2000 });
    const to = int(b.to, 'إلى صفحة', { min: from, max: Math.min(from + 40, 2000) });
    const book = str(b.book || 'math6', 'الكتاب', { max: 40 });
    if (!/^[a-z0-9_-]+$/.test(book)) throw new HttpError(400, 'اسم الكتاب غير صالح.');
    f.body = JSON.stringify({ book, from, to });
  } else {
    f.body = str(b.body, 'الوصف', { max: 5000 });
    if (b.media_id) {
      const m = await c.db.prepare('SELECT id FROM media WHERE id = ?').bind(String(b.media_id)).first();
      if (!m) throw new HttpError(400, 'الملف المرفوع غير موجود.');
      f.media_id = m.id;
    } else f.url = httpUrl(b.url, 'الرابط');
    if (kind === 'link' && f.media_id) throw new HttpError(400, 'الرابط يجب أن يكون عنوان إنترنت.');
  }
  return f;
}
route('POST', '/manage/items', STAFF, async (c) => {
  const b = await body(c);
  const lessonId = int(b.lesson_id, 'الدرس', { min: 1 });
  await mustExist(c.db, 'lessons', lessonId);
  const kind = String(b.kind);
  if (!ITEM_KINDS.includes(kind)) throw new HttpError(400, 'نوع المحتوى غير معروف.');
  const f = await itemFields(c, b, kind);
  const r = await c.db
    .prepare('INSERT INTO items (lesson_id, kind, title, body, url, media_id, position) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(lessonId, kind, f.title, f.body, f.url, f.media_id, await nextPos(c.db, 'items', 'lesson_id', lessonId))
    .first();
  await c.db.prepare('UPDATE lessons SET updated_at = ? WHERE id = ?').bind(c.now, lessonId).run();
  return { id: r.id };
});
route('PUT', '/manage/items/:id', STAFF, async (c) => {
  const it = await mustExist(c.db, 'items', id(c));
  const b = await body(c);
  const f = await itemFields(c, { ...b, media_id: b.media_id === undefined ? it.media_id : b.media_id }, it.kind);
  await c.db.prepare('UPDATE items SET title = ?, body = ?, url = ?, media_id = ? WHERE id = ?').bind(f.title, f.body, f.url, f.media_id, it.id).run();
  if (it.media_id && it.media_id !== f.media_id) await dropMediaIfUnused(c, it.media_id);
  return { ok: true };
});
route('DELETE', '/manage/items/:id', STAFF, async (c) => {
  const it = await mustExist(c.db, 'items', id(c));
  await c.db.prepare('DELETE FROM items WHERE id = ?').bind(it.id).run();
  await dropMediaIfUnused(c, it.media_id);
  return { ok: true };
});

route('POST', '/manage/quizzes', STAFF, async (c) => {
  const b = await body(c);
  let unitId = b.unit_id ? int(b.unit_id, 'الوحدة', { min: 1 }) : null;
  let lessonId = b.lesson_id ? int(b.lesson_id, 'الدرس', { min: 1 }) : null;
  if (lessonId) unitId = (await mustExist(c.db, 'lessons', lessonId)).unit_id;
  if (!unitId) throw new HttpError(400, 'اختر الوحدة أو الدرس.');
  await mustExist(c.db, 'units', unitId);
  const f = quizFields(b, {});
  const r = await c.db
    .prepare(
      'INSERT INTO quizzes (unit_id, lesson_id, title, description, pass_percent, max_attempts, show_answers, shuffle, published, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id'
    )
    .bind(unitId, lessonId, f.title, f.description, f.pass_percent, f.max_attempts, f.show_answers, f.shuffle, f.published,
      await nextPos(c.db, 'quizzes', 'unit_id', unitId))
    .first();
  audit(c, 'quiz.create', r.id);
  return { id: r.id };
});
function quizFields(b, cur) {
  return {
    title: str(b.title ?? cur.title, 'عنوان الاختبار', { min: 1, max: 200 }),
    description: str(b.description ?? cur.description ?? '', 'الوصف', { max: 2000 }),
    pass_percent: int(b.pass_percent ?? cur.pass_percent ?? 50, 'درجة النجاح', { min: 0, max: 100 }),
    max_attempts: int(b.max_attempts ?? cur.max_attempts ?? 0, 'عدد المحاولات', { min: 0, max: 100 }),
    show_answers: bool(b.show_answers) ?? cur.show_answers ?? 1,
    shuffle: bool(b.shuffle) ?? cur.shuffle ?? 0,
    published: bool(b.published) ?? cur.published ?? 1,
  };
}
route('GET', '/manage/quizzes/:id', STAFF, async (c) => {
  const quiz = await mustExist(c.db, 'quizzes', id(c));
  const { results } = await c.db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position, id').bind(quiz.id).all();
  const extra = await c.db
    .prepare('SELECT un.subject_id, un.title AS unit_title, l.title AS lesson_title FROM units un LEFT JOIN lessons l ON l.id = ? WHERE un.id = ?')
    .bind(quiz.lesson_id, quiz.unit_id)
    .first();
  return {
    quiz: { ...quiz, ...extra },
    questions: results.map((q) => ({ ...q, options: JSON.parse(q.options), answer: JSON.parse(q.answer) })),
  };
});
route('PUT', '/manage/quizzes/:id', STAFF, async (c) => {
  const q = await mustExist(c.db, 'quizzes', id(c));
  const f = quizFields(await body(c), q);
  await c.db
    .prepare('UPDATE quizzes SET title = ?, description = ?, pass_percent = ?, max_attempts = ?, show_answers = ?, shuffle = ?, published = ? WHERE id = ?')
    .bind(f.title, f.description, f.pass_percent, f.max_attempts, f.show_answers, f.shuffle, f.published, q.id)
    .run();
  return { ok: true };
});
route('DELETE', '/manage/quizzes/:id', STAFF, async (c) => {
  const q = await mustExist(c.db, 'quizzes', id(c));
  await c.db.prepare('DELETE FROM quizzes WHERE id = ?').bind(q.id).run();
  audit(c, 'quiz.delete', q.title);
  return { ok: true };
});

function questionFields(b) {
  const kind = String(b.kind);
  if (!['mcq', 'tf', 'short'].includes(kind)) throw new HttpError(400, 'نوع السؤال غير معروف.');
  const f = {
    kind,
    text: str(b.text, 'نص السؤال', { min: 1, max: 3000 }),
    points: int(b.points ?? 1, 'الدرجة', { min: 1, max: 100 }),
    explanation: str(b.explanation, 'الشرح', { max: 2000 }),
    options: '[]',
  };
  if (kind === 'mcq') {
    if (!Array.isArray(b.options)) throw new HttpError(400, 'أضف الخيارات.');
    const opts = b.options.map((o, i) => str(o, `الخيار ${i + 1}`, { min: 1, max: 500 }));
    if (opts.length < 2 || opts.length > 6) throw new HttpError(400, 'عدد الخيارات من 2 إلى 6.');
    const a = int(b.answer, 'الإجابة الصحيحة', { min: 0, max: opts.length - 1 });
    f.options = JSON.stringify(opts);
    f.answer = JSON.stringify(a);
  } else if (kind === 'tf') {
    if (typeof b.answer !== 'boolean') throw new HttpError(400, 'اختر صح أو خطأ.');
    f.answer = JSON.stringify(b.answer);
  } else {
    const list = (Array.isArray(b.answer) ? b.answer : String(b.answer || '').split('|'))
      .map((x) => String(x).trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((x) => str(x, 'الإجابة', { min: 1, max: 200 }));
    if (!list.length) throw new HttpError(400, 'اكتب الإجابة الصحيحة.');
    f.answer = JSON.stringify(list);
  }
  return f;
}
route('POST', '/manage/questions', STAFF, async (c) => {
  const b = await body(c);
  const quizId = int(b.quiz_id, 'الاختبار', { min: 1 });
  await mustExist(c.db, 'quizzes', quizId);
  const f = questionFields(b);
  const r = await c.db
    .prepare('INSERT INTO questions (quiz_id, kind, text, options, answer, points, explanation, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(quizId, f.kind, f.text, f.options, f.answer, f.points, f.explanation, await nextPos(c.db, 'questions', 'quiz_id', quizId))
    .first();
  return { id: r.id };
});
route('PUT', '/manage/questions/:id', STAFF, async (c) => {
  const q = await mustExist(c.db, 'questions', id(c));
  const f = questionFields(await body(c));
  await c.db
    .prepare('UPDATE questions SET kind = ?, text = ?, options = ?, answer = ?, points = ?, explanation = ? WHERE id = ?')
    .bind(f.kind, f.text, f.options, f.answer, f.points, f.explanation, q.id)
    .run();
  return { ok: true };
});
route('DELETE', '/manage/questions/:id', STAFF, async (c) => {
  const q = await mustExist(c.db, 'questions', id(c));
  await c.db.prepare('DELETE FROM questions WHERE id = ?').bind(q.id).run();
  return { ok: true };
});

const REORDERABLE = { subjects: null, units: 'subject_id', lessons: 'unit_id', items: 'lesson_id', quizzes: 'unit_id', questions: 'quiz_id' };
route('POST', '/manage/reorder', STAFF, async (c) => {
  const b = await body(c);
  const table = String(b.table);
  if (!(table in REORDERABLE)) throw new HttpError(400, 'غير مسموح.');
  if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 500) throw new HttpError(400, 'قائمة غير صالحة.');
  const ids = b.ids.map((x) => int(x, 'المعرّف', { min: 1 }));
  await c.db.batch(ids.map((rid, i) => c.db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`).bind(i, rid)));
  return { ok: true };
});

// ---------------------------------------------------------------- announcements

route('POST', '/announcements', STAFF, async (c) => {
  const b = await body(c);
  const r = await c.db
    .prepare('INSERT INTO announcements (title, body, author_id, pinned, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(str(b.title, 'عنوان الإعلان', { min: 1, max: 200 }), str(b.body, 'نص الإعلان', { max: 5000 }), c.user.id, bool(b.pinned) ?? 0, c.now)
    .first();
  audit(c, 'announcement.create', r.id);
  return { id: r.id };
});
route('PUT', '/announcements/:id', STAFF, async (c) => {
  const a = await mustExist(c.db, 'announcements', id(c));
  const b = await body(c);
  await c.db
    .prepare('UPDATE announcements SET title = ?, body = ?, pinned = ? WHERE id = ?')
    .bind(str(b.title ?? a.title, 'عنوان الإعلان', { min: 1, max: 200 }), str(b.body ?? a.body, 'نص الإعلان', { max: 5000 }), bool(b.pinned) ?? a.pinned, a.id)
    .run();
  return { ok: true };
});
route('DELETE', '/announcements/:id', STAFF, async (c) => {
  const a = await mustExist(c.db, 'announcements', id(c));
  await c.db.prepare('DELETE FROM announcements WHERE id = ?').bind(a.id).run();
  return { ok: true };
});

// ---------------------------------------------------------------- staff reports

route('GET', '/staff/overview', STAFF, async (c) => {
  const [students, lessons, quizzes, week, avg] = await c.db.batch([
    c.db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN last_login > ? THEN 1 ELSE 0 END) AS active FROM users WHERE role = 'student' AND active = 1").bind(c.now - 7 * DAY),
    c.db.prepare('SELECT COUNT(*) AS n, SUM(published) AS pub FROM lessons'),
    c.db.prepare('SELECT COUNT(*) AS n FROM quizzes'),
    c.db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE submitted_at > ?').bind(c.now - 7 * DAY),
    c.db.prepare("SELECT AVG(a.percent) AS avg FROM attempts a JOIN users u ON u.id = a.user_id WHERE u.role = 'student'"),
  ]);
  const { results: recent } = await c.db
    .prepare(
      `SELECT a.id, a.percent, a.passed, a.submitted_at, q.title, u.full_name
         FROM attempts a JOIN quizzes q ON q.id = a.quiz_id JOIN users u ON u.id = a.user_id
        WHERE u.role = 'student' ORDER BY a.submitted_at DESC LIMIT 10`
    )
    .all();
  return {
    students: students.results[0].n, active_week: students.results[0].active || 0,
    lessons: lessons.results[0].n, lessons_published: lessons.results[0].pub || 0,
    quizzes: quizzes.results[0].n, attempts_week: week.results[0].n,
    avg: avg.results[0].avg === null ? null : Math.round(avg.results[0].avg),
    recent,
  };
});

route('GET', '/staff/students', STAFF, async (c) => {
  const total = await c.db.prepare(`SELECT COUNT(*) AS n FROM lessons l JOIN units un ON un.id = l.unit_id JOIN subjects s ON s.id = un.subject_id WHERE ${PUB_LESSON}`).first();
  const { results } = await c.db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.active, u.last_login,
              (SELECT COUNT(*) FROM progress p WHERE p.user_id = u.id) AS done,
              (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id) AS attempts,
              (SELECT ROUND(AVG(best)) FROM (SELECT MAX(percent) AS best FROM attempts a WHERE a.user_id = u.id GROUP BY a.quiz_id)) AS avg
         FROM users u WHERE u.role = 'student' ORDER BY u.username`
    )
    .all();
  return { students: results, lessons_total: total.n };
});

route('GET', '/staff/students/:id', STAFF, async (c) => {
  const u = await c.db.prepare("SELECT id, username, full_name, active, last_login, created_at FROM users WHERE id = ? AND role = 'student'").bind(id(c)).first();
  if (!u) throw new HttpError(404, 'التلميذ غير موجود.');
  const { results: attempts } = await c.db
    .prepare(
      `SELECT a.id, a.percent, a.passed, a.score, a.max_score, a.submitted_at, q.title
         FROM attempts a JOIN quizzes q ON q.id = a.quiz_id WHERE a.user_id = ? ORDER BY a.submitted_at DESC`
    )
    .bind(u.id)
    .all();
  const { results: lessons } = await c.db
    .prepare(
      `SELECT l.id, l.title, un.title AS unit_title, p.completed_at
         FROM lessons l JOIN units un ON un.id = l.unit_id JOIN subjects s ON s.id = un.subject_id
         LEFT JOIN progress p ON p.lesson_id = l.id AND p.user_id = ?
        WHERE ${PUB_LESSON} ORDER BY s.position, un.position, un.id, l.position, l.id`
    )
    .bind(u.id)
    .all();
  return { student: u, attempts, lessons };
});

route('GET', '/staff/quizzes/:id/results', STAFF, async (c) => {
  const quiz = await mustExist(c.db, 'quizzes', id(c));
  const { results } = await c.db
    .prepare(
      `SELECT u.id, u.username, u.full_name,
              COUNT(a.id) AS attempts, MAX(a.percent) AS best, MAX(a.submitted_at) AS last_at,
              (SELECT a2.id FROM attempts a2 WHERE a2.user_id = u.id AND a2.quiz_id = ? ORDER BY a2.percent DESC, a2.submitted_at DESC LIMIT 1) AS best_attempt
         FROM users u LEFT JOIN attempts a ON a.user_id = u.id AND a.quiz_id = ?
        WHERE u.role = 'student' AND u.active = 1 GROUP BY u.id ORDER BY u.username`
    )
    .bind(quiz.id, quiz.id)
    .all();
  return { quiz: { id: quiz.id, title: quiz.title, pass_percent: quiz.pass_percent }, results };
});

// ---------------------------------------------------------------- principal: users

route('GET', '/admin/users', PRINCIPAL, async (c) => {
  const { results } = await c.db
    .prepare("SELECT id, username, full_name, role, active, last_login, created_at FROM users ORDER BY CASE role WHEN 'principal' THEN 0 WHEN 'teacher' THEN 1 ELSE 2 END, username")
    .all();
  return { users: results };
});

route('POST', '/admin/users', PRINCIPAL, async (c) => {
  const b = await body(c);
  const role = String(b.role);
  if (!['teacher', 'student', 'principal'].includes(role)) throw new HttpError(400, 'الدور غير صالح.');
  const username = str(b.username, 'اسم المستخدم', { min: 2, max: 40 }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) throw new HttpError(400, 'اسم المستخدم: حروف إنجليزية وأرقام فقط.');
  const exists = await c.db.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
  if (exists) throw new HttpError(409, 'اسم المستخدم مستخدم من قبل.');
  const password = role === 'student' ? randomDigits(6) : randomPassword(10);
  const r = await c.db
    .prepare('INSERT INTO users (username, full_name, role, pass_hash, active, created_at) VALUES (?, ?, ?, ?, 1, ?) RETURNING id')
    .bind(username, str(b.full_name, 'الاسم', { min: 2, max: 100 }), role, await hashPassword(password, iterations(c)), c.now)
    .first();
  audit(c, 'user.create', `${username} (${role})`);
  return { id: r.id, username, password };
});

route('PUT', '/admin/users/:id', PRINCIPAL, async (c) => {
  const u = await mustExist(c.db, 'users', id(c));
  const b = await body(c);
  const active = bool(b.active) ?? u.active;
  if (u.id === c.user.id && !active) throw new HttpError(400, 'لا يمكنك إيقاف حسابك.');
  await c.db.prepare('UPDATE users SET full_name = ?, active = ? WHERE id = ?').bind(str(b.full_name ?? u.full_name, 'الاسم', { min: 2, max: 100 }), active, u.id).run();
  if (!active) await c.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id).run();
  audit(c, 'user.update', `${u.username} active=${active}`);
  return { ok: true };
});

route('DELETE', '/admin/users/:id', PRINCIPAL, async (c) => {
  const u = await mustExist(c.db, 'users', id(c));
  if (u.id === c.user.id) throw new HttpError(400, 'لا يمكنك حذف حسابك.');
  await c.db.prepare('DELETE FROM users WHERE id = ?').bind(u.id).run();
  audit(c, 'user.delete', u.username);
  return { ok: true };
});

async function resetOne(c, u) {
  const password = u.role === 'student' ? randomDigits(6) : randomPassword(10);
  await c.db.batch([
    c.db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').bind(await hashPassword(password, iterations(c)), u.id),
    c.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id),
    c.db.prepare('DELETE FROM login_attempts WHERE k = ?').bind('u:' + u.username),
  ]);
  return { id: u.id, username: u.username, full_name: u.full_name, role: u.role, password };
}

route('POST', '/admin/users/:id/reset', PRINCIPAL, async (c) => {
  const u = await mustExist(c.db, 'users', id(c));
  if (u.id === c.user.id) throw new HttpError(400, 'لتغيير كلمة مرورك استخدم صفحة "حسابي".');
  const r = await resetOne(c, u);
  audit(c, 'user.reset', u.username);
  return r;
});

// Reset a batch of student passwords (to print fresh login cards). Small batches
// keep each request inside the Workers CPU budget; the page calls it repeatedly.
route('POST', '/admin/reset-batch', PRINCIPAL, async (c) => {
  const b = await body(c);
  if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 5) throw new HttpError(400, 'من 1 إلى 5 حسابات في كل دفعة.');
  const out = [];
  for (const rid of b.ids) {
    const u = await c.db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").bind(int(rid, 'المعرّف', { min: 1 })).first();
    if (u) out.push(await resetOne(c, u));
  }
  audit(c, 'user.reset-batch', out.map((x) => x.username).join(','));
  return { users: out };
});

route('POST', '/admin/users/:id/logout', PRINCIPAL, async (c) => {
  const u = await mustExist(c.db, 'users', id(c));
  await c.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id).run();
  return { ok: true };
});

route('GET', '/admin/audit', PRINCIPAL, async (c) => {
  const { results } = await c.db
    .prepare('SELECT a.id, a.action, a.detail, a.created_at, u.full_name FROM audit a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200')
    .all();
  return { audit: results };
});
