-- EnvironmSafe Records: demonstration data. Clearly labelled as not real.
-- Admin can load it and remove it from Settings with one click.

create or replace function public.remove_demo_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  c int;
  t text;
begin
  if not (public.is_admin() or public.is_system()) then
    raise exception 'Only an Admin can remove demo data' using errcode = '42501';
  end if;
  foreach t in array array['finding_updates', 'documents', 'certificates', 'readings', 'reports', 'findings',
                           'dprs', 'job_items', 'inspections', 'jobs'] loop
    execute format('delete from public.%I where is_demo or client_id in (select id from public.clients where is_demo)', t);
    get diagnostics c = row_count;
    n := n + c;
  end loop;
  delete from public.asset_tag_history where client_id in (select id from public.clients where is_demo);
  -- Children first, then parents.
  delete from public.assets where is_demo and parent_id is not null;
  delete from public.assets where is_demo;
  get diagnostics c = row_count; n := n + c;
  delete from public.sites where is_demo;
  update public.profiles set client_id = null where client_id in (select id from public.clients where is_demo);
  delete from public.clients where is_demo;
  get diagnostics c = row_count; n := n + c;
  return jsonb_build_object('removed', n);
end $$;

create or replace function public.load_demo_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cl uuid := '00000000-0000-4000-8000-00000000d001';
  st uuid := '00000000-0000-4000-8000-00000000d002';
  boiler uuid := '00000000-0000-4000-8000-00000000d010';
  psv1 uuid := '00000000-0000-4000-8000-00000000d011';
  psv2 uuid := '00000000-0000-4000-8000-00000000d012';
  psv3 uuid := '00000000-0000-4000-8000-00000000d013';
  v1 uuid := '00000000-0000-4000-8000-00000000d020';
  v2 uuid := '00000000-0000-4000-8000-00000000d021';
  pipe uuid := '00000000-0000-4000-8000-00000000d030';
  insp uuid := '00000000-0000-4000-8000-00000000d040';
  insp_b uuid := '00000000-0000-4000-8000-00000000d041';
  job uuid := '00000000-0000-4000-8000-00000000d050';
  f1 uuid := '00000000-0000-4000-8000-00000000d060';
  f2 uuid := '00000000-0000-4000-8000-00000000d061';
  f3 uuid := '00000000-0000-4000-8000-00000000d062';
  et_boiler uuid;
  et_psv uuid;
  et_pv uuid;
  et_pipe uuid;
  d0 date := current_date - 365;
