-- ES-PF v2 · Migration 6: reference data and company bootstrap
-- Currencies, roles, permissions, document types (global), plus app.bootstrap_company()
-- which seeds the default chart of accounts, periods, rates and internal projects.

insert into public.currencies (code, name_en, name_ar, decimals, sort) values
  ('USD', 'US Dollar',    'دولار أمريكي', 2, 1),
  ('SAR', 'Saudi Riyal',  'ريال سعودي',   2, 2),
  ('YER', 'Yemeni Rial',  'ريال يمني',    2, 3);

insert into public.roles (code, name_en, name_ar, description, requires_mfa, sort) values
  ('owner',       'Owner / Admin', 'المالك / المدير',   'Everything, including users, chart of accounts and reopening periods', true,  1),
  ('accountant',  'Accountant',    'محاسب',             'Post, reverse, close periods, manual journals',                        true,  2),
  ('procurement', 'Procurement',   'المشتريات',          'POs, bills, suppliers, items; no payment posting unless granted',     false, 3),
  ('data_entry',  'Data entry',    'إدخال بيانات',       'Create drafts, upload vouchers, add missing parties/items inline',     false, 4),
  ('auditor',     'Auditor',       'مدقق',              'Read-only everything, including the audit log',                        false, 5),
  ('viewer',      'Viewer',        'مشاهد',             'Selected reports only',                                                false, 6);

insert into public.permissions (code, module, description) values
  ('company.manage',        'settings',    'Edit company settings; manage owner parties'),
  ('users.manage',          'settings',    'Invite users, grant and revoke roles, deactivate users'),
  ('gl.manage',             'accounting',  'Edit the chart of accounts'),
  ('rates.manage',          'settings',    'Maintain FX rates'),
  ('periods.close',         'accounting',  'Close monthly periods'),
  ('periods.reopen',        'accounting',  'Reopen a closed period (logged with reason)'),
  ('audit.view',            'settings',    'Read the audit log'),
  ('masterdata.view',       'masterdata',  'See projects, parties, items, accounts'),
  ('masterdata.create',     'masterdata',  'Create a missing party or item inline from a form'),
  ('projects.manage',       'masterdata',  'Create and edit projects'),
  ('customers.manage',      'masterdata',  'Create and edit customers'),
  ('suppliers.manage',      'masterdata',  'Create and edit suppliers'),
  ('employees.manage',      'masterdata',  'Create and edit employees'),
  ('items.manage',          'masterdata',  'Create and edit items'),
  ('money_accounts.manage', 'masterdata',  'Create and edit bank / cash accounts'),
  ('docs.view',             'documents',   'See documents and attachments'),
  ('docs.create',           'documents',   'Create and edit drafts'),
  ('docs.post',             'documents',   'Post procurement and sales documents (PO, bill, invoice, credit note)'),
  ('docs.post_money',       'documents',   'Post money documents (payments, receipts, transfers, claims, salaries)'),
  ('docs.reverse',          'documents',   'Reverse or void posted documents'),
  ('docs.approve',          'documents',   'Approve documents above the approval threshold'),
  ('journal.manual',        'accounting',  'Create manual journal entries'),
  ('reports.financial',     'reports',     'Financial statements, GL, TB, audit pack'),
  ('reports.view',          'reports',     'Operational reports (project P&L, aging, balances)');

-- owner: everything
insert into public.role_permissions (role_code, permission_code)
select 'owner', code from public.permissions;

insert into public.role_permissions (role_code, permission_code)
select 'accountant', unnest(array[
  'rates.manage', 'periods.close', 'audit.view', 'masterdata.view', 'masterdata.create',
  'projects.manage', 'customers.manage', 'suppliers.manage', 'employees.manage', 'items.manage',
  'money_accounts.manage', 'docs.view', 'docs.create', 'docs.post', 'docs.post_money',
  'docs.reverse', 'journal.manual', 'reports.financial', 'reports.view']);

insert into public.role_permissions (role_code, permission_code)
select 'procurement', unnest(array[
  'masterdata.view', 'masterdata.create', 'suppliers.manage', 'items.manage',
  'docs.view', 'docs.create', 'docs.post', 'reports.view']);

insert into public.role_permissions (role_code, permission_code)
select 'data_entry', unnest(array[
  'masterdata.view', 'masterdata.create', 'docs.view', 'docs.create']);

