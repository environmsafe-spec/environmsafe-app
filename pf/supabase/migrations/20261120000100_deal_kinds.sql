-- ES-PF v2 · Phase 7 (Deals): new document kinds. Enum values must be committed before they are used.
alter type public.doc_kind add value if not exists 'customer_request';   -- RFQ received from a customer
alter type public.doc_kind add value if not exists 'supplier_rfq';       -- our request for quotation to a supplier
alter type public.doc_kind add value if not exists 'supplier_offer';     -- a supplier's quotation / offer
alter type public.doc_kind add value if not exists 'sales_order';        -- customer order (their PO), confirmed by us
alter type public.doc_kind add value if not exists 'goods_receipt';      -- goods / service received from a supplier
alter type public.doc_kind add value if not exists 'delivery_note';      -- goods / service delivered to a customer
