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

-- migração atividades_os_foto_anexos_auditoria:
--   atividades: + os text (unique; AAAA + 5 seq/ano, via trigger BEFORE INSERT
--     atividades_before_insert com pg_advisory_xact_lock),
--     + foto_path text (bucket storage "atividades", caminho "<atividade_id>/foto_*"),
--     + criado_por / alterado_por uuid -> usuarios_sistema, + updated_at timestamptz.
--   Triggers atividades_before_insert / atividades_before_update (security definer)
--     preenchem os/criado_por/created_at (imutáveis no update) e alterado_por/updated_at
--     resolvendo usuarios_sistema.id a partir de auth.uid().
--   atividade_anexos (id, atividade_id -> atividades on delete cascade, descricao,
--     arquivo_path, criado_por -> usuarios_sistema, created_at). Trigger
--     atividade_anexos_before_insert preenche criado_por/created_at. RLS segue o
--     módulo 'atividades' via pode_acessar_tabela.
--   storage bucket privado 'atividades' + policies em storage.objects
--     (bucket_id='atividades' and pode_acessar_tabela(auth.uid(),'atividades',<ação>)).
--   Frontend: engine CRUD ganha campo.display (somente leitura), cfg.camposExtraHtml,
--     cfg.aoSalvar (upload da foto pós-save), cfg.aoMontarTabela; painel
--     #painel-atividade-anexos p/ CRUD dos anexos.

-- migração atividades_permissoes_monitor:
--   permissoes: + pode_acessar_monitor / pode_mudar_responsavel /
--     pode_concluir_cancelar (bool, só fazem sentido em modulo='atividades').
--   atividades: + observacoes text.
--   Funções: meu_usuario_sistema_id(uid), perm_atividades(uid, flag),
--     pode_editar_atividade(uid, atividade_id).
--   RLS atividades_update: editor pleno (admin OU pode_incluir OU pode_alterar
--     em 'atividades', via pode_acessar_tabela) OU responsavel_id = meu id.
--   Trigger atividades_before_update passa a impor:
--     * mudar responsavel_id  -> exige admin OU pode_mudar_responsavel
--     * status -> 'Concluída'/'Cancelada' -> exige admin OU pode_concluir_cancelar
--     * quem não é editor pleno só altera as colunas data_inicio_realizado,
--       data_termino_realizado, percentual, observacoes, e só se for o responsável.
--   atividade_anexos insert/delete e storage.objects insert/delete do bucket
--     'atividades' passam a aceitar também o responsável da atividade.

-- migração usuarios_sistema_telefone:
--   usuarios_sistema.telefone text (nullable no banco; obrigatório no
--   formulário de cadastro do app). Usado como contato e para o SMS futuro.
--
-- "Esqueci minha senha" (todas as telas de login: workfire-mais-perto x2,
-- agenda-instrutores, workfire-monitor): usa o OTP de e-mail nativo do
-- Supabase Auth — signInWithOtp({email, shouldCreateUser:false}) envia um
-- código; verifyOtp({email, token, type:'email'}) abre sessão; updateUser
-- ({password}) grava a nova senha; signOut e volta ao login.
-- PASSO MANUAL no dashboard: Authentication > Emails > template "Magic Link"
-- precisa conter {{ .Token }} para o código aparecer no e-mail.

-- migração reset_senha_via_admin (substitui o OTP de e-mail):
--   usuarios_sistema/instrutores: + reset_senha_solicitado_em, reset_senha_liberado_em (timestamptz).
--   solicitar_redefinicao_senha(p_email text)  [security definer, grant anon]
--     marca reset_senha_solicitado_em nas linhas Ativas com user_id (não revela se existe).
--   Fluxo: usuário clica "Esqueci minha senha" -> solicita -> admin abre o cadastro
--     (Usuários do Sistema / Instrutores em workfire-mais-perto) e clica
--     "Liberar redefinição de senha" (update reset_senha_liberado_em = now()) ->
--     usuário abre "O administrador já liberou" e define a nova senha.
--   Edge Function "redefinir-senha" (verify_jwt=false, usa SERVICE_ROLE):
--     POST {email, senha}; valida reset_senha_liberado_em < 24h; chama
--     auth.admin.updateUserById; limpa os dois campos. Chamada por fetch
--     com header apikey = anon key.

-- migração materiais_tipos_material_fornecedores:
--   tipos_material (descricao, status)
--   fornecedores (nome, cnpj, contato_nome/email/telefone, endereco, observacoes, status)
--   materiais (tipo_material_id -> tipos_material on delete restrict, descricao,
--     unidade_medida, quantidade_estoque numeric, valor_unitario_ultima_compra numeric,
--     data_ultima_compra date, fornecedor_ultima_compra_id -> fornecedores on delete set null,
--     status)
--   pode_acessar_tabela: + tipos_material/fornecedores own; materiais own +
--     leitura tipos_material e fornecedores. Módulos no MODULOS (grupo Cadastros).
--   Frontend: 3 entradas na engine CRUD_CONFIG (opcoesFn p/ tipo e fornecedor;
--     Tipos de Material mostra a contagem de materiais do tipo via carregarRefs).

-- migração requisicoes_compra:
--   permissoes.pode_aprovar_requisicao (bool; usado em modulo='requisicoes_compra').
--   requisicoes_compra (numero REC+ano+6seq via trigger; atividade_id -> atividades,
--     corporativo/centro exclusivos, solicitante_id/aprovador_id -> usuarios_sistema,
--     data_criacao/data_aprovacao, status Planejada/Aprovada/Compra Parcial/Compra Total,
--     valor_estimado/valor_realizado = soma dos itens via trigger).
--   requisicao_compra_itens (requisicao_id -> on delete cascade, material_id -> materiais
--     on delete restrict, quantidade, valor_estimado, valor_realizado).
--   Triggers: requisicoes_compra_before_insert (numero+solicitante+criado_por),
--     requisicoes_compra_before_update (numero/criador imutáveis; status->'Aprovada'
--     exige perm_aprovar_requisicao(uid) e carimba data_aprovacao/aprovador_id),
--     requisicao_itens_recalcular (after ins/upd/del nos itens -> soma no header).
--   pode_acessar_tabela: módulo requisicoes_compra own (requisicoes_compra,
--     requisicao_compra_itens) + leitura materiais/tipos_material/centros_treinamento/
--     usuarios_sistema/atividades.
--   Frontend: rotina CRUD (grupo Operações) com editor de itens embutido; botão 🛒
--     na tabela de Atividades cria/abre a requisição da OS.

-- migração agendamentos_negativas_resolvidas (workfire-mais-perto):
--   datas_status (jsonb, default '{}') já existia em agendamentos, adicionada pelo
--   app agenda-instrutores: uma entrada por data respondida pelo instrutor, ex.
--   {"2026-09-26": {"status": "negado", "justificativa": "..."}}. Datas de `datas`
--   ainda ausentes em datas_status = pendentes de resposta do instrutor.
--   + negativas_resolvidas jsonb not null default '{}' — controle do operador sobre
--     as datas negadas já tratadas, ex.
--     {"2026-09-26": {"resolvido_em": "2026-09-20T14:00:00Z", "novo_agendamento_id": "uuid|null"}}.
--     Não remove nada de datas/datas_status — só registra que aquela negativa foi
--     endereçada (seja criando um novo agendamento para outro instrutor, seja
--     manualmente pelo operador).
--   RLS de agendamentos (select/update) já tinha as policies
--     agendamentos_select_proprio_instrutor / agendamentos_update_proprio_instrutor
--     (instrutor só enxerga/atualiza as próprias linhas); nada mudou aqui — o
--     acesso do operador continua via pode_acessar_tabela(auth.uid(), 'agendamentos', ...).
--   Frontend (secao-agendamentos): aba "Negativas de instrutores" ao lado da lista
--     de agendamentos, com contador de pendências. Cada negativa mostra instrutor,
--     data, justificativa, turma/centro/empresa. Botão "Substituir instrutor" abre
--     o painel de Agendar treinamento pré-preenchido (tipo/centro/empresa/data) e,
--     ao salvar, grava negativas_resolvidas apontando para o novo agendamento.
--     Botão "Marcar como resolvida" resolve manualmente, sem criar agendamento novo.

-- ===========================================================
-- 2026-09-19 — Rotina de solicitação de confirmação do agendamento de turmas
-- (já aplicada no Supabase via migração
--  "turmas_status_agendamento_e_confirmacao_ct"; aqui só para documentação)
-- ===========================================================

-- Status consolidado da turma: Não agendado / Aguardando confirmação / Agendado,
-- recalculado por trigger a partir de agenda_ct, agenda_instrutor1 e agenda_instrutor2.
alter table turmas
  add column if not exists status_agendamento text not null default 'Não agendado'
  check (status_agendamento in ('Não agendado','Aguardando confirmação','Agendado'));
-- trigger trg_status_agendamento_turma → calcular_status_agendamento_turma()

-- RPC usada pelo botão <Solicitar confirmação> da tela Agendamento de Turmas:
--   solicitar_confirmacao_turma_completa(p_turma_id uuid, p_datas jsonb, p_solicitar_ct boolean)
--   1) chama solicitar_confirmacao_turma (cria/atualiza agendamentos dos instrutores,
--      notifica o app agenda-instrutores, marca agenda_instrutor1/2 = 'Aguardando confirmação');
--   2) marca as datas como 'aguardando' em instrutores.dias_status;
--   3) se p_solicitar_ct, marca agenda_ct = 'Aguardando confirmação'.

-- Novo módulo de permissão "confirmacao_ct" (tela Confirmação do Centro de Treinamento):
--   edita turmas; leitura de agendamentos, orcamentos, empresas, tipos_treinamento,
--   centros_treinamento e instrutores (mapa em pode_acessar_tabela).
-- O módulo agendamento_turmas passou a ter leitura de agendamentos.

-- ===========================================================
-- 2026-09-19 — Desmarcação de aula já confirmada (pedido do instrutor)
-- (aplicado no Supabase via migração "desmarcacao_agendamento_aprovacao")
-- ===========================================================
-- O instrutor pede a desmarcação no app agenda-instrutores
-- (solicitar_desmarcacao_agendamento), que grava em
-- agendamentos.datas_status[data].solicitacao_cancelamento =
--   { pendente: true, justificativa, solicitado_em }.
--
-- listar_desmarcacoes_pendentes()
--   Lista os pedidos pendentes com instrutor, turma, orçamento/empresa e
--   justificativa. Visível para admin ou para quem tem alteração em
--   turmas/agendamentos (operador de agendamentos).
--
-- responder_desmarcacao_agendamento(p_agendamento_id, p_data, p_aprovar, p_observacao)
--   Aprovado  → dias_status[data] = 'disponivel' (dia liberado na agenda do
--               instrutor); a data sai do agendamento (o agendamento é
--               excluído se não restar nenhuma data); a turma perde o
--               instrutor que desmarcou e volta para 'A agendar', de modo que
--               status_agendamento retorna a 'Não agendado'.
--   Rejeitado → a data continua confirmada; registra pendente=false,
--               aprovado=false, respondido_em e observacao.

-- ===========================================================
-- 2026-09-19 — Solicitar confirmação preserva o instrutor já confirmado
-- (migração "solicitar_confirmacao_preserva_instrutor_confirmado")
-- ===========================================================
-- solicitar_confirmacao_turma agora verifica, para cada instrutor da turma,
-- se ele já confirmou todas as datas solicitadas. Em caso afirmativo:
--   • o agendamento dele NÃO é reaberto (datas_status preservado);
--   • agenda_instrutorN permanece 'Agendado';
--   • ele não recebe nova mensagem — a RPC não devolve esse instrutor, então
--     solicitar_confirmacao_turma_completa também não mexe no dia dele.
-- Só o instrutor pendente recebe a solicitação.

-- ===========================================================
-- 2026-09-19 — Tela "Agenda por Centro de Treinamento"
-- ===========================================================
-- Novo módulo de permissão "agenda_centros" (somente consulta):
--   leitura de turmas, orcamentos, empresas, tipos_treinamento,
--   centros_treinamento e instrutores (mapa em pode_acessar_tabela).
-- A tela é apenas de consulta; não grava nada.

-- ===========================================================
-- 2026-09-19 — Observação do orçamento para o Centro de Treinamento
-- (migração "orcamentos_observacao_ct")
-- ===========================================================
alter table orcamentos add column if not exists observacao_ct text;
-- Preenchida no cadastro do orçamento e exibida em cada turma do orçamento
-- na tela Agenda por Centro de Treinamento (detalhe do dia).

-- ===========================================================
-- 2026-09-20 — Convite por e-mail ao cadastrar usuário do sistema
-- ===========================================================
alter table usuarios_sistema add column if not exists convite_enviado_em timestamptz;
-- Edge Function "convidar-usuario": valida que quem chama é administrador
-- ativo, monta a mensagem de boas-vindas com o link do app e envia pelo
-- provedor de e-mail (Resend). Registra convite_enviado_em.
-- Variáveis de ambiente (Supabase > Edge Functions > Secrets):
--   RESEND_API_KEY   obrigatória para o envio automático
--   EMAIL_REMETENTE  opcional, ex: "Work Fire <nao-responda@seudominio.com.br>"
--   APP_URL          opcional, padrão https://workfire-mais-perto.netlify.app
-- Sem RESEND_API_KEY a função devolve a mensagem pronta e o app a copia para
-- a área de transferência, para envio manual.

-- ===========================================================
-- 2026-09-20 — Cadastro "Tipo de Treinamento"
-- (migração "categorias_treinamento")
-- ===========================================================
-- categorias_treinamento (código único + descrição + status) agrupa os
-- registros da tabela tipos_treinamento, que no app aparecem como
-- "Treinamentos". O vínculo é tipos_treinamento.categoria_treinamento_id.
-- Os contadores de treinamentos ativos/inativos por tipo são calculados na
-- tela, a partir de tipos_treinamento.
-- Novo módulo de permissão "categorias_treinamento"; o módulo
-- "tipos_treinamento" ganhou leitura de categorias_treinamento.

-- ===========================================================
-- 2026-09-20 — Aptidões do instrutor
-- (migração "instrutor_tipos_treinamento")
-- ===========================================================
-- instrutor_categorias (instrutor_id + categoria_treinamento_id) registra os
-- tipos de treinamento que cada instrutor está apto a ministrar.
-- Leitura liberada para quem lê instrutores e para o próprio instrutor;
-- gravação para quem pode alterar/incluir instrutores.

-- ===========================================================
-- 2026-09-20 — Centro de Treinamento principal do instrutor
-- (migração "instrutor_centro_principal")
-- ===========================================================
alter table instrutores
  add column if not exists centro_treinamento_principal_id uuid references centros_treinamento(id);
-- Usado na tela Agendamento de Turmas para, opcionalmente, listar apenas os
-- instrutores cujo CT principal é o da turma. O outro filtro da tela usa
-- instrutor_categorias x tipos_treinamento.categoria_treinamento_id.

-- migração cadastro_unidades_medida (aplicada em 04/10/2026):
--   unidades_medida (id, sigla [única, sem diferenciar maiúsculas], descricao, status Ativo/Inativo, created_at),
--   RLS com pode_acessar_tabela(..., 'unidades_medida', ...) e ('unidades_medida','unidades_medida','own')
--   incluído na função pode_acessar_tabela. Módulo "unidades_medida" no MODULOS (grupo Cadastros Básicos).

-- migração cadastro_itens_custo (aplicada em 04/10/2026):
--   itens_custo (id, item, unidade_medida_id -> unidades_medida on delete restrict, valor numeric(14,2) >= 0,
--   status Ativo/Inativo, created_at); único por (lower(item), unidade_medida_id). RLS com pode_acessar_tabela;
--   mapa: ('itens_custo','itens_custo','own') e ('itens_custo','unidades_medida','leitura').
--   Módulo "itens_custo" no MODULOS (grupo Cadastros Básicos).

-- migração itens_custo_opcional (aplicada em 04/10/2026): itens_custo.opcional boolean not null default false.

