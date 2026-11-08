-- Invoice verification (anti-forgery QR) for the Procurement & Finance system.
-- Supabase project mcgjrsfsppdcnvolqsgs. Apply once; safe to re-run.
--
-- Each issued invoice gets one random token. The QR on the invoice opens
--   https://www.environmsafe.com/verify?t=<token>
-- and that page calls es_verify_invoice(token), which reads the invoice LIVE
-- from es_records. A forged invoice either has no QR, a QR to some other site,
-- or a real token whose page shows the real customer and amount, not the fake.
--
-- Tokens live in their own table, not inside es_records.data, so editing the
-- invoice in the app can never drop or change its token.

create table if not exists public.es_invoice_verify (
  token       text primary key check (token ~ '^[A-Za-z0-9_-]{22,64}$'),
  company_id  uuid not null,
  invoice_no  text not null,
  revoked     boolean not null default false,
  note        text,
  created_at  timestamptz not null default now(),
  unique (company_id, invoice_no)
);

-- No policies: the table is unreadable through the API. Only the two
-- functions below (and the service role) touch it.
alter table public.es_invoice_verify enable row level security;
revoke all on public.es_invoice_verify from anon, authenticated;

-- Public lookup. Returns only what someone holding the invoice can already
-- see on it: number, date, customer, total, currency, status.
create or replace function public.es_verify_invoice(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v   public.es_invoice_verify%rowtype;
  r   record;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22,64}$' then
    return json_build_object('result', 'unknown');
  end if;

  select * into v from public.es_invoice_verify where token = p_token;
  if not found then
    return json_build_object('result', 'unknown');
  end if;

  select min(t.data->>'date')                                   as inv_date,
         sum(coalesce(nullif(t.data->>'amount','')::numeric, 0)) as total,
         string_agg(distinct t.data->>'currency', '/')          as currency,
         min(t.data->>'customerId')                             as customer_id,
         count(*)                                               as lines,
         bool_and(lower(coalesce(t.data->>'status','')) = 'cancelled') as all_cancelled,
         bool_or(lower(coalesce(t.data->>'status','')) in ('paid','closed')) as any_paid
    into r
    from public.es_records t
   where t.company_id = v.company_id
     and t.collection = 'transactions'
     and t.deleted is not true
     and t.data->>'type' = 'INVOICE OUT'
     and t.data->>'refNo' = v.invoice_no;

  if v.revoked or r.lines = 0 or r.all_cancelled then
    return json_build_object('result', 'cancelled', 'invoice_no', v.invoice_no);
  end if;

  return json_build_object(
    'result',     'valid',
    'invoice_no', v.invoice_no,
    'date',       r.inv_date,
    'customer',   coalesce(
                    (select coalesce(nullif(c.data->>'nameEn',''), nullif(c.data->>'nameAr',''), nullif(c.data->>'name',''))
                       from public.es_records c
                      where c.company_id = v.company_id and c.collection = 'customers'
                        and c.deleted is not true and c.data->>'id' = r.customer_id
                      limit 1), ''),
    'total',      round(r.total, 2),
    'currency',   r.currency,
    'status',     case when r.any_paid then 'paid' else 'issued' end
  );
end;
$$;

revoke all on function public.es_verify_invoice(text) from public;
grant execute on function public.es_verify_invoice(text) to anon, authenticated;

-- Issue (or fetch) the token for an invoice number. Not callable through the
-- API: run it from the SQL editor / MCP when an invoice is generated.
create or replace function public.es_invoice_token(p_company uuid, p_invoice_no text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t text;
begin
  select token into t from public.es_invoice_verify
   where company_id = p_company and invoice_no = p_invoice_no;
  if found then return t; end if;
  -- a random v4 UUID (122 random bits) as 22 url-safe characters
  t := rtrim(translate(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/', '-_'), '=');
  insert into public.es_invoice_verify (token, company_id, invoice_no) values (t, p_company, p_invoice_no);
  return t;
end;
$$;

revoke all on function public.es_invoice_token(uuid, text) from public, anon, authenticated;
