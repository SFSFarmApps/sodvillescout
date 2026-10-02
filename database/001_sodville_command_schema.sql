-- Sodville Command Master Database v1
-- PostgreSQL + PostGIS. Designed to coexist with Field Scout Build 1002-31.

create extension if not exists pgcrypto;
create extension if not exists postgis;

create type party_kind as enum ('umbrella','client','landowner','vendor','other');
create type person_role as enum ('employee','owner','landowner_contact','client_contact','vendor_contact','other');
create type document_status as enum ('inbox','review','approved','archived');
create type task_status as enum ('open','in_progress','completed','cancelled');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  command_code text unique not null,
  name text not null,
  legal_name text,
  kind party_kind not null,
  parent_organization_id uuid references organizations(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table people (
  id uuid primary key default gen_random_uuid(),
  command_code text unique not null,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table organization_people (
  organization_id uuid not null references organizations(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  role person_role not null,
  primary key (organization_id, person_id, role)
);

create table farms (
  id uuid primary key default gen_random_uuid(),
  command_code text unique not null,
  client_organization_id uuid not null references organizations(id),
  name text not null,
  fsa_farm_number text,
  county text,
  state text default 'TX',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_organization_id, name)
);

create table fields (
  id uuid primary key default gen_random_uuid(),
  command_code text unique not null,
  farm_id uuid not null references farms(id) on delete cascade,
  name text not null,
  acres numeric(12,3),
  boundary geometry(MultiPolygon,4326),
  centroid geometry(Point,4326),
  source_system text,
  source_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, name)
);
create index fields_boundary_gix on fields using gist(boundary);
create index fields_centroid_gix on fields using gist(centroid);

create table field_external_ids (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references fields(id) on delete cascade,
  system_name text not null,
  external_id text not null,
  external_name text,
  metadata jsonb not null default '{}'::jsonb,
  unique(system_name, external_id)
);

create table landowner_field_interests (
  id uuid primary key default gen_random_uuid(),
  landowner_organization_id uuid not null references organizations(id),
  field_id uuid not null references fields(id) on delete cascade,
  ownership_share numeric(8,6),
  effective_from date,
  effective_to date,
  notes text
);

create table crop_years (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references fields(id) on delete cascade,
  crop_year int not null check(crop_year between 2000 and 2200),
  crop text,
  variety text,
  planted_acres numeric(12,3),
  plant_date date,
  harvest_date date,
  status text,
  unique(field_id,crop_year)
);

create table weather_observations (
  id bigserial primary key,
  field_id uuid not null references fields(id) on delete cascade,
  observed_at timestamptz not null,
  rainfall_inches numeric(8,3),
  source text not null,
  raw_data jsonb,
  unique(field_id, observed_at, source)
);
create index weather_field_time_idx on weather_observations(field_id, observed_at desc);

create table workability_snapshots (
  id bigserial primary key,
  field_id uuid not null references fields(id) on delete cascade,
  calculated_at timestamptz not null,
  score numeric(6,2),
  category text,
  model_version text,
  inputs jsonb
);
create index workability_field_time_idx on workability_snapshots(field_id, calculated_at desc);

create table scouting_observations (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references fields(id) on delete cascade,
  crop_year_id uuid references crop_years(id),
  observed_by uuid references people(id),
  observed_at timestamptz not null default now(),
  location geometry(Point,4326),
  category text,
  severity text,
  notes text,
  source_system text default 'command_scout',
  metadata jsonb not null default '{}'::jsonb
);
create index scouting_location_gix on scouting_observations using gist(location);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  field_id uuid references fields(id),
  assigned_to uuid references people(id),
  created_by uuid references people(id),
  title text not null,
  description text,
  status task_status not null default 'open',
  priority text,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table equipment (
  id uuid primary key default gen_random_uuid(),
  command_code text unique not null,
  owner_organization_id uuid references organizations(id),
  name text not null,
  manufacturer text,
  model text,
  model_year int,
  serial_number text unique,
  machine_type text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb
);

create table field_operations (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references fields(id),
  crop_year_id uuid references crop_years(id),
  equipment_id uuid references equipment(id),
  operator_id uuid references people(id),
  operation_type text not null,
  started_at timestamptz,
  ended_at timestamptz,
  acres numeric(12,3),
  machine_hours numeric(12,2),
  source_system text,
  external_id text,
  geometry geometry(Geometry,4326),
  metadata jsonb not null default '{}'::jsonb
);
create index field_operations_geom_gix on field_operations using gist(geometry);

create table employee_time_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references people(id),
  field_id uuid references fields(id),
  operation_id uuid references field_operations(id),
  clock_in timestamptz not null,
  clock_out timestamptz,
  clock_in_location geometry(Point,4326),
  clock_out_location geometry(Point,4326),
  job_code text,
  notes text,
  approved_by uuid references people(id),
  approved_at timestamptz
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  command_code text unique not null,
  document_type text not null,
  status document_status not null default 'inbox',
  crop_year int,
  organization_id uuid references organizations(id),
  farm_id uuid references farms(id),
  field_id uuid references fields(id),
  title text,
  original_filename text,
  storage_provider text,
  storage_file_id text,
  storage_path text,
  sha256 text,
  extracted_data jsonb not null default '{}'::jsonb,
  uploaded_by uuid references people(id),
  uploaded_at timestamptz not null default now(),
  approved_by uuid references people(id),
  approved_at timestamptz
);
create index documents_lookup_idx on documents(document_type,crop_year,organization_id,farm_id,field_id);

create table fsa_field_records (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id),
  field_id uuid references fields(id),
  program_year int not null,
  fsa_farm_number text,
  fsa_tract_number text,
  fsa_field_number text,
  crop text,
  intended_use text,
  certified_acres numeric(12,3),
  plant_date date,
  share numeric(8,6),
  metadata jsonb not null default '{}'::jsonb
);

create table financial_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  farm_id uuid references farms(id),
  field_id uuid references fields(id),
  crop_year_id uuid references crop_years(id),
  transaction_date date not null,
  category text not null,
  vendor text,
  description text,
  quantity numeric(16,4),
  unit text,
  amount numeric(16,2) not null,
  source_system text,
  external_id text,
  document_id uuid references documents(id),
  metadata jsonb not null default '{}'::jsonb
);
create index financial_field_year_idx on financial_transactions(field_id,transaction_date);

create table integration_links (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  entity_type text not null,
  command_entity_id uuid not null,
  external_id text not null,
  external_name text,
  metadata jsonb not null default '{}'::jsonb,
  unique(provider,entity_type,external_id)
);

create table audit_log (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid references people(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_data jsonb,
  after_data jsonb
);

-- Seed the umbrella organization only. Client/farm/field data will be migrated from Field Scout.
insert into organizations(command_code,name,legal_name,kind)
values ('ORG-0001','Sodville Farm Services, Inc.','Sodville Farm Services, Inc.','umbrella')
on conflict (command_code) do nothing;