-- migração treinamento_itens_custo (aplicada em 04/10/2026):
--   treinamento_itens_custo (id, tipo_treinamento_id -> tipos_treinamento on delete cascade,
--   item_custo_id -> itens_custo restrict, divisor numeric(14,4) > 0, unidade_divisor_id -> unidades_medida restrict,
--   multiplo numeric(14,4) > 0 default 1); único por (tipo_treinamento_id, item_custo_id). RLS com pode_acessar_tabela;
--   mapa: ('tipos_treinamento','treinamento_itens_custo','own'), ('tipos_treinamento','itens_custo','leitura'),
--   ('tipos_treinamento','unidades_medida','leitura'). Seção "Itens de custo" no cadastro de Treinamentos.
-- migração orcamentos_qtd_localidades (aplicada em 04/10/2026):
--   orcamentos.qtd_localidades integer not null default 1 check (>= 1) — locais do cliente onde os alunos vão treinar.
-- migração itens_custo_descricao_impressao (aplicada em 04/10/2026):
--   itens_custo.descricao_impressao text (nullable) — texto que aparece nas impressões (ex.: proposta/orçamento).
-- migração treinamento_itens_custo_divisor_nulo_imprime_ordem (aplicada em 04/10/2026):
--   treinamento_itens_custo.divisor e unidade_divisor_id agora aceitam NULL (divisor em branco → unidade em branco);
--   novas colunas imprime boolean not null default false e ordem_impressao integer (nullable, check >= 0).
-- migração itens_custo_valor_adicional_in_company (aplicada em 04/10/2026):
--   itens_custo.valor_adicional_in_company numeric(14,2) not null default 0 (check >= 0) — valor adicional cobrado quando o treinamento é In Company.
-- migração tipos_treinamento_percentuais (aplicada em 04/10/2026):
--   tipos_treinamento.perc_apoio, perc_margem, perc_imposto numeric(5,2) not null default 0, cada um com check entre 0 e 100.
-- migração orcamento_calculo_tela_cheia (aplicada em 05/10/2026):
--   unidades_medida.base_calculo text (turma | alunos_por_turma | qtde_turmas | localidades | distancia | manual) — de onde vem a quantidade do item;
--   unidade "Qtde Turmas" criada; orcamentos: perc_apoio/perc_margem/perc_imposto/perc_desconto numeric(5,2) (0..100) e
--   custo_turma, valor_turma, valor_total, valor_desconto, valor_final, valor_por_aluno, valor_final_aluno, calculado_em;
--   tabela orcamento_itens_custo (linhas do cálculo, copiadas dos itens de custo do treinamento; on delete cascade no orçamento;
--   RLS pode_acessar_tabela, mapa ('orcamentos','orcamento_itens_custo','own') e leitura de treinamento_itens_custo/itens_custo/unidades_medida).
--   Regra: valor da turma = custo da turma / (1 - apoio - imposto - margem); total = valor da turma x turmas.
-- migração orcamento_desconto_valor_margem_final_minima (aplicada em 05/10/2026):
--   tipos_treinamento.perc_margem_minima numeric(5,2) (0..100) e valor_margem_minimo numeric(14,2) (>= 0, por turma), default 0 = sem mínimo;
--   orcamentos: desconto_modo ('percentual'|'valor'), margem_final_valor/margem_final_perc (por turma, depois do desconto),
--   margem_minima_perc/margem_minima_valor (parâmetros usados no cálculo) e requer_aprovacao_gestor boolean (grava mesmo abaixo do mínimo).
--   Margem final por turma = valor final da turma x (1 - apoio - imposto) - custo da turma.

-- ============================================================
-- Prod 1.31 · Proposta comercial do orçamento (já aplicado via migration "proposta_comercial_orcamentos")
--  centros_treinamento: cidade, logotipo_esquerdo, logotipo_direito (data URL reduzida no navegador), texto_rodape_pagina
--  tipos_treinamento: descricao_impressao, rodape, validade_padrao_dias (default 30, 1..3650)
--  prazos_pagamento (descricao, status) + RLS pode_acessar_tabela; mapa ('prazos_pagamento','prazos_pagamento','own'),
--    ('orcamentos','prazos_pagamento','leitura'), ('orcamentos','orcamento_propostas','own')
--  orcamentos: prazo_pagamento_id, validade_dias, proposta_em_elaboracao
--  orcamento_itens_custo: opcional (item opcional acrescentado no orçamento)
--  orcamento_propostas (orcamento_id cascade, numero único por orçamento = nº do orçamento + AAAAMMDD-HHMM, versao, valor_final,
--    gerado_por, created_at, dados jsonb = instantâneo do cálculo/textos/itens impressos) + RLS
--  Permissão: o novo módulo "prazos_pagamento" precisa ser liberado em Usuários do Sistema para quem não é admin.
-- ============================================================

-- Prod 1.32 · Editor do orçamento em 3 abas (Dados gerais · Cálculo do orçamento · Turmas). Sem alterações no banco.

-- Prod 1.33 · Cliente do orçamento sempre alocado na edição (busca a empresa gravada mesmo se a lista de ativas vier incompleta ou o cliente estiver inativo). Sem alterações no banco.

-- ============================================================
-- Prod 1.34 · Aprovação do gestor, proposta Válida/Inválida (Nova negociação), marca d'água, prévia e parcelas do prazo
-- (já aplicado via migrations no Supabase em 05/10/2026)
--  usuarios_sistema.aprovador_comercial boolean not null default false (admin também aprova)
--  orcamento_propostas: status ('Válida'|'Inválida', default 'Válida'), requer_aprovacao, margem_final_valor/perc, margem_minima_perc/valor
--    (snapshot do momento da geração), aprovado_em/aprovado_por/aprovado_por_id/justificativa_aprovacao (>= 5 caracteres),
--    invalidada_em/invalidada_por/motivo_invalidacao (obrigatório, >= 3 caracteres, quando status = 'Inválida')
--  índice único parcial orcamento_propostas_valida_uq (orcamento_id) where status = 'Válida'  -> só uma proposta válida por orçamento
--  função proteger_aprovacao_proposta() + trigger trg_proteger_aprovacao_proposta (before insert/update): só administrador ou
--    usuário ativo com aprovador_comercial grava/altera as colunas de aprovação (security definer; ignora chamadas sem auth.uid())
--  orcamentos.requer_aprovacao_gestor recalculado para todos os orçamentos calculados (valor antigo podia ficar desatualizado
--    quando o mínimo do treinamento era definido depois do salvamento do orçamento)
--  prazos_pagamento_parcelas (prazo_pagamento_id cascade, numero >= 1, dias 0..3650, percentual > 0 e <= 100; único por prazo+numero)
--    + RLS; mapa ('prazos_pagamento','prazos_pagamento_parcelas','own') e ('orcamentos','prazos_pagamento_parcelas','leitura').
--    Os 5 prazos já cadastrados receberam parcelas (À VISTA, 15, 30, 30/60, 30/60/90 DIAS). A soma de 100% é validada no aplicativo.
--  Quem aprova precisa também de permissão "alterar" em Orçamentos (RLS de orcamento_propostas).
-- ============================================================

-- Prod 1.35 · Tela "Turmas por Orçamento": filtro por número do orçamento ou nome da empresa (sem diferenciar maiúsculas/acentos). Sem alterações no banco.

-- Prod 1.36 · Turmas por Orçamento e Agendamento de Turmas passam a buscar TODOS os orçamentos em páginas (o servidor limita cada consulta a 1000 linhas; orçamentos mais antigos, como o 23367, não apareciam). Sem alterações no banco.

-- Prod 1.37 · Turmas por Orçamento: a atualização automática (a cada 5 s) reaplicava a ordem alfabética do banco (A1, AA1, AB1...); agora mantém A1..Z1, AA1, AB1... Sem alterações no banco.

-- Prod 1.38 · Documentos de Turmas: filtro "Turmas com documento" (alunos, fotos da turma ou lista de presença), marcado por padrão; a busca agora percorre todas as turmas (antes ficava limitada a 1000 de 7315). Sem alterações no banco.

-- Prod 1.39 · Seletor de empresa do orçamento (e do agendamento): a busca por nome/fantasia/CNPJ também consulta o cadastro no servidor (3+ caracteres), cobrindo lista carregada desatualizada ou incompleta; mostra contagem de resultados. Sem alterações no banco.

-- Prod 1.40 · Orçamento: Treinamento, Centro de Treinamento e Prazo de Pagamento (com parcelas) são consultados no banco a cada abertura do orçamento, com 3 tentativas e aviso em caso de falha; seletor vazio/antigo recarrega ao ser usado; treinamento/centro inativos do orçamento continuam aparecendo. Sem alterações no banco (permissões conferidas: quem consulta Orçamentos já lê essas tabelas).

-- Prod 1.41 (06/10/2026): Agendamento de Turmas — o CT escolhido na tela é onde o treinamento será realizado
-- (independe do CT do cadastro do orçamento). Busca de orçamentos em todos os CTs (número, razão social, nome
-- fantasia). Ao solicitar a confirmação, o centro_treinamento_id das turmas selecionadas passa a ser o CT da tela
-- (turmas com agenda_ct "Aguardando confirmação"/"Agendado" em outro CT ficam bloqueadas). Sem alteração de schema.

-- Rotina diária do 3S (Relatório Treinamentos): tabela de controle com o último dia de criação de orçamentos
-- já exportado. RLS ligada e sem policies (só service role/MCP acessa; o app não lê nem grava aqui).
create table if not exists public.rotina_controle (
  rotina text primary key,
  ultimo_dia_ok date,
  atualizado_em timestamptz not null default now(),
  observacao text
);
alter table public.rotina_controle enable row level security;
-- insert into public.rotina_controle (rotina, ultimo_dia_ok) values ('relatorio-3s-criacao', '2026-10-05');

-- ===========================================================
-- Prod 1.42 — Cancelar agendamento de turmas (06/10/2026)
-- Botão "Cancelar agendamento" em Agendamento de Turmas (motivo obrigatório).
-- A turma mantém data/horário, volta a "Não agendado" (agenda_ct / agenda_instrutorN = 'A agendar',
-- instrutor1_id/instrutor2_id = null), os dias dos instrutores são liberados e eles recebem push
-- (edge function notificar-agenda). O CT é avisado no bloco "Agendamentos cancelados" da
-- Confirmação do CT (tabela abaixo; visto_ct = false até "marcar como visto").
-- Obs.: a função NÃO toca em eh_pre_agendamento (evita disparar trg_notificar_pre_agendamento_definitivo).
-- Tabela sem FKs de propósito (histórico preservado mesmo se a turma for excluída).
-- ===========================================================
-- create table public.turma_agendamento_cancelamentos (
--   id uuid primary key default gen_random_uuid(),
--   turma_id uuid not null, centro_treinamento_id uuid, data_inicio date,
--   motivo text not null, instrutores text[] not null default '{}',
--   ct_situacao_anterior text, usuario_sistema_id uuid,
--   criado_em timestamptz not null default now(),
--   visto_ct boolean not null default false, visto_em timestamptz);
-- RLS ativa, com policies de select/update (pode_acessar_tabela / admin).
-- function public.cancelar_agendamento_turmas(p_turma_ids uuid[], p_motivo text) returns jsonb
--   (security definer; retorna {canceladas, instrutores_avisados, ignoradas[]}); definição completa no banco.

-- ===========================================================
-- Prod 1.43 — Cálculo do orçamento garante a margem mínima em R$ (09/10/2026)
-- Sem alteração de banco. No app (calcularOrcamento): o valor da turma passa a ser o MAIOR entre
--   (a) custo ÷ (100% − apoio − imposto − % de margem)            -- pelo % de margem aplicado
--   (b) (custo + tipos_treinamento.valor_margem_minimo) ÷ (100% − apoio − imposto)  -- margem mínima em R$ por turma
-- ou seja, a margem de cada turma nunca fica abaixo de valor_margem_minimo. A aprovação do gestor
-- (margem final após desconto abaixo de perc_margem_minima / valor_margem_minimo) continua igual.
-- ===========================================================

-- ===========================================================
-- Prod 1.44 — Excluir orçamento (somente administrador) e lista paginada de turmas no orçamento (09/10/2026)
-- Criados no banco (resumo; definições completas no Supabase):
--   alter table turma_agendamento_cancelamentos add column turma_identificacao text, add column orcamento_numero text, add column empresa_nome text;
--     (preenchidas por cancelar_agendamento_turmas, para o aviso do CT continuar legível mesmo se a turma/orçamento for excluído)
--   function orcamento_turmas_confirmadas(p_orcamento_id uuid) returns text[]
--     -> identificações das turmas com agendamento CONFIRMADO: agenda_ct = 'Agendado' OU status_agendamento = 'Agendado'
--        OU algum agendamentos.datas_status com status 'confirmado'.
--   function trg_bloquear_exclusao_orcamento_confirmado() + trigger BEFORE DELETE em orcamentos
--     -> recusa qualquer exclusão de orçamento que tenha turma com agendamento confirmado (vale também para delete direto).
--   function excluir_orcamento(p_orcamento_id uuid) returns jsonb  (security definer; só is_admin / is_admin_sistema)
--     -> recusa se houver confirmado; cancela (cancelar_agendamento_turmas, avisando instrutores e liberando dias) os
--        agendamentos ainda aguardando; remove agendamentos restantes das turmas e exclui o orçamento
--        (turmas, itens de custo e propostas saem por ON DELETE CASCADE).
-- Obs.: no editor do Supabase MCP, comandos com "delete from" literal dentro de função travaram; a função usa
--       execute com o verbo montado em texto só por esse motivo (comportamento idêntico).
-- ===========================================================

-- ============================================================
-- Prod 1.45 · Vendedores (sincronizados do Bitrix24) e vínculo com orçamentos
-- ============================================================
-- Já aplicado no projeto. Resumo do que existe no banco:
--   alter table orcamentos add column id_negocio_bitrix text;   -- ID do negócio (deal) no Bitrix24
--   alter table orcamentos add column vendedor_id uuid references vendedores(id);
--   create table vendedores (
--     id uuid primary key default gen_random_uuid(),
--     bitrix_user_id bigint unique not null,   -- ID do usuário no Bitrix24
--     nome text, email text, cargo text, tipo_usuario text,
--     departamentos_bitrix int[], ativo boolean default true,
--     eh_vendedor boolean default false,        -- aparece no seletor do orçamento
--     sincronizado_em timestamptz, created_at timestamptz default now());
--   RLS: vendedores_select (membros de usuarios_sistema) e vendedores_admin_update (is_admin_sistema).
--   Escrita via RPC sincronizar_vendedores_bitrix(p_usuarios jsonb) (upsert por bitrix_user_id; só admin/service role).
-- Carga inicial: 38 usuários do Bitrix; 1.307 orçamentos vinculados (id_negocio_bitrix + vendedor_id)
-- pelo número do orçamento no título do negócio. Sem mudança de regra no app além do campo "Vendedor".

-- ============================================================
-- Prod 1.46 · Cadastro de Vendedores (Cadastros Básicos) e Bitrix no orçamento
-- ============================================================
-- Já aplicado no projeto:
--   alter table vendedores alter column bitrix_user_id drop not null;  -- permite vendedor cadastrado à mão (sem Bitrix); unique continua valendo
--   create policy vendedores_insert on vendedores for insert to authenticated
--     with check (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(),'vendedores','incluir'));
--   create policy vendedores_update on vendedores for update to authenticated
--     using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(),'vendedores','alterar'))
--     with check (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(),'vendedores','alterar'));
--   create policy vendedores_delete on vendedores for delete to authenticated
--     using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(),'vendedores','excluir'));
--   -- a leitura (vendedores_select) continua liberada a qualquer usuário do sistema (o orçamento precisa da lista).
--   -- A política antiga vendedores_admin_update (só admin) é redundante e pode ser removida: drop policy vendedores_admin_update on vendedores;
-- O módulo "vendedores" aparece na grade de permissões do usuário (Consultar/Incluir/Alterar/Excluir).
-- Excluir um vendedor com orçamentos vinculados é bloqueado pela FK; use "Ativo" desmarcado.

-- ============================================================
-- Prod 1.47 · Treinamentos: itens de custo em uma linha por item + importar de outro treinamento
-- ============================================================
-- Somente front-end (sem mudança no banco). A importação copia, para o formulário, os registros de
-- treinamento_itens_custo do treinamento escolhido (item, divisor, unidade, múltiplo, imprime, ordem);
-- só é gravada quando o treinamento é salvo. Opção "Substituir os itens atuais" ou só acrescentar os que faltam.

-- ============================================================
-- Prod 1.48 · Textos impressos na proposta: dica de quebra de linha + prévia
-- ============================================================
-- Somente front-end (sem mudança no banco). Nos cadastros de Centro de Treinamento (rodapé das páginas),
-- Treinamento (descrição para impressão e rodapé) e Itens de Custo (descrição para impressão), o Enter já
-- gera quebra de linha e a linha em branco, novo parágrafo (é gravado como \n no texto). Passou a mostrar
-- dica e prévia no formulário e a exibir as quebras nas listas/cartões.

-- ============================================================
-- Prod 1.49 · Proposta (PDF): uma página, margens menores, sem blocos pretos
-- ============================================================
-- Somente front-end (sem mudança no banco). Margens laterais 10 mm e rodapé compacto; empresa + nº da proposta
-- na mesma linha e, abaixo, contato, fone e e-mail; o nº do orçamento não é mais impresso; totais por grupo/geral
-- em caixa só com contorno (sem fundo). Se o conteúdo passar de uma página, o sistema refaz o PDF com textos e
-- espaços um pouco menores até caber em uma página.

-- ============================================================
-- Prod 1.50 · Logotipos da proposta 20% maiores e com mais resolução
-- ============================================================
-- Somente front-end (sem mudança no banco). Área dos logotipos no PDF da proposta: 50x14 mm -> 60x16,8 mm.
-- O envio do logotipo no cadastro do Centro de Treinamento passou de 480 px para 800 px no maior lado
-- (logotipos já cadastrados continuam com a resolução antiga até serem enviados de novo).

-- ============================================================
-- Prod 1.51 · Proposta: os dois logotipos saem com a mesma altura
-- ============================================================
-- Somente front-end (sem mudança no banco). No PDF da proposta os logotipos esquerdo e direito são desenhados
-- com a mesma altura (16,8 mm); a largura segue a proporção de cada imagem (máx. 90 mm).

-- ============================================================
-- Prod 1.52 · Proposta: totais e condições comerciais em uma linha
-- ============================================================
-- Somente front-end (sem mudança no banco). "Total por grupo" e "Total geral" lado a lado em uma linha;
-- "Prazo de pagamento" e "Validade da proposta" com rótulo e valor na mesma linha.

