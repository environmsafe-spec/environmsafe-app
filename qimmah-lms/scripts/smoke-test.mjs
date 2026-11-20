// End-to-end API test against a running server (default http://localhost:8787).
// Usage: npm run setup:local && npm run dev   (in another terminal)   then: npm test
// Uses the credentials in .secrets/credentials.json. Leaves test data behind,
// so run `npm run setup:local` afterwards to reset.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const creds = JSON.parse(readFileSync(join(ROOT, '.secrets', 'credentials.json'), 'utf8')).users;
const cred = (u) => creds.find((x) => x.username === u);
let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`);
}

class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, body, headers = {}) {
    const h = { 'x-qimmah': '1', ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let payload;
    if (body instanceof Uint8Array) payload = body;
    else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + '/api' + path, { method, headers: h, body: payload, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, headers: res.headers };
  }
  async login(u) {
    return this.req('POST', '/login', { username: u, password: cred(u).password });
  }
}

const anon = new Client();
const st = new Client();
const st2 = new Client();
const te = new Client();
const pr = new Client();

// --- auth
check('anonymous /me is 401', (await anon.req('GET', '/me')).status === 401);
check('wrong password rejected', (await anon.req('POST', '/login', { username: '602', password: '000000' })).status === 401);
check('POST without x-qimmah header is 403', (await anon.req('POST', '/login', { username: 'x', password: 'y' }, { 'x-qimmah': '0' })).status === 403);
check('foreign Origin is 403', (await anon.req('POST', '/login', { username: 'x', password: 'y' }, { origin: 'https://evil.example' })).status === 403);
check('student login', (await st.login('601')).status === 200);
check('student 2 login', (await st2.login('603')).status === 200);
check('teacher login', (await te.login('teacher')).status === 200);
check('principal login', (await pr.login('principal')).status === 200);
check('login with Arabic-cased username works (case-insensitive)', (await new Client().req('POST', '/login', { username: 'TEACHER', password: cred('teacher').password })).status === 200);

// --- rate limit on one username
const rl = new Client();
let last;
for (let i = 0; i < 6; i++) last = await rl.req('POST', '/login', { username: '630', password: 'nope' + i });
check('6th wrong attempt is rate limited (429)', last.status === 429, last.status);
check('correct password still locked out', (await rl.login('630')).status === 429);

// --- RBAC
for (const [m, p] of [['GET', '/staff/students'], ['GET', '/admin/users'], ['POST', '/manage/lessons'], ['PUT', '/manage/items/1'], ['DELETE', '/manage/quizzes/1'], ['GET', '/manage/quizzes/1'], ['POST', '/announcements'], ['POST', '/admin/reset-batch']])
  check(`student blocked: ${m} ${p}`, (await st.req(m, p, m === 'GET' ? undefined : {})).status === 403);
check('teacher blocked from /admin/users', (await te.req('GET', '/admin/users')).status === 403);

// --- learning flow
const home = await st.req('GET', '/home');
check('student home has subjects & next lesson', home.status === 200 && home.data.subjects.length === 1 && home.data.next);
const subj = await st.req('GET', '/subjects/' + home.data.subjects[0].id);
check('subject has 4 units', subj.data.units.length === 4);
const lesson = await st.req('GET', '/lessons/' + home.data.next.id);
check('lesson has items', lesson.data.items.length >= 2 && lesson.data.quizzes.length === 1);
check('complete lesson', (await st.req('POST', `/lessons/${home.data.next.id}/complete`)).status === 200);

const qid = lesson.data.quizzes[0].id;
const quiz = await st.req('GET', '/quizzes/' + qid);
check('student quiz has no answers in payload', !JSON.stringify(quiz.data.questions).includes('"answer"') && !JSON.stringify(quiz.data.questions).includes('explanation'));
// get the key via teacher to submit a perfect attempt
const key = await te.req('GET', '/manage/quizzes/' + qid);
const answers = {};
for (const q of key.data.questions) answers[q.id] = q.kind === 'short' ? q.answer[0].replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]) : q.answer;
const sub = await st.req('POST', `/quizzes/${qid}/submit`, { answers });
check('perfect attempt scores 100% (short answers typed with Arabic digits)', sub.data.attempt && sub.data.attempt.percent === 100, JSON.stringify(sub.data).slice(0, 300));
const bad = await st.req('POST', `/quizzes/${qid}/submit`, { answers: {} });
check('empty attempt scores 0% and fails', bad.data.attempt.percent === 0 && !bad.data.attempt.passed);
check('review shows correct answers', bad.data.details.every((d) => d.answer !== null));
check('other student cannot read this attempt', (await st2.req('GET', '/attempts/' + sub.data.attempt.id)).status === 403);
check('teacher can read this attempt', (await te.req('GET', '/attempts/' + sub.data.attempt.id)).status === 200);

// --- teacher authoring
const unitId = subj.data.units[0].id;
const nl = await te.req('POST', '/manage/lessons', { unit_id: unitId, title: 'درس تجريبي', summary: 'اختبار', published: false });
check('teacher creates hidden lesson', nl.status === 200);
check('student cannot open hidden lesson', (await st.req('GET', '/lessons/' + nl.data.id)).status === 404);
check('add text item', (await te.req('POST', '/manage/items', { lesson_id: nl.data.id, kind: 'text', title: 'شرح', body: '## عنوان\n- نقطة **مهمة**' })).status === 200);
check('add youtube video', (await te.req('POST', '/manage/items', { lesson_id: nl.data.id, kind: 'video', title: 'فيديو', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).status === 200);
check('javascript: URL rejected', (await te.req('POST', '/manage/items', { lesson_id: nl.data.id, kind: 'link', title: 'x', url: 'javascript:alert(1)' })).status === 400);
const audio = new Uint8Array(4096).map((_, i) => i % 256);
const up = await te.req('POST', '/manage/upload', audio, { 'content-type': 'audio/mpeg', 'x-filename': encodeURIComponent('تسجيل.mp3') });
check('upload audio to R2', up.status === 200 && up.data.id, JSON.stringify(up.data));
check('html upload rejected', (await te.req('POST', '/manage/upload', new Uint8Array(10), { 'content-type': 'text/html' })).status === 415);
check('add audio item from upload', (await te.req('POST', '/manage/items', { lesson_id: nl.data.id, kind: 'audio', title: 'صوت', media_id: up.data.id })).status === 200);
const range = await st.req('GET', '/media/' + up.data.id, undefined, { range: 'bytes=100-199' });
check('media range request returns 206 with 100 bytes', range.status === 206 && range.data.byteLength === 100 && new Uint8Array(range.data)[0] === 100);
check('anonymous cannot fetch media', (await anon.req('GET', '/media/' + up.data.id)).status === 401);
check('publish lesson', (await te.req('PUT', '/manage/lessons/' + nl.data.id, { published: true })).status === 200);
check('student now sees lesson', (await st.req('GET', '/lessons/' + nl.data.id)).status === 200);

const nq = await te.req('POST', '/manage/quizzes', { lesson_id: nl.data.id, title: 'تمرين تجريبي', pass_percent: 60, max_attempts: 1, published: true });
check('create quiz', nq.status === 200);
check('add mcq', (await te.req('POST', '/manage/questions', { quiz_id: nq.data.id, kind: 'mcq', text: '2+2؟', options: ['3', '4', '5'], answer: 1, points: 2 })).status === 200);
check('add tf', (await te.req('POST', '/manage/questions', { quiz_id: nq.data.id, kind: 'tf', text: '1>2', answer: false })).status === 200);
check('add short', (await te.req('POST', '/manage/questions', { quiz_id: nq.data.id, kind: 'short', text: 'نصف', answer: '1/2|0.5' })).status === 200);
check('invalid mcq answer index rejected', (await te.req('POST', '/manage/questions', { quiz_id: nq.data.id, kind: 'mcq', text: 'x', options: ['a', 'b'], answer: 5 })).status === 400);
const qq = (await te.req('GET', '/manage/quizzes/' + nq.data.id)).data.questions;
const r1 = await st.req('POST', `/quizzes/${nq.data.id}/submit`, { answers: { [qq[0].id]: 1, [qq[1].id]: true, [qq[2].id]: '٠٫٥' } });
check('partial score 3/4 = 75%, passed', r1.data.attempt && r1.data.attempt.percent === 75 && r1.data.attempt.passed, JSON.stringify(r1.data).slice(0, 200));
check('max_attempts=1 enforced', (await st.req('POST', `/quizzes/${nq.data.id}/submit`, { answers: {} })).status === 403);
const res = await te.req('GET', `/staff/quizzes/${nq.data.id}/results`);
check('quiz results list 30 students', res.data.results.length === 30 && res.data.results.find((r) => r.username === '601').best === 75);
const reorder = await te.req('POST', '/manage/reorder', { table: 'questions', ids: qq.map((q) => q.id).reverse() });
check('reorder questions', reorder.status === 200 && (await te.req('GET', '/manage/quizzes/' + nq.data.id)).data.questions[0].kind === 'short');
check('reorder unknown table rejected', (await te.req('POST', '/manage/reorder', { table: 'users', ids: [1] })).status === 400);

// --- announcements
check('teacher posts announcement', (await te.req('POST', '/announcements', { title: 'تنبيه', body: 'غداً اختبار' })).status === 200);
check('student sees announcement', (await st.req('GET', '/announcements')).data.announcements.some((a) => a.title === 'تنبيه'));

// --- principal
const users = await pr.req('GET', '/admin/users');
check('principal sees 32 users', users.data.users.length === 32);
const s2 = users.data.users.find((u) => u.username === '603');
const reset = await pr.req('POST', `/admin/users/${s2.id}/reset`);
check('principal resets password (6 digits)', /^\d{6}$/.test(reset.data.password));
check('old session of reset student is revoked', (await st2.req('GET', '/me')).status === 401);
check('reset student logs in with new password', (await new Client().req('POST', '/login', { username: '603', password: reset.data.password })).status === 200);
check('deactivate student', (await pr.req('PUT', `/admin/users/${s2.id}`, { active: false })).status === 200);
check('deactivated student cannot log in', (await new Client().req('POST', '/login', { username: '603', password: reset.data.password })).status === 403);
const nu = await pr.req('POST', '/admin/users', { username: '631', full_name: 'تلميذ جديد', role: 'student' });
check('principal creates student', nu.status === 200 && /^\d{6}$/.test(nu.data.password));
check('duplicate username rejected', (await pr.req('POST', '/admin/users', { username: '631', full_name: 'x y', role: 'student' })).status === 409);
const batch = await pr.req('POST', '/admin/reset-batch', { ids: [nu.data.id] });
check('batch reset for cards', batch.data.users.length === 1);
check('audit log has entries', (await pr.req('GET', '/admin/audit')).data.audit.length > 5);

// --- change own password & logout
check('student changes own password', (await st.req('POST', '/me/password', { current: cred('601').password, next: '4321' })).status === 200);
check('logout', (await st.req('POST', '/logout')).status === 200 && (await st.req('GET', '/me')).status === 401);

// --- static & headers
const page = await fetch(BASE + '/');
check('index served with CSP', page.status === 200 && (page.headers.get('content-security-policy') || '').includes("default-src 'self'"));
check('book page image served', (await fetch(BASE + '/book/math6/p016.jpg')).status === 200);
check('APK downloadable', (await fetch(BASE + '/download/qimmah.apk')).headers.get('content-type') === 'application/vnd.android.package-archive');
const apiH = await anon.req('GET', '/me');
check('API responses carry nosniff + no-store', apiH.headers.get('x-content-type-options') === 'nosniff' && apiH.headers.get('cache-control') === 'no-store');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
