-- =========================================================
-- Sistema de Agenda de Instrutores — Schema Supabase
-- Rode este script inteiro em: Supabase > SQL Editor > New query
-- =========================================================

-- Extensão para gerar UUIDs
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- Tabela principal de instrutores (e do administrador)
-- ---------------------------------------------------------
create table if not exists instrutores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  codigo text unique,
  nome text not null,
  cpf text,
  email text not null unique,
  telefone text,
  especialidade text,
  carga_horaria text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  observacoes text,
  documento_url text,
  dias_status jsonb not null default '{}'::jsonb, -- { "2026-08-25": "disponivel" | "bloqueado" | "agendado" | "aguardando" }
  role text not null default 'instrutor' check (role in ('admin', 'instrutor')),
  created_at timestamptz not null default now()
);

-- Código sequencial amigável (INS-001, INS-002...)
create sequence if not exists instrutores_codigo_seq;

create or replace function gerar_codigo_instrutor()
returns trigger as $$
begin
  if new.codigo is null then
    new.codigo := 'INS-' || lpad(nextval('instrutores_codigo_seq')::text, 3, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_gerar_codigo on instrutores;
create trigger trg_gerar_codigo
  before insert on instrutores
  for each row execute function gerar_codigo_instrutor();

-- ---------------------------------------------------------
-- Função auxiliar: o usuário autenticado é administrador?
-- (security definer para poder ser usada dentro das próprias policies)
-- ---------------------------------------------------------
create or replace function is_admin(uid uuid)
returns boolean as $$
  select exists (
    select 1 from instrutores where user_id = uid and role = 'admin'
  );
$$ language sql security definer stable;

-- ---------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------
alter table instrutores enable row level security;

-- Cada instrutor vê/edita apenas a própria linha; admin vê/edita tudo
create policy "instrutor_select_proprio_ou_admin"
  on instrutores for select
  using (auth.uid() = user_id or is_admin(auth.uid()));

create policy "instrutor_update_proprio_ou_admin"
  on instrutores for update
  using (auth.uid() = user_id or is_admin(auth.uid()));

-- Só administrador cria e exclui instrutores
create policy "admin_insert"
  on instrutores for insert
  with check (is_admin(auth.uid()));

create policy "admin_delete"
  on instrutores for delete
  using (is_admin(auth.uid()));

-- ---------------------------------------------------------
-- Função de primeiro acesso do instrutor: vincula a conta de
-- login (auth.users) criada no app à linha já cadastrada pelo
-- administrador, localizando pelo e-mail. Roda com privilégio
-- elevado (security definer) só para essa operação pontual e seguro,
-- pois só vincula à PRÓPRIA conta que acabou de logar (auth.uid()).
-- ---------------------------------------------------------
create or replace function vincular_instrutor(p_email text)
returns instrutores as $$
declare
  linha instrutores;
begin
  update instrutores
    set user_id = auth.uid()
    where lower(email) = lower(p_email)
      and user_id is null
      and status = 'Ativo'
    returning * into linha;

  if linha.id is null then
    raise exception 'E-mail não encontrado ou já vinculado a outra conta.';
  end if;

  return linha;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------
-- Storage: bucket privado para os documentos de identificação
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('documentos', 'documentos', false)
  on conflict (id) do nothing;

-- Caminho do arquivo = "<id_do_instrutor>/documento.jpg"
create policy "documentos_select"
  on storage.objects for select
  using (
    bucket_id = 'documentos'
    and (
      is_admin(auth.uid())
      or exists (
        select 1 from instrutores
        where id::text = (storage.foldername(name))[1]
          and user_id = auth.uid()
      )
    )
  );

create policy "documentos_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'documentos'
    and (
      is_admin(auth.uid())
      or exists (
        select 1 from instrutores
        where id::text = (storage.foldername(name))[1]
          and user_id = auth.uid()
      )
    )
  );

create policy "documentos_update"
  on storage.objects for update
  using (
    bucket_id = 'documentos'
    and (
      is_admin(auth.uid())
      or exists (
        select 1 from instrutores
        where id::text = (storage.foldername(name))[1]
          and user_id = auth.uid()
      )
    )
  );

