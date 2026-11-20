// Builds .secrets/seed.sql: the 32 accounts (hashed passwords) and the course
// content from seed/content.json. The SQL first empties every table, so it is
// only ever run against a new database (deploy.mjs checks that first).
// Usage: node scripts/seed.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SECRETS, hashPassword, loadCredentials, sq, writeCredentialsDoc } from './lib.mjs';

const TABLES = ['audit', 'announcements', 'progress', 'attempts', 'questions', 'quizzes', 'items', 'media', 'lessons', 'units', 'subjects', 'login_attempts', 'sessions', 'users'];

export function buildSeedSql(url) {
  const creds = loadCredentials();
  const content = JSON.parse(readFileSync(join(ROOT, 'seed', 'content.json'), 'utf8'));
  const now = Date.now();
  const out = TABLES.map((t) => `DELETE FROM ${t};`);
  let uid = 0;
  for (const u of creds.users) {
    uid++;
    out.push(
      `INSERT INTO users (id, username, full_name, role, pass_hash, active, created_at) VALUES (${uid}, ${sq(u.username)}, ${sq(u.full_name)}, ${sq(u.role)}, ${sq(hashPassword(u.password))}, 1, ${now});`
    );
  }
  let sid = 0, unid = 0, lid = 0, iid = 0, qzid = 0, qid = 0;
  const quiz = (q, unitId, lessonId, pos) => {
    qzid++;
    out.push(
      `INSERT INTO quizzes (id, unit_id, lesson_id, title, description, pass_percent, max_attempts, show_answers, shuffle, published, position) VALUES (${qzid}, ${unitId}, ${lessonId ?? 'NULL'}, ${sq(q.title)}, ${sq(q.description || '')}, ${q.pass_percent ?? 50}, 0, 1, 0, 1, ${pos});`
    );
    q.questions.forEach((x, i) => {
      qid++;
      const options = x.type === 'mcq' ? JSON.stringify(x.options) : '[]';
      const answer = JSON.stringify(x.type === 'short' ? (Array.isArray(x.answer) ? x.answer.map(String) : [String(x.answer)]) : x.answer);
      out.push(
        `INSERT INTO questions (id, quiz_id, kind, text, options, answer, points, explanation, position) VALUES (${qid}, ${qzid}, ${sq(x.type)}, ${sq(x.text)}, ${sq(options)}, ${sq(answer)}, ${x.points || 1}, ${sq(x.explanation || '')}, ${i});`
      );
    });
  };
  content.subjects.forEach((s, si) => {
    sid++;
    out.push(
      `INSERT INTO subjects (id, title, description, icon, color, position, published) VALUES (${sid}, ${sq(s.title)}, ${sq(s.description || '')}, ${sq(s.icon || '📘')}, ${sq(s.color || '#2563eb')}, ${si}, 1);`
    );
    s.units.forEach((u, ui) => {
      unid++;
      const unitId = unid;
      out.push(`INSERT INTO units (id, subject_id, title, description, position, published) VALUES (${unitId}, ${sid}, ${sq(u.title)}, ${sq(u.description || '')}, ${ui}, 1);`);
      u.lessons.forEach((l, li) => {
        lid++;
        out.push(
          `INSERT INTO lessons (id, unit_id, title, summary, position, published, updated_at) VALUES (${lid}, ${unitId}, ${sq(l.title)}, ${sq(l.summary || '')}, ${li}, 1, ${now});`
        );
        let pos = 0;
        if (l.explanation) {
          iid++;
          out.push(`INSERT INTO items (id, lesson_id, kind, title, body, position) VALUES (${iid}, ${lid}, 'text', 'شرح الدرس', ${sq(l.explanation)}, ${pos++});`);
        }
        if (l.book_pages && l.book_pages.length) {
          iid++;
          const body = JSON.stringify({ book: s.book || 'math6', from: Math.min(...l.book_pages), to: Math.max(...l.book_pages) });
          out.push(`INSERT INTO items (id, lesson_id, kind, title, body, position) VALUES (${iid}, ${lid}, 'book', 'صفحات الدرس من الكتاب المدرسي', ${sq(body)}, ${pos++});`);
        }
        if (l.quiz && l.quiz.questions && l.quiz.questions.length) quiz(l.quiz, unitId, lid, li);
      });
      if (u.unit_test && u.unit_test.questions && u.unit_test.questions.length) quiz(u.unit_test, unitId, null, 1000);
    });
  });
  out.push(
    `INSERT INTO announcements (title, body, author_id, pinned, created_at) VALUES (${sq('مرحباً بكم في منصة التعلّم عن بُعد 🌟')}, ${sq('أعزائي تلاميذ الصف السادس، أهلاً بكم في منصة مدارس القمة النموذجية. ادخلوا كل يوم، اقرؤوا الدرس، تصفحوا صفحات الكتاب، ثم حلّوا التمرين. بالتوفيق!')}, 1, 1, ${now});`
  );
  const file = join(SECRETS, 'seed.sql');
  writeFileSync(file, out.join('\n') + '\n');
  const doc = writeCredentialsDoc(creds, url);
  return { file, doc, counts: { users: uid, subjects: sid, units: unid, lessons: lid, items: iid, quizzes: qzid, questions: qid } };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const r = buildSeedSql();
  console.log('Seed SQL:', r.file);
  console.log('Credentials:', r.doc);
  console.log(r.counts);
}
