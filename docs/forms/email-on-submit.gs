/**
 * EnvironmSafe — email every form response, in full, as it arrives.
 *
 * The website's forms (quote request, feedback, complaint, grievance) save into
 * Google Forms. Google Forms on its own only sends a "new response" alert with
 * no details, and only to the form's owner. This script sends the whole
 * response to the addresses below, with Reply-To set to the customer, so you
 * can answer straight from your inbox.
 *
 * SET-UP (once per form, about 3 minutes; see docs/forms/README.md):
 *   1. Sign in as the account that owns the form (environmsafe.gm@gmail.com).
 *   2. Open the form in edit mode -> three-dot menu -> Apps Script.
 *   3. Delete the placeholder code, paste this whole file, and edit NOTIFY_TO.
 *   4. Save, choose `setup` in the function list, and press Run.
 *      Approve the permissions Google asks for (send email, read this form).
 *   5. Send a test from the website. The email arrives within a minute.
 *
 * Running `setup` twice is safe: it removes its own old trigger first.
 */

// Who receives the emails. Separate several addresses with commas.
const NOTIFY_TO = 'support@environmsafe.com';

// Shown at the start of the subject line, so the emails are easy to filter.
const SUBJECT_PREFIX = 'EnvironmSafe website';

function setup() {
  const form = FormApp.getActiveForm();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onFormSubmitEmail')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onFormSubmitEmail').forForm(form).onFormSubmit().create();
  Logger.log('Ready: responses to "%s" will be emailed to %s', form.getTitle(), NOTIFY_TO);
}

function onFormSubmitEmail(e) {
  const form = FormApp.getActiveForm();
  const answers = e.response.getItemResponses().map(r => ({
    question: r.getItem().getTitle(),
    answer: [].concat(r.getResponse()).join(', ')
  }));

  const find = words => {
    const hit = answers.find(a => words.some(w => a.question.toLowerCase().includes(w)));
    return hit ? hit.answer.trim() : '';
  };
  const name = find(['name', 'الاسم']);
  const email = find(['email', 'e-mail', 'البريد']);
  const service = find(['service', 'الخدمة']);

  const subject = [SUBJECT_PREFIX + ': ' + form.getTitle(), service, name]
    .filter(Boolean).join(' — ');

  const esc = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = answers.map(a =>
    '<tr><td style="padding:8px 12px;background:#F4F6F9;font-weight:bold;vertical-align:top;white-space:nowrap">' +
    esc(a.question) + '</td><td style="padding:8px 12px;white-space:pre-wrap">' +
    esc(a.answer) + '</td></tr>').join('');
  const when = Utilities.formatDate(e.response.getTimestamp(), 'Asia/Aden', 'd MMM yyyy, HH:mm');

  const htmlBody =
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b">' +
    '<p>New response to <b>' + esc(form.getTitle()) + '</b> (' + esc(when) + ' Aden time).</p>' +
    '<table style="border-collapse:collapse;border:1px solid #e2e8f0">' + rows + '</table>' +
    (email ? '<p>Reply to this email to answer the customer directly.</p>' : '') +
    '</div>';
  const body = answers.map(a => a.question + ': ' + a.answer).join('\n');

  const message = { to: NOTIFY_TO, subject: subject, htmlBody: htmlBody, body: body, name: 'EnvironmSafe Website' };
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) message.replyTo = email;
  MailApp.sendEmail(message);
}