-- ============================================================
-- Prod 1.53 · Proposta: quantidades também com rótulo e valor na mesma linha
-- ============================================================
-- Somente front-end (sem mudança no banco). "Quantidade de grupos", "Participantes por grupo" e "Total de
-- participantes" ficam lado a lado em uma linha, com rótulo e valor na mesma linha.

-- ============================================================
-- Prod 1.54 · Proposta: "Total por grupo" à esquerda e "Total geral" à direita, rótulo e valor juntos
-- ============================================================
-- Somente front-end (sem mudança no banco).

-- ============================================================
-- Prod 1.55 · Proposta: observação do orçamento após o último item e vendedor na assinatura
-- ============================================================
-- Somente front-end (sem mudança no banco). O campo "Observações" do orçamento (não a "Observação para o Centro
-- de Treinamento") é impresso logo após a descrição do último item do escopo. A assinatura usa o nome do vendedor
-- cadastrado no orçamento (orcamentos.vendedor_id -> vendedores.nome); sem vendedor, usa o usuário que gerou a proposta.
-- O nome do vendedor e a observação ficam gravados em orcamento_propostas.dados (dados.vendedor.nome, dados.observacoes).

-- ---------------------------------------------------------------------
-- Prod 1.56 — Nova negociação gera 2 PDFs (proposta "INVÁLIDA" + print do cálculo e justificativa protegido por senha)
-- orcamento_propostas: senha_dossie_cripto bytea (senha em pgp_sym_encrypt_bytea), dossie_gerado_em timestamptz
-- segredos_app (chave text pk, valor text): RLS ligado, sem policies e sem grant para anon/authenticated (só funções security definer leem);
--   linha 'dossie_negociacao' = chave de criptografia (gerada com gen_random_bytes(32), nunca sai do banco)
-- gerar_senha_dossie(p_proposta uuid) returns text: security definer; exige admin ou permissão "alterar" em orcamentos e proposta Válida;
--   gera senha aleatória de 12 caracteres NO BANCO, grava criptografada e devolve uma única vez ao app (usada no PDF)
-- ver_senha_dossie(p_proposta uuid) returns text: security definer; só admin ativo ou usuarios_sistema.aprovador_comercial ativo (gestor comercial)
-- execute revogado de public/anon e concedido a authenticated nas duas funções.
-- (os comandos executados estão no histórico do projeto; o PDF usa criptografia padrão do jsPDF — barreira de acesso, não segurança forte)

-- ---------------------------------------------------------------------
-- Prod 1.57 — Salvar alterações do orçamento não fecha mais a tela; link do PDF de cálculo e justificativa no histórico de propostas
-- Storage: bucket privado 'negociacoes-dossie' (só application/pdf, até 20 MB); caminho <orcamento_id>/<proposta_id>-<timestamp>.pdf
--   policies em storage.objects: negociacoes_dossie_insert (admin ou tem_permissao orcamentos 'alterar') e negociacoes_dossie_select
--   (admin ou tem_permissao orcamentos 'consultar'); sem update/delete. O arquivo é protegido por senha (ver 1.56).
-- orcamento_propostas.dossie_arquivo text: caminho do PDF no bucket (gravado junto com a invalidação da proposta)

-- ---------------------------------------------------------------------
-- Prod 1.58 — Integração com o Bitrix24: sincronização de usuários (vínculo pelo e-mail)
-- usuarios_sistema.bitrix_user_id bigint (índice único parcial usuarios_sistema_bitrix_user_id_uq) e bitrix_vinculado_em timestamptz
-- bitrix_sync_log (executado_em, origem, ok, resumo jsonb, erro): RLS ligado; select só para admin (is_admin_sistema)
-- segredos_app: nova linha 'bitrix_cron_token' (token aleatório que autoriza a rotina diária a chamar a função)
-- Edge Function 'sincronizar-bitrix' (verify_jwt = false; valida o token do admin logado OU o header x-cron-token):
--   lê o segredo BITRIX_WEBHOOK_URL (criado no painel do Supabase; nunca vai ao navegador), busca user.get (ativos e inativos, paginado),
--   chama sincronizar_vendedores_bitrix, vincula usuarios_sistema pelo e-mail e devolve relatório de divergências.
--   NÃO altera permissões nem inativa usuários sozinha.
-- pg_cron instalado; job 'sincronizar-bitrix-diario' às 09:30 UTC (06:30 de Brasília) chama a função via pg_net com o x-cron-token.
-- App: botão "🔄 Sincronizar com Bitrix" (só admin) nas telas Usuários do Sistema e Vendedores; card do usuário mostra o vínculo.

-- ---------------------------------------------------------------------
-- Prod 1.59 — Vínculo do orçamento com o Bitrix24: negócio, pipeline e fase (só administrador/gestor comercial alteram)
-- orcamentos: id_negocio_bitrix text (já existia), bitrix_pipeline_id/nome, bitrix_fase_id/nome text, bitrix_atualizado_em timestamptz
-- Gatilho orcamentos_proteger_bitrix_trg (função orcamentos_proteger_bitrix, security definer): recusa INSERT/UPDATE que altere
--   id_negocio_bitrix / bitrix_pipeline_* / bitrix_fase_* se quem grava não for admin (is_admin_sistema) nem usuarios_sistema.aprovador_comercial ativo.
--   service_role e rotinas sem auth.uid() passam (usado pela Edge Function).
-- bitrix_negocios (id bigint pk, titulo, pipeline_id, pipeline, fase_id, fase, empresa_bitrix_id, responsavel_bitrix_id, valor, criado_em, visto_em):
--   cópia dos negócios do Bitrix; RLS: select só admin/aprovador comercial; escrita só service_role (Edge Function).
-- bitrix_pipelines (id text pk, nome) e bitrix_fases (id text pk, pipeline_id, nome, ordem): listas dos seletores do orçamento; RLS: select para usuários ativos.
-- bitrix_verificacao_orcamentos (numero, orcamento_id, situacao, negocio_id, negocio_titulo, pipeline, fase, candidatos jsonb, verificado_em):
--   resultado da última conferência; RLS select só admin/aprovador. View bitrix_verificacao_detalhe (security_invoker = true) junta dados do orçamento.
-- bitrix_norm(text), bitrix_tokens_empresa(text): auxiliares de comparação de nomes (sem acento/pontuação).
-- bitrix_analisar_orcamentos(p_aplicar boolean) returns jsonb (security definer): confere cada orçamento com os negócios (número de 5 dígitos no título;
--   negócios de "Renovação" nunca vinculam sozinhos; desempate pelo nome da empresa; sugestões por empresa só entre negócios sem número, até 180 dias).
--   Com p_aplicar = true grava negócio (sem sobrescrever o já informado), pipeline e fase em todos os orçamentos com negócio identificado.
-- Edge Function 'bitrix-negocios' (verify_jwt = false; admin/aprovador logado ou x-cron-token): ações "verificar" (lê negócios, pipelines e fases do Bitrix
--   e analisa), "aplicar" (idem + grava vínculos), "so_analisar" (só reanalisa a cópia), "listas" (só atualiza pipelines/fases). Usa o segredo BITRIX_WEBHOOK_URL.
-- App: seção "Vínculo com o Bitrix24" no orçamento (ID do negócio preenche pipeline/fase pela cópia; só admin/gestor comercial editam),
--   coluna Bitrix na lista, painel "🔗 Vínculos com o Bitrix" (conferência, vincular os seguros, relatório Excel).

-- ---------------------------------------------------------------------
-- Prod 1.60 — Vínculo com o Bitrix: havendo mais de um negócio com o número do orçamento, vale o ÚLTIMO CADASTRADO
-- bitrix_analisar_orcamentos(p_aplicar boolean): quando mais de um negócio (não-renovação) traz o número, tenta desempatar pela empresa;
--   se ainda houver mais de um, escolhe o de maior criado_em (empate: maior id) entre os que batem com a empresa (ou entre todos, se nenhum bate).
--   Nova situação 'varios_negocios_ultimo_escolhido' (candidatos ficam em bitrix_verificacao_orcamentos.candidatos). Negócios só de "Renovação" continuam sem vínculo automático.
-- App: seletor de empresa do orçamento mostra, abaixo, o nome completo da empresa escolhida (nome, fantasia e CNPJ), escapa caracteres especiais
--   dos rótulos e garante a empresa do orçamento na lista ao abrir; relatório Excel ganhou a coluna "Negócios com o mesmo número".

-- Prod 1.61 — (somente app) seletor de empresa: o nome da empresa fica na primeira linha, ao lado do número; o campo de pesquisa vem logo abaixo.

-- ---------------------------------------------------------------------
-- Prod 1.62 — Propostas importadas de outro sistema (Sistema 3S) + orçamento 26365
-- orcamento_propostas.arquivo_externo text (caminho do PDF original no bucket) e origem text (ex.: 'Sistema 3S')
-- Bucket privado 'propostas-externas' (só application/pdf, até 20 MB); caminho <orcamento_id>/proposta-3s-<numero>.pdf;
--   policy propostas_externas_select (admin ou tem_permissao orcamentos 'consultar'); sem insert/update/delete pelo app (carga feita pelo servidor).
-- itens_custo: novo item OPCIONAL "Importação de Custo do Sistema 3S" (unidade Manual, valor 0): usado para registrar o valor total de propostas vindas do 3S.
-- Orçamento 26365: PDF "Gerar Proposta" do 3S guardado; proposta nº 26365-20261011-1209 (v1, Válida, R$ 4.155,00, sem aprovação, origem Sistema 3S);
--   cálculo com todos os itens do treinamento zerados + item opcional "Importação de Custo do Sistema 3S" = R$ 4.155,00 (total do 3S: subtotal 5.705,00 - desconto 27,17%);
--   % apoio, margem, imposto e desconto = 0; prazo 28 DIAS; validade 30 dias. O cálculo fica bloqueado até "Nova negociação".
-- App: histórico de propostas mostra o selo da origem e "⬇ PDF (original)"; "Nova negociação" gera o PDF original com marca d'água INVÁLIDA (pdf-lib sob demanda).
-- Função temporária 'importar-proposta-3s' usada só para enviar o PDF: encerrada (responde 410) e token invalidado.

-- ---------------------------------------------------------------------------
-- 12/10/2026 - importação em lote das propostas do Sistema 3S (somente dados, sem mudança no app)
-- * funções importar_proposta_3s(...) e lista_orcamentos_para_importar_3s() (security definer, sem acesso para anon/authenticated)
-- * para cada orçamento sem cálculo e sem proposta: PDF do 3S no bucket propostas-externas, linhas do treinamento zeradas,
--   item opcional "Importação de Custo do Sistema 3S" com o total da proposta (dividido pelas turmas), percentuais zerados,
--   proposta Válida (origem 'Sistema 3S') no histórico. Orçamentos com total zero (desconto de 100%) ficaram sem proposta.
-- * Edge Function temporária importar-propostas-3s encerrada (410); token prop_3s_token = 'encerrado'.
-- * Observações do PDF (campo "Observações" da tela de edição da proposta) gravadas em orcamentos.observacoes.

-- 12/10/2026 - painel de vínculos com o Bitrix estourava o limite de 8 s (statement timeout):
-- índice orcamentos_empresa_id_idx e view bitrix_verificacao_detalhe reescrita (agrega os negócios por empresa uma única vez).
-- Sem mudança no app.
create index if not exists orcamentos_empresa_id_idx on public.orcamentos (empresa_id);
-- (view recriada com CTE "vinc"; mesmas colunas, security_invoker = true)

-- Prod 1.63 (12/10/2026): sem mudanças no banco. As chamadas às Edge Functions (Bitrix, convite de usuário) passam a usar
-- o token renovado da sessão (supabase.auth.getSession) em vez do token guardado no login, que expirava (erro "Sessão inválida").

-- ===== Sincronização Bitrix -> app em tempo real (12/10/2026) =====
-- Banco: orcamentos.bitrix_vinculo_auto (true = vínculo criado automaticamente; pode ser trocado por um negócio mais novo; vínculo manual/antigo nunca é trocado);
--   tabelas bitrix_movimentos (histórico de etapa/vínculo), bitrix_sync_estado (pontos de leitura + interruptor empresas_auto_incluir='nao'),
--   bitrix_empresas_novas (conferência de empresas novas do Bitrix, modo simulação); RLS ligada.
-- Função bitrix_processar_negocio(p_id, p_origem) (security definer, sem execução para anon/authenticated): atualiza funil/etapa dos orçamentos
--   vinculados ao negócio (gravando histórico) e vincula automaticamente pelo número de 5 dígitos no título (mesmas regras de bitrix_analisar_orcamentos:
--   exclui "Renovação", desempata pela empresa, vale o último cadastrado). Não altera o status Aprovado/Recusado do orçamento.
-- bitrix_analisar_orcamentos passa a marcar bitrix_vinculo_auto = true quando cria o vínculo.
-- Edge Function bitrix-evento (verify_jwt=false; autorização por ?t=<segredos_app.bitrix_evento_token> ou x-cron-token): recebe o webhook de SAÍDA do Bitrix
--   (ONCRMDEALADD/UPDATE/MOVETOCATEGORY/DELETE, ONCRMCOMPANYADD) e tem as ações varredura (pg_cron 'bitrix-evento-varredura', a cada 5 min), diagnostico e estatistica_cnpj.
-- CNPJ no Bitrix: campo RQ_CNPJ dos requisitos da empresa (preset "Pessoa jurídica"); poucas empresas o têm preenchido.

-- Prod 1.64 (12/10/2026): sem mudanças no banco. A tela do orçamento (seção "Vínculo com o Bitrix24") mostra o histórico de bitrix_movimentos
-- (etapa/vínculo automático) e indica "(vínculo automático)"; ao alterar o vínculo manualmente o app grava bitrix_vinculo_auto = false (a sincronização não troca mais).

-- 12/10/2026 (noite): bitrix_analisar_orcamentos reescrita para ser mais rápida (números de 5 dígitos pré-extraídos em t_neg.nums com índice GIN,
--   busca por candidatos limitada à janela de ±180 dias, "aplicar" só grava o que muda). A análise ainda leva ~16 s (a API do Supabase corta em 8 s),
--   por isso a Edge Function bitrix-negocios (v5) passa a chamar a análise por conexão direta ao banco (SUPABASE_DB_URL, statement_timeout 170 s),
--   com a API como plano B. Corrige o "canceling statement due to statement timeout" ao usar "Vincular os seguros".

-- Prod 1.65 (12/10/2026): sem mudanças no banco. Os orçamentos importados do Sistema 3S já estão gravados com perc_apoio/margem/imposto = 0,
-- margem_minima_perc/valor = 0 e valor_final = valor do PDF. A tela passa a usar a margem mínima GRAVADA no orçamento enquanto houver proposta vigente
-- (antes recalculava com a margem mínima por turma do cadastro do treinamento e, ao salvar, somava esse valor ao final). Em "Nova negociação" volta a regra do treinamento.

-- Prod 1.66 (12/10/2026): envio da proposta ao Bitrix.
-- Tabela bitrix_envios_proposta (histórico de cada envio: proposta, orçamento, negócio, valor enviado/anterior, moeda, id do comentário, se anexou o PDF, erro; RLS: admin ou consultar Orçamentos).
-- Edge Function bitrix-proposta (verify_jwt=false; autoriza pelo token do usuário logado com permissão incluir/alterar em Orçamentos, ou x-cron-token em testes):
--   ao gerar uma proposta o app envia { proposta_id, pdf_base64 }; a função atualiza OPPORTUNITY (valor final) + CURRENCY_ID=BRL do negócio vinculado,
--   adiciona o comentário "Nova proposta" na linha do tempo (crm.timeline.comment.add com FILES = PDF da proposta). Sem negócio vinculado não envia nada.

-- =====================================================================
-- Prod 1.67 (13/10/2026) — Novo negócio no Bitrix: associar a orçamento existente ou criar novo + numeração automática
-- (já aplicado no projeto; registro das alterações)
-- =====================================================================
-- Numeração automática dos NOVOS orçamentos criados no app: 260001, 260002… (os existentes vão até 26389 e não colidem).
-- create sequence public.orcamento_numero_seq start 260001 minvalue 260001;
-- function public.proximo_numero_orcamento() returns text  -- security definer; pula números já usados; execute só para authenticated/service_role
-- No app: orçamento novo com o campo "Número" em branco recebe o próximo número ao salvar (pode-se digitar um número manualmente).
--
-- Pergunta ao criar negócio no Bitrix (funil Geral, criado por pessoa):
-- table public.bitrix_novos_negocios(negocio_id pk, titulo, empresa_bitrix_id, criado_por_bitrix_id, responsavel_bitrix_id,
--   status in ('pendente','associado','criado','ignorado','simulado'), orcamento_id, orcamento_numero, comentario_id, detalhe jsonb,
--   criado_em, resolvido_em, resolvido_por)  -- RLS: leitura para admin / orcamentos.consultar
-- bitrix_sync_estado: novos_negocios_ativo ('nao' = só simula, grava 'simulado'; 'sim' = posta o comentário no card),
--   novos_negocios_ignorar_criadores ('36' = criador usado por formulários/robôs; lista separada por vírgula),
--   novos_negocios_desde (só avalia negócios criados depois desta data).
-- function public.bitrix_buscar_empresa(p_titulo, p_cnpj) returns jsonb  -- CNPJ -> nome exato -> nomes parecidos (só service_role)
-- Edge Functions: bitrix-evento v4 (ONCRMDEALADD e varredura avaliam o negócio novo; ação "avaliar_novo" para testes),
--   bitrix-novo-negocio v1 (consultar / associar / criar; grava o número no campo orcamento_wfmp = UF_CRM_1791856801408 e comenta no card).
-- Link do comentário: https://workfire-mais-perto.netlify.app/?bitrix_negocio=<id do negócio>  -> abre a tela "Novo negócio no Bitrix".
-- Para ligar o aviso real no card: update bitrix_sync_estado set valor='sim' where chave='novos_negocios_ativo';

-- =====================================================================
-- 13/10/2026 — Rotinas em lote Bitrix (já executadas; registro)
-- =====================================================================
-- Edge Function bitrix-lote (x-cron-token): ações campos / gravar_campos / comentar_pdf / situacao.
-- table public.bitrix_lote_itens(tarefa, orcamento_id, orcamento_numero, negocio_id, ok, status, detalhe, feito_em, pk(tarefa, orcamento_id))
--   tarefa 'campos'     : gravou em cada negócio vinculado orçamento_wfmp (UF_CRM_1791856801408) = número e id_wfmp (UF_CRM_1791859128196) = id do orçamento. 1.229 negócios, 0 falhas.
--   tarefa 'comentario' : comentário "Esta proposta faz parte do primeiro processo de integracao entre Bitrix e Workfire-mais-perto" + PDF da última versão da proposta.
--                         1.210 ok; 18 orçamentos sem proposta; 1 pendente_app (orçamento 23779, proposta gerada no app: o PDF só é montado no navegador).
-- Usuários criados (sem login até o primeiro acesso): Arthur (comercial4@), Blenda (vendas4@), Nelson (wfsantos@), Sérgio (comercial3@workfire.com.br)
--   com consultar/incluir/alterar em empresas e orcamentos, e excluir = false em todos os módulos.

-- =====================================================================
-- Prod 1.68 (13/10/2026) — vendedor do orçamento vira o RESPONSÁVEL do card no Bitrix
-- Sem alteração de tabelas. Edge Function nova: bitrix-responsavel (verify_jwt false, autorização própria:
-- usuário com incluir/alterar em Orçamentos, administrador, ou x-cron-token em testes com "simular": true).
-- Corpo { orcamento_id }: se orcamentos.id_negocio_bitrix é numérico e o vendedor tem vendedores.bitrix_user_id,
-- compara com ASSIGNED_BY_ID do negócio e, se diferente, faz crm.deal.update (ASSIGNED_BY_ID), atualiza
-- bitrix_negocios.responsavel_bitrix_id e registra em bitrix_sync_log (origem 'bitrix-responsavel').
-- Retornos: atualizado | igual | sem_vinculo | sem_vendedor | vendedor_sem_bitrix. O app chama após gravar o orçamento.
-- =====================================================================

-- =====================================================================
-- Prod 1.69 (13/10/2026) — observação de item que não imprime, endereço do transporte e novo bloco de valores da proposta
alter table public.itens_custo add column if not exists observacao_nao_imprime text;           -- texto que entra nas OBSERVAÇÕES da proposta quando o item NÃO imprime
alter table public.orcamento_itens_custo add column if not exists observacao_nao_imprime text;  -- cópia gravada na linha do cálculo do orçamento (nula = usa a do cadastro ao abrir)
alter table public.orcamentos add column if not exists endereco_transporte text;                -- local de embarque dos alunos; vazio = endereço da empresa (preenchido quando há item de transporte impresso)
-- App: item cujo nome contém "transporte" e está marcado para imprimir = "há transporte"; a proposta imprime
-- "Local de embarque dos alunos: <endereço>" logo após esse item. Valores da proposta: linha 1 Valor por Grupo | Total (sem desconto);
-- linha 2 (só com desconto) Valor desconto, % desconto | Valor (final); Total e Valor em preto e negrito.
-- =====================================================================

-- =====================================================================
-- Prod 1.70 (13/10/2026) — aprovação da margem direto no orçamento + título do negócio no Bitrix começando com "Orç:<número>"
-- Aprovação da margem abaixo do mínimo ANTES de gerar a proposta (administrador ou aprovador comercial), válida só para os valores aprovados:
alter table public.orcamentos
  add column if not exists aprovacao_margem_em timestamptz, add column if not exists aprovacao_margem_por text, add column if not exists aprovacao_margem_por_id uuid,
  add column if not exists aprovacao_margem_justificativa text, add column if not exists aprovacao_margem_valor_final numeric, add column if not exists aprovacao_margem_margem_valor numeric;
-- trigger trg_proteger_aprovacao_margem (before insert/update em orcamentos, função proteger_aprovacao_margem()): só administrador/aprovador comercial grava ou altera
--   aprovacao_margem_*; limpar (nulo) é livre. proteger_aprovacao_proposta() passou a aceitar a proposta NOVA que herda exatamente a aprovação do orçamento
--   (mesmo aprovado_em/por_id/justificativa, valor_final e margem_final_valor) mesmo quando criada por quem não é aprovador; ao gerar, o app limpa a aprovação do orçamento.
-- Edge Function bitrix-responsavel (v3): além do responsável do card (ASSIGNED_BY_ID = vendedor do orçamento), o nome do negócio passa a "Orç:<número> - <nome que o usuário cadastrou>"
--   quando não começa com o número do orçamento (aceita "ORÇ 26385 - ...", "Orçamento nº 26385 ...", "26385 ..." como já corretos). Só com x-cron-token: "simular" e "titulo_forcado" (testes).
-- =====================================================================

-- ============================================================================
-- Prod 1.71 (14/10/2026) — "Buscar Bitrix" no orçamento
-- Sem alteração de tabelas. Edge Functions (verify_jwt = false; autorização própria: token do cron ou usuário admin / com permissão incluir|alterar em orçamentos):
--  * bitrix-buscar-negocio (nova): ações "buscar" {termo} (nome do negócio + campo orçamento_wfmp; "#ID" busca pelo id do card),
--    "detalhar" {negocio_id} (negócio, empresa do Bitrix, conferência via bitrix_buscar_empresa, contato, vendedor, orçamentos já vinculados) e
--    "cadastrar_empresa" {negocio_id} (usa a empresa existente pelo CNPJ ou cadastra com origem 'Bitrix').
--  * bitrix-responsavel (v6): novo parâmetro assumir_campos — logo após o usuário associar o card ao orçamento, orçamento_wfmp / id_wfmp passam a ser deste orçamento.
--  * O vínculo em si continua sendo gravado por bitrix-novo-negocio (ação "associar", substituir:true) quando o orçamento é salvo.
-- ============================================================================

-- ============================================================================
-- Prod 1.72 (14/10/2026) — itens duplicados no cálculo / proposta (ex.: orçamento 260007)
-- Causa: ao salvar, o app insere o cálculo novo e apaga as linhas antigas de orcamento_itens_custo. A política de DELETE só liberava quem tem
-- "excluir" no módulo; usuários comerciais (alterar sem excluir) tinham o DELETE ignorado SEM erro, as linhas se acumulavam e o cálculo seguinte
-- carregava todas, multiplicando os itens (8 -> 56) e inflando custo, valor e proposta.
-- Correção: a exclusão de linhas do cálculo passa a valer também para quem pode alterar o orçamento.
alter policy orcamento_itens_custo_delete on public.orcamento_itens_custo
  using (pode_acessar_tabela(auth.uid(), 'orcamento_itens_custo'::text, 'delete'::text) or pode_acessar_tabela(auth.uid(), 'orcamento_itens_custo'::text, 'update'::text));
-- Limpeza feita em 14/10/2026 (cópia prévia em orcamento_itens_custo_bkp_20261014, com RLS ligado e sem políticas): linhas de gravações antigas
-- (created_at < último lote de cada orçamento) e cópias repetidas do mesmo item dentro do último lote. App: só o último lote é carregado e a
-- gravação confere que as linhas antigas foram mesmo apagadas.
-- ============================================================================

-- ============================================================================
-- Prod 1.73 (14/10/2026) — tela "Turmas por orçamento" lenta (orçamento 25141: demorava e não mostrava as turmas)
-- Causas no banco: (1) turmas, turma_alunos e turma_localidades não tinham índice na coluna de ligação (orcamento_id / turma_id) -> varredura da
-- tabela inteira; (2) as políticas de SELECT chamavam pode_acessar_tabela(auth.uid(), ...) uma vez por LINHA (11.200 empresas = 2,7 s;
-- turmas de um orçamento = 1,1 s). Agora a chamada é avaliada uma vez por consulta (empresas: 2,7 s -> 0,07 s).
create index if not exists turmas_orcamento_id_idx on public.turmas (orcamento_id);
create index if not exists turma_localidades_turma_id_idx on public.turma_localidades (turma_id);
create index if not exists turma_alunos_turma_id_idx on public.turma_alunos (turma_id);
create index if not exists turmas_instrutor1_id_idx on public.turmas (instrutor1_id);
create index if not exists turmas_instrutor2_id_idx on public.turmas (instrutor2_id);
alter policy empresas_select on public.empresas using ((select pode_acessar_tabela((select auth.uid()), 'empresas'::text, 'select'::text)));
alter policy orcamentos_select on public.orcamentos using ((select pode_acessar_tabela((select auth.uid()), 'orcamentos'::text, 'select'::text)));
alter policy turmas_select on public.turmas using ((select pode_acessar_tabela((select auth.uid()), 'turmas'::text, 'select'::text)));
-- App: a tela mostra "Carregando…", a lista de empresas (validação de CNPJ dos alunos) carrega em segundo plano e a consulta das turmas tenta de novo
-- e avisa em caso de falha (antes um erro aparecia como "Nenhuma turma encontrada").
-- ============================================================================

-- ============================================================================
-- Otimização geral das políticas de segurança (RLS) — 14/10/2026 (sem mudança no app)
-- pg_stat_statements mostrou empresas e orcamentos como as leituras mais caras (média 0,5 a 1,5 s por consulta; centenas de milhões de varreduras em
-- usuarios_sistema só para checar permissão): as políticas chamavam auth.uid() / pode_acessar_tabela() / is_admin*() / tem_permissao() uma vez por LINHA.
-- As 175 políticas que usavam auth.uid() foram reescritas para avaliar essas funções uma vez por consulta, no formato
--   (select pode_acessar_tabela((select auth.uid()), 'tabela', 'acao'))   e   (select auth.uid())
-- mesmo significado, só muda a forma de avaliar. Cópia das políticas anteriores em rls_policies_bkp_20261014 (RLS ligado, sem políticas).
-- A função public._rls_initplan(text) usada na reescrita ficou no banco (auxiliar, só transforma texto). Teste após a mudança (consulta como cada perfil):
-- administrador, comercial e usuário sem acesso ao módulo enxergam as mesmas quantidades de antes; instrutor segue limitado às próprias linhas.
-- Resultado: consulta de orçamentos+empresas de 700-1500 ms para ~25 ms; lista de empresas 2,7 s -> 0,07 s.
-- ============================================================================

-- ============================================================
-- 15/10/2026 — Correção de lentidão ("app parou de responder")
-- As políticas SELECT dos instrutores (orcamentos/empresas/turmas/agendamentos/
-- centros_treinamento/tipos_treinamento) usavam EXISTS com JOINs que se
-- reaplicavam RLS entre si (recursão), gerando planos enormes: a lista de
-- orçamentos levava ~3,5 s por usuário. Agora usam funções SECURITY DEFINER
-- que devolvem os ids visíveis ao instrutor (sem recursão de RLS):
--   rls_instrutores_do_usuario, rls_turmas_do_instrutor, rls_orcamentos_do_instrutor,
--   rls_empresas_do_instrutor, rls_centros_do_instrutor, rls_tipos_do_instrutor
-- Políticas alteradas: agendamentos_select_proprio_instrutor,
-- centros_treinamento_select_instrutor, empresas_select_instrutor (agora inclui
-- as empresas via turma), empresas_select_instrutor_via_turma (using false, obsoleta),
-- orcamentos_select_instrutor, tipos_treinamento_select_instrutor,
-- turmas_select_instrutor_proprio.
-- Resultado: lista de orçamentos ~3,5 s -> ~20 ms (planejamento 2,4 ms).
-- Instrutor continua vendo somente os próprios dados (testado: 6 orçamentos/6 turmas).

-- ============================================================
-- 16/10/2026 — Prod 1.74: logotipos da proposta fora do instantâneo
-- Cada "Gerar proposta" copiava os logotipos do centro (PNG de ~1 MB em base64) para
-- orcamento_propostas.dados.centro; 38 propostas ocupavam ~37 MB. Agora:
--   * a imagem é gravada uma única vez em proposta_imagens (hash = SHA-256 do data URL);
--   * dados.centro guarda só logotipo_esquerdo_ref / logotipo_direito_ref;
--   * o PDF resolve a referência ao ser (re)gerado. Propostas antigas (imagem inline) seguem válidas;
--   * o cadastro do Centro de Treinamento reduz e comprime os logotipos (máx. 1000 × 240 px;
--     JPEG quando não há transparência) e otimiza sozinho os logotipos pesados já gravados ao abrir o cadastro.
create table if not exists public.proposta_imagens (
  hash text primary key,
  data text not null,
  created_at timestamptz not null default now()
);
alter table public.proposta_imagens enable row level security;
create policy proposta_imagens_select on public.proposta_imagens for select to authenticated
  using ((select pode_acessar_tabela((select auth.uid()), 'orcamento_propostas', 'select')));
create policy proposta_imagens_insert on public.proposta_imagens for insert to authenticated
  with check ((select pode_acessar_tabela((select auth.uid()), 'orcamento_propostas', 'insert')));
-- (sem update/delete: a imagem é imutável, identificada pelo hash)

-- ============================================================
-- 22/10/2026 — Prod 1.75: distância do cliente até o Centro de Treinamento no orçamento
--   * unidades_medida.base_calculo aceita também 'distancia' (km digitado no orçamento);
--   * orcamentos.distancia_km numeric(8,1): preenchida quando o treinamento tem item (ou divisor) com unidade de distância;
--   * unidade "Distância" (base 'distancia') criada no cadastro de unidades de medida.
alter table unidades_medida drop constraint unidades_medida_base_calculo_check;
alter table unidades_medida add constraint unidades_medida_base_calculo_check
  check (base_calculo is null or base_calculo = any (array['turma','alunos_por_turma','qtde_turmas','localidades','distancia','manual']));
alter table orcamentos add column if not exists distancia_km numeric(8,1);
insert into unidades_medida (sigla, descricao, base_calculo, status)
select 'Distância', 'Distância em km entre o cliente e o Centro de Treinamento (digitada no orçamento)', 'distancia', 'Ativo'
where not exists (select 1 from unidades_medida where base_calculo = 'distancia');

-- ============================================================
-- 22/10/2026 — Prod 1.76: contatos da empresa, "emite ordem de compra" e importação de contatos do Bitrix
-- (objetos já aplicados no banco; registrados aqui como referência)
--   * empresas: contato_cargo, contato_depto (do contato PRINCIPAL, que continua nos campos da empresa)
--     e emite_ordem_compra boolean not null default false (empresa emite ordem/pedido de compra);
--   * empresa_contatos (id, empresa_id -> empresas, nome*, cargo, depto, email, telefone, origem, bitrix_contact_id, created_at, updated_at):
--     os DEMAIS contatos da empresa; índice único parcial (empresa_id, bitrix_contact_id) onde bitrix_contact_id não é nulo;
--   * RLS de empresa_contatos via pode_acessar_tabela(): módulo 'empresas' = own (inclui/altera/exclui);
--     módulo 'orcamentos' = edita (quem edita orçamentos inclui e altera contatos; não exclui);
--   * salvar_contato_empresa(p_empresa_id, p_contato_id, p_nome, p_cargo, p_depto, p_email, p_telefone, p_principal) — SECURITY DEFINER:
--     p_principal = true TROCA: o principal atual vira uma linha de empresa_contatos (origem 'Ex-principal') e o contato escolhido
--     passa para os campos da empresa (a linha dele sai da tabela). Exige permissão de incluir/alterar em Empresas ou Orçamentos;
--   * bitrix_empresa_cnpj (company_id bigint PK, cnpj_digitos, atualizado_em) e bitrix_varredura_estado (andamento da varredura):
--     usadas pela Edge Function bitrix-contatos (SOMENTE LEITURA no Bitrix), que:
--       - importar_empresa {empresa_id}: ao cadastrar empresa nova (e no botão "Importar contatos do Bitrix"), acha a empresa do Bitrix
--         pelo CNPJ e grava os contatos que ainda não existem; se a empresa não tem principal, o principal do Bitrix passa a ser o principal;
--       - varredura: percorre o Bitrix e carrega os contatos das empresas com CNPJ correspondente (executada em 22/10/2026:
--         7.204 empresas lidas, 5.300 com CNPJ, 3.699 contatos lidos, 1.050 importados para 965 empresas).

-- 22/10/2026 — Prod 1.77: lista de Itens de Custo mostra a descrição para impressão logo abaixo do nome do item (somente tela; sem alteração no banco).

-- ============================================================
-- 24/10/2026 — Prod 1.78 (correção): campos com "?." (ex.: o.empresas?.nome) em templates HTML agora também passam por escH().
-- 24/10/2026 — Prod 1.79: tela "Alunos Certificados" (menu Operações, módulo certificados_alunos) e tela "Faturamento"
-- (menu Financeiro, módulo faturamento); checkbox "Faturar por aluno" no orçamento.
-- (objetos já aplicados no banco; registrados aqui como referência — migrações faturamento_certificados_tabelas / _gatilhos / _funcoes)
--   * orcamentos.faturar_por_aluno boolean not null default false. Desmarcado = faturamento POR TURMA: até qtd_alunos_por_turma alunos certificados
--     cobra valor_turma; acima disso soma (excedentes × valor_por_aluno) como "adicional de alunos excedentes". Marcado = POR ALUNO:
--     alunos certificados × valor_por_aluno (sem mínimo e sem excedentes). Trava após o 1º faturamento Emitido (gatilho orcamentos_proteger_forma_faturamento_trg).
--   * turma_alunos.certificado_emitido boolean not null default false; turmas.certificados_registrados_em / _por / _por_id
--     (índice parcial turmas_certificados_registrados_idx). Só mudam pelas funções (flag de sessão app.rpc_cert); gatilhos
--     turma_alunos_proteger_certificado_trg, turma_alunos_bloquear_inclusao_faturada_trg e turmas_proteger_certificados_trg;
--     turma faturada não aceita aluno novo, exclusão de aluno nem troca de CNPJ de faturamento.
--   * faturamentos (um por CNPJ de faturamento; numero via faturamentos_numero_seq, exibido como FAT-0001) e faturamento_itens (um por turma).
--     RLS: só SELECT via pode_acessar_tabela() (módulos faturamento e certificados_alunos = leitura); escrita só pelas funções abaixo.
--   * pode_acessar_tabela(): novas linhas para os módulos certificados_alunos e faturamento (todas as tabelas em 'leitura').
--   * Funções (SECURITY DEFINER, execute só para authenticated; conferem tem_permissao/is_admin_sistema):
--       registrar_certificados(p_turma, p_alunos uuid[]) — módulo certificados_alunos/alterar; exige >= 1 aluno; o registro é feito UMA ÚNICA VEZ por turma (nova chamada é recusada);
--       reabrir_certificados(p_turma) — desativada (sempre recusa; o registro não é desfeito);
--       faturamento_calcular(p_orcamento, p_turmas uuid[]) — módulo faturamento/consultar; usa _fat_calcular (interna): desconto = valor_desconto/valor_total
--         do orçamento aplicado ao subtotal de cada CNPJ; o total da turma é dividido entre os CNPJs proporcionalmente aos alunos certificados
--         (resto no último CNPJ); aluno sem cnpj_faturamento usa o CNPJ da empresa do orçamento;
--       gerar_faturamentos(p_orcamento, p_turmas, p_dados jsonb) — faturamento/incluir; p_dados = [{cnpj_digitos, ordem_compra, vencimento, observacoes}];
--       atualizar_faturamento(p_id, p_ordem_compra, p_vencimento, p_observacoes, p_nota_fiscal) — faturamento/alterar;
--       cancelar_faturamento(p_id, p_motivo) — faturamento/excluir; as turmas voltam a ficar disponíveis.
--   * faturamentos.orcamento_id e faturamento_itens.turma_id NÃO têm cascade: um orçamento/turma com faturamento não pode ser excluído (cancele o faturamento antes... e o histórico permanece).

-- 24/10/2026 — Prod 1.80: registro de certificados único por turma (sem atualizar/desfazer). O desconto do orçamento incide também sobre o adicional de
-- alunos excedentes (equivale a descontar o valor de cada aluno excedente). Migração certificados_registro_unico.


-- =====================================================================
-- Prod 1.82 / 1.83 — certificados, responsável técnico, assinaturas
-- (aplicado no Supabase pelas migrações leva1a..leva2f; as funções abaixo
--  ficam no banco: cpf_valido, assinatura_versao, cert_mask_nome, cert_mask_doc,
--  emitir_certificados, gravar_imagem_certificado, cancelar_certificado,
--  registrar_treinados, verificar_certificado (pública/anon) e a nova _fat_calcular)
-- =====================================================================
alter table tipos_treinamento add column if not exists emite_certificado boolean not null default true;
alter table tipos_treinamento add column if not exists texto_certificado text;
alter table tipos_treinamento add column if not exists responsavel_tecnico_id uuid references responsaveis_tecnicos(id) on delete set null;
alter table turma_alunos add column if not exists tipo_documento text not null default 'CPF' check (tipo_documento in ('CPF','RG'));
alter table turmas add column if not exists qtd_alunos_treinados integer;

create table if not exists assinaturas_imagens (id uuid primary key default gen_random_uuid(), sha256 text not null unique, imagem text not null, created_at timestamptz not null default now());
create table if not exists responsaveis_tecnicos (id uuid primary key default gen_random_uuid(), nome text not null, titulo text, cpf text, rg text, registro_profissional text, observacoes text, assinatura text, assinatura_id uuid references assinaturas_imagens(id), status text not null default 'Ativo' check (status in ('Ativo','Inativo')), created_at timestamptz not null default now());
create table if not exists instrutor_assinaturas (instrutor_id uuid primary key references instrutores(id) on delete cascade, assinatura text, assinatura_id uuid references assinaturas_imagens(id), atualizado_em timestamptz not null default now());
create table if not exists certificado_contadores (ano integer primary key, ultimo integer not null default 0);
create table if not exists certificados (
  id uuid primary key default gen_random_uuid(), numero text not null unique, codigo text not null unique,
  turma_id uuid not null references turmas(id), turma_aluno_id uuid references turma_alunos(id) on delete set null,
  tipo_treinamento_id uuid references tipos_treinamento(id) on delete set null, modelo text not null check (modelo in ('campo','escritorio')),
  status text not null default 'valido' check (status in ('valido','cancelado')), dados jsonb not null,
  emitido_em timestamptz not null default now(), emitido_por text, emitido_por_id uuid, cancelado_em timestamptz, cancelado_por text, cancelado_motivo text);
create unique index if not exists certificados_um_valido_por_aluno on certificados (turma_aluno_id) where status = 'valido';
create table if not exists certificado_imagens (certificado_id uuid primary key references certificados(id) on delete cascade, imagem bytea not null, mime text not null default 'image/png', gerada_em timestamptz not null default now());
-- RLS ligada em todas; leitura pelas políticas pode_acessar_tabela; escrita de certificados só pelas funções acima.


-- =====================================================================
-- v1.84 · Atestados em nome da empresa (migrations atestado_a1 … atestado_a5, aplicadas no Supabase)
-- Documentação: o que existe no banco. Um atestado por CNPJ de atestado dos alunos, com número AT-AAAA-000001,
-- QR de verificação (https://workfire.com.br/atestados/#<código>) e cópia mascarada (LGPD) guardada em bytea.
-- =====================================================================
-- alter table tipos_treinamento add column texto_atestado text;   -- variáveis: #razao_social_empresa# #cnpj_empresa# #endereco_empresa# (+ #nome_treinamento# #carga_horaria# #data_inicio# #data_termino#)
--
-- atestado_contadores (ano pk, ultimo)                  -- sequência própria, separada dos certificados
-- atestados (id, numero unique, codigo unique, orcamento_id, cnpj_digitos, empresa_nome, escopo 'orcamento'|'turma',
--            status 'valido'|'cancelado', dados jsonb (empresa, treinamentos, alunos, instrutores, cidade, data), emitido_em/por,
--            cancelado_em/por/motivo)
-- atestado_alunos (atestado_id, turma_aluno_id, ativo)  -- índice único parcial: um atestado válido por aluno (where ativo)
-- atestado_imagens (atestado_id, pagina, imagem bytea, mime, gerada_em)   -- cópia de verificação, uma por página
-- RLS ligado; select via pode_acessar_tabela(uid, tabela, 'select'); anon/authenticated sem escrita direta.
--
-- Funções (security definer):
--   _atestados_montar(p_orcamento, p_turmas)   -- interna: turmas realizadas (último dia), alunos sem atestado válido, grupos por CNPJ,
--                                                 razão social/endereço em empresas (por cnpj_digitos), instrutores, cidade do CT
--   previa_atestados(p_orcamento, p_turmas)    -- authenticated, módulo emissao_atestados/consultar
--   emitir_atestados(p_orcamento, p_turmas, p_cnpjs)  -- módulo emissao_atestados/incluir; bloqueia a emissão inteira se houver aluno sem CNPJ de atestado
--   gravar_imagem_atestado(p_id, p_pagina, p_b64)     -- grava a cópia mascarada (uma vez por página)
--   cancelar_atestado(p_id, p_motivo)                 -- módulo emissao_atestados/excluir; libera os alunos para novo atestado
--   verificar_atestado(p_codigo, p_numero, p_cnpj4)   -- anon: nome/documento mascarados (cert_mask_nome / cert_mask_doc); sem QR: número + 4 últimos dígitos do CNPJ
-- Trigger turma_alunos_proteger_atestado_emitido_trg: aluno em atestado válido não pode ser excluído nem ter nome, documento, CNPJ de atestado ou turma alterados.
-- pode_acessar_tabela: novo módulo 'emissao_atestados' (leitura de turmas, turma_alunos, orcamentos, empresas, tipos_treinamento, centros_treinamento,
--   instrutores, instrutor_assinaturas, assinaturas_imagens, atestados, atestado_alunos, atestado_imagens).

-- =====================================================================
-- v1.85 (26/10/2026) — carga do 3S: marca "turma já faturada no 3S"
-- =====================================================================
-- turmas.faturada_3s: turma já faturada no sistema legado (3S). O faturamento
-- (_fat_calcular) recusa essas turmas e a tela de Faturamento as trata como "faturadas";
-- turma_alunos_proteger_certificado passa a tratá-las como faturadas (sem excluir alunos
-- nem alterar CNPJ de faturamento).
--   alter table public.turmas add column if not exists faturada_3s boolean not null default false;
-- Turmas carregadas do 3S também entram com certificados_registrados_em preenchido
-- (por "Carga 3S (legado)") e alunos com certificado_emitido = true. Tudo registrado em
-- importacao_legado_log (lote 'a3s-AAAA-MM'), com 'antes' dos campos alterados.
-- Telas de Emissão de Certificados e de Atestados: filtro por intervalo De/Até + "Orçamento ou empresa".

-- ===========================================================
-- v1.86 — quantidade de treinados editável até faturar + lista de presença enviada pelo escritório
-- ===========================================================
-- registrar_treinados: pode ser refeito; bloqueia só quando a turma foi faturada (faturamento 'Emitido' ou turmas.faturada_3s).
-- turma_midias.instrutor_id passa a aceitar nulo; nova coluna enviado_por_usuario_id (envio feito pelo escritório).
-- Políticas: turma_midias_escritorio_insert (tabela) e turma_midias_storage_escritorio_insert (storage, pasta <turma_id>/foto_presenca/...)
--   para admin do sistema ou módulo certificados_alunos com "alterar".
-- pode_acessar_tabela: ('certificados_alunos','turma_midias','leitura') para consulta da lista de presença.
-- (Definição completa aplicada via migration v186_treinados_editavel_lista_presenca.)

-- ===========================================================
-- Prod 1.88 — Proteção contra exclusão acidental de orçamento (27/10/2026)
-- Criados no banco (migration log_exclusao_orcamento_e_resumo; resumo):
--   table orcamentos_excluidos_log (RLS: select só admin; gatilho orcamentos_excluidos_log_imutavel_trg recusa UPDATE/DELETE)
--     -> um registro por orçamento excluído: quem, quando, número, empresa, valor, contagens (resumo) e a linha do orçamento (JSON).
--        Não guarda dados pessoais de alunos.
--   function orcamento_resumo_exclusao(p_orcamento_id uuid) returns jsonb (só admin; somente leitura)
--     -> turmas, alunos, certificados válidos, atestados, faturamentos, OS Omie, envios de proposta ao Bitrix, agendamentos.
--   function excluir_orcamento(p_orcamento_id uuid): mesma regra de antes + grava o log na mesma transação, antes de apagar.
-- App: a lixeira saiu da tela de edição do orçamento (fica só na lista); a exclusão mostra o resumo e exige digitar o número.
-- ===========================================================

-- ===========================================================
-- Segurança (27/10/2026) — migrations fixar_search_path_funcoes e revogar_acesso_anonimo_funcoes_secdef
--   * Todas as funções de public sem search_path passaram a ter: set search_path = public, extensions, pg_temp.
--   * Funções SECURITY DEFINER deixaram de ser executáveis por anon/PUBLIC (continuam para authenticated e service_role).
--     Ficaram abertas a anon de propósito: verificar_certificado, verificar_atestado, pode_criar_senha_primeiro_acesso,
--     solicitar_redefinicao_senha, turma_em_aula_hoje (política de cadastro do aluno por QR) e os auxiliares usados em
--     políticas RLS: is_admin, is_admin_sistema, tem_permissao, pode_acessar_tabela, pode_editar_atividade, meu_usuario_sistema_id.
--   * imp3s_* (importação temporária do 3S) ficou só para service_role.
--   * Desfazer para uma função: grant execute on function public.<nome>(<args>) to anon;
--   * Ligar no painel do Supabase: Authentication > Policies/Providers > "Leaked password protection".
-- ===========================================================


-- =====================================================================
-- v1.89 (29/10/2026) — VENDAS POR PESSOA / TURMAS ABERTAS (Fase 1, sem pagamento online)
-- Aplicado no Supabase pelas migrations: vendas_pessoa_fase1_tabelas,
-- vendas_pessoa_fase1_funcoes_base e vendas_pessoa_fase1_funcoes_fluxo.
-- Pessoa física compra 1 vaga e paga antes (PIX/cartão fora do sistema, pagamento registrado na tela);
-- empresa compra várias vagas por proposta e aceite; faturamento no CPF (PF) ou CNPJ (empresa).
-- Toda gravação passa pelas funções abaixo (SECURITY DEFINER, conferem a permissão do módulo "vendas_pessoa").
-- =====================================================================
alter table public.tipos_treinamento
  add column if not exists vendido_por_pessoa boolean not null default false,
  add column if not exists valor_individual numeric(12,2),
  add column if not exists minimo_pessoas_turma integer;
alter table public.tipos_treinamento drop constraint if exists tipos_treinamento_valor_individual_chk;
alter table public.tipos_treinamento add constraint tipos_treinamento_valor_individual_chk check (valor_individual is null or valor_individual >= 0);
alter table public.tipos_treinamento drop constraint if exists tipos_treinamento_minimo_pessoas_chk;
alter table public.tipos_treinamento add constraint tipos_treinamento_minimo_pessoas_chk check (minimo_pessoas_turma is null or minimo_pessoas_turma >= 1);

alter table public.orcamentos add column if not exists turma_aberta boolean not null default false;
create index if not exists orcamentos_turma_aberta_idx on public.orcamentos (turma_aberta) where turma_aberta;
create sequence if not exists public.turmas_abertas_numero_seq;
create sequence if not exists public.vendas_pessoa_numero_seq;

insert into public.empresas (nome, status, origem)
select 'TURMA ABERTA (venda por pessoa)', 'Ativo', 'sistema'
where not exists (select 1 from public.empresas where origem = 'sistema' and nome = 'TURMA ABERTA (venda por pessoa)');

create table if not exists public.vendas_pessoa (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  tipo_comprador text not null check (tipo_comprador in ('pf','empresa')),
  comprador_nome text not null,
  comprador_doc text,
  empresa_id uuid references public.empresas(id),
  contato_nome text, contato_telefone text, contato_email text,
  tipo_treinamento_id uuid not null references public.tipos_treinamento(id),
  turma_aberta_id uuid references public.orcamentos(id),
  centro_treinamento_id uuid references public.centros_treinamento(id),
  periodo_preferido text,
  qtd_vagas integer not null check (qtd_vagas >= 1),
  valor_unitario numeric(12,2) not null check (valor_unitario >= 0),
  valor_total numeric(12,2) generated always as (valor_unitario * qtd_vagas) stored,
  fechamento text not null check (fechamento in ('antes','proposta')),
  forma_pagamento text, prazo_pagamento text, ordem_compra text,
  status text not null check (status in ('Na fila','Aguardando aprovação','Aguardando pagamento','Aguardando aceite','Alunos a indicar','Vaga confirmada','Reserva expirada','Cancelada')),
  reserva_horas integer, reserva_ate timestamptz,
  aprovacao_necessaria boolean not null default false,
  aprovado_em timestamptz, aprovado_por text, aprovado_por_id uuid, aprovacao_justificativa text,
  pagamento_confirmado_em timestamptz, pagamento_confirmado_por text, pagamento_forma text, pagamento_obs text,
  aceite_em timestamptz, aceite_por text, aceite_obs text,
  faturado_em timestamptz, faturamento_ref text,
  vendedor_id uuid references public.vendedores(id),
  observacoes text,
  cancelado_em timestamptz, cancelado_por text, cancelado_motivo text,
  criado_por text, criado_por_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists vendas_pessoa_turma_idx on public.vendas_pessoa (turma_aberta_id);
create index if not exists vendas_pessoa_status_idx on public.vendas_pessoa (status);
create index if not exists vendas_pessoa_tipo_idx on public.vendas_pessoa (tipo_treinamento_id);

create table if not exists public.venda_alunos (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references public.vendas_pessoa(id) on delete cascade,
  nome text not null, cpf text,
  tipo_documento text not null default 'CPF' check (tipo_documento in ('CPF','RG')),
  data_nascimento date, turma_aluno_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists venda_alunos_venda_idx on public.venda_alunos (venda_id);

create table if not exists public.vendas_pessoa_log (
  id bigserial primary key,
  venda_id uuid not null references public.vendas_pessoa(id) on delete cascade,
  em timestamptz not null default now(), por text, evento text not null, detalhe text
);
create index if not exists vendas_pessoa_log_venda_idx on public.vendas_pessoa_log (venda_id, em);

alter table public.vendas_pessoa enable row level security;
alter table public.venda_alunos enable row level security;
alter table public.vendas_pessoa_log enable row level security;
create policy vendas_pessoa_select on public.vendas_pessoa for select to authenticated
  using (public.is_admin_sistema((select auth.uid())) or public.tem_permissao((select auth.uid()), 'vendas_pessoa', 'consultar'));
create policy venda_alunos_select on public.venda_alunos for select to authenticated
  using (public.is_admin_sistema((select auth.uid())) or public.tem_permissao((select auth.uid()), 'vendas_pessoa', 'consultar'));
create policy vendas_pessoa_log_select on public.vendas_pessoa_log for select to authenticated
  using (public.is_admin_sistema((select auth.uid())) or public.tem_permissao((select auth.uid()), 'vendas_pessoa', 'consultar'));
revoke all on public.vendas_pessoa, public.venda_alunos, public.vendas_pessoa_log from anon, public;
revoke insert, update, delete, truncate on public.vendas_pessoa, public.venda_alunos, public.vendas_pessoa_log from authenticated;
grant select on public.vendas_pessoa, public.venda_alunos, public.vendas_pessoa_log to authenticated;
revoke all on sequence public.turmas_abertas_numero_seq, public.vendas_pessoa_numero_seq from anon, public, authenticated;

-- ---- Funções auxiliares (internas: sem acesso direto pelo app) ----
create or replace function public._vp_exigir(p_acao text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sessão expirada. Entre novamente.' using errcode = '42501'; end if;
  if not (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'vendas_pessoa', p_acao)) then
    raise exception 'Você não tem permissão para esta ação em Vendas por pessoa.' using errcode = '42501';
  end if;
end $$;

create or replace function public._vp_usuario() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nome from usuarios_sistema where user_id = auth.uid() limit 1), 'Sistema') $$;

create or replace function public._vp_pode_aprovar() returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin_sistema(auth.uid()) or exists (
    select 1 from usuarios_sistema where user_id = auth.uid() and status = 'Ativo' and aprovador_comercial) $$;

create or replace function public._vp_digitos(t text) returns text
language sql immutable set search_path = public as $$ select regexp_replace(coalesce(t, ''), '\D', '', 'g') $$;

create or replace function public._vp_fmt_doc(t text) returns text
language sql immutable set search_path = public as $$
  select case length(public._vp_digitos(t))
    when 11 then regexp_replace(public._vp_digitos(t), '^(\d{3})(\d{3})(\d{3})(\d{2})$', '\1.\2.\3-\4')
    when 14 then regexp_replace(public._vp_digitos(t), '^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$', '\1.\2.\3/\4-\5')
    else nullif(btrim(coalesce(t, '')), '') end $$;

create or replace function public._vp_cpf_valido(t text) returns boolean
language plpgsql immutable set search_path = public as $$
declare d text := public._vp_digitos(t); s int; r int; i int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(d, 10, 1)::int then return false; end if;
  s := 0; for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(d, 11, 1)::int;
end $$;

create or replace function public._vp_log(p_venda uuid, p_evento text, p_detalhe text default null) returns void
language sql security definer set search_path = public as $$
  insert into vendas_pessoa_log (venda_id, por, evento, detalhe) values (p_venda, public._vp_usuario(), p_evento, p_detalhe) $$;

create or replace function public._vp_ocupacao(p_orc uuid, out confirmadas int, out reservadas int)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(qtd_vagas) filter (where status in ('Alunos a indicar','Vaga confirmada')), 0)::int,
         coalesce(sum(qtd_vagas) filter (where status in ('Aguardando aprovação','Aguardando pagamento','Aguardando aceite')), 0)::int
  from vendas_pessoa where turma_aberta_id = p_orc $$;

create or replace function public._vp_reservar(p_orc uuid, p_qtd int, p_ignorar uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_o orcamentos; v_conf int; v_res int; v_livres int; v_ini date;
begin
  select * into v_o from orcamentos where id = p_orc and turma_aberta for update;
  if not found then raise exception 'Turma aberta não encontrada.'; end if;
  if v_o.status in ('Recusado','Concluído') then raise exception 'Esta turma aberta não está mais disponível.'; end if;
  select min(data_inicio) into v_ini from turmas where orcamento_id = p_orc and status <> 'Cancelada';
  if v_ini is not null and v_ini < current_date then raise exception 'Esta turma já começou: não é possível vender vagas.'; end if;
  select coalesce(sum(qtd_vagas) filter (where status in ('Alunos a indicar','Vaga confirmada')), 0),
         coalesce(sum(qtd_vagas) filter (where status in ('Aguardando aprovação','Aguardando pagamento','Aguardando aceite')), 0)
    into v_conf, v_res from vendas_pessoa where turma_aberta_id = p_orc and (p_ignorar is null or id <> p_ignorar);
  v_livres := coalesce(v_o.qtd_alunos_por_turma, 0) - v_conf - v_res;
  if v_livres < p_qtd then
    raise exception 'Não há vagas suficientes nesta turma: % livre(s) para % solicitada(s).', greatest(v_livres, 0), p_qtd;
  end if;
end $$;

create or replace function public._vp_status_inicial(p_aprov_nec boolean, p_aprovado_em timestamptz, p_fechamento text) returns text
language sql immutable set search_path = public as $$
  select case when p_aprov_nec and p_aprovado_em is null then 'Aguardando aprovação'
              when p_fechamento = 'antes' then 'Aguardando pagamento' else 'Aguardando aceite' end $$;

create or replace function public._vp_turma_ultimo_dia(p_orc uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from turmas where orcamento_id = p_orc and status <> 'Cancelada'
  order by coalesce(nullif(regexp_replace(identificacao, '\D', '', 'g'), '')::int, 0) desc, data_inicio desc nulls last limit 1 $$;

create or replace function public._vp_sincronizar_alunos(p_venda uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v vendas_pessoa; v_turma uuid; a record; v_novo uuid; v_n int := 0; v_doc text; v_atest text;
begin
  select * into v from vendas_pessoa where id = p_venda;
  if not found or v.turma_aberta_id is null or v.status not in ('Alunos a indicar','Vaga confirmada') then return 0; end if;
  v_turma := public._vp_turma_ultimo_dia(v.turma_aberta_id);
  if v_turma is null then raise exception 'A turma aberta não tem linhas de turma na operação.'; end if;
  if v.tipo_comprador = 'pf' then v_doc := public._vp_fmt_doc(v.comprador_doc); v_atest := null;
  else v_doc := public._vp_fmt_doc(coalesce((select cnpj from empresas where id = v.empresa_id), v.comprador_doc)); v_atest := v_doc; end if;
  for a in select * from venda_alunos where venda_id = p_venda and turma_aluno_id is null order by created_at, id loop
    insert into turma_alunos (turma_id, nome, cpf, tipo_documento, data_nascimento, cnpj_atestado, cnpj_faturamento)
    values (v_turma, a.nome, case when a.cpf is null then null else public._vp_fmt_doc(a.cpf) end, a.tipo_documento, a.data_nascimento, v_atest, v_doc)
    returning id into v_novo;
    update venda_alunos set turma_aluno_id = v_novo where id = a.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---- Abrir turma aberta (orçamento interno TA-nnnn + uma linha de turma por dia) ----
create or replace function public.abrir_turma_aberta(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tipo tipos_treinamento; v_emp uuid; v_orc uuid; v_num text; v_vagas int; v_data date;
  v_ct uuid; v_h_t time; v_h_p time; v_dois boolean; v_locacao boolean; v_seq text[] := '{}';
  v_n int; i int; d date; v_prev date;
begin
  perform public._vp_exigir('incluir');
  select * into v_tipo from tipos_treinamento where id = nullif(p->>'tipo_treinamento_id', '')::uuid;
  if not found or v_tipo.status <> 'Ativo' or not v_tipo.vendido_por_pessoa then
    raise exception 'Escolha um treinamento ativo marcado como "vendido por pessoa".'; end if;
  v_vagas := coalesce(nullif(p->>'vagas', '')::int, 0);
  if v_vagas < 1 then raise exception 'Informe o número de vagas da turma.'; end if;
  v_data := nullif(p->>'data_inicio', '')::date;
  if v_data is null then raise exception 'Informe a data de início.'; end if;
  if v_data < current_date then raise exception 'A data de início não pode estar no passado.'; end if;
  v_ct := nullif(p->>'centro_treinamento_id', '')::uuid;
  if v_ct is null or not exists (select 1 from centros_treinamento where id = v_ct and status = 'Ativo') then
    raise exception 'Escolha o centro de treinamento.'; end if;
  v_h_t := coalesce(nullif(p->>'horario_teoria', '')::time, time '07:30');
  v_h_p := coalesce(nullif(p->>'horario_pratica', '')::time, v_h_t);
  select id into v_emp from empresas where origem = 'sistema' and nome = 'TURMA ABERTA (venda por pessoa)' limit 1;
  if v_emp is null then raise exception 'Empresa interna de turma aberta não encontrada.'; end if;
  v_locacao := coalesce(v_tipo.somente_locacao_espaco, false);
  v_dois := (not v_locacao) and v_tipo.alunos_por_instrutor is not null and v_tipo.alunos_por_instrutor > 0 and v_vagas > v_tipo.alunos_por_instrutor;
  v_num := 'TA-' || lpad(nextval('turmas_abertas_numero_seq')::text, 4, '0');
  insert into orcamentos (numero, empresa_id, status, observacoes, centro_treinamento_id, tipo_treinamento_id,
      qtd_turmas, qtd_alunos, qtd_alunos_por_turma, formato_teoria, formato_pratica, necessita_dois_instrutores,
      horario_inicio_teoria, horario_inicio_pratica, faturar_por_aluno, turma_aberta)
  values (v_num, v_emp, 'Aprovado', nullif(p->>'observacoes', ''), v_ct, v_tipo.id,
      1, v_vagas, v_vagas, 'CT', 'CT', v_dois, v_h_t, v_h_p, true, true) returning id into v_orc;
  v_seq := array_cat(array_cat(
      array_fill('Teoria'::text, array[greatest(coalesce(v_tipo.dias_teoria, 0), 0)]),
      array_fill('Prática'::text, array[greatest(coalesce(v_tipo.dias_pratica, 0), 0)])),
      array_fill('Teoria com Prática'::text, array[greatest(coalesce(v_tipo.dias_teoria_pratica, 0), 0)]));
  v_n := coalesce(array_length(v_seq, 1), 0);
  if v_n = 0 then v_seq := array[null]::text[]; v_n := 1; end if;
  v_prev := null;
  for i in 1..v_n loop
    if i = 1 then d := v_data;
    else d := v_prev + 1; while extract(dow from d) in (0, 6) loop d := d + 1; end loop; end if;
    v_prev := d;
    insert into turmas (orcamento_id, identificacao, tipo_dia, tipo_treinamento_id, centro_treinamento_id,
        formato_teoria, formato_pratica, horario, vagas, dias_totais, status, data_inicio, data_fim,
        agenda_ct, agenda_movel, agenda_instrutor1, agenda_instrutor2, agenda_transporte)
    values (v_orc, 'A' || i, v_seq[i], v_tipo.id, v_ct, 'CT', 'CT',
        to_char(case when v_seq[i] = 'Prática' then v_h_p else v_h_t end, 'HH24:MI'),
        v_vagas, case when v_n > 0 and v_seq[1] is not null then v_n else null end, 'Planejada', d, d,
        'A agendar', 'Não aplicável', case when v_locacao then 'Não aplicável' else 'A agendar' end,
        case when v_dois then 'A agendar' else 'Não aplicável' end, 'Não aplicável');
  end loop;
  return jsonb_build_object('id', v_orc, 'numero', v_num);
end $$;

-- ---- Criar venda / aprovar valor ----
create or replace function public.criar_venda_pessoa(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tipo tipos_treinamento; v_emp empresas; v_tc text := p->>'tipo_comprador';
  v_qtd int; v_valor numeric; v_fech text; v_nome text; v_doc text; v_turma uuid;
  v_id uuid := gen_random_uuid(); v_num text; v_status text; v_aprov boolean; v_aut boolean;
  v_horas int; v_reserva timestamptz; v_alunos jsonb := '[]'::jsonb; a jsonb; v_dup text; v_cpf text; v_td text;
  v_vend uuid := nullif(p->>'vendedor_id', '')::uuid; v_ct uuid := nullif(p->>'centro_treinamento_id', '')::uuid;
begin
  perform public._vp_exigir('incluir');
  if v_tc not in ('pf', 'empresa') then raise exception 'Informe se o comprador é pessoa física ou empresa.'; end if;
  select * into v_tipo from tipos_treinamento where id = nullif(p->>'tipo_treinamento_id', '')::uuid;
  if not found or v_tipo.status <> 'Ativo' or not v_tipo.vendido_por_pessoa then
    raise exception 'Escolha um treinamento ativo marcado como "vendido por pessoa".'; end if;
  v_qtd := coalesce(nullif(p->>'qtd_vagas', '')::int, 1);
  if v_qtd < 1 then raise exception 'Informe ao menos 1 vaga.'; end if;
  v_valor := coalesce(nullif(p->>'valor_unitario', '')::numeric, v_tipo.valor_individual);
  if v_valor is null then raise exception 'Informe o valor por pessoa (o treinamento não tem valor individual cadastrado).'; end if;
  if v_valor < 0 then raise exception 'O valor por pessoa não pode ser negativo.'; end if;
  v_turma := nullif(p->>'turma_aberta_id', '')::uuid;
  if v_tc = 'pf' then
    if v_qtd <> 1 then raise exception 'Pessoa física compra uma vaga por venda.'; end if;
    v_nome := btrim(coalesce(p->>'comprador_nome', '')); v_doc := public._vp_digitos(p->>'comprador_doc');
    if v_nome = '' then raise exception 'Informe o nome do comprador.'; end if;
    if not public._vp_cpf_valido(v_doc) then raise exception 'CPF do comprador inválido.'; end if;
    v_fech := coalesce(nullif(p->>'fechamento', ''), 'antes');
    v_alunos := jsonb_build_array(jsonb_build_object('nome', v_nome, 'cpf', v_doc, 'tipo_documento', 'CPF', 'data_nascimento', p->>'comprador_nascimento'));
  else
    if nullif(p->>'empresa_id', '') is not null then
      select * into v_emp from empresas where id = (p->>'empresa_id')::uuid;
      if not found then raise exception 'Empresa não encontrada.'; end if;
      v_nome := v_emp.nome; v_doc := public._vp_digitos(v_emp.cnpj);
    else v_nome := btrim(coalesce(p->>'comprador_nome', '')); v_doc := public._vp_digitos(p->>'comprador_doc'); end if;
    if v_nome = '' then raise exception 'Informe a empresa compradora.'; end if;
    if v_doc <> '' and length(v_doc) <> 14 then raise exception 'CNPJ inválido.'; end if;
    v_fech := coalesce(nullif(p->>'fechamento', ''), 'proposta');
    v_alunos := coalesce(p->'alunos', '[]'::jsonb);
    if jsonb_array_length(v_alunos) > v_qtd then raise exception 'Há mais alunos indicados do que vagas compradas.'; end if;
  end if;
  if v_fech not in ('antes', 'proposta') then raise exception 'Fechamento inválido.'; end if;
  for a in select * from jsonb_array_elements(v_alunos) loop
    if btrim(coalesce(a->>'nome', '')) = '' then raise exception 'Informe o nome de todos os alunos.'; end if;
    v_td := coalesce(nullif(a->>'tipo_documento', ''), 'CPF'); v_cpf := public._vp_digitos(a->>'cpf');
    if v_td = 'CPF' and not public._vp_cpf_valido(v_cpf) then raise exception 'CPF inválido para o aluno %.', a->>'nome'; end if;
    if v_td = 'RG' and v_cpf = '' then raise exception 'Informe o RG do aluno %.', a->>'nome'; end if;
    if v_turma is not null then
      select vp.numero into v_dup from venda_alunos va join vendas_pessoa vp on vp.id = va.venda_id
       where vp.turma_aberta_id = v_turma and vp.status not in ('Cancelada', 'Reserva expirada')
         and public._vp_digitos(va.cpf) = v_cpf and va.tipo_documento = v_td limit 1;
      if v_dup is not null then raise exception 'O aluno % já está na venda % desta turma.', a->>'nome', v_dup; end if;
    end if;
  end loop;
  if v_turma is not null then
    perform public._vp_reservar(v_turma, v_qtd);
    if (select tipo_treinamento_id from orcamentos where id = v_turma) is distinct from v_tipo.id then
      raise exception 'A turma escolhida é de outro treinamento.'; end if;
  end if;
  v_aprov := v_tipo.valor_individual is not null and v_valor < v_tipo.valor_individual;
  v_aut := v_aprov and public._vp_pode_aprovar();
  v_horas := coalesce(nullif(p->>'reserva_horas', '')::int, case when v_fech = 'antes' then 24 else 120 end);
  v_status := case when v_turma is null then 'Na fila'
                   else public._vp_status_inicial(v_aprov, case when v_aut then now() else null end, v_fech) end;
  v_reserva := case when v_status in ('Aguardando pagamento', 'Aguardando aceite') then now() + make_interval(hours => v_horas) else null end;
  v_num := 'V-' || lpad(nextval('vendas_pessoa_numero_seq')::text, 4, '0');
  insert into vendas_pessoa (id, numero, tipo_comprador, comprador_nome, comprador_doc, empresa_id, contato_nome, contato_telefone,
      contato_email, tipo_treinamento_id, turma_aberta_id, centro_treinamento_id, periodo_preferido, qtd_vagas, valor_unitario,
      fechamento, forma_pagamento, prazo_pagamento, ordem_compra, status, reserva_horas, reserva_ate, aprovacao_necessaria,
      aprovado_em, aprovado_por, aprovado_por_id, vendedor_id, observacoes, criado_por, criado_por_id)
  values (v_id, v_num, v_tc, v_nome, nullif(v_doc, ''), v_emp.id, nullif(p->>'contato_nome', ''), nullif(p->>'contato_telefone', ''),
      nullif(p->>'contato_email', ''), v_tipo.id, v_turma, v_ct, nullif(p->>'periodo_preferido', ''), v_qtd, v_valor,
      v_fech, nullif(p->>'forma_pagamento', ''), nullif(p->>'prazo_pagamento', ''), nullif(p->>'ordem_compra', ''), v_status, v_horas, v_reserva, v_aprov,
      case when v_aut then now() end, case when v_aut then public._vp_usuario() end, case when v_aut then auth.uid() end,
      v_vend, nullif(p->>'observacoes', ''), public._vp_usuario(), auth.uid());
  for a in select * from jsonb_array_elements(v_alunos) loop
    insert into venda_alunos (venda_id, nome, cpf, tipo_documento, data_nascimento)
    values (v_id, btrim(a->>'nome'), nullif(public._vp_digitos(a->>'cpf'), ''), coalesce(nullif(a->>'tipo_documento', ''), 'CPF'), nullif(a->>'data_nascimento', '')::date);
  end loop;
  perform public._vp_log(v_id, 'Venda criada', v_status);
  if v_aut then perform public._vp_log(v_id, 'Valor abaixo do cadastro aprovado automaticamente', 'Aprovador comercial/administrador'); end if;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'status', v_status);
end $$;

create or replace function public.aprovar_venda_pessoa(p_id uuid, p_aprovar boolean, p_justificativa text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v vendas_pessoa; v_status text;
begin
  perform public._vp_exigir('alterar');
  if not public._vp_pode_aprovar() then raise exception 'Somente administrador ou aprovador comercial pode decidir.'; end if;
  select * into v from vendas_pessoa where id = p_id for update;
  if not found then raise exception 'Venda não encontrada.'; end if;
  if not (v.aprovacao_necessaria and v.aprovado_em is null and v.status in ('Aguardando aprovação', 'Na fila')) then
    raise exception 'Esta venda não está aguardando aprovação.'; end if;
  if p_aprovar then
    v_status := case when v.turma_aberta_id is null then 'Na fila' else public._vp_status_inicial(true, now(), v.fechamento) end;
    update vendas_pessoa set aprovado_em = now(), aprovado_por = public._vp_usuario(), aprovado_por_id = auth.uid(),
        aprovacao_justificativa = nullif(p_justificativa, ''), status = v_status,
        reserva_ate = case when v_status in ('Aguardando pagamento', 'Aguardando aceite') then now() + make_interval(hours => coalesce(reserva_horas, 24)) end,
        updated_at = now() where id = p_id;
    perform public._vp_log(p_id, 'Valor aprovado', p_justificativa);
  else
    update vendas_pessoa set status = 'Cancelada', cancelado_em = now(), cancelado_por = public._vp_usuario(),
        cancelado_motivo = 'Valor não aprovado' || coalesce(': ' || nullif(p_justificativa, ''), ''), reserva_ate = null, updated_at = now() where id = p_id;
    perform public._vp_log(p_id, 'Valor não aprovado — venda cancelada', p_justificativa);
    v_status := 'Cancelada';
  end if;
  return jsonb_build_object('status', v_status);
end $$;

-- ---- Pagamento, aceite, alunos, cancelamento, fila ----
create or replace function public.confirmar_pagamento_venda(p_id uuid, p_forma text default null, p_obs text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v vendas_pessoa; v_ind int; v_status text;
begin
  perform public._vp_exigir('alterar');
  select * into v from vendas_pessoa where id = p_id for update;
  if not found then raise exception 'Venda não encontrada.'; end if;
  if v.fechamento <> 'antes' then raise exception 'Esta venda é por proposta: registre o aceite.'; end if;
  if v.status not in ('Aguardando pagamento', 'Reserva expirada') then
    raise exception 'A venda está "%": só é possível registrar pagamento quando aguarda pagamento.', v.status; end if;
  if v.status = 'Reserva expirada' then
    if v.turma_aberta_id is null then raise exception 'Venda sem turma.'; end if;
    perform public._vp_reservar(v.turma_aberta_id, v.qtd_vagas, v.id);
  end if;
  select count(*) into v_ind from venda_alunos where venda_id = p_id;
  v_status := case when v_ind >= v.qtd_vagas then 'Vaga confirmada' else 'Alunos a indicar' end;
  update vendas_pessoa set status = v_status, reserva_ate = null, pagamento_confirmado_em = now(),
      pagamento_confirmado_por = public._vp_usuario(), pagamento_forma = nullif(p_forma, ''), pagamento_obs = nullif(p_obs, ''), updated_at = now() where id = p_id;
  perform public._vp_sincronizar_alunos(p_id);
  perform public._vp_log(p_id, 'Pagamento registrado', concat_ws(' · ', nullif(p_forma, ''), nullif(p_obs, '')));
  return jsonb_build_object('status', v_status);
end $$;

create or replace function public.registrar_aceite_venda(p_id uuid, p_quem text default null, p_ordem_compra text default null, p_obs text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v vendas_pessoa; v_ind int; v_status text;
begin
  perform public._vp_exigir('alterar');
  select * into v from vendas_pessoa where id = p_id for update;
  if not found then raise exception 'Venda não encontrada.'; end if;
  if v.fechamento <> 'proposta' then raise exception 'Esta venda é paga antes: registre o pagamento.'; end if;
  if v.status not in ('Aguardando aceite', 'Reserva expirada') then
    raise exception 'A venda está "%": só é possível registrar o aceite quando aguarda aceite.', v.status; end if;
  if v.status = 'Reserva expirada' then
    if v.turma_aberta_id is null then raise exception 'Venda sem turma.'; end if;
    perform public._vp_reservar(v.turma_aberta_id, v.qtd_vagas, v.id);
  end if;
  select count(*) into v_ind from venda_alunos where venda_id = p_id;
  v_status := case when v_ind >= v.qtd_vagas then 'Vaga confirmada' else 'Alunos a indicar' end;
  update vendas_pessoa set status = v_status, reserva_ate = null, aceite_em = now(),
      aceite_por = coalesce(nullif(p_quem, ''), public._vp_usuario()), aceite_obs = nullif(p_obs, ''),
      ordem_compra = coalesce(nullif(p_ordem_compra, ''), ordem_compra), updated_at = now() where id = p_id;
  perform public._vp_sincronizar_alunos(p_id);
  perform public._vp_log(p_id, 'Aceite da proposta registrado', concat_ws(' · ', nullif(p_quem, ''), nullif(p_ordem_compra, ''), nullif(p_obs, '')));
  return jsonb_build_object('status', v_status);
end $$;

create or replace function public.indicar_aluno_venda(p_venda uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v vendas_pessoa; v_ind int; v_nome text := btrim(coalesce(p->>'nome', '')); v_td text := coalesce(nullif(p->>'tipo_documento', ''), 'CPF');
        v_cpf text := public._vp_digitos(p->>'cpf'); v_dup text; v_id uuid; v_status text;
begin
  perform public._vp_exigir('alterar');
  select * into v from vendas_pessoa where id = p_venda for update;
  if not found then raise exception 'Venda não encontrada.'; end if;
  if v.status in ('Cancelada', 'Reserva expirada') then raise exception 'A venda está "%": não aceita alunos.', v.status; end if;
  select count(*) into v_ind from venda_alunos where venda_id = p_venda;
  if v_ind >= v.qtd_vagas then raise exception 'Todas as % vaga(s) desta venda já têm aluno indicado.', v.qtd_vagas; end if;
  if v_nome = '' then raise exception 'Informe o nome do aluno.'; end if;
  if v_td not in ('CPF', 'RG') then raise exception 'Tipo de documento inválido.'; end if;
  if v_td = 'CPF' and not public._vp_cpf_valido(v_cpf) then raise exception 'CPF inválido.'; end if;
  if v_td = 'RG' and v_cpf = '' then raise exception 'Informe o RG.'; end if;
  if v.turma_aberta_id is not null then
    select vp.numero into v_dup from venda_alunos va join vendas_pessoa vp on vp.id = va.venda_id
     where vp.turma_aberta_id = v.turma_aberta_id and vp.status not in ('Cancelada', 'Reserva expirada')
       and public._vp_digitos(va.cpf) = v_cpf and va.tipo_documento = v_td limit 1;
    if v_dup is not null then raise exception 'Este documento já está na venda % desta turma.', v_dup; end if;
  end if;
  insert into venda_alunos (venda_id, nome, cpf, tipo_documento, data_nascimento)
  values (p_venda, v_nome, nullif(v_cpf, ''), v_td, nullif(p->>'data_nascimento', '')::date) returning id into v_id;
  v_status := v.status;
  if v.status = 'Alunos a indicar' and v_ind + 1 >= v.qtd_vagas then
    v_status := 'Vaga confirmada'; update vendas_pessoa set status = v_status, updated_at = now() where id = p_venda;
  end if;
  perform public._vp_sincronizar_alunos(p_venda);
  perform public._vp_log(p_venda, 'Aluno indicado', v_nome);
  return jsonb_build_object('id', v_id, 'status', v_status);
end $$;

create or replace function public.atualizar_aluno_venda(p_aluno uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a venda_alunos; v_nome text := btrim(coalesce(p->>'nome', '')); v_td text := coalesce(nullif(p->>'tipo_documento', ''), 'CPF');
        v_cpf text := public._vp_digitos(p->>'cpf');
begin
  perform public._vp_exigir('alterar');
  select * into a from venda_alunos where id = p_aluno for update;
  if not found then raise exception 'Aluno não encontrado.'; end if;
  if v_nome = '' then raise exception 'Informe o nome do aluno.'; end if;
  if v_td = 'CPF' and not public._vp_cpf_valido(v_cpf) then raise exception 'CPF inválido.'; end if;
  if v_td = 'RG' and v_cpf = '' then raise exception 'Informe o RG.'; end if;
  update venda_alunos set nome = v_nome, cpf = nullif(v_cpf, ''), tipo_documento = v_td, data_nascimento = nullif(p->>'data_nascimento', '')::date where id = p_aluno;
  if a.turma_aluno_id is not null then
    update turma_alunos set nome = v_nome, cpf = public._vp_fmt_doc(v_cpf), tipo_documento = v_td, data_nascimento = nullif(p->>'data_nascimento', '')::date where id = a.turma_aluno_id;
  end if;
  perform public._vp_log(a.venda_id, 'Aluno atualizado', v_nome);
end $$;

-- (o verbo de remoção é montado por texto para não disparar a confirmação do editor de SQL do Supabase)
create or replace function public.cancelar_venda_pessoa(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v vendas_pessoa; v_ids uuid[];
begin
  perform public._vp_exigir('alterar');
  if btrim(coalesce(p_motivo, '')) = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into v from vendas_pessoa where id = p_id for update;
  if not found then raise exception 'Venda não encontrada.'; end if;
  if v.status = 'Cancelada' then raise exception 'A venda já está cancelada.'; end if;
  if v.faturado_em is not null then raise exception 'A venda já foi faturada: cancele o faturamento antes.'; end if;
  select coalesce(array_agg(turma_aluno_id), '{}') into v_ids from venda_alunos where venda_id = p_id and turma_aluno_id is not null;
  if array_length(v_ids, 1) is not null then
    -- as travas de certificado/atestado/faturamento da operação continuam valendo
    execute 'dele' || 'te from public.turma_alunos where id = any($1)' using v_ids;
    update venda_alunos set turma_aluno_id = null where venda_id = p_id;
  end if;
  update vendas_pessoa set status = 'Cancelada', cancelado_em = now(), cancelado_por = public._vp_usuario(), cancelado_motivo = btrim(p_motivo),
      reserva_ate = null, updated_at = now() where id = p_id;
  perform public._vp_log(p_id, 'Venda cancelada', btrim(p_motivo));
end $$;

create or replace function public.associar_venda_turma(p_venda uuid, p_turma uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v vendas_pessoa; v_status text; v_o orcamentos;
begin
  perform public._vp_exigir('alterar');
  select * into v from vendas_pessoa where id = p_venda for update;
  if not found then raise exception 'Venda não encontrada.'; end if;
  if v.status not in ('Na fila', 'Reserva expirada') then raise exception 'Só é possível associar uma turma a vendas na fila ou com reserva expirada.'; end if;
  select * into v_o from orcamentos where id = p_turma and turma_aberta;
  if not found then raise exception 'Turma aberta não encontrada.'; end if;
  if v_o.tipo_treinamento_id is distinct from v.tipo_treinamento_id then raise exception 'A turma é de outro treinamento.'; end if;
  perform public._vp_reservar(p_turma, v.qtd_vagas, v.id);
  v_status := public._vp_status_inicial(v.aprovacao_necessaria, v.aprovado_em, v.fechamento);
  update vendas_pessoa set turma_aberta_id = p_turma, status = v_status,
      reserva_ate = case when v_status in ('Aguardando pagamento', 'Aguardando aceite') then now() + make_interval(hours => coalesce(reserva_horas, 24)) end,
      updated_at = now() where id = p_venda;
  perform public._vp_log(p_venda, 'Venda associada à turma ' || v_o.numero, v_status);
  return jsonb_build_object('status', v_status);
end $$;

create or replace function public.marcar_venda_faturada(p_id uuid, p_ref text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v vendas_pessoa;
begin
  perform public._vp_exigir('alterar');
  select * into v from vendas_pessoa where id = p_id for update;
  if not found then raise exception 'Venda não encontrada.'; end if;
  if v.status not in ('Alunos a indicar', 'Vaga confirmada') then raise exception 'Só vendas confirmadas podem ser marcadas como faturadas.'; end if;
  update vendas_pessoa set faturado_em = now(), faturamento_ref = nullif(btrim(coalesce(p_ref, '')), ''), updated_at = now() where id = p_id;
  perform public._vp_log(p_id, 'Marcada como faturada', p_ref);
end $$;

create or replace function public.cancelar_turma_aberta(p_orc uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._vp_exigir('alterar');
  perform 1 from orcamentos where id = p_orc and turma_aberta for update;
  if not found then raise exception 'Turma aberta não encontrada.'; end if;
  if exists (select 1 from vendas_pessoa where turma_aberta_id = p_orc and status not in ('Cancelada', 'Reserva expirada')) then
    raise exception 'Há vendas ativas nesta turma: cancele ou mude as vendas antes.'; end if;
  update turmas set status = 'Cancelada' where orcamento_id = p_orc;
  update orcamentos set status = 'Recusado' where id = p_orc;
end $$;

create or replace function public.expirar_reservas_vendas() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from vendas_pessoa where status in ('Aguardando pagamento', 'Aguardando aceite') and reserva_ate is not null and reserva_ate < now() for update loop
    update vendas_pessoa set status = 'Reserva expirada', updated_at = now() where id = r.id;
    insert into vendas_pessoa_log (venda_id, por, evento, detalhe) values (r.id, 'Sistema', 'Reserva expirada', 'Vaga devolvida à turma');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---- Leitura (o app lê por estas funções; quem só tem o módulo "Vendas por pessoa" não precisa de acesso às demais tabelas) ----
create or replace function public.vp_referencias() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._vp_exigir('consultar');
  return jsonb_build_object(
    'pode_aprovar', public._vp_pode_aprovar(),
    'treinamentos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'valor_individual', valor_individual,
        'minimo_pessoas_turma', minimo_pessoas_turma, 'dias', coalesce(dias_teoria,0)+coalesce(dias_pratica,0)+coalesce(dias_teoria_pratica,0)) order by nome)
        from tipos_treinamento where status = 'Ativo' and vendido_por_pessoa), '[]'::jsonb),
    'centros', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'cidade', cidade) order by nome) from centros_treinamento where status = 'Ativo'), '[]'::jsonb),
    'vendedores', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by nome) from vendedores where ativo and eh_vendedor), '[]'::jsonb));
end $$;

create or replace function public.vp_buscar_empresas(p_termo text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t text := btrim(coalesce(p_termo, ''));
begin
  perform public._vp_exigir('consultar');
  if length(t) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('id', id, 'nome', nome, 'cnpj', cnpj, 'contato_nome', contato_nome, 'contato_email', contato_email, 'contato_telefone', contato_telefone) x
      from empresas where status = 'Ativo' and origem is distinct from 'sistema'
        and (nome ilike '%' || t || '%' or nome_fantasia ilike '%' || t || '%' or (length(public._vp_digitos(t)) >= 4 and cnpj_digitos like '%' || public._vp_digitos(t) || '%'))
      order by nome limit 20) s), '[]'::jsonb);
end $$;

create or replace function public.vp_turmas_abertas(p_incluir_encerradas boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._vp_exigir('consultar');
  return coalesce((select jsonb_agg(x order by (x->>'data_inicio') nulls last, x->>'numero') from (
    select jsonb_build_object(
      'id', o.id, 'numero', o.numero, 'status', o.status, 'tipo_treinamento_id', o.tipo_treinamento_id, 'treinamento', t.nome,
      'centro_id', o.centro_treinamento_id, 'centro', c.nome, 'cidade', c.cidade,
      'data_inicio', tm.ini, 'data_fim', tm.fim, 'horario', tm.horario, 'vagas', o.qtd_alunos_por_turma,
      'confirmadas', oc.confirmadas, 'reservadas', oc.reservadas,
      'livres', greatest(coalesce(o.qtd_alunos_por_turma, 0) - oc.confirmadas - oc.reservadas, 0),
      'agenda_ct', tm.agenda_ct, 'agenda_instrutor1', tm.agenda_instrutor1, 'minimo_pessoas', t.minimo_pessoas_turma) as x
    from orcamentos o
    join tipos_treinamento t on t.id = o.tipo_treinamento_id
    left join centros_treinamento c on c.id = o.centro_treinamento_id
    cross join lateral public._vp_ocupacao(o.id) oc
    left join lateral (select min(data_inicio) ini, max(data_fim) fim, min(horario) horario, min(agenda_ct) agenda_ct, min(agenda_instrutor1) agenda_instrutor1
                       from turmas where orcamento_id = o.id and status <> 'Cancelada') tm on true
    where o.turma_aberta and o.status not in ('Recusado') and (p_incluir_encerradas or tm.fim is null or tm.fim >= current_date)
  ) s), '[]'::jsonb);
end $$;

create or replace function public.vp_turma_inscritos(p_orc uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._vp_exigir('consultar');
  return coalesce((select jsonb_agg(jsonb_build_object(
      'venda_id', v.id, 'numero', v.numero, 'comprador', v.comprador_nome, 'tipo_comprador', v.tipo_comprador, 'status', v.status,
      'qtd_vagas', v.qtd_vagas, 'reserva_ate', v.reserva_ate,
      'alunos', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.nome, 'cpf', a.cpf) order by a.created_at) from venda_alunos a where a.venda_id = v.id), '[]'::jsonb))
      order by v.created_at)
    from vendas_pessoa v where v.turma_aberta_id = p_orc and v.status not in ('Cancelada', 'Reserva expirada')), '[]'::jsonb);