insert into public.role_permissions (role_code, permission_code)
select 'auditor', unnest(array[
  'audit.view', 'masterdata.view', 'docs.view', 'reports.financial', 'reports.view']);

insert into public.role_permissions (role_code, permission_code)
select 'viewer', unnest(array['masterdata.view', 'reports.view']);

insert into public.document_types (code, prefix, numbering, name_en, name_ar, module, sort) values
  ('purchase_order',  '',     'daily',  'Purchase order',        'أمر شراء',           'procurement', 10),
  ('supplier_bill',   'BILL', 'yearly', 'Supplier bill',         'فاتورة مورد',        'procurement', 20),
  ('quotation',       'QT',   'yearly', 'Quotation',             'عرض سعر',            'sales',       30),
  ('sales_invoice',   'INV-', 'daily',  'Sales invoice',         'فاتورة مبيعات',      'sales',       40),
  ('credit_note',     'CN',   'yearly', 'Credit note',           'إشعار دائن',         'sales',       50),
  ('payment',         'PV',   'yearly', 'Payment voucher',       'سند صرف',            'money',       60),
  ('receipt',         'RV',   'yearly', 'Receipt voucher',       'سند قبض',            'money',       70),
  ('transfer',        'TRF',  'yearly', 'Transfer',              'تحويل',              'money',       80),
  ('expense_claim',   'CLM',  'yearly', 'Expense claim',         'مطالبة مصروفات',     'money',       90),
  ('journal',         'JV',   'yearly', 'Journal voucher',       'قيد يومية',          'accounting', 100);

