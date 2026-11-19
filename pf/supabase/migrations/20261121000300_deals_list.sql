-- Since v2 step 2 every receipt and payment carries its project, so "a project with documents" no longer means
-- "a deal". The Deals list shows deals started as deals, and projects holding deal documents
-- (request, RFQ, offer, quotation, customer order, goods receipt, delivery note).
create or replace view public.v_deals with (security_invoker = true) as
with docs as (
  select d.project_id, d.kind::text as kind, d.status, d.amount, d.currency, d.doc_date, d.id
    from public.documents d where d.project_id is not null and d.status <> 'void'
), k as (
  select project_id,
         bool_or(kind in ('customer_request', 'supplier_rfq', 'supplier_offer', 'quotation', 'sales_order', 'goods_receipt',
                          'delivery_note')) as has_deal_docs,
         bool_or(kind = 'customer_request') as has_request,
         bool_or(kind = 'supplier_rfq' and status = 'posted') as has_rfq,
         bool_or(kind = 'supplier_offer' and status = 'posted') as has_offer,
         bool_or(kind = 'quotation' and status = 'posted') as has_quote,
         bool_or(kind = 'sales_order' and status = 'posted') as has_order,
         bool_or(kind = 'purchase_order' and status = 'posted') as has_po,
         bool_or(kind = 'goods_receipt' and status = 'posted') as has_grn,
         bool_or(kind = 'delivery_note' and status = 'posted') as has_dn,
         bool_or(kind = 'sales_invoice' and status = 'posted') as has_inv,
         count(*) filter (where status in ('draft', 'submitted')) as drafts,
         max(doc_date) as last_date
    from docs group by project_id
), money as (
  select d.project_id,
         sum(b.amount / d.rate) filter (where d.kind = 'sales_order') as ordered_usd,
         sum(b.amount / d.rate) filter (where d.kind = 'sales_invoice') as invoiced_usd,
         sum(b.open_amount / d.rate) filter (where d.kind = 'sales_invoice') as receivable_usd,
         sum(b.amount / d.rate) filter (where d.kind = 'supplier_bill') as billed_usd,
         sum(b.open_amount / d.rate) filter (where d.kind = 'supplier_bill') as payable_usd
    from public.documents d join public.v_document_balances b on b.id = d.id
   where d.project_id is not null and d.status = 'posted'
   group by d.project_id
)
select p.id, p.company_id, p.code, p.name_en, p.name_ar, p.customer_id, c.name_en as customer_name, p.status::text as status, p.deal_outcome,
       p.closed_on,
       case
         when p.status = 'closed' then coalesce(p.deal_outcome, 'closed')
         when k.has_inv and coalesce(m.receivable_usd, 0) = 0 then 'paid'
         when k.has_inv then 'invoiced'
         when k.has_dn then 'delivered'
         when k.has_grn then 'received'
         when k.has_po then 'purchasing'
         when k.has_order then 'ordered'
         when k.has_quote then 'quoted'
         when k.has_offer then 'offers'
         when k.has_rfq then 'sourcing'
         when k.has_request then 'request'
         else 'new'
       end as stage,
       coalesce(k.drafts, 0) as drafts, coalesce(k.last_date, p.created_at::date) as last_date,
       round(coalesce(m.ordered_usd, 0), 2) as ordered_usd, round(coalesce(m.invoiced_usd, 0), 2) as invoiced_usd,
       round(coalesce(m.receivable_usd, 0), 2) as receivable_usd, round(coalesce(m.billed_usd, 0), 2) as billed_usd,
       round(coalesce(m.payable_usd, 0), 2) as payable_usd
  from public.projects p
  left join k on k.project_id = p.id
  left join money m on m.project_id = p.id
  left join public.parties c on c.id = p.customer_id
 where p.is_deal or k.has_deal_docs;