-- =========================================================
-- PASSO MANUAL (uma única vez): criar o primeiro administrador
-- =========================================================
-- 1) No painel do Supabase: Authentication > Users > Add user
--    Crie o e-mail e a senha do administrador e SALVE.
-- 2) Copie o "User UID" gerado e cole abaixo no lugar de
--    'COLE-O-UID-AQUI'. Ajuste também o e-mail e o nome.
-- 3) Rode só esse INSERT (uma vez):
--
-- insert into instrutores (user_id, nome, email, role, status)
-- values ('COLE-O-UID-AQUI', 'Administrador', 'admin@suaempresa.com', 'admin', 'Ativo');


-- =========================================================
-- ÁREA DE TRABALHO — cadastros, operações e permissões
-- (seção adicionada — não altera nada do que já existe acima)
-- =========================================================

-- ---------------------------------------------------------
-- Cadastros simples
-- ---------------------------------------------------------
create table if not exists empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text,
  contato_nome text,
  contato_email text,
  contato_telefone text,
  endereco text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now()
);

create table if not exists centros_treinamento (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  endereco text,
  capacidade text,
  observacoes text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now()
);

create table if not exists tipos_treinamento (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  carga_horaria text,
  categoria text,
  descricao text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Usuários do sistema (login próprio, igual instrutor) + permissões
-- ---------------------------------------------------------
create table if not exists usuarios_sistema (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  nome text not null,
  email text not null unique,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  role text not null default 'usuario' check (role in ('admin', 'usuario')),
  created_at timestamptz not null default now()
);

create table if not exists permissoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios_sistema(id) on delete cascade,
  modulo text not null,
  pode_consultar boolean not null default false,
  pode_incluir boolean not null default false,
  pode_alterar boolean not null default false,
  pode_excluir boolean not null default false,
  unique (usuario_id, modulo)
);

-- ---------------------------------------------------------
-- Orçamentos, itens, turmas e agendamentos
-- ---------------------------------------------------------
create sequence if not exists orcamentos_numero_seq;

create table if not exists orcamentos (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  empresa_id uuid references empresas(id) on delete restrict,
  data date not null default current_date,
  validade date,
  status text not null default 'Aberto' check (status in ('Aberto', 'Aprovado', 'Recusado', 'Cancelado')),
  observacoes text,
  created_at timestamptz not null default now()
);

