-- LOCAL DEMO ONLY: sample users and master data for screenshots / end-to-end checks.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'akram@demo.test',   '{"full_name":"Akram (demo owner)"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'entry@demo.test',   '{"full_name":"Data entry (demo)","locale":"ar"}');
insert into public.user_roles (company_id, user_id, role_code) values
  ('dee3dc12-55bb-4acc-9c44-46721b36651b', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('dee3dc12-55bb-4acc-9c44-46721b36651b', '00000000-0000-0000-0000-0000000000a2', 'data_entry');

insert into public.parties (company_id, code, primary_kind, name_en, name_ar, city, phone, legacy_id) values
  ('dee3dc12-55bb-4acc-9c44-46721b36651b', '', 'customer', 'UNHCR Aden', 'المفوضية السامية للاجئين - عدن', 'Aden', null, 'CUS-0001'),
  ('dee3dc12-55bb-4acc-9c44-46721b36651b', '', 'customer', 'FAO Yemen', 'منظمة الأغذية والزراعة', 'Aden', null, 'CUS-0002'),
  ('dee3dc12-55bb-4acc-9c44-46721b36651b', '', 'customer', 'Yemen Company for Sugar Refining (YCSR)', 'الشركة اليمنية لتكرير السكر', 'Hodeidah', null, 'CUS-UL-0004'),
  ('dee3dc12-55bb-4acc-9c44-46721b36651b', '', 'supplier', 'Al Qutaibi Exchange', 'القطيبي للصرافة', 'Aden', null, 'SUP-0007'),
  ('dee3dc12-55bb-4acc-9c44-46721b36651b', '', 'supplier', 'Gulf Calibration Services', 'الخليج لخدمات المعايرة', 'Dammam', '+966 13 000 0000', 'SUP-UL-0003'),
  ('dee3dc12-55bb-4acc-9c44-46721b36651b', '', 'employee', 'Field Engineer (demo)', 'مهندس ميداني', 'Aden', null, 'EMP-0002');

insert into public.projects (company_id, code, name_en, name_ar, customer_id, budget_amount, budget_currency, start_date, legacy_id)
select 'dee3dc12-55bb-4acc-9c44-46721b36651b', '', 'UNHCR generator maintenance 2026', 'صيانة مولدات المفوضية 2026', id, 48000, 'USD', '2026-01-01', 'PRJ-0042'
from public.parties where legacy_id = 'CUS-0001';
insert into public.projects (company_id, code, name_en, customer_id, budget_amount, budget_currency, start_date, legacy_id)
select 'dee3dc12-55bb-4acc-9c44-46721b36651b', '', 'YCSR PSV inspection and calibration', id, 12500, 'USD', '2026-10-15', 'PRJ-UL-0019'
from public.parties where legacy_id = 'CUS-UL-0004';

insert into public.items (company_id, code, name_en, name_ar, kind, unit, last_cost, last_cost_currency) values
  ('dee3dc12-55bb-4acc-9c44-46721b36651b', '', 'PSV calibration and certification', 'معايرة واعتماد صمامات الأمان', 'service', 'valve', 85, 'USD'),
  ('dee3dc12-55bb-4acc-9c44-46721b36651b', '', 'Generator service (250 kVA)', 'صيانة مولد', 'service', 'visit', null, null),
  ('dee3dc12-55bb-4acc-9c44-46721b36651b', '', 'Oil filter', 'فلتر زيت', 'goods', 'pc', 3200, 'YER');

insert into public.money_accounts (company_id, code, name_en, name_ar, kind, currency, bank_name, opening_balance, opening_date, legacy_id) values
  ('dee3dc12-55bb-4acc-9c44-46721b36651b', '', 'Kuraimi USD', 'الكريمي دولار', 'bank', 'USD', 'Al Kuraimi', 0, '2025-01-26', 'ACC-0003'),
  ('dee3dc12-55bb-4acc-9c44-46721b36651b', '', 'Kuraimi YER', 'الكريمي ريال يمني', 'bank', 'YER', 'Al Kuraimi', 0, '2025-01-26', 'ACC-0008'),
  ('dee3dc12-55bb-4acc-9c44-46721b36651b', '', 'Qutaibi SAR', 'القطيبي سعودي', 'exchange', 'SAR', 'Al Qutaibi', 0, '2025-01-26', 'ACC-0011'),
  ('dee3dc12-55bb-4acc-9c44-46721b36651b', '', 'Petty cash Aden (YER)', 'العهدة النقدية عدن', 'cash', 'YER', null, 0, '2025-01-26', 'ACC-0015');
