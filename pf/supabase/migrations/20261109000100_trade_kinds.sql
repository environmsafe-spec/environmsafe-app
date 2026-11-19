-- ES-PF v2 · Migration 11: procurement and sales document kinds.
-- New enum values must be committed before they are used, so they get their own migration.
alter type public.doc_kind add value if not exists 'purchase_order';
alter type public.doc_kind add value if not exists 'supplier_bill';
alter type public.doc_kind add value if not exists 'quotation';
alter type public.doc_kind add value if not exists 'sales_invoice';
alter type public.doc_kind add value if not exists 'credit_note';