create or replace function gerar_numero_orcamento()
returns trigger as $$
begin
  if new.numero is null then
    new.numero := 'ORC-' || lpad(nextval('orcamentos_numero_seq')::text, 3, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_gerar_numero_orcamento on orcamentos;
create trigger trg_gerar_numero_orcamento
  before insert on orcamentos
  for each row execute function gerar_numero_orcamento();

create table if not exists orcamento_itens (
  id uuid primary key default gen_random_uuid(),
  orcamento_id uuid not null references orcamentos(id) on delete cascade,
  tipo_treinamento_id uuid references tipos_treinamento(id) on delete restrict,
  quantidade_turmas integer not null default 1,
  carga_horaria text,
  valor_unitario numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists turmas (
  id uuid primary key default gen_random_uuid(),
  orcamento_id uuid references orcamentos(id) on delete cascade,
  orcamento_item_id uuid references orcamento_itens(id) on delete set null,
  tipo_treinamento_id uuid references tipos_treinamento(id) on delete restrict,
  centro_treinamento_id uuid references centros_treinamento(id) on delete set null,
  instrutor_id uuid references instrutores(id) on delete set null,
  data_inicio date,
  data_fim date,
  horario text,
  vagas integer,
  status text not null default 'Planejada' check (status in ('Planejada', 'Confirmada', 'Concluida', 'Cancelada')),
  observacoes text,
  created_at timestamptz not null default now()
);

create table if not exists agendamentos (
  id uuid primary key default gen_random_uuid(),
  instrutor_id uuid references instrutores(id) on delete cascade,
  tipo_treinamento_id uuid references tipos_treinamento(id) on delete restrict,
  centro_treinamento_id uuid references centros_treinamento(id) on delete set null,
  empresa_id uuid references empresas(id) on delete set null,
  turma_id uuid references turmas(id) on delete set null,
  datas jsonb not null default '[]'::jsonb, -- ["2026-08-25", "2026-08-26"]
  horario text,
  status text not null default 'Aguardando' check (status in ('Aguardando', 'Confirmado', 'Cancelado')),
  observacoes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Funções auxiliares de permissão (mesmo padrão de is_admin/vincular_instrutor)
-- ---------------------------------------------------------
create or replace function is_admin_sistema(uid uuid)
returns boolean as $$
  select exists (
    select 1 from usuarios_sistema where user_id = uid and role = 'admin' and status = 'Ativo'
  );
$$ language sql security definer stable;

create or replace function tem_permissao(uid uuid, p_modulo text, p_acao text)
returns boolean as $$
  select exists (
    select 1
    from usuarios_sistema us
    join permissoes p on p.usuario_id = us.id
    where us.user_id = uid
      and us.status = 'Ativo'
      and p.modulo = p_modulo
      and (
        (p_acao = 'consultar' and p.pode_consultar)
        or (p_acao = 'incluir' and p.pode_incluir)
        or (p_acao = 'alterar' and p.pode_alterar)
        or (p_acao = 'excluir' and p.pode_excluir)
      )
  );
$$ language sql security definer stable;

create or replace function vincular_usuario_sistema(p_email text)
returns usuarios_sistema as $$
declare
  linha usuarios_sistema;
begin
  update usuarios_sistema
    set user_id = auth.uid()
    where lower(email) = lower(p_email)
      and user_id is null
      and status = 'Ativo'
    returning * into linha;

  if linha.id is null then
    raise exception 'E-mail não encontrado ou já vinculado a outra conta.';
  end if;

  return linha;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------
-- Permissões adicionais para o cadastro de Instrutores: usuários do
-- sistema com direito no módulo "instrutores" também podem gerenciá-los
-- (regras aditivas — não alteram as policies já existentes acima)
-- ---------------------------------------------------------
create policy "sistema_select_instrutores"
  on instrutores for select
  using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'instrutores', 'consultar'));

create policy "sistema_insert_instrutores"
  on instrutores for insert
  with check (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'instrutores', 'incluir'));

create policy "sistema_update_instrutores"
  on instrutores for update
  using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'instrutores', 'alterar'));

create policy "sistema_delete_instrutores"
  on instrutores for delete
  using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'instrutores', 'excluir'));

-- ---------------------------------------------------------
-- Row Level Security — cadastros simples
-- ---------------------------------------------------------
alter table empresas enable row level security;
alter table centros_treinamento enable row level security;
alter table tipos_treinamento enable row level security;

create policy "empresas_select" on empresas for select using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'empresas', 'consultar'));
create policy "empresas_insert" on empresas for insert with check (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'empresas', 'incluir'));
create policy "empresas_update" on empresas for update using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'empresas', 'alterar'));
create policy "empresas_delete" on empresas for delete using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'empresas', 'excluir'));

create policy "centros_select" on centros_treinamento for select using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'centros_treinamento', 'consultar'));
create policy "centros_insert" on centros_treinamento for insert with check (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'centros_treinamento', 'incluir'));
create policy "centros_update" on centros_treinamento for update using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'centros_treinamento', 'alterar'));
create policy "centros_delete" on centros_treinamento for delete using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'centros_treinamento', 'excluir'));

create policy "tipos_select" on tipos_treinamento for select using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'tipos_treinamento', 'consultar'));
create policy "tipos_insert" on tipos_treinamento for insert with check (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'tipos_treinamento', 'incluir'));
create policy "tipos_update" on tipos_treinamento for update using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'tipos_treinamento', 'alterar'));
create policy "tipos_delete" on tipos_treinamento for delete using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'tipos_treinamento', 'excluir'));

-- ---------------------------------------------------------
-- Row Level Security — usuários do sistema e permissões
-- ---------------------------------------------------------
alter table usuarios_sistema enable row level security;
alter table permissoes enable row level security;

-- Cada usuário vê a própria linha (para carregar o próprio perfil ao logar); admin vê/gerencia todos
create policy "usuarios_sistema_select" on usuarios_sistema for select using (auth.uid() = user_id or is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'usuarios_sistema', 'consultar'));
create policy "usuarios_sistema_insert" on usuarios_sistema for insert with check (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'usuarios_sistema', 'incluir'));
create policy "usuarios_sistema_update" on usuarios_sistema for update using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'usuarios_sistema', 'alterar'));
create policy "usuarios_sistema_delete" on usuarios_sistema for delete using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'usuarios_sistema', 'excluir'));

