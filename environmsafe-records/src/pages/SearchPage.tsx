import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Empty, LinkButton, PageHeader, Row } from '../components/ui';
import { searchAll, type SearchHit } from '../lib/domain';
import { t } from '../lib/i18n';

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  client: 'Client', asset: 'Asset', finding: 'Finding', inspection: 'Inspection', job: 'Job', document: 'Document',
};

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    const h = setTimeout(async () => {
      setHits(await searchAll(q));
      setParams(q ? { q } : {}, { replace: true });
    }, 150);
    return () => clearTimeout(h);
  }, [q, setParams]);
  return (
    <div>
      <PageHeader title="Search" actions={<LinkButton to="/scan" tone="secondary" icon="qr">Scan QR</LinkButton>} />
      <input
        className="input mb-4 text-lg"
        autoFocus
        type="search"
        placeholder={t('action.search')}
        aria-label="Search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {q && hits.length === 0 && <Empty title="Nothing found" icon="search">Try part of the tag, e.g. "201" or "PSV".</Empty>}
      <div className="surface rounded-2xl border border-line px-3">
        {hits.map((h) => (
          <Row key={`${h.kind}-${h.id}`} to={h.href} title={h.title} sub={h.sub} right={<Badge>{KIND_LABEL[h.kind]}</Badge>} />
        ))}
      </div>
    </div>
  );
}