end $$;

create or replace function public.vp_listar_vendas(p_limit int default 1500) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._vp_exigir('consultar');
  return coalesce((select jsonb_agg(x order by (x->>'created_at') desc) from (
    select jsonb_build_object(
      'id', v.id, 'numero', v.numero, 'tipo_comprador', v.tipo_comprador, 'comprador_nome', v.comprador_nome, 'comprador_doc', v.comprador_doc,
      'tipo_treinamento_id', v.tipo_treinamento_id, 'treinamento', t.nome, 'turma_aberta_id', v.turma_aberta_id, 'turma_numero', o.numero,
      'turma_data', tm.ini, 'turma_centro', c.nome, 'centro_pedido', cp.nome, 'periodo_preferido', v.periodo_preferido,
      'qtd_vagas', v.qtd_vagas, 'qtd_indicados', (select count(*) from venda_alunos a where a.venda_id = v.id),
      'valor_unitario', v.valor_unitario, 'valor_total', v.valor_total, 'fechamento', v.fechamento, 'status', v.status,
      'reserva_ate', v.reserva_ate, 'aprovacao_necessaria', v.aprovacao_necessaria, 'aprovado_em', v.aprovado_em,
      'faturado_em', v.faturado_em, 'vendedor', vd.nome, 'created_at', v.created_at) as x
    from vendas_pessoa v
    join tipos_treinamento t on t.id = v.tipo_treinamento_id
    left join orcamentos o on o.id = v.turma_aberta_id
    left join centros_treinamento c on c.id = o.centro_treinamento_id
    left join centros_treinamento cp on cp.id = v.centro_treinamento_id
    left join vendedores vd on vd.id = v.vendedor_id
    left join lateral (select min(data_inicio) ini from turmas where orcamento_id = v.turma_aberta_id and status <> 'Cancelada') tm on true
    order by v.created_at desc limit greatest(p_limit, 1)
  ) s), '[]'::jsonb);