-- Cada usuário pode ler as próprias permissões (para montar o menu); admin gerencia todas
create policy "permissoes_select" on permissoes for select using (
  is_admin_sistema(auth.uid())
  or exists (select 1 from usuarios_sistema us where us.id = permissoes.usuario_id and us.user_id = auth.uid())
);
create policy "permissoes_insert" on permissoes for insert with check (is_admin_sistema(auth.uid()));
create policy "permissoes_update" on permissoes for update using (is_admin_sistema(auth.uid()));
create policy "permissoes_delete" on permissoes for delete using (is_admin_sistema(auth.uid()));

-- ---------------------------------------------------------
-- Row Level Security — orçamentos, itens, turmas e agendamentos
-- ---------------------------------------------------------
alter table orcamentos enable row level security;
alter table orcamento_itens enable row level security;
alter table turmas enable row level security;
alter table agendamentos enable row level security;

create policy "orcamentos_select" on orcamentos for select using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'orcamentos', 'consultar'));
create policy "orcamentos_insert" on orcamentos for insert with check (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'orcamentos', 'incluir'));
create policy "orcamentos_update" on orcamentos for update using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'orcamentos', 'alterar'));
create policy "orcamentos_delete" on orcamentos for delete using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'orcamentos', 'excluir'));

create policy "orcamento_itens_select" on orcamento_itens for select using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'orcamentos', 'consultar'));
create policy "orcamento_itens_insert" on orcamento_itens for insert with check (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'orcamentos', 'incluir'));
create policy "orcamento_itens_update" on orcamento_itens for update using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'orcamentos', 'alterar'));
create policy "orcamento_itens_delete" on orcamento_itens for delete using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'orcamentos', 'excluir'));

create policy "turmas_select" on turmas for select using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'turmas', 'consultar'));
create policy "turmas_insert" on turmas for insert with check (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'turmas', 'incluir'));
create policy "turmas_update" on turmas for update using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'turmas', 'alterar'));
create policy "turmas_delete" on turmas for delete using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'turmas', 'excluir'));

create policy "agendamentos_select" on agendamentos for select using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'agendamentos', 'consultar'));
create policy "agendamentos_insert" on agendamentos for insert with check (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'agendamentos', 'incluir'));
create policy "agendamentos_update" on agendamentos for update using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'agendamentos', 'alterar'));
create policy "agendamentos_delete" on agendamentos for delete using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'agendamentos', 'excluir'));

-- =========================================================
-- PASSO MANUAL (uma única vez): tornar o admin existente também
-- administrador da área de trabalho, reaproveitando a MESMA conta
-- (mesmo user_id) já criada para o admin de instrutores.
-- =========================================================
-- 1) Pegue o "User UID" do admin (Authentication > Users, ou
--    "select user_id from instrutores where role = 'admin'").
-- 2) Rode (ajuste e-mail/nome se quiser):
--
-- insert into usuarios_sistema (user_id, nome, email, role, status)
-- values ('COLE-O-UID-AQUI', 'Administrador', 'admin@suaempresa.com', 'admin', 'Ativo');


-- =========================================================
-- Estrutura do Centro de Treinamento (capacidade e recursos)
-- =========================================================
alter table centros_treinamento
  add column if not exists capacidade_diaria integer,
  add column if not exists qtd_salas_aula integer,
  add column if not exists qtd_pistas_treinamento integer,
  add column if not exists qtd_torres_altura integer,
  add column if not exists qtd_espaco_confinado integer,
  add column if not exists qtd_petrolifera integer,
  add column if not exists qtd_uti integer;

-- =========================================================
-- Consumo de dias do Treinamento (teoria / prática / ambos)
-- =========================================================
alter table tipos_treinamento
  add column if not exists dias_teoria integer,
  add column if not exists dias_pratica integer,
  add column if not exists dias_teoria_pratica integer;

