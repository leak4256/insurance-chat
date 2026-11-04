-- טבלת דופק למניעת השהיית פרויקט ה-Supabase (free tier מושהה אחרי ~שבוע ללא פעילות).
-- נכתבת פעם ביום ע"י סצנריו Make בשם "Supabase Keep-Alive". שורה אחת, בלי נתונים אישיים.
-- להרצה ב-SQL Editor של Supabase, אחרי schema.sql ו-schema-phase2.sql.

create table if not exists keepalive (
  id        int primary key,
  pinged_at timestamptz not null default now()
);

insert into keepalive (id) values (1) on conflict (id) do nothing;

alter table keepalive enable row level security;

-- הרשאת anon מינימלית: רק הטבלה הזו, רק השורה הזו. ה-service role עוקף RLS בלי קשר.
create policy keepalive_anon on keepalive for all to anon using (id = 1) with check (id = 1);