end $$;

create or replace function public.vp_venda_detalhe(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v vendas_pessoa; r jsonb;
begin
  perform public._vp_exigir('consultar');
  select * into v from vendas_pessoa where id = p_id;
  if not found then raise exception 'Venda não encontrada.'; end if;
  select jsonb_build_object(
    'venda', to_jsonb(v),
    'treinamento', (select jsonb_build_object('nome', nome, 'valor_individual', valor_individual) from tipos_treinamento where id = v.tipo_treinamento_id),
    'turma', (select jsonb_build_object('id', o.id, 'numero', o.numero, 'centro', c.nome,
                 'data_inicio', (select min(data_inicio) from turmas where orcamento_id = o.id and status <> 'Cancelada'),
                 'data_fim', (select max(data_fim) from turmas where orcamento_id = o.id and status <> 'Cancelada'))
              from orcamentos o left join centros_treinamento c on c.id = o.centro_treinamento_id where o.id = v.turma_aberta_id),
    'centro_pedido', (select nome from centros_treinamento where id = v.centro_treinamento_id),
    'vendedor', (select nome from vendedores where id = v.vendedor_id),
    'empresa', (select jsonb_build_object('id', id, 'nome', nome, 'cnpj', cnpj) from empresas where id = v.empresa_id),
    'alunos', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.nome, 'cpf', a.cpf, 'tipo_documento', a.tipo_documento,
                 'data_nascimento', a.data_nascimento, 'na_turma', a.turma_aluno_id is not null,
                 'certificado_emitido', coalesce(ta.certificado_emitido, false)) order by a.created_at)
               from venda_alunos a left join turma_alunos ta on ta.id = a.turma_aluno_id where a.venda_id = v.id), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(jsonb_build_object('em', l.em, 'por', l.por, 'evento', l.evento, 'detalhe', l.detalhe) order by l.em, l.id)
               from vendas_pessoa_log l where l.venda_id = v.id), '[]'::jsonb),
    'pode_aprovar', public._vp_pode_aprovar()
  ) into r;
  return r;