-- =========================================================
-- Reestruturação do Orçamento: um treinamento por orçamento
-- (sem lista de itens), número digitado manualmente, e geração
-- automática das turmas (A, B, C...) ao criar o orçamento
-- =========================================================
alter table orcamentos
  add column if not exists centro_treinamento_id uuid references centros_treinamento(id) on delete set null,
  add column if not exists tipo_treinamento_id uuid references tipos_treinamento(id) on delete set null,
  add column if not exists qtd_turmas integer,
  add column if not exists qtd_alunos integer,
  add column if not exists qtd_alunos_por_turma integer;

alter table turmas
  add column if not exists identificacao text,
  add column if not exists dias_totais integer;

-- =========================================================
-- Formato de teoria/prática de cada turma (editável na tela
-- de Orçamento, em tabela, logo após a geração automática)
-- =========================================================
alter table turmas
  add column if not exists formato_teoria text check (formato_teoria in ('CT','InCompany','EAD','EAD Síncrono','Móvel')),
  add column if not exists formato_pratica text check (formato_pratica in ('CT','InCompany','Móvel'));

-- Formato Teoria/Prática agora são selecionados no orçamento e repetidos
-- em cada turma gerada automaticamente
alter table orcamentos
  add column if not exists formato_teoria text check (formato_teoria in ('CT','InCompany','EAD','EAD Síncrono','Móvel')),
  add column if not exists formato_pratica text check (formato_pratica in ('CT','InCompany','Móvel'));

-- Cada linha de turma gerada indica se o dia é de Teoria, Prática ou
-- Teoria com Prática, conforme os dias configurados no treinamento
alter table turmas
  add column if not exists tipo_dia text check (tipo_dia in ('Teoria','Prática','Teoria com Prática'));

-- =========================================================
-- Instrutor 1/2 e Empresa de Transporte por dia de turma
-- =========================================================
create table if not exists empresas_transporte (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now()
);

alter table empresas_transporte enable row level security;

create policy "empresas_transporte_select" on empresas_transporte for select using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'empresas_transporte', 'consultar'));
create policy "empresas_transporte_insert" on empresas_transporte for insert with check (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'empresas_transporte', 'incluir'));
create policy "empresas_transporte_update" on empresas_transporte for update using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'empresas_transporte', 'alterar'));
create policy "empresas_transporte_delete" on empresas_transporte for delete using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'empresas_transporte', 'excluir'));

alter table turmas
  add column if not exists instrutor1_id uuid references instrutores(id) on delete set null,
  add column if not exists instrutor2_id uuid references instrutores(id) on delete set null,
  add column if not exists empresa_transporte_id uuid references empresas_transporte(id) on delete set null;

-- =========================================================
-- Lista de orçamentos, status "Concluído", dois instrutores e
-- status de agenda por turma
-- =========================================================
alter table orcamentos drop constraint if exists orcamentos_status_check;
alter table orcamentos add constraint orcamentos_status_check check (status in ('Aberto','Aprovado','Recusado','Cancelado','Concluído'));

alter table tipos_treinamento
  add column if not exists alunos_por_instrutor integer;

alter table orcamentos
  add column if not exists necessita_dois_instrutores boolean not null default false;

alter table turmas
  add column if not exists agenda_ct text check (agenda_ct in ('A agendar','Agendado','Aguardando confirmação','Não aplicável')),
  add column if not exists agenda_instrutor1 text check (agenda_instrutor1 in ('A agendar','Agendado','Aguardando confirmação','Não aplicável')),
  add column if not exists agenda_instrutor2 text check (agenda_instrutor2 in ('A agendar','Agendado','Aguardando confirmação','Não aplicável')),
  add column if not exists agenda_transporte text check (agenda_transporte in ('A agendar','Agendado','Aguardando confirmação','Não aplicável')),
  add column if not exists agenda_movel text check (agenda_movel in ('A agendar','Agendado','Aguardando confirmação','Não aplicável'));

-- =========================================================
-- CNPJ do grupo econômico (opcional, validado contra empresa
-- já cadastrada — feito no front-end)
-- =========================================================
alter table empresas
  add column if not exists cnpj_grupo_economico text;

