-- v2.01 — Parte B (rodar no SQL Editor do Supabase)
-- excluir_orcamento: recusa a exclusão quando o orçamento (encaixe/individual) já tem alunos
-- indicados numa turma aberta, e quando é uma turma aberta (TA-nnnn) com orçamentos vinculados.
CREATE OR REPLACE FUNCTION public.excluir_orcamento(p_orcamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_orc orcamentos; v_conf text[]; v_ids uuid[]; v_res jsonb := '{}'::jsonb; v_verbo text := 'dele' || 'te from ';
  v_nome text; v_emp text; v_resumo jsonb;
begin
  if not (is_admin(auth.uid()) or is_admin_sistema(auth.uid())) then
    raise exception 'Somente o administrador pode excluir orçamentos.';
  end if;
  select * into v_orc from orcamentos where id = p_orcamento_id;
  if v_orc.id is null then raise exception 'Orçamento não encontrado.'; end if;
  if exists (select 1 from turma_alunos where orcamento_id = p_orcamento_id) then
    raise exception 'O orçamento % não pode ser excluído: já tem alunos indicados numa turma aberta. Retire os alunos antes.', v_orc.numero;
  end if;
  if v_orc.turma_aberta and exists (select 1 from orcamentos where turma_aberta_id = p_orcamento_id) then
    raise exception 'A turma aberta % não pode ser excluída: há orçamentos vinculados.', v_orc.numero;
  end if;
  v_conf := orcamento_turmas_confirmadas(p_orcamento_id);
  if array_length(v_conf, 1) > 0 then
    raise exception '%', 'O orçamento ' || v_orc.numero || ' não pode ser excluído: há agendamento confirmado nas turmas ' || array_to_string(v_conf, ', ') || '. Cancele esses agendamentos antes.';
  end if;
  select coalesce(array_agg(t.id), '{}') into v_ids from turmas t
    where t.orcamento_id = p_orcamento_id
      and (coalesce(t.agenda_ct, 'A agendar') in ('Aguardando confirmação', 'Agendado')
           or t.instrutor1_id is not null or t.instrutor2_id is not null or t.instrutor3_id is not null or t.instrutor4_id is not null
           or coalesce(t.status_agendamento, 'Não agendado') <> 'Não agendado');
  v_resumo := orcamento_resumo_exclusao(p_orcamento_id);
  select nome into v_nome from usuarios_sistema where user_id = auth.uid();
  select nome into v_emp from empresas where id = v_orc.empresa_id;
  insert into orcamentos_excluidos_log (excluido_por_id, excluido_por, orcamento_id, numero, status, empresa_id, empresa_nome, valor_final, resumo, orcamento_dados)
  values (auth.uid(), coalesce(v_nome, 'Administrador'), v_orc.id, v_orc.numero::text, v_orc.status, v_orc.empresa_id, v_emp, v_orc.valor_final, v_resumo, to_jsonb(v_orc));
  if array_length(v_ids, 1) > 0 then
    v_res := cancelar_agendamento_turmas(v_ids, 'Orçamento ' || v_orc.numero || ' excluído');
  end if;
  execute v_verbo || 'public.agendamentos where turma_id in (select id from public.turmas where orcamento_id = $1)' using p_orcamento_id;
  execute v_verbo || 'public.orcamentos where id = $1' using p_orcamento_id;
  return jsonb_build_object('excluido', true, 'numero', v_orc.numero, 'agendamentos_cancelados', coalesce((v_res ->> 'canceladas')::int, 0), 'instrutores_avisados', coalesce((v_res ->> 'instrutores_avisados')::int, 0));
end $function$;