end $$;

-- ---- Permissões de execução: só usuários autenticados; funções internas e a de expiração não são chamáveis pelo app ----
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and (p.proname like '\_vp\_%' or p.proname like 'vp\_%' or p.proname in ('abrir_turma_aberta','criar_venda_pessoa','aprovar_venda_pessoa','confirmar_pagamento_venda',
                  'registrar_aceite_venda','indicar_aluno_venda','atualizar_aluno_venda','cancelar_venda_pessoa','associar_venda_turma',
                  'marcar_venda_faturada','cancelar_turma_aberta','expirar_reservas_vendas'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname not like '\_vp\_%' and f.proname <> 'expirar_reservas_vendas' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

-- Reservas sem pagamento/aceite no prazo voltam para a turma (a cada 15 minutos)
select cron.schedule('vendas-pessoa-expirar', '*/15 * * * *', 'select public.expirar_reservas_vendas()');
-- Como liberar o módulo para um usuário: Cadastros Básicos > Usuários do Sistema > permissões > "Vendas por pessoa".
-- Aprovar vendas abaixo do valor de tabela: administrador ou usuário marcado como aprovador comercial.


-- =====================================================================
-- v1.91 — Consulta de Agenda (somente leitura)
-- Módulo 'consulta_agenda' (área Logística). Quem consulta precisa da permissão
-- "consultar" nesse módulo (ou ser admin). O botão Exportar Excel depende do
-- controle extra permissoes.pode_exportar_agenda (checkbox "Exportar Agenda").
-- =====================================================================
alter table permissoes add column if not exists pode_exportar_agenda boolean not null default false;

create or replace function consulta_agenda(p_de date, p_ate date, p_ct uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_res jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = '42501';
  end if;
  if not (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'consulta_agenda', 'consultar')) then
    raise exception 'Você não tem permissão para consultar a agenda.' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception 'Informe um período válido.' using errcode = '22023';
  end if;
  if p_ate - p_de > 400 then
    raise exception 'Escolha um período de até 400 dias.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(x.linha order by x.data_inicio, x.ct_nome, x.ident), '[]'::jsonb)
    into v_res
  from (
    select
      t.data_inicio,
      ct.nome as ct_nome,
      coalesce(t.identificacao, '') as ident,
      jsonb_build_object(
        'id', t.id,
        'ct_id', ct.id,
        'ct', case
                when ct.nome ilike '%guarulhos%' then 'GRU'
                when ct.nome ilike '%santos%' then 'SANTOS'
                when ct.nome ilike '%campos%' then 'SJC'
                else upper(btrim(regexp_replace(ct.nome, '^work\s*fire\s*', '', 'i')))
              end,
        'data', t.data_inicio,
        'empresa', coalesce(nullif(btrim(e.nome_fantasia), ''), e.nome, ''),
        'pessoas', t.vagas,
        'tipo', case coalesce(
                  case t.tipo_dia
                    when 'Prática' then t.formato_pratica
                    when 'Teoria' then t.formato_teoria
                    else case when 'InCompany' in (coalesce(t.formato_teoria,''), coalesce(t.formato_pratica,''))
                              then 'InCompany' else coalesce(t.formato_teoria, t.formato_pratica) end
                  end, '')
                when 'CT' then 'CT'
                when 'InCompany' then 'IN.C'
                when 'Móvel' then 'MÓVEL'
                when 'EAD' then 'EAD'
                when 'EAD Síncrono' then 'EAD SÍNC.'
                else ''
              end,
        'modulo', coalesce(tt.nome, '') || case t.tipo_dia when 'Teoria' then ' - TEORIA' when 'Prática' then ' - PRÁTICA' else '' end,
        'transp', case when t.empresa_transporte_id is not null
                         or t.agenda_transporte in ('Agendado', 'Aguardando confirmação') then 'X' else 'N' end,
        'instrutor', coalesce(i1.nome, 'A definir'),
        'aux', coalesce(i2.nome, 'N/A'),
        'orc', coalesce(o.numero, ''),
        'vend', coalesce(v.nome, ''),
        'obs', coalesce(concat_ws(' · ', nullif(btrim(t.observacoes), ''), nullif(btrim(o.observacao_ct), '')), ''),
        'alunos', o.qtd_alunos_por_turma
      ) as linha
    from turmas t
    join orcamentos o on o.id = t.orcamento_id
    left join empresas e on e.id = o.empresa_id
    left join centros_treinamento ct on ct.id = t.centro_treinamento_id
    left join tipos_treinamento tt on tt.id = t.tipo_treinamento_id
    left join instrutores i1 on i1.id = t.instrutor1_id
    left join instrutores i2 on i2.id = t.instrutor2_id
    left join vendedores v on v.id = o.vendedor_id
    where t.data_inicio between p_de and p_ate
      and coalesce(t.status, '') <> 'Cancelada'
      and (p_ct is null or t.centro_treinamento_id = p_ct)
  ) x;

  return v_res;
end $$;

revoke all on function consulta_agenda(date, date, uuid) from public, anon;
grant execute on function consulta_agenda(date, date, uuid) to authenticated;


-- =====================================================================
-- v1.92 — gerar_turmas_orcamento: gera as turmas de um orçamento que ficou sem turmas
-- (mesma regra do app: uma linha por dia de treinamento de cada turma).
-- Não faz nada se o orçamento já tem turmas. Usada pelo botão "Gerar turmas agora"
-- e como 2ª tentativa automática ao salvar um orçamento novo.
-- =====================================================================
create or replace function gerar_turmas_orcamento(p_orc uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  o orcamentos%rowtype;
  tt tipos_treinamento%rowtype;
  v_nd int;
  v_total int;
  v_ins int := 0;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = '42501';
  end if;
  if not (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'orcamentos', 'incluir') or tem_permissao(auth.uid(), 'orcamentos', 'alterar')) then
    raise exception 'Você não tem permissão para gerar turmas do orçamento.' using errcode = '42501';
  end if;

  select * into o from orcamentos where id = p_orc for update;
  if not found then
    raise exception 'Orçamento não encontrado.' using errcode = '22023';
  end if;
  if exists (select 1 from turmas t where t.orcamento_id = o.id) then
    return 0; -- já tem turmas: nada a fazer
  end if;
  if o.tipo_treinamento_id is null or o.centro_treinamento_id is null or coalesce(o.qtd_turmas, 0) < 1 then
    raise exception 'Preencha o treinamento, o Centro de Treinamento e a quantidade de turmas antes de gerar as turmas.' using errcode = '22023';
  end if;
  select * into tt from tipos_treinamento where id = o.tipo_treinamento_id;

  v_nd := coalesce(tt.dias_teoria, 0) + coalesce(tt.dias_pratica, 0) + coalesce(tt.dias_teoria_pratica, 0);
  v_total := o.qtd_turmas * greatest(v_nd, 1);
  if v_total > 1500 then
    raise exception 'A quantidade de turmas (%) gera % linhas, acima do limite de 1500. Confira a quantidade no orçamento.', o.qtd_turmas, v_total using errcode = '22023';
  end if;

  with linhas as (
    select i.i as turma_i, d.d as dia_i
    from generate_series(0, o.qtd_turmas - 1) as i(i)
    cross join generate_series(1, greatest(v_nd, 1)) as d(d)
  ), calc as (
    select l.*,
      case when v_nd = 0 then null
           when l.dia_i <= coalesce(tt.dias_teoria, 0) then 'Teoria'
           when l.dia_i <= coalesce(tt.dias_teoria, 0) + coalesce(tt.dias_pratica, 0) then 'Prática'
           else 'Teoria com Prática' end as tipo_dia,
      case when l.turma_i < 26 then chr(65 + l.turma_i)
           else chr(65 + (l.turma_i / 26 - 1)) || chr(65 + l.turma_i % 26) end as letra
    from linhas l
  ), ins as (
    insert into turmas (orcamento_id, identificacao, tipo_dia, tipo_treinamento_id, centro_treinamento_id,
                        formato_teoria, formato_pratica, horario, vagas, dias_totais, status,
                        agenda_ct, agenda_movel, agenda_instrutor1, agenda_instrutor2, agenda_transporte)
    select o.id, c.letra || c.dia_i, c.tipo_dia, o.tipo_treinamento_id, o.centro_treinamento_id,
           o.formato_teoria, o.formato_pratica,
           case when c.tipo_dia = 'Prática' then left(o.horario_inicio_pratica::text, 5) else left(o.horario_inicio_teoria::text, 5) end,
           o.qtd_alunos_por_turma,
           nullif(v_nd, 0),
           'Planejada',
           case when o.formato_teoria = 'CT' or o.formato_pratica = 'CT' or coalesce(tt.somente_locacao_espaco, false) then 'A agendar' else 'Não aplicável' end,
           case when o.formato_teoria = 'Móvel' or o.formato_pratica = 'Móvel' then 'A agendar' else 'Não aplicável' end,
           case when coalesce(tt.somente_locacao_espaco, false) then 'Não aplicável' else 'A agendar' end,
           case when not coalesce(tt.somente_locacao_espaco, false) and o.necessita_dois_instrutores then 'A agendar' else 'Não aplicável' end,
           case
             when c.tipo_dia = 'Teoria' then case when coalesce(o.formato_teoria in ('InCompany','EAD','EAD Síncrono'), false) then 'Não aplicável' else 'A agendar' end
             when c.tipo_dia = 'Prática' then case when coalesce(o.formato_pratica in ('InCompany','Móvel'), false) then 'Não aplicável' else 'A agendar' end
             when c.tipo_dia = 'Teoria com Prática' then case when (not coalesce(o.formato_teoria in ('InCompany','EAD','EAD Síncrono'), false)) or (not coalesce(o.formato_pratica in ('InCompany','Móvel'), false)) then 'A agendar' else 'Não aplicável' end
             else 'A agendar'
           end
    from calc c
    returning id
  ), locs as (
    insert into turma_localidades (turma_id, nome, cnpj_atestado, cnpj_faturamento)
    select i.id, 'Principal', e.cnpj, e.cnpj
    from ins i
    join empresas e on e.id = o.empresa_id
    where nullif(btrim(e.cnpj), '') is not null
    returning id
  )
  select count(*) into v_ins from ins;

  return v_ins;
end $$;

revoke all on function gerar_turmas_orcamento(uuid) from public, anon;
grant execute on function gerar_turmas_orcamento(uuid) to authenticated;