-- =========================================================
-- Alunos por Turma (cadastro dos alunos de cada turma)
-- CPF validado por dígito verificador + máscara no front-end.
-- cnpj_atestado / cnpj_faturamento precisam ser CNPJs de
-- empresas já cadastradas e pertencer ao mesmo grupo
-- econômico da empresa do orçamento da turma (comparação
-- feita no front-end usando cnpj_grupo_economico || cnpj).
-- =========================================================
create table if not exists turma_alunos (
  id uuid primary key default gen_random_uuid(),
  turma_id uuid not null references turmas(id) on delete cascade,
  cpf text,
  nome text not null,
  data_nascimento date,
  cnpj_atestado text,
  cnpj_faturamento text,
  created_at timestamptz not null default now()
);

alter table turma_alunos enable row level security;

create policy "turma_alunos_select" on turma_alunos for select using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'turmas', 'consultar'));
create policy "turma_alunos_insert" on turma_alunos for insert with check (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'turmas', 'incluir'));
create policy "turma_alunos_update" on turma_alunos for update using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'turmas', 'alterar'));
create policy "turma_alunos_delete" on turma_alunos for delete using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'turmas', 'excluir'));

-- =========================================================
-- Localidades por Turma
-- Nome + cnpj_atestado + cnpj_faturamento, mesma validação
-- de grupo econômico da tabela turma_alunos (feita no
-- front-end). Ao gerar/cadastrar uma turma, o app cria
-- automaticamente uma localidade "Principal" com os CNPJs
-- iguais ao CNPJ da empresa do orçamento.
-- =========================================================
create table if not exists turma_localidades (
  id uuid primary key default gen_random_uuid(),
  turma_id uuid not null references turmas(id) on delete cascade,
  nome text not null,
  cnpj_atestado text,
  cnpj_faturamento text,
  created_at timestamptz not null default now()
);

alter table turma_localidades enable row level security;

create policy "turma_localidades_select" on turma_localidades for select using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'turmas', 'consultar'));
create policy "turma_localidades_insert" on turma_localidades for insert with check (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'turmas', 'incluir'));
create policy "turma_localidades_update" on turma_localidades for update using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'turmas', 'alterar'));
create policy "turma_localidades_delete" on turma_localidades for delete using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'turmas', 'excluir'));

-- =========================================================
-- Alunos por Turma: vínculo com a localidade de origem
-- Ao cadastrar um aluno, o CNPJ de atestado/faturamento vem
-- da localidade selecionada (uma das cadastradas na turma).
-- Na edição, o usuário pode alterar os CNPJs manualmente
-- (mesma validação de grupo econômico), e nesse caso o
-- vínculo com a localidade é removido.
-- =========================================================
alter table turma_alunos add column if not exists localidade_id uuid references turma_localidades(id) on delete set null;

-- =========================================================
-- App do Aluno (workfire-aluno, sem login, acessado via QR Code)
-- Views públicas com colunas não sensíveis (sem CNPJ) + trigger
-- que preenche cnpj_atestado/cnpj_faturamento a partir da
-- localidade escolhida, para que o app do aluno nunca leia/envie
-- esses CNPJs. Policy adicional permite o aluno (anon) se
-- autocadastrar em turma_alunos.
-- =========================================================
create view v_qrcode_turma as
select t.id as turma_id, t.identificacao, t.data_inicio, t.data_fim, t.orcamento_id,
       o.numero as orcamento_numero, e.nome as empresa_nome
from turmas t
join orcamentos o on o.id = t.orcamento_id
join empresas e on e.id = o.empresa_id;

create view v_qrcode_localidades as
select id, turma_id, nome from turma_localidades;

grant select on v_qrcode_turma to anon;
grant select on v_qrcode_localidades to anon;

create or replace function preencher_cnpj_aluno_turma()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.localidade_id is not null then
    select cnpj_atestado, cnpj_faturamento into new.cnpj_atestado, new.cnpj_faturamento
    from turma_localidades where id = new.localidade_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_preencher_cnpj_aluno_turma on turma_alunos;
create trigger trg_preencher_cnpj_aluno_turma
before insert on turma_alunos
for each row execute function preencher_cnpj_aluno_turma();

create policy "turma_alunos_anon_insert" on turma_alunos
  for insert to anon
  with check (true);

