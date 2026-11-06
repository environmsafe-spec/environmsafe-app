# Website forms → email

The website's four forms (quote request on Contact, post-service feedback,
complaint, grievance) do not send email themselves. Each one posts into a
Google Form (`public/js/form-config.js` holds the form ids), and the answers
are stored as responses in that form.

The forms are owned by **environmsafe.gm@gmail.com**. Google Forms on its own
emails only the owner, only if notifications are switched on, and only a
"new response" alert with no details. That is why a test quote sent from the
website produced no email.

`email-on-submit.gs` fixes that: once installed in a form, every response is
emailed in full to the addresses you choose, with Reply-To set to the
customer's email address.

## Install it in the quote form (about 3 minutes)

1. Sign in to Google as **environmsafe.gm@gmail.com**.
2. Open the website's quote-request form in **edit** mode.
3. Three-dot menu (⋮) → **Apps Script**. A new tab opens.
4. Delete the placeholder `function myFunction() {}` and paste the whole of
   `email-on-submit.gs`.
5. Change `NOTIFY_TO` to the address(es) that should receive quotes, for
   example `'support@environmsafe.com, yourname@gmail.com'`.
6. Click **Save** (disk icon).
7. In the function list next to **Run**, choose **`setup`**, then click **Run**.
8. Google asks for permission: *Review permissions* → choose the account →
   *Advanced* → *Go to project (unsafe)* → *Allow*. "Unsafe" only means Google
   has not reviewed this private script; it can only read this form and send
   email from this account.
9. The log should say `Ready: responses to "…" will be emailed to …`.
10. Send a test quote from https://www.environmsafe.com/contact.html. The email
    arrives within about a minute.

To use it for the feedback, complaint or grievance forms as well, repeat the
same steps in each of those forms.

## If no email arrives

- Open the form → **Responses**. If the test is **not** there, the website's
  post was rejected by Google: most often a question was changed to multiple
  choice or made required. See the warning at the top of
  `public/js/form-config.js`.
- If the response **is** there but no email came, open the Apps Script tab →
  **Executions** (left sidebar) to see the error, and check your spam folder.
- Gmail accounts can send about 100 such emails a day, far above the site's
  volume.

## Known limitation

The website shows "Thank you" about 2.5 seconds after sending, whether or not
Google accepted the response, because a static page cannot read Google's
reply. A server-side sender (a Cloudflare Pages Function with an email
service) would remove that blind spot; it needs an email-service account and
an API key set in Cloudflare.