begin
  if not (public.is_admin() or public.is_system()) then
    raise exception 'Only an Admin can load demo data' using errcode = '42501';
  end if;
  if exists (select 1 from public.clients where id = cl) then
    return jsonb_build_object('loaded', false, 'reason', 'Demo data is already loaded');
  end if;

  select id into et_boiler from public.equipment_types where code = 'BOILER-WT';
  select id into et_psv from public.equipment_types where code = 'PSV';
  select id into et_pv from public.equipment_types where code = 'PV';
  select id into et_pipe from public.equipment_types where code = 'PIPING';

  insert into public.clients (id, name, code, address, notes, contacts, is_demo) values
    (cl, 'DEMO – Sample Process Plant (not a real client)', 'DEMO', 'Demo industrial area',
     'Demonstration data for training. Remove from Settings → Demo data.',
     '[{"name":"Demo Plant Manager","role":"Plant manager","phone":"+000 000 000","email":"demo@example.com"}]', true);

  insert into public.sites (id, client_id, name, area, location, is_demo) values
    (st, cl, 'Demo Utilities Area', 'Boiler house and process unit', 'Demo site', true);

  insert into public.assets (id, client_id, site_id, tag, equipment_type_id, description, manufacturer, model, serial_no,
                             year_built, design, service, location, criticality, custom, is_demo) values
    (boiler, cl, st, 'B-101', et_boiler, 'Water-tube steam boiler No. 1', 'Demo Boiler Works', 'WT-40', 'DBW-2009-117', 2009,
     '{"design_pressure_pa":4500000,"design_temp_c":260,"mawp_pa":4200000,"capacity":"40 t/h","material":"SA-516 Gr 70 / SA-192","code":"ASME I"}',
     'Saturated steam', 'Boiler house', 'high', '{"steam_capacity":40,"fuel":"Diesel / HFO","drum_count":2}', true),
    (psv1, cl, st, 'PSV-101A', et_psv, 'Steam drum safety valve A', 'Demo Valves', 'SV-3', 'DV-1101', 2009,
     '{"set_pressure_pa":4300000}', 'Steam', 'Steam drum', 'high', '{"set_pressure":4300000,"inlet_size":"3 in","outlet_size":"4 in","valve_type":"Conventional spring","protected_item":"B-101 steam drum"}', true),
    (psv2, cl, st, '21-PSV-003-2', et_psv, 'Steam drum safety valve B', 'Demo Valves', 'SV-3', 'DV-1102', 2009,
     '{"set_pressure_pa":4400000}', 'Steam', 'Steam drum', 'high', '{"set_pressure":4400000,"inlet_size":"3 in","outlet_size":"4 in","valve_type":"Conventional spring","protected_item":"B-101 steam drum"}', true),
    (psv3, cl, st, 'PSV 18 111-1', et_psv, 'Superheater outlet safety valve', 'Demo Valves', 'SV-2', 'DV-1103', 2009,
     '{"set_pressure_pa":4100000}', 'Steam', 'Superheater outlet', 'high', '{"set_pressure":4100000,"inlet_size":"2 in","outlet_size":"3 in","valve_type":"Conventional spring","protected_item":"B-101 superheater"}', true),
    (v1, cl, st, 'V-201', et_pv, 'Air receiver / pressure vessel', 'Demo Fabricators', 'AR-10', 'DF-5521', 2012,
     '{"design_pressure_pa":1200000,"design_temp_c":80,"mawp_pa":1200000,"capacity":"10 m³","material":"SA-516 Gr 70","code":"ASME VIII-1"}',
     'Compressed air', 'Compressor house', 'medium', '{"orientation":"Vertical","corrosion_allowance":3,"insulated":"No"}', true),
    (v2, cl, st, 'V-202', et_pv, 'Condensate flash vessel', 'Demo Fabricators', 'FV-2', 'DF-5530', 2012,
     '{"design_pressure_pa":800000,"design_temp_c":180,"mawp_pa":800000,"capacity":"2 m³","material":"SA-516 Gr 60","code":"ASME VIII-1"}',
     'Condensate', 'Boiler house', 'medium', '{"orientation":"Horizontal","corrosion_allowance":3,"insulated":"Yes"}', true),
    (pipe, cl, st, 'P-301 (Steam header circuit)', et_pipe, 'Main steam header from B-101 to plant', '', '', '', 2009,
     '{"design_pressure_pa":4500000,"design_temp_c":260,"material":"A106 Gr B","code":"ASME B31.1"}',
     'Steam', 'Pipe rack', 'high', '{"piping_class":"Class 2","line_size":"8 in","fluid":"Steam","insulated":"Yes"}', true);

  update public.assets set parent_id = boiler where id in (psv1, psv2, psv3);

  -- One past inspection of V-201 with readings and findings.
  insert into public.inspections (id, client_id, asset_id, type_code, standard, inspection_date, inspector_name, status,
                                  is_historical, summary, conclusion, conclusion_text, interval_months, next_due, report_no,
                                  results, is_demo) values
    (insp, cl, v1, 'EXT', 'API 510', d0, 'Demo Inspector', 'issued', true,
     'External inspection and UT survey of the air receiver. General external corrosion at the bottom head and support legs. Drain valve passing.',
     'fit_conditions', 'Fit for continued service subject to completion of the P1 recommendations.', 12, d0 + 365,
     'ES/DEMO-EXT-' || to_char(d0, 'YYYY') || '-001', '{}', true),
    (insp_b, cl, boiler, 'EXT', 'ASME I', d0 + 10, 'Demo Inspector', 'issued', true,
     'Annual external examination of the boiler. No significant defects.', 'fit', '', 12, d0 + 375,
     'ES/DEMO-EXT-' || to_char(d0, 'YYYY') || '-002', '{}', true);

  insert into public.readings (asset_id, inspection_id, client_id, point, location, nominal, measured, previous, retirement,
                               reading_date, sort, is_demo) values
    (v1, insp, cl, 'CML-01', 'Top head', 12.0, 11.6, 11.8, 8.2, d0, 1, true),
    (v1, insp, cl, 'CML-02', 'Shell course 1', 12.0, 11.4, 11.7, 8.2, d0, 2, true),
    (v1, insp, cl, 'CML-03', 'Shell course 2', 12.0, 11.5, 11.7, 8.2, d0, 3, true),
    (v1, insp, cl, 'CML-04', 'Bottom head', 12.0, 10.6, 11.2, 8.2, d0, 4, true),
    (v1, insp, cl, 'CML-05', 'Drain nozzle', 7.1, 6.0, 6.5, 4.0, d0, 5, true),
    (v1, null, cl, 'CML-01', 'Top head', 12.0, 11.8, null, 8.2, d0 - 1460, 1, true),
    (v1, null, cl, 'CML-02', 'Shell course 1', 12.0, 11.7, null, 8.2, d0 - 1460, 2, true),
    (v1, null, cl, 'CML-03', 'Shell course 2', 12.0, 11.7, null, 8.2, d0 - 1460, 3, true),
    (v1, null, cl, 'CML-04', 'Bottom head', 12.0, 11.2, null, 8.2, d0 - 1460, 4, true),
    (v1, null, cl, 'CML-05', 'Drain nozzle', 7.1, 6.5, null, 4.0, d0 - 1460, 5, true);

  insert into public.findings (id, client_id, asset_id, inspection_id, title, description, location, severity, priority,
                               category, damage_mechanism, code_ref, recommendation, status, due_date, raised_date, is_demo) values
    (f1, cl, v1, insp, 'External corrosion at bottom head', 'General external corrosion with light pitting over approx. 30% of the bottom head. Coating breakdown noted.',
     'Bottom head, 6 o''clock', 'medium', 'P1', 'corrosion', 'atmospheric', 'API 510 §6', 'Clean, re-measure and restore the coating system.', 'open', d0 + 180, d0, true),
    (f2, cl, v1, insp, 'Drain valve passing', 'The bottom drain valve was passing when closed.', 'Drain nozzle N5', 'low', 'P2', 'leak', 'unknown', '', 'Replace the drain valve at the next shutdown.', 'open', d0 + 300, d0, true),
    (f3, cl, v1, insp, 'Nameplate partly illegible', 'Nameplate stamping is partly illegible because of paint build-up.', 'Shell', 'low', 'P3', 'documentation', '', 'ASME VIII-1 UG-119', 'Clean the nameplate and record the data in the register.', 'open', null, d0, true);

  insert into public.jobs (id, client_id, site_id, number, title, scope, start_date, end_date, team, status, is_demo) values
    (job, cl, st, 'DEMO-PC0001', 'Demo boiler shutdown inspection', 'Internal and external inspection of B-101, PSV overhaul and UT survey of V-201 / V-202 and P-301.',
     current_date - 3, current_date + 4, 'Demo Inspector, Demo NDT Technician', 'in_progress', true);

  insert into public.job_items (job_id, client_id, kind, ref_no, title, description, raised_date, status, raised_by_name, is_demo) values
    (job, cl, 'hold', 'H-01', 'Boiler internal access', 'Hold point for gas-free certificate before drum entry.', current_date - 2, 'open', 'Demo Inspector', true),
    (job, cl, 'observation', 'O-01', 'Scaffold tag missing at drum level', 'Scaffold at steam drum level had no inspection tag.', current_date - 2, 'closed', 'Demo Inspector', true);

  insert into public.dprs (job_id, client_id, report_date, manpower, hours_worked, toolbox_talks, hse, activities,
                           progress_planned, progress_actual, observations, planned_next, issues, status, is_demo) values
    (job, cl, current_date - 3, '[{"role":"Inspector","count":1},{"role":"NDT technician","count":1}]', 18, 'Confined space entry',
     '{"lti":0,"first_aid":0,"near_miss":0}', '[{"discipline":"Mechanical","description":"Mobilisation, permit and isolation review"}]',
     10, 10, '', 'External inspection of B-101 and PSV removal', '', 'submitted', true),
    (job, cl, current_date - 2, '[{"role":"Inspector","count":1},{"role":"NDT technician","count":1}]', 20, 'Working at height',
     '{"lti":0,"first_aid":0,"near_miss":1}', '[{"discipline":"Mechanical","description":"External inspection of B-101 completed"},{"discipline":"PSV","description":"Three PSVs removed and sent to workshop"}]',
     30, 25, 'Scaffold tag missing at drum level (O-01).', 'PSV bench testing; UT survey of V-201', 'Gas-free certificate awaited for drum entry (H-01).', 'submitted', true),
    (job, cl, current_date - 1, '[{"role":"Inspector","count":1},{"role":"NDT technician","count":1}]', 20, 'Pressure testing safety',
     '{"lti":0,"first_aid":0,"near_miss":0}', '[{"discipline":"PSV","description":"As-found tests of PSV-101A, 21-PSV-003-2, PSV 18 111-1"},{"discipline":"NDT","description":"UT survey of V-201 completed"}]',
     50, 45, '', 'PSV overhaul and as-left tests; UT of P-301', '', 'draft', true);

  return jsonb_build_object('loaded', true);
end $$;

revoke execute on function public.load_demo_data() from public, anon;
revoke execute on function public.remove_demo_data() from public, anon;
grant execute on function public.load_demo_data() to authenticated;
grant execute on function public.remove_demo_data() to authenticated;