-- =========================================================
-- Acesso por artefato/rotina (migração
-- permissao_por_artefato_tabelas_dependentes)
--
-- Conceder permissão a um módulo libera TODAS as tabelas que
-- aquela rotina usa, no nível concedido, independentemente das
-- permissões das outras rotinas. Papéis do mapa:
--   own     -> CRUD completo segue o nível do módulo
--   edita   -> select/insert/update seguem o módulo (sem delete)
--   leitura -> apenas select (com pode_consultar do módulo)
--
-- Mapa módulo -> tabela -> papel:
--   instrutores/empresas/centros_treinamento/tipos_treinamento/
--     empresas_transporte      -> a própria tabela (own)
--   usuarios_sistema           -> usuarios_sistema, permissoes (own)
--   agendamentos               -> agendamentos (own);
--                                 instrutores (edita — grava dias_status);
--                                 tipos_treinamento, centros_treinamento, empresas (leitura)
--   orcamentos                 -> orcamentos, orcamento_itens (own);
--                                 turmas, turma_localidades (edita);
--                                 empresas, tipos_treinamento, centros_treinamento,
--                                 instrutores, empresas_transporte (leitura)
--   turmas                     -> turmas, turma_alunos, turma_localidades (own);
--                                 orcamentos, orcamento_itens, empresas,
--                                 tipos_treinamento, centros_treinamento,
--                                 instrutores, empresas_transporte (leitura)
--   agendamento_turmas         -> turmas (edita);
--                                 orcamentos, empresas, tipos_treinamento,
--                                 centros_treinamento, instrutores (leitura)
--
-- Todas as políticas RLS da área de trabalho passaram a usar
-- pode_acessar_tabela(auth.uid(), '<tabela>', '<select|insert|update|delete>').
-- Preservados: leitura da própria linha em usuarios_sistema/permissoes
-- (para montar o menu) e o INSERT anônimo em turma_alunos (app do aluno).
-- Ver a definição completa na migração de mesmo nome.
-- =========================================================