-- ---------------------------------------------------------------------------
-- Default chart of accounts (IFRS for SMEs presentation). See docs/chart-of-accounts.md.
-- columns: code, parent, type, name_en, name_ar, ifrs_line, postable, requires_project, control_kind, subtype
-- ---------------------------------------------------------------------------
create or replace function app.seed_chart_of_accounts(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  for r in
    select * from (values
      -- Assets
      ('1000', null,   'asset', 'Cash and bank',                         'النقد والبنوك',                 'cash_and_cash_equivalents', false, false, null, 'cash_and_bank'),
      ('1100', null,   'asset', 'Accounts receivable',                   'ذمم مدينة - عملاء',             'trade_receivables',         true,  false, 'ar', null),
      ('1150', null,   'asset', 'Other receivables (owed back)',         'ذمم مدينة أخرى',                'other_receivables',         true,  false, null, null),
      ('1200', null,   'asset', 'Employee advances',                     'سلف الموظفين',                  'other_receivables',         true,  false, 'employee_advance', null),
      ('1250', null,   'asset', 'Advances to suppliers and prepayments', 'دفعات مقدمة للموردين',          'prepayments',               true,  false, 'supplier_advance', null),
      ('1260', null,   'asset', 'Deposits and guarantees paid',          'تأمينات وضمانات مدفوعة',        'prepayments',               true,  false, null, null),
      ('1300', null,   'asset', 'Inventory',                             'المخزون',                       'inventories',               true,  false, null, null),
      ('1400', null,   'asset', 'Tax receivable',                        'ضرائب مستردة',                  'other_receivables',         true,  false, null, null),
      ('1500', null,   'asset', 'Property, plant and equipment',         'الممتلكات والمعدات',            'property_plant_equipment',  false, false, null, null),
      ('1510', '1500', 'asset', 'Vehicles',                              'السيارات',                      'property_plant_equipment',  true,  false, null, 'ppe_cost'),
      ('1520', '1500', 'asset', 'Equipment and tools',                   'المعدات والأدوات',              'property_plant_equipment',  true,  false, null, 'ppe_cost'),
      ('1530', '1500', 'asset', 'Furniture and IT equipment',            'الأثاث وأجهزة الحاسوب',         'property_plant_equipment',  true,  false, null, 'ppe_cost'),
      ('1590', '1500', 'asset', 'Accumulated depreciation',              'مجمع الإهلاك',                  'property_plant_equipment',  true,  false, null, 'accumulated_depreciation'),
      -- Liabilities
      ('2000', null,   'liability', 'Accounts payable',                  'ذمم دائنة - موردون',            'trade_payables',            true,  false, 'ap', null),
      ('2100', null,   'liability', 'Employee payables (claims, salaries)', 'مستحقات الموظفين',          'other_payables',            true,  false, 'employee_payable', null),
      ('2150', null,   'liability', 'Customer advances',                 'دفعات مقدمة من العملاء',        'contract_liabilities',      true,  false, 'customer_advance', null),
      ('2200', null,   'liability', 'Owner current account',             'جاري المالك',                   'related_party_payables',    true,  false, 'owner', null),
      ('2300', null,   'liability', 'VAT and withholding payable',       'ضريبة مستحقة',                  'tax_payables',              true,  false, null, null),
      ('2400', null,   'liability', 'Accrued expenses',                  'مصروفات مستحقة',                'other_payables',            true,  false, null, null),
      ('2900', null,   'liability', 'Suspense (to be reviewed)',         'حساب معلق',                     'other_payables',            true,  false, null, 'suspense'),
      -- Equity
      ('3000', null,   'equity', 'Share capital',                        'رأس المال',                     'share_capital',             true,  false, null, null),
      ('3100', null,   'equity', 'Retained earnings',                    'الأرباح المحتجزة',              'retained_earnings',         true,  false, null, 'retained_earnings'),
      ('3200', null,   'equity', 'Owner drawings',                       'مسحوبات المالك',                'drawings',                  true,  false, null, 'drawings'),
      ('3900', null,   'equity', 'Opening balance equity',               'أرصدة افتتاحية',                'retained_earnings',         true,  false, null, 'opening_balance'),
      -- Income
      ('4000', null,   'income', 'Revenue',                              'الإيرادات',                     'revenue',                   false, true,  null, null),
      ('4100', '4000', 'income', 'Inspection and certification',         'التفتيش وإصدار الشهادات',       'revenue',                   true,  true,  null, null),
      ('4200', '4000', 'income', 'Maintenance services',                 'خدمات الصيانة',                 'revenue',                   true,  true,  null, null),
      ('4300', '4000', 'income', 'HSE and training',                     'السلامة والتدريب',              'revenue',                   true,  true,  null, null),
      ('4400', '4000', 'income', 'Engineering services',                 'الخدمات الهندسية',              'revenue',                   true,  true,  null, null),
      ('4500', '4000', 'income', 'Trading (sale of goods)',              'المبيعات التجارية',             'revenue',                   true,  true,  null, null),
      ('4900', null,   'income', 'Other income',                         'إيرادات أخرى',                  'other_income',              true,  true,  null, null),
      -- Cost of services
      ('5000', null,   'expense', 'Cost of services',                    'تكلفة الخدمات',                 'cost_of_sales',             false, true,  null, null),
      ('5100', '5000', 'expense', 'Subcontractors',                      'مقاولون من الباطن',             'cost_of_sales',             true,  true,  null, null),
      ('5200', '5000', 'expense', 'Materials and spare parts',           'مواد وقطع غيار',                'cost_of_sales',             true,  true,  null, null),
      ('5300', '5000', 'expense', 'Direct labour',                       'عمالة مباشرة',                  'cost_of_sales',             true,  true,  null, null),
      ('5400', '5000', 'expense', 'Equipment hire',                      'استئجار معدات',                 'cost_of_sales',             true,  true,  null, null),
      ('5500', '5000', 'expense', 'Site transport and logistics',        'نقل ولوجستيات المواقع',         'cost_of_sales',             true,  true,  null, null),
      ('5600', '5000', 'expense', 'Cost of goods sold',                  'تكلفة البضاعة المباعة',         'cost_of_sales',             true,  true,  null, null),
      ('5900', '5000', 'expense', 'Other direct costs',                  'تكاليف مباشرة أخرى',            'cost_of_sales',             true,  true,  null, null),
      -- Operating expenses
      ('6000', null,   'expense', 'Operating expenses',                  'المصروفات التشغيلية',           'administrative_expenses',   false, true,  null, null),
      ('6100', '6000', 'expense', 'Salaries and wages',                  'الرواتب والأجور',               'administrative_expenses',   true,  true,  null, null),
      ('6200', '6000', 'expense', 'Transport and fuel',                  'المواصلات والوقود',             'administrative_expenses',   true,  true,  null, null),
      ('6300', '6000', 'expense', 'Rent',                                'الإيجارات',                     'administrative_expenses',   true,  true,  null, null),
      ('6350', '6000', 'expense', 'Utilities and communications',        'الخدمات والاتصالات',            'administrative_expenses',   true,  true,  null, null),
      ('6400', '6000', 'expense', 'Government fees and licences',        'رسوم حكومية وتراخيص',           'administrative_expenses',   true,  true,  null, null),
      ('6500', '6000', 'expense', 'Professional fees',                   'أتعاب مهنية',                   'administrative_expenses',   true,  true,  null, null),
      ('6600', '6000', 'expense', 'Travel and accommodation',            'السفر والإقامة',                'administrative_expenses',   true,  true,  null, null),
      ('6700', '6000', 'expense', 'Marketing',                           'التسويق',                       'distribution_costs',        true,  true,  null, null),
      ('6800', '6000', 'expense', 'Office and supplies',                 'المكتب واللوازم',               'administrative_expenses',   true,  true,  null, null),
      ('6850', '6000', 'expense', 'IT and subscriptions',                'تقنية المعلومات والاشتراكات',   'administrative_expenses',   true,  true,  null, null),
      ('6900', '6000', 'expense', 'Bank and remittance charges',         'رسوم بنكية وحوالات',            'administrative_expenses',   true,  false, null, 'bank_charges'),
      ('6990', '6000', 'expense', 'Other operating expenses',            'مصروفات تشغيلية أخرى',          'administrative_expenses',   true,  true,  null, null),
      -- Other gains / losses, depreciation
      ('7000', null,   'expense', 'Foreign exchange gain / loss',        'أرباح / خسائر فروق العملة',     'other_gains_losses',        true,  false, null, 'fx'),
      ('7100', null,   'expense', 'Depreciation',                        'الإهلاك',                       'depreciation',              true,  false, null, 'depreciation')
    ) as t(code, parent, typ, name_en, name_ar, ifrs, postable, req_project, control, subtype)
    order by (parent is not null), code
  loop
    insert into public.gl_accounts
      (company_id, code, name_en, name_ar, account_type, subtype, parent_id, ifrs_line,
       requires_project, control_kind, is_postable, is_system)
    values
      (p_company, r.code, r.name_en, r.name_ar, r.typ::public.account_type, r.subtype,
       (select id from public.gl_accounts where company_id = p_company and code = r.parent),
       r.ifrs, r.req_project, r.control, r.postable, true)
    on conflict (company_id, code) do nothing;
  end loop;
end $$;

-- Create a company with its defaults. Runs as the migration/service role only.
create or replace function app.bootstrap_company(
  p_company_id uuid, p_name_en text, p_name_ar text, p_owner uuid default null,
  p_first_year int default extract(year from current_date)::int
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  y int;
begin
  insert into public.companies (id, name_en, name_ar, legal_name, settings)
  values (p_company_id, p_name_en, p_name_ar, p_name_en,
          jsonb_build_object(
            'address_lines', jsonb_build_array('Aden-Alburaqah / Sanaa-Alsafiah'),
            'phones', '(967) 773033186 - 783402932',
            'email', 'support@environmsafe.com',
            'website', 'www.environmsafe.com',
            'invoice_bank_line', 'Al Kuraimi Bank acct 3108401426',
            'approval_threshold_usd', 1000))
  on conflict (id) do nothing;

  perform app.seed_chart_of_accounts(p_company_id);

  for y in p_first_year .. extract(year from current_date)::int + 1 loop
    perform app.ensure_periods(p_company_id, y);
  end loop;

  insert into public.fx_rates (company_id, rate_date, currency, rate_per_usd, source)
  values (p_company_id, make_date(p_first_year, 1, 1), 'SAR', 3.79, 'default'),
         (p_company_id, make_date(p_first_year, 1, 1), 'YER', 1556, 'default')
  on conflict do nothing;

  if not exists (select 1 from public.projects where company_id = p_company_id and kind = 'internal') then
    insert into public.projects (company_id, code, name_en, name_ar, kind)
    values (p_company_id, '', 'General',           'عام',             'internal'),
           (p_company_id, '', 'Marketing',         'التسويق',         'internal'),
           (p_company_id, '', 'Internal Transfer', 'تحويلات داخلية',  'internal');
  end if;

  if p_owner is not null then
    insert into public.user_roles (company_id, user_id, role_code)
    values (p_company_id, p_owner, 'owner')
    on conflict do nothing;
  end if;

  return p_company_id;
end $$;
revoke execute on function app.bootstrap_company(uuid, text, text, uuid, int) from authenticated;
revoke execute on function app.seed_chart_of_accounts(uuid) from authenticated;
