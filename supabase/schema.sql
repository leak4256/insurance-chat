-- סכמת מאגר הידע (שלב 1) — להרצה ב-SQL Editor של Supabase.
-- ניתן להרצה חוזרת (idempotent).

create extension if not exists vector;

create table if not exists knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  -- מזהה יציב לכל מסמך מקור (slug של שם הקובץ) — מאפשר רענון פר-מסמך
  document_id text not null,
  document_title text not null,
  file_name text not null,
  page integer,
  section_title text,
  -- תחום ביטוח: רכב / דירה / בריאות / חיים / נסיעות / עסק / כללי
  domain text,
  version text,
  language text not null default 'he',
  content text not null,
  embedding vector(1024) not null,
  embedding_model text not null,
  ingested_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_embedding_idx
  on knowledge_chunks using hnsw (embedding vector_cosine_ops);

create index if not exists knowledge_chunks_document_idx
  on knowledge_chunks (document_id);

-- הטבלה נגישה רק דרך ה-service role (צד שרת); אין גישה אנונימית.
alter table knowledge_chunks enable row level security;

create or replace function match_chunks(
  query_embedding vector(1024),
  match_count int default 8,
  filter_domain text default null
)
returns table (
  id uuid,
  document_title text,
  file_name text,
  page integer,
  section_title text,
  domain text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    kc.id,
    kc.document_title,
    kc.file_name,
    kc.page,
    kc.section_title,
    kc.domain,
    kc.content,
    1 - (kc.embedding <=> query_embedding) as similarity
  from knowledge_chunks kc
  where filter_domain is null or kc.domain = filter_domain
  order by kc.embedding <=> query_embedding
  limit match_count;
$$;