create or replace function pode_acessar_tabela(p_uid uuid, p_tabela text, p_acao text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_admin_sistema(p_uid) or exists (
    select 1
    from (values
      ('instrutores','instrutores','own'),
      ('empresas','empresas','own'),
      ('centros_treinamento','centros_treinamento','own'),
      ('tipos_treinamento','tipos_treinamento','own'),
      ('empresas_transporte','empresas_transporte','own'),
      ('usuarios_sistema','usuarios_sistema','own'),
      ('usuarios_sistema','permissoes','own'),
      ('agendamentos','agendamentos','own'),
      ('agendamentos','instrutores','edita'),
      ('agendamentos','tipos_treinamento','leitura'),
      ('agendamentos','centros_treinamento','leitura'),
      ('agendamentos','empresas','leitura'),
      ('orcamentos','orcamentos','own'),
      ('orcamentos','orcamento_itens','own'),
      ('orcamentos','turmas','edita'),
      ('orcamentos','turma_localidades','edita'),
      ('orcamentos','empresas','leitura'),
      ('orcamentos','tipos_treinamento','leitura'),
      ('orcamentos','centros_treinamento','leitura'),
      ('orcamentos','instrutores','leitura'),
      ('orcamentos','empresas_transporte','leitura'),
      ('turmas','turmas','own'),
      ('turmas','turma_alunos','own'),
      ('turmas','turma_localidades','own'),
      ('turmas','orcamentos','leitura'),
      ('turmas','orcamento_itens','leitura'),
      ('turmas','empresas','leitura'),
      ('turmas','tipos_treinamento','leitura'),
      ('turmas','centros_treinamento','leitura'),
      ('turmas','instrutores','leitura'),
      ('turmas','empresas_transporte','leitura'),
      ('agendamento_turmas','turmas','edita'),
      ('agendamento_turmas','orcamentos','leitura'),
      ('agendamento_turmas','empresas','leitura'),
      ('agendamento_turmas','tipos_treinamento','leitura'),
      ('agendamento_turmas','centros_treinamento','leitura'),
      ('agendamento_turmas','instrutores','leitura')
    ) as mapa(modulo, tabela, papel)
    join permissoes p on p.modulo = mapa.modulo
    join usuarios_sistema us on us.id = p.usuario_id
    where us.user_id = p_uid
      and us.status = 'Ativo'
      and mapa.tabela = p_tabela
      and (
           (p_acao = 'select' and p.pode_consultar)
        or (p_acao = 'insert' and p.pode_incluir and mapa.papel in ('own','edita'))
        or (p_acao = 'update' and p.pode_alterar and mapa.papel in ('own','edita'))
        or (p_acao = 'delete' and p.pode_excluir and mapa.papel = 'own')
      )
  );
$$;

-- =========================================================
-- Rotina de Atividades (migração atividades_e_tipos_atividade)
--
-- tipos_atividade: tabela acessória (cadastro), selecionada no
-- cadastro de atividades. Colunas: nome, descricao, status.
--
-- atividades: tipo_atividade_id -> tipos_atividade (on delete restrict),
--   responsavel_id -> usuarios_sistema (on delete set null; usuário
--   responsável por manter a informação atualizada e o percentual),
--   descricao (descritivo), data_inicio_previsto, data_termino_previsto,
--   data_inicio_realizado, data_termino_realizado (date),
--   percentual int 0..100 (evolução, atualizada pelo responsável),
--   status in ('Planejada','Aguardando Materiais','Em Execução',
--              'Concluída','Cancelada') default 'Planejada'.
--
-- Módulos no app (MODULOS) e no mapa de pode_acessar_tabela:
--   tipos_atividade -> own tipos_atividade
--   atividades      -> own atividades; leitura tipos_atividade, usuarios_sistema
-- Políticas RLS de ambas as tabelas usam pode_acessar_tabela().
-- No frontend as duas rotinas usam a engine genérica CRUD_CONFIG
-- (com opcoesFn p/ selects dinâmicos, tipo:"date" e corStatus).
-- =========================================================

create table if not exists tipos_atividade (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  status text not null default 'Ativo',
  created_at timestamptz not null default now()
);

create table if not exists atividades (
  id uuid primary key default gen_random_uuid(),
  tipo_atividade_id uuid references tipos_atividade(id) on delete restrict,
  responsavel_id uuid references usuarios_sistema(id) on delete set null,
  descricao text,
  data_inicio_previsto date,
  data_termino_previsto date,
  data_inicio_realizado date,
  data_termino_realizado date,
  percentual integer not null default 0 check (percentual between 0 and 100),
  status text not null default 'Planejada'
    check (status in ('Planejada','Aguardando Materiais','Em Execução','Concluída','Cancelada')),
  created_at timestamptz not null default now()
);

alter table tipos_atividade enable row level security;
alter table atividades enable row level security;

create policy "tipos_atividade_select" on tipos_atividade for select using (pode_acessar_tabela(auth.uid(),'tipos_atividade','select'));
create policy "tipos_atividade_insert" on tipos_atividade for insert with check (pode_acessar_tabela(auth.uid(),'tipos_atividade','insert'));
create policy "tipos_atividade_update" on tipos_atividade for update using (pode_acessar_tabela(auth.uid(),'tipos_atividade','update'));
create policy "tipos_atividade_delete" on tipos_atividade for delete using (pode_acessar_tabela(auth.uid(),'tipos_atividade','delete'));

create policy "atividades_select" on atividades for select using (pode_acessar_tabela(auth.uid(),'atividades','select'));
create policy "atividades_insert" on atividades for insert with check (pode_acessar_tabela(auth.uid(),'atividades','insert'));
create policy "atividades_update" on atividades for update using (pode_acessar_tabela(auth.uid(),'atividades','update'));
create policy "atividades_delete" on atividades for delete using (pode_acessar_tabela(auth.uid(),'atividades','delete'));

-- pode_acessar_tabela passa a incluir no mapa:
--   ('tipos_atividade','tipos_atividade','own'),
--   ('atividades','atividades','own'),
--   ('atividades','tipos_atividade','leitura'),
--   ('atividades','usuarios_sistema','leitura')

-- migração atividades_centro_treinamento_e_corporativo:
--   atividades.centro_treinamento_id -> centros_treinamento (on delete set null)
--   atividades.corporativo boolean not null default false
--   check (not (corporativo and centro_treinamento_id is not null))  -- exclusivos
--   pode_acessar_tabela: + ('atividades','centros_treinamento','leitura')
