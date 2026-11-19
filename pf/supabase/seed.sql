-- Staging / local seed: the EnvironmSafe company with its defaults.
-- Same company id as the old app, so migrated rows keep their company reference.
select app.bootstrap_company(
  'dee3dc12-55bb-4acc-9c44-46721b36651b',
  'EnvironmSafe For Engineering, Trading, and Services Ltd',
  'شركة انفيرومسيف للهندسة والتجارة والخدمات المحدودة',
  null,
  2025);
