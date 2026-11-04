-- v2.04 · Importar orçamento do Sistema 3S + Exportar agenda mensal
-- (já aplicado no Supabase; este arquivo só documenta — acrescentar ao final do supabase-schema.sql)

create table if not exists public.importacoes_3s_orcamentos (
  id uuid primary key default gen_random_uuid(),
  numero text not null,
  orcamento_id uuid,
  usuario_id uuid,
  usuario_nome text,
  resultado jsonb,
  created_at timestamptz not null default now()
);
alter table public.importacoes_3s_orcamentos enable row level security;
create policy importacoes_3s_orc_sel on public.importacoes_3s_orcamentos for select to authenticated
  using (is_admin_sistema(auth.uid()) or tem_permissao(auth.uid(), 'importar_orcamento_3s', 'consultar'));
revoke all on public.importacoes_3s_orcamentos from anon;

create or replace function public.imp3s_pode_importar(p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_admin_sistema(p_uid), false) or coalesce(tem_permissao(p_uid, 'importar_orcamento_3s', 'incluir'), false)
$$;
revoke all on function public.imp3s_pode_importar(uuid) from public, anon, authenticated;
grant execute on function public.imp3s_pode_importar(uuid) to service_role;

-- Aplica o orçamento lido do 3S (staging imp3s_* já carregado): cliente, orçamento, turmas, alunos e dados da proposta.
create or replace function public.importar_orcamento_3s_aplicar(p_lote text, p_orc integer, p_hoje date, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o orcamentos; v_res jsonb; v_prazo uuid; v_dprop date; v_dias int := 30;
  v_final numeric; v_st text; v_stxt text; v_qt int; v_qa int;
begin
  if exists (select 1 from orcamentos where numero = p_orc::text) then raise exception 'ORC_EXISTE'; end if;
  v_res := sync3s_aplicar_lote(p_lote, p_hoje, 30, false);
  select * into o from orcamentos where numero = p_orc::text;
  if not found then raise exception 'ORC_NAO_CRIADO: %', v_res::text; end if;

  v_dprop := coalesce(nullif(p_dados->>'data_proposta','')::date, o.data);
  -- mesmo critério das importações anteriores: o valor final do 3S vale como total e final, sem desconto/margem
  v_final := coalesce(nullif(p_dados->>'final','')::numeric, o.valor_final, 0);
  v_qt := greatest(coalesce(o.qtd_turmas, 1), 1); v_qa := greatest(coalesce(o.qtd_alunos, 1), 1);

  select id into v_prazo from prazos_pagamento
   where upper(trim(descricao)) = upper(trim(coalesce(p_dados->>'prazo_descricao',''))) and status = 'Ativo' limit 1;

  v_stxt := upper(coalesce(p_dados->>'status_texto',''));
  v_st := case
    when v_stxt like '%RECUS%' or v_stxt like '%PERD%' then 'Recusado'
    when v_stxt like '%CONCLU%' then 'Concluído'
    when v_stxt like '%CONFIRM%' then 'Aprovado e Confirmado'
    when v_stxt like '%AGEND%' then 'Aprovado e Agendado'
    when v_stxt like '%ABERT%' then 'Aberto'
    when v_stxt like '%APROV%' then 'Aprovado'
    else o.status end;

  update orcamentos set
    data = v_dprop, validade_dias = v_dias, validade = v_dprop + v_dias, status = v_st,
    contato_nome = nullif(trim(coalesce(p_dados->>'contato_nome','')),''),
    contato_telefone = nullif(trim(coalesce(p_dados->>'contato_telefone','')),''),
    contato_email = nullif(trim(coalesce(p_dados->>'contato_email','')),''),
    observacoes = coalesce(nullif(trim(coalesce(p_dados->>'observacoes','')),''), ''),
    prazo_pagamento_id = v_prazo,
    valor_total = v_final, perc_desconto = 0, valor_desconto = 0, valor_final = v_final,
    valor_turma = round(v_final / v_qt, 2), custo_turma = round(v_final / v_qt, 2),
    valor_por_aluno = round(v_final / v_qa, 2), valor_final_aluno = round(v_final / v_qa, 2),
    desconto_modo = 'percentual', perc_apoio = 0, perc_margem = 0, perc_imposto = 0,
    margem_final_valor = 0, margem_final_perc = 0, margem_minima_perc = 0, margem_minima_valor = 0,
    requer_aprovacao_gestor = false, qtd_localidades = coalesce(qtd_localidades, 1), proposta_em_elaboracao = false,
    calculado_em = now(), vendedor_id = null
  where id = o.id;

  return v_res || jsonb_build_object('orcamento_id', o.id, 'prazo_encontrado', v_prazo is not null, 'status', v_st);
end $$;
revoke all on function public.importar_orcamento_3s_aplicar(text, integer, date, jsonb) from public, anon, authenticated;
grant execute on function public.importar_orcamento_3s_aplicar(text, integer, date, jsonb) to service_role;

-- Grava a proposta do 3S (PDF original já enviado ao bucket propostas-externas) como proposta vigente do orçamento.
create or replace function public.importar_orcamento_3s_proposta(p_orcamento uuid, p_arquivo text, p_usuario text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o orcamentos; e empresas; c centros_treinamento; t tipos_treinamento; pz prazos_pagamento; v_id uuid; v_agora timestamptz := now();
  v_num text; v_parc jsonb; v_dados jsonb;
begin
  select * into o from orcamentos where id = p_orcamento; if not found then raise exception 'orçamento inexistente'; end if;
  select * into e from empresas where id = o.empresa_id;
  select * into c from centros_treinamento where id = o.centro_treinamento_id;
  select * into t from tipos_treinamento where id = o.tipo_treinamento_id;
  select * into pz from prazos_pagamento where id = o.prazo_pagamento_id;
  v_num := o.numero || '-' || to_char(v_agora at time zone 'America/Sao_Paulo', 'YYYYMMDD-HH24MI');
  select coalesce(jsonb_agg(jsonb_build_object('numero', x.numero, 'dias', x.dias, 'percentual', x.percentual,
           'valor', round(o.valor_final * x.percentual / 100, 2)) order by x.numero), '[]'::jsonb)
    into v_parc from prazos_pagamento_parcelas x where x.prazo_pagamento_id = o.prazo_pagamento_id;
  v_dados := jsonb_build_object(
    'itens', '[]'::jsonb, 'itens_impressao', '[]'::jsonb, 'origem', 'Sistema 3S', 'versao', 1,
    'centro', jsonb_build_object('id', c.id, 'nome', c.nome, 'cidade', coalesce(c.cidade,''), 'endereco', coalesce(c.endereco,'')),
    'calculo', jsonb_build_object('custo_turma', o.valor_turma, 'valor_final', o.valor_final, 'valor_total', o.valor_total, 'valor_turma', o.valor_turma,
        'valor_desconto', o.valor_desconto, 'margem_final_perc', 0, 'valor_final_aluno', o.valor_final_aluno,
        'valor_final_turma', round(o.valor_final / greatest(coalesce(o.qtd_turmas,1),1), 2), 'margem_final_valor', 0,
        'margem_minima_perc', 0, 'margem_minima_valor', 0, 'requer_aprovacao_gestor', false),
    'contato', jsonb_build_object('nome', coalesce(o.contato_nome,''), 'email', coalesce(o.contato_email,''), 'telefone', coalesce(o.contato_telefone,'')),
    'empresa', jsonb_build_object('id', e.id, 'nome', e.nome),
    'parcelas', v_parc,
    'gerada_em', v_agora, 'gerado_por', 'Importado do Sistema 3S',
    'observacoes', coalesce(o.observacoes,''),
    'percentuais', jsonb_build_object('apoio', 0, 'margem', 0, 'imposto', 0, 'desconto', coalesce(o.perc_desconto,0), 'desconto_modo', 'percentual'),
    'quantidades', jsonb_build_object('alunos', o.qtd_alunos, 'turmas', o.qtd_turmas, 'localidades', coalesce(o.qtd_localidades,1), 'alunos_por_turma', o.qtd_alunos_por_turma),
    'treinamento', jsonb_build_object('id', t.id, 'nome', t.nome, 'rodape', '', 'descricao_impressao', ''),
    'validade_ate', o.validade, 'validade_dias', o.validade_dias, 'data_impressao', o.data,
    'prazo_pagamento', coalesce(pz.descricao, ''), 'proposta_numero', v_num, 'orcamento_numero', o.numero);
  insert into orcamento_propostas(orcamento_id, numero, versao, valor_final, gerado_por, status, requer_aprovacao,
      margem_final_valor, margem_final_perc, margem_minima_perc, margem_minima_valor, dados, arquivo_externo, origem)
  values (o.id, v_num, 1, o.valor_final, 'Importado do Sistema 3S', 'Válida', false, 0, 0, 0, 0, v_dados, p_arquivo, 'Sistema 3S')
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.importar_orcamento_3s_proposta(uuid, text, text) from public, anon, authenticated;
grant execute on function public.importar_orcamento_3s_proposta(uuid, text, text) to service_role;

-- Exportar agenda mensal
alter table public.permissoes add column if not exists pode_exportar_agenda_mensal boolean not null default false;
-- A função agenda_mensal_exportar(p_de date, p_ate date, p_ct uuid) está no Supabase (SECURITY DEFINER; exige admin
-- ou permissoes.pode_exportar_agenda_mensal no módulo agenda_centros); executável por authenticated.

-- Consulta de Agenda: 4 instrutores (i1..i4) e valores v_transp/v_turma/v_aluno (estes só para admin ou quem tem
-- permissoes.pode_exportar_agenda no módulo consulta_agenda). A função consulta_agenda(p_de, p_ate, p_ct) foi
-- recriada no Supabase (migração consulta_agenda_4_instrutores_valores_v204).
