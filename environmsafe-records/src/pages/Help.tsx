import { Card, PageHeader } from '../components/ui';
import { APP_VERSION } from '../lib/native';

const TOPICS: { q: string; a: string }[] = [
  { q: 'Start an inspection', a: 'Tap + then "New inspection". Choose the client and the tag (or scan the QR label), choose the inspection type and tap Start. Work through the steps at the top: Checklist, Readings, Photos, Previous findings, New findings, Conclusion & sign. Everything is saved as you type.' },
  { q: 'Previous findings', a: 'Every open finding from earlier inspections appears in "Previous findings". Set each one to Closed, Unchanged, Deteriorated, Improved, Superseded or Deferred and add a note. You cannot submit until all are done. The report then shows the "Status of previous findings" table automatically.' },
  { q: 'Photos', a: 'Tap "Take photo" (or "From gallery"). Photos are made smaller on the phone (about 250 KB) so they upload quickly. Add a caption under each photo – it is printed under the figure in the report. Use the arrows to change the order.' },
  { q: 'No internet', a: 'Keep working. The bar at the top turns yellow and shows how many changes are waiting. When the phone is back online they are sent automatically. Do not sign out while changes are waiting.' },
  { q: 'Daily report', a: 'Open the job and tap "New daily report". It starts from yesterday\'s planned activities, manpower and progress. Fill in today\'s work and tap "PDF + Word".' },
  { q: 'Reports and certificates', a: 'Use Reports → Generate report, or the buttons on an inspection, daily report or certificate. Office or Admin issues the document; it is then locked. To change an issued document, create a revision.' },
  { q: 'Next inspection dates', a: 'The due date is proposed from the interval for the equipment type (or the asset\'s own interval) and can be changed. The Due board shows what is overdue and due in 30, 60 and 90 days.' },
  { q: 'Forgot password / new phone', a: 'Ask the Admin to set a new password for you in Users. On a new phone, install the app and sign in again.' },
];

export default function Help() {
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <PageHeader title="Help" sub={`EnvironmSafe Records version ${APP_VERSION}`} />
      {TOPICS.map((t) => (
        <Card key={t.q} title={t.q}>
          <p>{t.a}</p>
        </Card>
      ))}
      <Card title="Need more help?">
        <p>Contact the office at support@environmsafe.com or +967 78 340 2932.</p>
      </Card>
    </div>
  );
}
