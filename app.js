// =========================================================
// Work Fire mais perto de você — lógica do app (Supabase)
// Área de trabalho: cadastros, operações e permissões.
// =========================================================
(function () {
  // Proteção contra o script ser incluído/executado mais de uma vez na página
  if (window.__agendaInstrutoresAppIniciado) return;
  window.__agendaInstrutoresAppIniciado = true;

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

// O Supabase devolve no máximo 1.000 linhas por consulta; esta função busca
// todas as páginas. Recebe uma função que monta a consulta (precisa ter
// ordenação estável).
async function buscarTodos(montarConsulta) {
  const tam = 1000;
  let todos = [];
  for (let de = 0; ; de += tam) {
    // Uma falha momentânea de rede em uma das páginas não pode deixar a lista incompleta: tenta de novo antes de desistir.
    let data, error;
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      ({ data, error } = await montarConsulta().range(de, de + tam - 1));
      if (!error) break;
      if (tentativa < 3) await new Promise((r) => setTimeout(r, 500 * tentativa));
    }
    if (error) return { data: todos.length ? todos : null, error };
    todos = todos.concat(data || []);
    if (!data || data.length < tam) break;
  }
  return { data: todos, error: null };
}

// Versão do aplicativo — atualizar (número + data) a cada entrega feita ao
// usuário, junto com o commit. Mostrada no cabeçalho de todas as páginas e no
// rodapé do menu lateral. Também atualizar o "?v=" do app.js no index.html.
const APP_VERSAO = "Prod 1.44 · 09/10/2026";
if ($("app-header-versao")) $("app-header-versao").textContent = `Versão: ${APP_VERSAO}`;

// ---------------------------------------------------------
// Verificação de nova versão publicada
// Ao navegar pelo aplicativo, compara a versão em uso (APP_VERSAO) com a que está
// publicada no servidor (lida do início do app.js, sem usar cache). Se forem diferentes,
// avisa o usuário e atualiza a página para carregar a versão nova.
// ---------------------------------------------------------
let verUltimaChecagem = 0;
let verAvisoAtivo = false;

async function buscarVersaoPublicada() {
  const ctrl = new AbortController();
  const limite = setTimeout(() => ctrl.abort(), 8000);
  try {
    const resp = await fetch(`app.js?chk=${Date.now()}`, { cache: "no-store", signal: ctrl.signal });
    if (!resp.ok || !resp.body) return null;
    // Lê só o começo do arquivo: a constante APP_VERSAO fica nas primeiras linhas.
    const leitor = resp.body.getReader();
    const decodificador = new TextDecoder();
    let texto = "";
    let achada = null;
    while (texto.length < 30000) {
      const { done, value } = await leitor.read();
      if (done) break;
      texto += decodificador.decode(value, { stream: true });
      const m = texto.match(/const APP_VERSAO = "([^"]+)"/);
      if (m) { achada = m[1]; break; }
    }
    try { await leitor.cancel(); } catch (e) { /* já encerrado */ }
    return achada;
  } catch (e) {
    return null; // sem conexão ou lento: tenta de novo na próxima navegação
  } finally {
    clearTimeout(limite);
  }
}

function mostrarAvisoNovaVersao(versaoNova, recarregarSozinho) {
  if (verAvisoAtivo) return;
  verAvisoAtivo = true;
  const faixa = document.createElement("div");
  faixa.id = "aviso-nova-versao";
  faixa.setAttribute("role", "alert");
  faixa.className = "fixed top-0 inset-x-0 z-[100] bg-amber-500 text-slate-900 shadow-lg px-4 py-3 text-sm flex flex-wrap items-center justify-center gap-3";
  document.body.appendChild(faixa);
  const atualizar = () => {
    try { sessionStorage.setItem("wf_ver_reload", JSON.stringify({ versao: versaoNova, em: Date.now() })); } catch (e) { /* sem storage */ }
    window.location.reload();
  };
  let restante = 5;
  const desenhar = () => {
    faixa.innerHTML = `<span>🔄 <strong>Há uma nova versão do aplicativo (${versaoNova}).</strong> ${
      recarregarSozinho ? `A página será atualizada em ${restante}s para você usar a versão mais recente.` : "Atualize a página (Ctrl+F5) para usar a versão mais recente."}</span>
      <button id="btn-aviso-atualizar" class="rounded-md bg-slate-900 text-white text-xs font-medium px-3 py-1.5 hover:bg-slate-800">Atualizar agora</button>`;
    $("btn-aviso-atualizar").addEventListener("click", atualizar);
  };
  desenhar();
  if (recarregarSozinho) {
    const relogio = setInterval(() => {
      restante -= 1;
      if (restante <= 0) { clearInterval(relogio); atualizar(); } else desenhar();
    }, 1000);
  }
}

async function verificarNovaVersao(forcar = false) {
  if (verAvisoAtivo) return;
  const agora = Date.now();
  if (!forcar && agora - verUltimaChecagem < 30000) return; // no máximo uma checagem a cada 30s
  verUltimaChecagem = agora;
  const publicada = await buscarVersaoPublicada();
  if (!publicada || publicada === APP_VERSAO) return;
  // Não interrompe uma importação de orçamentos em andamento: avisa depois que terminar.
  try { if (typeof impOrc !== "undefined" && impOrc && impOrc.rodando) { verUltimaChecagem = 0; return; } } catch (e) { /* ainda não inicializado */ }
  // Evita laço de recarregamentos se o servidor/cache ainda entregar a versão antiga.
  let anterior = null;
  try { anterior = JSON.parse(sessionStorage.getItem("wf_ver_reload") || "null"); } catch (e) { /* ignora */ }
  const jaTentou = !!anterior && anterior.versao === publicada && Date.now() - anterior.em < 120000;
  // Com o editor de orçamento aberto não recarrega sozinho (perderia o que está sendo digitado).
  let editorAberto = false;
  try { editorAberto = typeof orcEditorAberto === "function" && orcEditorAberto(); } catch (e) { /* ainda não inicializado */ }
  mostrarAvisoNovaVersao(publicada, !jaTentou && !editorAberto);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) verificarNovaVersao(); });

const diasSemana = ["D", "S", "T", "Q", "Q", "S", "S"];
const nomesMeses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const nomesMesesAbrev = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

function formatarDataAbrev(dataStr) {
  if (!dataStr) return "—";
  const [ano, mes, dia] = dataStr.split("-");
  return `${dia}/${nomesMesesAbrev[Number(mes) - 1]}/${ano}`;
}
const pad2 = (n) => String(n).padStart(2, "0");
const formatarData = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function gerarGradeMes(ano, mes) {
  const primeiroDia = new Date(ano, mes, 1);
  const ultimoDia = new Date(ano, mes + 1, 0);
  const offset = primeiroDia.getDay();
  const celulas = [];
  for (let i = 0; i < offset; i++) celulas.push(null);
  for (let d = 1; d <= ultimoDia.getDate(); d++) celulas.push(new Date(ano, mes, d));
  return celulas;
}

// ---------------------------------------------------------
// Status possíveis de cada dia da agenda
// ---------------------------------------------------------
const STATUS_PADRAO = "bloqueado"; // dia sem registro ainda = tratado como bloqueado
const STATUS_PROTEGIDOS = ["agendado", "aguardando"]; // não alteráveis por clique ou pelos botões de mês

const ESTILO_STATUS = {
  disponivel: "bg-teal-600 text-white",
  bloqueado: "bg-slate-200 text-slate-500",
  agendado: "bg-blue-600 text-white",
  aguardando: "bg-amber-400 text-white",
};
// Estilo só de exibição para um dia "agendado" cuja turma está marcada como
// pré-agendamento. NÃO é um valor gravado em dias_status — esse campo é
// compartilhado com o app agenda-instrutores (outro repositório), que não
// conhece essa distinção; gravar um valor novo ali quebra a proteção contra
// clique daquele app (foi o que causou a desmarcação indevida). A cor é
// calculada aqui, cruzando o dia "agendado" com `datasPreAgendadas`.
const ESTILO_PRE_AGENDADO = "bg-sky-200 text-sky-900";

function obterStatusDia(diasStatus, dataStr) {
  return (diasStatus && diasStatus[dataStr]) || STATUS_PADRAO;
}

// Renderiza uma grade de calendário genérica (usada tanto na agenda do instrutor
// quanto no formulário do administrador). `aoClicarDia` recebe (dataStr, statusAtual)
// e só é chamado para dias que não estão em um status protegido.
// `datasPreAgendadas` (Set opcional de "AAAA-MM-DD") marca, só visualmente,
// quais dias "agendado" pertencem a uma turma em pré-agendamento.
function renderizarGradeCalendario({ mes, diasStatus, elLabel, elSemana, elGrade, aoClicarDia, datasPreAgendadas }) {
  elLabel.textContent = `${nomesMeses[mes.getMonth()]} ${mes.getFullYear()}`;
  elSemana.innerHTML = diasSemana
    .map((d) => `<div class="text-center text-[10px] font-medium text-slate-400 py-1">${d}</div>`)
    .join("");

  const grade = gerarGradeMes(mes.getFullYear(), mes.getMonth());
  elGrade.innerHTML = "";
  grade.forEach((dia) => {
    if (!dia) {
      elGrade.innerHTML += `<div></div>`;
      return;
    }
    const dataStr = formatarData(dia);
    const status = obterStatusDia(diasStatus, dataStr);
    const ehPreAgendado = status === "agendado" && datasPreAgendadas?.has(dataStr);
    const protegido = STATUS_PROTEGIDOS.includes(status);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = dia.getDate();
    btn.title =
      ehPreAgendado ? "Pré-agendado — não pode ser alterado aqui"
      : status === "agendado" ? "Agendado — não pode ser alterado aqui"
      : status === "aguardando" ? "Aguardando confirmação — não pode ser alterado aqui"
      : "";
    btn.className = `aspect-square rounded-md text-xs font-medium transition-colors ${ehPreAgendado ? ESTILO_PRE_AGENDADO : ESTILO_STATUS[status]} ${
      protegido ? "cursor-not-allowed opacity-90" : "hover:opacity-80"
    }`;
    if (!protegido) btn.addEventListener("click", () => aoClicarDia(dataStr, status));
    elGrade.appendChild(btn);
  });
}

// Aplica um novo status a TODOS os dias do mês informado, pulando os protegidos.
// Retorna o novo objeto dias_status (não altera o original).
function aplicarStatusNoMes(diasStatusAtual, mes, novoStatus) {
  const copia = { ...(diasStatusAtual || {}) };
  const grade = gerarGradeMes(mes.getFullYear(), mes.getMonth()).filter(Boolean);
  grade.forEach((dia) => {
    const dataStr = formatarData(dia);
    const statusAtual = obterStatusDia(copia, dataStr);
    if (!STATUS_PROTEGIDOS.includes(statusAtual)) {
      copia[dataStr] = novoStatus;
    }
  });
  return copia;
}

function contarStatus(diasStatus) {
  const contagem = { disponivel: 0, bloqueado: 0, agendado: 0, aguardando: 0 };
  Object.values(diasStatus || {}).forEach((s) => {
    if (contagem[s] !== undefined) contagem[s]++;
  });
  return contagem;
}

function mostrarTela(id) {
  document.querySelectorAll(".tela").forEach((el) => el.classList.add("hidden"));
  $(id).classList.remove("hidden");
}

function mostrarErro(elId, msg) {
  const el = $(elId);
  el.textContent = msg;
  el.classList.remove("hidden");
}
function esconderErro(elId) {
  $(elId).classList.add("hidden");
}

// Confirmação padrão antes de qualquer exclusão definitiva.
function confirmarExclusao(descricao) {
  return confirm(`Tem certeza que deseja excluir ${descricao}?\n\nEsta ação não pode ser desfeita.`);
}

// ---------------------------------------------------------
// Estado geral
// ---------------------------------------------------------
let sessaoAtual = null;
let perfilAtual = null; // linha da tabela instrutores do usuário logado
let listaInstrutoresAdmin = [];
let mesCalendarioInstrutor = new Date();
let instrutorDatasPreAgendadas = new Set(); // datas "agendado" do instrutor logado cuja turma está em pré-agendamento (só exibição)

// Busca, para um instrutor, as datas confirmadas cuja turma está marcada
// como pré-agendamento — usado só para colorir o calendário (não altera
// dias_status, que é compartilhado com o app agenda-instrutores).
async function carregarDatasPreAgendadas(instrutorId) {
  const vazio = new Set();
  if (!instrutorId) return vazio;
  const { data, error } = await supabase
    .from("agendamentos")
    .select("datas_status, turmas!inner(eh_pre_agendamento)")
    .eq("instrutor_id", instrutorId)
    .eq("turmas.eh_pre_agendamento", true);
  if (error) return vazio;
  const datas = new Set();
  (data || []).forEach((a) => {
    Object.entries(a.datas_status || {}).forEach(([data, v]) => {
      if (v?.status === "confirmado") datas.add(data);
    });
  });
  return datas;
}
let mesCalendarioForm = new Date();
let diasStatusForm = {};
let formDatasPreAgendadas = new Set(); // idem instrutorDatasPreAgendadas, para o instrutor aberto no painel admin
let editandoId = null;
let pendingDocFile = null;
let pendingDocPreviewUrl = null;
let docUrlAtualForm = null; // path já salvo (edição)
let telaAposLoginParaTrocaSenha = "login"; // para onde voltar após trocar senha

// ---------------------------------------------------------
// Estado da área de trabalho (usuários do sistema, cadastros e operações)
// ---------------------------------------------------------
const qs = (sel) => document.querySelector(sel);
let usuarioSistemaAtual = null; // linha da tabela usuarios_sistema do usuário logado
let permissoesAtual = {}; // { modulo: { pode_consultar, pode_incluir, pode_alterar, pode_excluir } }
let moduloAtivo = null;
// Situação do usuário logado no fluxo de aprovação de reembolso (gestor
// direto de alguém, gestor financeiro, ou admin) — controla se o módulo
// "Aprovações de Reembolso" (área Financeiro) aparece no menu. A checagem
// "de verdade" acontece nas RPCs; isso é só para a visibilidade do menu.
let aprovSituacao = { eh_gestor: false, eh_financeiro: false, eh_admin: false };

let crudModuloId = null;
let crudLista = [];
let crudEditandoId = null;

let listaInstrutoresAtivos = [];
let listaTiposAtivos = [];
let listaCentrosAtivos = [];
let listaEmpresasAtivas = [];

// Listas de referência para o cadastro de Atividades (carregadas sob demanda)
let atividadeRefUsuarios = [];
let atividadeRefTipos = [];
let atividadeRefCentros = [];
// Usuários do sistema disponíveis para seleção como "Gestor direto"
// (cadastro de instrutores e de usuários do sistema). Carregada sob demanda
// via RPC listar_usuarios_sistema_para_gestor (não depende do módulo de
// permissões "Usuários do Sistema" estar liberado para quem está editando).
let usuariosSistemaRefGestores = [];
let usuariosSistemaRefGestoresCarregada = false;
async function carregarUsuariosSistemaRefGestores(forcar) {
  if (usuariosSistemaRefGestoresCarregada && !forcar) return usuariosSistemaRefGestores;
  const { data, error } = await supabase.rpc("listar_usuarios_sistema_para_gestor");
  usuariosSistemaRefGestores = error ? [] : (data || []);
  usuariosSistemaRefGestoresCarregada = true;
  return usuariosSistemaRefGestores;
}
// Listas de referência para o cadastro de Materiais
let materialRefTipos = [];
let materialRefFornecedores = [];
let itemCustoRefUnidades = [];
// Itens de custo do treinamento (seção dentro do cadastro de Treinamentos)
let treinoRefItensCusto = [];
let treinoRefUnidades = [];
let treinoContagemItensCusto = {};
let treinoItensCustoForm = [];        // linhas exibidas no formulário
let treinoItensCustoOriginais = [];   // linhas que já estavam gravadas (ao editar)
let treinoItensSeq = 0;
let materialContagemPorTipo = {};

// Requisições de Compra
let reqRefCentros = [], reqRefUsuarios = [], reqRefAprovadores = [], reqRefMateriais = [], reqRefAtividades = [];
let reqItensAtual = [];
let requisicaoAtividadePreset = null;

function podeAprovarRequisicao() {
  if (usuarioSistemaAtual && usuarioSistemaAtual.role === "admin") return true;
  return !!(permissoesAtual.requisicoes_compra && permissoesAtual.requisicoes_compra.pode_aprovar_requisicao);
}
const fmtPerc = (v) => `${Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
// De onde vem a quantidade de um item de custo no cálculo do orçamento (unidades de medida).
const BASES_CALCULO = [
  { value: "turma", label: "Turma (1 por turma)" },
  { value: "alunos_por_turma", label: "Alunos por turma" },
  { value: "qtde_turmas", label: "Quantidade de turmas do orçamento" },
  { value: "localidades", label: "Quantidade de localidades do orçamento" },
  { value: "manual", label: "Digitada no orçamento (manual)" },
];
const rotuloBaseCalculo = (v) => (BASES_CALCULO.find((b) => b.value === v) || {}).label || "";
const fmtBRL = (v) => (v == null || v === "" ? "R$ 0,00" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const fmtDataHoraBR = (s) => (s ? new Date(s).toLocaleString("pt-BR") : "—");

let crudItemEmEdicao = null;         // linha sendo editada no painel CRUD (null = novo)
let atividadeFotoPendente = null;    // File escolhido para a fotografia, ainda não enviado
let atividadeFotoRemover = false;    // marcar remoção da fotografia atual
let atividadeAnexosAbertaId = null;  // atividade cujo painel de anexos está aberto
let anexosDaAtividadeAtual = [];

let listaAgendamentos = [];
let editandoAgendamentoId = null;
let agInstrutorSelecionado = null;
let agMesCalendario = new Date();
let agDatasSelecionadas = new Set();
let agendamentoOriginalDatas = [];
let agendamentoInstrutorOriginalId = null;
let agAbaAtiva = "lista"; // "lista" | "negativas" | "desmarcacoes"
let listaNegativas = []; // achatado a partir de datas_status/negativas_resolvidas de listaAgendamentos
let listaDesmarcacoes = []; // pedidos de desmarcação de aulas já confirmadas, aguardando decisão
let negativaEmSubstituicao = null; // { agendamentoId, data } quando o painel foi aberto a partir de uma negativa
let agDataForcada = null; // data que deve ficar selecionável mesmo fora da disponibilidade do novo instrutor

let listaOrcamentos = [];
let editandoOrcamentoId = null;
let orcFiltroStatus = new Set(["Aberto", "Aprovado", "Aprovado e Agendado", "Aprovado e Confirmado", "Aberto e Pré-Agendado", "Aberto e Pré-Confirmado", "Recusado", "Concluído"]);
// Controlam se o horário de início (teoria/prática) já foi digitado manualmente pelo
// usuário — enquanto não for, trocar o formato continua atualizando o valor padrão.
let orcHorarioTeoriaEditadoManualmente = false;
let orcHorarioPraticaEditadoManualmente = false;

let listaOrcamentosParaTurma = [];
let turmaOrcamentoSelecionadoId = null;
let turmasDoOrcamento = [];
let editandoTurmaId = null;
let listaEmpresasParaValidacao = [];
let agendTurmaCentroId = null;
let agendTurmaOrcamentoId = null;
let agendTurmaListaOrcamentos = [];
let agendTurmasLista = [];
let agendTurmaSelecionadas = new Set();
let agendTurmaCentroStatus = new Map(); // turmaId -> { disponivel: bool, salaOk, pistaOk }
let agendTurmaInstrutores = new Map(); // turmaId -> { instrutor1: id|"", instrutor2: id|"" }
let agendTurmaRankingInstrutores = [];
const agendTurmaAgendamentos = new Map(); // `${turmaId}|${instrutorId}` → linha de agendamentos // [{ instrutor, diasDisponiveis, totalDias, fullyAvailable }]
let turmaAlunosAbertaId = null;
let alunosDaTurmaAtual = [];
let localidadesParaAlunosTurma = [];
let editandoAlunoId = null;
let turmaLocalidadesAbertaId = null;
let localidadesDaTurmaAtual = [];
let editandoLocalidadeId = null;

const URL_APP_ALUNO = "https://workfire-aluno.netlify.app";
const URL_TEMPLATE_LISTA_PRESENCA = "templates/lista-presenca.xlsx";
const TURMA_STATUS = ["Planejada", "A confirmar", "Agendada", "Confirmada", "Concluída", "Cancelada"];
let turmaFiltroStatus = new Set(TURMA_STATUS);
let turmaFiltroDataDe = "";
let turmaFiltroDataAte = "";
const FORMATOS_TEORIA = ["CT", "InCompany", "EAD", "EAD Síncrono", "Móvel"];
const FORMATOS_PRATICA = ["CT", "InCompany", "Móvel"];
const AGENDA_STATUS = ["A agendar", "Agendado", "Aguardando confirmação", "Não aplicável"];
const ORCAMENTO_STATUS = ["Aberto", "Aprovado", "Aprovado e Agendado", "Aprovado e Confirmado", "Aberto e Pré-Agendado", "Aberto e Pré-Confirmado", "Recusado", "Concluído"];

const AREAS = ["Geral", "Cadastros Básicos", "Comercial", "Compras", "Logística", "Operações", "Financeiro"];

const MODULOS = [
  // Cadastros Básicos
  { id: "usuarios_sistema", label: "Usuários do Sistema", icone: "🔑", grupo: "Cadastros Básicos" },
  { id: "instrutores", label: "Instrutores", icone: "👥", grupo: "Cadastros Básicos" },
  { id: "fornecedores", label: "Fornecedores", icone: "🚚", grupo: "Cadastros Básicos" },
  { id: "centros_treinamento", label: "Centros de Treinamento", icone: "🏫", grupo: "Cadastros Básicos" },
  { id: "categorias_treinamento", label: "Tipos de Treinamento", icone: "🗃️", grupo: "Cadastros Básicos" },
  { id: "tipos_treinamento", label: "Treinamentos", icone: "🏷️", grupo: "Cadastros Básicos" },
  { id: "tipos_atividade", label: "Tipos de Atividade", icone: "🗂️", grupo: "Cadastros Básicos" },
  { id: "tipos_material", label: "Tipos de Material", icone: "🧰", grupo: "Cadastros Básicos" },
  { id: "tipos_despesas", label: "Tipos de Despesas", icone: "💸", grupo: "Cadastros Básicos" },
  { id: "unidades_medida", label: "Unidades de Medida", icone: "📏", grupo: "Cadastros Básicos" },
  { id: "itens_custo", label: "Itens de Custo", icone: "🧾", grupo: "Cadastros Básicos" },
  { id: "prazos_pagamento", label: "Prazos de Pagamento", icone: "🗓️", grupo: "Cadastros Básicos" },
  { id: "treinamentos_capacitacao", label: "Treinamentos de Capacitação", icone: "📚", grupo: "Cadastros Básicos" },
  // Comercial
  { id: "empresas", label: "Empresas", icone: "🏢", grupo: "Comercial" },
  { id: "orcamentos", label: "Orçamentos", icone: "💰", grupo: "Comercial" },
  // Compras
  { id: "materiais", label: "Materiais", icone: "📦", grupo: "Compras" },
  // Logística
  { id: "empresas_transporte", label: "Empresas de Transporte", icone: "🚐", grupo: "Logística" },
  { id: "agendamentos", label: "Agendar Treinamento", icone: "🗓️", grupo: "Logística" },
  { id: "agendamento_turmas", label: "Agendamento de Turmas", icone: "📆", grupo: "Logística" },
  { id: "agenda_centros", label: "Agenda por Centro de Treinamento", icone: "📅", grupo: "Logística" },
  { id: "disponibilidade_instrutores", label: "Disponibilidade dos Instrutores", icone: "📊", grupo: "Logística" },
  { id: "turmas", label: "Turmas por Orçamento", icone: "🎓", grupo: "Logística" },
  // Operações
  { id: "atividades", label: "Atividades", icone: "📋", grupo: "Operações" },
  { id: "requisicoes_compra", label: "Requisições de Compra", icone: "🛒", grupo: "Operações" },
  { id: "confirmacao_ct", label: "Confirmação do Centro de Treinamento", icone: "✅", grupo: "Operações" },
  { id: "documentos_turmas", label: "Documentos de Turmas", icone: "📷", grupo: "Operações" },
  // Financeiro
  { id: "aprovacoes_reembolso", label: "Aprovações de Reembolso", icone: "✅", grupo: "Financeiro" },
  { id: "consulta_reembolsos", label: "Consulta de Reembolsos", icone: "🔎", grupo: "Financeiro" },
];

// Área selecionada no menu inicial. "Geral" mostra todas as áreas.
let areaAtiva = "Geral";
function modulosDaArea() {
  return MODULOS.filter((m) => (areaAtiva === "Geral" || m.grupo === areaAtiva) && podeFazer(m.id, "consultar"));
}

// Envia o e-mail de boas-vindas com o link do app para o usuário cadastrar a
// senha. Se não houver provedor de e-mail configurado, devolve a mensagem
// pronta para o administrador enviar manualmente.
async function enviarConviteUsuario(usuarioId, silenciosoSeOk = false) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/convidar-usuario`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${sessaoAtual?.access_token || SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ usuario_id: usuarioId }),
    });
    const r = await resp.json().catch(() => ({}));

    if (r.ok) {
      if (!silenciosoSeOk) alert(`Convite enviado para ${r.email}.`);
      return true;
    }
    if (r.sem_provedor) {
      const texto = `Para: ${r.email}\nAssunto: ${r.assunto}\n\n${r.mensagem}`;
      try { await navigator.clipboard.writeText(texto); } catch (e) { /* sem permissão de área de transferência */ }
      alert("O envio automático de e-mail ainda não está configurado.\n\nA mensagem de convite foi copiada para a área de transferência — cole no seu e-mail e envie para o usuário:\n\n" + texto);
      return false;
    }
    alert("Não foi possível enviar o convite. " + (r.error || ""));
    return false;
  } catch (e) {
    alert("Não foi possível enviar o convite: falha de conexão.");
    return false;
  }
}

// Aptidões do instrutor: tipos de treinamento que ele pode ministrar.
let centrosParaInstrutor = []; // lista usada só no cadastro de instrutor
let aptidoesCategorias = [];   // opções disponíveis (categorias ativas + as já marcadas)
let aptidoesSelecionadas = new Set();
let aptidoesPorInstrutor = {}; // instrutor_id → [categoria_treinamento_id]

async function carregarAptidoesRefs() {
  const [{ data: cats }, { data: vinc }, { data: centros }] = await Promise.all([
    supabase.from("categorias_treinamento").select("id, codigo, descricao, status").order("codigo"),
    supabase.from("instrutor_categorias").select("instrutor_id, categoria_treinamento_id"),
    supabase.from("centros_treinamento").select("id, nome, status").order("nome"),
  ]);
  centrosParaInstrutor = centros || [];
  aptidoesCategorias = cats || [];
  aptidoesPorInstrutor = {};
  (vinc || []).forEach((v) => {
    (aptidoesPorInstrutor[v.instrutor_id] = aptidoesPorInstrutor[v.instrutor_id] || []).push(v.categoria_treinamento_id);
  });
}

function preencherCentroPrincipalForm(valor) {
  const sel = $("f-centro-principal");
  if (!sel) return;
  const centros = (centrosParaInstrutor || []).filter((c) => c.status === "Ativo" || c.id === valor);
  sel.innerHTML = `<option value="">— Não definido —</option>` +
    centros.map((c) => `<option value="${c.id}" ${c.id === valor ? "selected" : ""}>${c.nome}</option>`).join("");
  sel.value = valor || "";
}

function renderizarAptidoesForm() {
  const cont = $("f-aptidoes");
  if (!cont) return;
  const visiveis = aptidoesCategorias.filter((c) => c.status === "Ativo" || aptidoesSelecionadas.has(c.id));
  if (visiveis.length === 0) {
    cont.innerHTML = `<p class="text-xs text-slate-400">Nenhum tipo de treinamento cadastrado. Cadastre em Tipos de Treinamento.</p>`;
    $("f-aptidoes-resumo").textContent = "";
    return;
  }
  cont.innerHTML = visiveis.map((c) => `
    <label class="flex items-start gap-2 text-sm text-slate-700">
      <input type="checkbox" data-aptidao="${c.id}" class="mt-0.5" ${aptidoesSelecionadas.has(c.id) ? "checked" : ""} />
      <span>${c.codigo} — ${c.descricao}${c.status !== "Ativo" ? ` <span class="text-[10px] text-rose-500">(tipo inativo)</span>` : ""}</span>
    </label>`).join("");
  cont.querySelectorAll("[data-aptidao]").forEach((el) =>
    el.addEventListener("change", () => {
      const id = el.getAttribute("data-aptidao");
      if (el.checked) aptidoesSelecionadas.add(id); else aptidoesSelecionadas.delete(id);
      $("f-aptidoes-resumo").textContent = `${aptidoesSelecionadas.size} tipo(s) selecionado(s)`;
    }));
  $("f-aptidoes-resumo").textContent = `${aptidoesSelecionadas.size} tipo(s) selecionado(s)`;
}

// Grava as aptidões do instrutor (remove as desmarcadas, inclui as novas).
async function salvarAptidoesInstrutor(instrutorId) {
  const atuais = new Set(aptidoesPorInstrutor[instrutorId] || []);
  const remover = [...atuais].filter((id) => !aptidoesSelecionadas.has(id));
  const incluir = [...aptidoesSelecionadas].filter((id) => !atuais.has(id));
  if (remover.length) {
    await supabase.from("instrutor_categorias").delete()
      .eq("instrutor_id", instrutorId).in("categoria_treinamento_id", remover);
  }
  if (incluir.length) {
    await supabase.from("instrutor_categorias")
      .insert(incluir.map((id) => ({ instrutor_id: instrutorId, categoria_treinamento_id: id })));
  }
}

function rotulosAptidoes(instrutorId) {
  const ids = aptidoesPorInstrutor[instrutorId] || [];
  return ids.map((id) => aptidoesCategorias.find((c) => c.id === id)?.codigo).filter(Boolean);
}

// Tipos de Treinamento (categorias_treinamento) e contagem de treinamentos.
let treinoRefCategorias = [];
let catTreinoContagem = {};
function contagemCategoria(id) {
  return catTreinoContagem[id] || { ativos: 0, inativos: 0 };
}
function rotuloCategoriaTreinamento(id) {
  const c = treinoRefCategorias.find((x) => x.id === id);
  return c ? `🗃️ ${c.codigo} — ${c.descricao}` : null;
}

const usuarioEhAdmin = () => !!(usuarioSistemaAtual && usuarioSistemaAtual.role === "admin");
function podeFazer(modulo, acao) {
  if (usuarioSistemaAtual && usuarioSistemaAtual.role === "admin") return true;
  // "Aprovações de Reembolso" não usa a grade de permissões padrão: quem vê
  // e acessa é quem de fato participa do fluxo (gestor direto de alguém, ou
  // gestor financeiro), segundo a RPC reembolso_minha_situacao_aprovacao.
  if (modulo === "aprovacoes_reembolso") {
    return acao === "consultar" && !!(aprovSituacao.eh_gestor || aprovSituacao.eh_financeiro);
  }
  // "Consulta de Reembolsos" é um relatório global (todos os reembolsos,
  // de todo mundo) — só quem participa do fluxo financeiro deve acessar.
  if (modulo === "consulta_reembolsos") {
    return acao === "consultar" && !!aprovSituacao.eh_financeiro;
  }
  const p = permissoesAtual[modulo];
  return !!(p && p["pode_" + acao]);
}

// Controles extras do módulo Atividades (colunas próprias de permissoes)
function podeAtividades(flag) {
  if (usuarioSistemaAtual && usuarioSistemaAtual.role === "admin") return true;
  return !!(permissoesAtual.atividades && permissoesAtual.atividades["pode_" + flag]);
}

// ---------------------------------------------------------
// Inicialização
// ---------------------------------------------------------
async function iniciar() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    sessaoAtual = data.session;
    if (sessaoAtual) {
      await carregarPerfilEEntrar();
    } else {
      mostrarTela("tela-acesso-admin");
    }
  } catch (e) {
    console.error("Falha ao iniciar o app:", e);
    $("tela-carregando").innerHTML =
      '<div class="text-center px-6"><p class="text-rose-400 text-sm font-medium mb-2">Não foi possível conectar.</p>' +
      '<p class="text-slate-500 text-xs">Verifique sua conexão com a internet e recarregue a página. Se persistir, avise o administrador.</p></div>';
  }
}

async function carregarPerfilEEntrar() {
  const uid = sessaoAtual.user.id;

  const { data: sisData } = await supabase.from("usuarios_sistema").select("*").eq("user_id", uid).maybeSingle();
  if (sisData) {
    usuarioSistemaAtual = sisData;
    await entrarNoPainelAdmin();
    return;
  }

  const { data, error } = await supabase.from("instrutores").select("*").eq("user_id", uid).maybeSingle();
  if (error || !data) {
    // sessão órfã (sem linha vinculada) — desloga
    await supabase.auth.signOut();
    mostrarTela("tela-acesso-admin");
    return;
  }
  perfilAtual = data;
  entrarNaAgendaInstrutor();
}

// ---------------------------------------------------------
// LOGIN (instrutor)
// ---------------------------------------------------------
$("btn-login").addEventListener("click", async () => {
  esconderErro("login-erro");
  const email = $("login-email").value.trim();
  const senha = $("login-senha").value;
  if (!email || !senha) return mostrarErro("login-erro", "Informe e-mail e senha.");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) return mostrarErro("login-erro", "E-mail ou senha incorretos.");
  sessaoAtual = data.session;
  await carregarPerfilEEntrar();
});

$("btn-ir-primeiro-acesso").addEventListener("click", () => {
  esconderErro("pa-erro");
  $("pa-email").value = $("login-email").value;
  $("pa-lgpd").checked = false;
  mostrarTela("tela-primeiro-acesso");
});
$("btn-voltar-login-1").addEventListener("click", () => mostrarTela("tela-login"));
$("btn-voltar-login-2").addEventListener("click", () => mostrarTela("tela-login"));

// ---------------------------------------------------------
// PRIMEIRO ACESSO (instrutor cria a própria senha)
// ---------------------------------------------------------
$("btn-criar-senha").addEventListener("click", async () => {
  esconderErro("pa-erro");
  const email = $("pa-email").value.trim();
  const senha = $("pa-senha").value;
  const confirmar = $("pa-confirmar").value;
  if (!email || !senha) return mostrarErro("pa-erro", "Preencha e-mail e senha.");
  if (senha.length < 6) return mostrarErro("pa-erro", "A senha precisa ter pelo menos 6 caracteres.");
  if (senha !== confirmar) return mostrarErro("pa-erro", "As senhas não coincidem.");
  if (!$("pa-lgpd").checked) return mostrarErro("pa-erro", "É necessário aceitar o termo de tratamento de dados (LGPD) para continuar.");

  const { data: podeCriar, error: podeCriarErro } = await supabase.rpc("pode_criar_senha_primeiro_acesso", { p_email: email, p_tipo: "instrutor" });
  if (podeCriarErro) return mostrarErro("pa-erro", "Não foi possível validar o e-mail. Tente novamente.");
  if (!podeCriar) return mostrarErro("pa-erro", "E-mail não encontrado no cadastro, ou já tem senha. Fale com o administrador.");

  const { data: signUpData, error: signUpErro } = await supabase.auth.signUp({ email, password: senha });
  if (signUpErro) return mostrarErro("pa-erro", traduzirErroAuth(signUpErro));

  // Se o projeto exige confirmação de e-mail, ainda não há sessão aqui.
  if (!signUpData.session) {
    return mostrarErro(
      "pa-erro",
      "Conta criada! Confirme seu e-mail (verifique a caixa de entrada) e depois faça login normalmente."
    );
  }

  sessaoAtual = signUpData.session;
  const { error: vinculoErro } = await supabase.rpc("vincular_instrutor", { p_email: email, p_lgpd_aceito: true });
  if (vinculoErro) {
    return mostrarErro("pa-erro", "E-mail não encontrado no cadastro, ou já vinculado. Fale com o administrador.");
  }
  await carregarPerfilEEntrar();
});

// ---------------------------------------------------------
// ACESSO ADMINISTRADOR
// ---------------------------------------------------------
$("btn-ir-admin").addEventListener("click", () => {
  esconderErro("admin-login-erro");
  mostrarTela("tela-acesso-admin");
});

$("btn-entrar-admin").addEventListener("click", async () => {
  esconderErro("admin-login-erro");
  const email = $("admin-login-email").value.trim();
  const senha = $("admin-login-senha").value;
  if (!email || !senha) return mostrarErro("admin-login-erro", "Informe e-mail e senha.");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) return mostrarErro("admin-login-erro", "E-mail ou senha incorretos.");
  sessaoAtual = data.session;

  const { data: perfil, error: perfilErro } = await supabase
    .from("usuarios_sistema").select("*").eq("user_id", data.session.user.id).maybeSingle();
  if (perfilErro || !perfil || perfil.status !== "Ativo") {
    await supabase.auth.signOut();
    return mostrarErro("admin-login-erro", "Essa conta não tem acesso à área de trabalho.");
  }
  usuarioSistemaAtual = perfil;
  await entrarNoPainelAdmin();
});

$("btn-ir-primeiro-acesso-sistema").addEventListener("click", () => {
  esconderErro("pas-erro");
  $("pas-email").value = $("admin-login-email").value;
  mostrarTela("tela-primeiro-acesso-sistema");
});
$("btn-voltar-acesso-admin").addEventListener("click", () => mostrarTela("tela-acesso-admin"));

$("btn-criar-senha-sistema").addEventListener("click", async () => {
  esconderErro("pas-erro");
  const email = $("pas-email").value.trim();
  const senha = $("pas-senha").value;
  const confirmar = $("pas-confirmar").value;
  if (!email || !senha) return mostrarErro("pas-erro", "Preencha e-mail e senha.");
  if (senha.length < 6) return mostrarErro("pas-erro", "A senha precisa ter pelo menos 6 caracteres.");
  if (senha !== confirmar) return mostrarErro("pas-erro", "As senhas não coincidem.");

  const { data: podeCriar, error: podeCriarErro } = await supabase.rpc("pode_criar_senha_primeiro_acesso", { p_email: email, p_tipo: "sistema" });
  if (podeCriarErro) return mostrarErro("pas-erro", "Não foi possível validar o e-mail. Tente novamente.");
  if (!podeCriar) return mostrarErro("pas-erro", "E-mail não encontrado no cadastro, ou já tem senha. Fale com o administrador.");

  const { data: signUpData, error: signUpErro } = await supabase.auth.signUp({ email, password: senha });
  if (signUpErro) return mostrarErro("pas-erro", traduzirErroAuth(signUpErro));

  if (!signUpData.session) {
    return mostrarErro(
      "pas-erro",
      "Conta criada! Confirme seu e-mail (verifique a caixa de entrada) e depois faça login normalmente."
    );
  }

  sessaoAtual = signUpData.session;
  const { error: vinculoErro } = await supabase.rpc("vincular_usuario_sistema", { p_email: email });
  if (vinculoErro) {
    return mostrarErro("pas-erro", "E-mail não encontrado no cadastro, ou já vinculado. Fale com o administrador.");
  }
  await carregarPerfilEEntrar();
});

$("btn-ir-trocar-senha").addEventListener("click", () => {
  telaAposLoginParaTrocaSenha = "tela-acesso-admin";
  $("ts-email").value = $("admin-login-email").value;
  esconderErro("ts-erro");
  mostrarTela("tela-trocar-senha");
});

// ---------------------------------------------------------
// TROCAR SENHA (funciona para admin e instrutor — reautentica antes)
// ---------------------------------------------------------
$("btn-salvar-nova-senha").addEventListener("click", async () => {
  esconderErro("ts-erro");
  const email = $("ts-email").value.trim();
  const senhaAtual = $("ts-senha-atual").value;
  const senhaNova = $("ts-senha-nova").value;
  if (!email || !senhaAtual || !senhaNova) return mostrarErro("ts-erro", "Preencha todos os campos.");
  if (senhaNova.length < 6) return mostrarErro("ts-erro", "A nova senha precisa ter pelo menos 6 caracteres.");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senhaAtual });
  if (error) return mostrarErro("ts-erro", "E-mail ou senha atual incorretos.");
  sessaoAtual = data.session;

  const { error: erroUpdate } = await supabase.auth.updateUser({ password: senhaNova });
  if (erroUpdate) return mostrarErro("ts-erro", "Não foi possível alterar a senha. Tente novamente.");

  await carregarPerfilEEntrar();
});

$("btn-cancelar-troca").addEventListener("click", () => mostrarTela(telaAposLoginParaTrocaSenha));

// ---------------------------------------------------------
// RECUPERAR SENHA — solicitação ao administrador + redefinição liberada
//   1) usuário pede -> solicitar_redefinicao_senha (RPC)
//   2) admin libera no cadastro (reset_senha_liberado_em)
//   3) usuário define a nova senha -> Edge Function "redefinir-senha"
// ---------------------------------------------------------
let recTelaOrigem = "tela-acesso-admin";

function irParaRecuperarSenha(origem, emailPrefill) {
  recTelaOrigem = origem;
  esconderErro("rec-email-erro");
  $("rec-email-ok").classList.add("hidden");
  $("rec-email").value = (emailPrefill || "").trim();
  $("rec-red-email").value = (emailPrefill || "").trim();
  mostrarTela("tela-rec-email");
}
$("btn-esqueci-senha-inst").addEventListener("click", () => irParaRecuperarSenha("tela-login", $("login-email").value));
$("btn-esqueci-senha-sistema").addEventListener("click", () => irParaRecuperarSenha("tela-acesso-admin", $("admin-login-email").value));

$("btn-rec-voltar-1").addEventListener("click", () => mostrarTela(recTelaOrigem));
$("btn-rec-voltar-2").addEventListener("click", () => mostrarTela(recTelaOrigem));

$("btn-rec-ir-redefinir").addEventListener("click", () => {
  esconderErro("rec-senha-erro");
  $("rec-red-email").value = ($("rec-email").value || "").trim();
  $("rec-senha-nova").value = "";
  $("rec-senha-confirmar").value = "";
  mostrarTela("tela-rec-senha");
});

$("btn-rec-solicitar").addEventListener("click", async () => {
  esconderErro("rec-email-erro");
  $("rec-email-ok").classList.add("hidden");
  const email = $("rec-email").value.trim().toLowerCase();
  if (!email || !email.includes("@")) return mostrarErro("rec-email-erro", "Informe um e-mail válido.");
  const btn = $("btn-rec-solicitar");
  btn.disabled = true; btn.textContent = "Enviando pedido…";
  const { error } = await supabase.rpc("solicitar_redefinicao_senha", { p_email: email });
  btn.disabled = false; btn.textContent = "Solicitar redefinição ao administrador";
  if (error) return mostrarErro("rec-email-erro", "Não foi possível registrar o pedido. Tente novamente.");
  $("rec-red-email").value = email;
  $("rec-email-ok").textContent = "Pedido registrado. Assim que o administrador liberar a redefinição, volte aqui e toque em \"O administrador já liberou\".";
  $("rec-email-ok").classList.remove("hidden");
});

$("btn-rec-salvar-senha").addEventListener("click", async () => {
  esconderErro("rec-senha-erro");
  const email = $("rec-red-email").value.trim().toLowerCase();
  const s1 = $("rec-senha-nova").value;
  const s2 = $("rec-senha-confirmar").value;
  if (!email || !email.includes("@")) return mostrarErro("rec-senha-erro", "Informe o e-mail cadastrado.");
  if (s1.length < 6) return mostrarErro("rec-senha-erro", "A nova senha precisa ter pelo menos 6 caracteres.");
  if (s1 !== s2) return mostrarErro("rec-senha-erro", "As senhas não coincidem.");
  const btn = $("btn-rec-salvar-senha");
  btn.disabled = true; btn.textContent = "Redefinindo…";
  let out = {};
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/redefinir-senha`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ email, senha: s1 }),
    });
    out = await resp.json().catch(() => ({}));
    btn.disabled = false; btn.textContent = "Redefinir senha";
    if (!resp.ok) return mostrarErro("rec-senha-erro", out.error || "Não foi possível redefinir a senha.");
  } catch (e) {
    btn.disabled = false; btn.textContent = "Redefinir senha";
    return mostrarErro("rec-senha-erro", "Falha de conexão. Tente novamente.");
  }
  alert("Senha redefinida com sucesso. Faça login com a nova senha.");
  mostrarTela(recTelaOrigem);
});

function traduzirErroAuth(error) {
  const msg = (error && error.message) || "";
  if (msg.includes("already registered")) return "Este e-mail já tem uma senha criada. Tente fazer login normalmente; se não souber a senha, use \"Esqueci minha senha\" ou fale com o administrador.";
  if (msg.includes("Password")) return "Senha inválida (mínimo 6 caracteres).";
  return "Não foi possível concluir. Tente novamente.";
}

// ===========================================================
// APP DO INSTRUTOR
// ===========================================================
async function entrarNaAgendaInstrutor() {
  mesCalendarioInstrutor = new Date();
  $("inst-nome").textContent = perfilAtual.nome.split(" ")[0];
  $("inst-especialidade").textContent = perfilAtual.especialidade || "";
  renderizarDadosInstrutor();
  instrutorDatasPreAgendadas = await carregarDatasPreAgendadas(perfilAtual.id);
  renderizarCalendarioInstrutor();
  prosseguirAposLoginInstrutor();
}

function prosseguirAposLoginInstrutor() {
  if (!perfilAtual.lgpd_aceito) {
    abrirTelaLgpdInstrutor();
  } else if (!enderecoInstrutorPreenchido(perfilAtual)) {
    abrirTelaEnderecoInstrutor(true);
  } else {
    mostrarTela("tela-instrutor");
  }
}

// ---------------------------------------------------------
// ACEITE LGPD DO INSTRUTOR (obrigatório no login, para quem foi vinculado antes de o aceite existir)
// ---------------------------------------------------------
function abrirTelaLgpdInstrutor() {
  $("inst-lgpd-check").checked = false;
  esconderErro("inst-lgpd-erro");
  mostrarTela("tela-instrutor-lgpd");
}

$("btn-inst-lgpd-aceitar").addEventListener("click", async () => {
  esconderErro("inst-lgpd-erro");
  if (!$("inst-lgpd-check").checked) {
    return mostrarErro("inst-lgpd-erro", "É necessário aceitar o termo de tratamento de dados (LGPD) para continuar.");
  }
  const btn = $("btn-inst-lgpd-aceitar");
  btn.disabled = true;
  btn.textContent = "Salvando…";
  const { data, error } = await supabase.rpc("aceitar_lgpd");
  btn.disabled = false;
  btn.textContent = "Aceitar e continuar";
  if (error) {
    return mostrarErro("inst-lgpd-erro", "Não foi possível registrar o aceite. Tente novamente.");
  }
  perfilAtual = data;
  prosseguirAposLoginInstrutor();
});

$("btn-inst-lgpd-sair").addEventListener("click", async () => {
  await supabase.auth.signOut();
  perfilAtual = null;
  mostrarTela("tela-login");
});

// ---------------------------------------------------------
// ENDEREÇO DO INSTRUTOR (preenchimento obrigatório no login + atualização via "Meus dados")
// ---------------------------------------------------------
let enderecoInstrutorObrigatorio = false;

function enderecoInstrutorPreenchido(inst) {
  return !!(inst && inst.cep && inst.endereco && inst.numero && inst.bairro && inst.cidade && inst.uf);
}

function abrirTelaEnderecoInstrutor(obrigatorio) {
  enderecoInstrutorObrigatorio = !!obrigatorio;
  $("inste-cep").value = perfilAtual.cep || "";
  $("inste-endereco").value = perfilAtual.endereco || "";
  $("inste-numero").value = perfilAtual.numero || "";
  $("inste-complemento").value = perfilAtual.complemento || "";
  $("inste-bairro").value = perfilAtual.bairro || "";
  $("inste-cidade").value = perfilAtual.cidade || "";
  $("inste-uf").value = perfilAtual.uf || "";
  $("inste-latitude").value = perfilAtual.latitude != null ? perfilAtual.latitude : "";
  $("inste-longitude").value = perfilAtual.longitude != null ? perfilAtual.longitude : "";
  $("inste-cep-status").textContent = "";
  $("inste-erro").classList.add("hidden");
  $("inste-obrigatorio-aviso").classList.toggle("hidden", !enderecoInstrutorObrigatorio);
  $("inste-intro").textContent = enderecoInstrutorObrigatorio
    ? "Precisamos do seu endereço para continuar."
    : "Atualize seu endereço sempre que precisar.";
  $("btn-inste-voltar").classList.toggle("hidden", enderecoInstrutorObrigatorio);
  mostrarTela("tela-instrutor-endereco");
}

$("btn-inst-meus-dados").addEventListener("click", () => abrirTelaEnderecoInstrutor(false));
$("btn-inste-voltar").addEventListener("click", () => mostrarTela("tela-instrutor"));

$("btn-inste-salvar").addEventListener("click", async () => {
  $("inste-erro").classList.add("hidden");
  const cep = $("inste-cep").value.trim();
  const endereco = $("inste-endereco").value.trim();
  const numero = $("inste-numero").value.trim();
  const complemento = $("inste-complemento").value.trim();
  const bairro = $("inste-bairro").value.trim();
  const cidade = $("inste-cidade").value.trim();
  const uf = $("inste-uf").value.trim().toUpperCase();

  if (!cep || !endereco || !numero || !bairro || !cidade || !uf) {
    $("inste-erro").textContent = "Preencha CEP, endereço, número, bairro, cidade e UF (complemento é opcional).";
    $("inste-erro").classList.remove("hidden");
    return;
  }

  if (!$("inste-latitude").value || !$("inste-longitude").value) {
    await geocodificarEnderecoInstrutorSelf();
  }

  const btn = $("btn-inste-salvar");
  btn.disabled = true;
  btn.textContent = "Salvando…";

  const latitude = $("inste-latitude").value === "" ? null : Number($("inste-latitude").value);
  const longitude = $("inste-longitude").value === "" ? null : Number($("inste-longitude").value);
  const payload = { cep, endereco, numero, complemento, bairro, cidade, uf, latitude, longitude };
  const { data, error } = await supabase.from("instrutores").update(payload).eq("id", perfilAtual.id).select().single();

  btn.disabled = false;
  btn.textContent = "Salvar endereço";

  if (error) {
    $("inste-erro").textContent = "Não foi possível salvar. Tente novamente.";
    $("inste-erro").classList.remove("hidden");
    return;
  }

  perfilAtual = data;
  mostrarTela("tela-instrutor");
});

async function buscarCepInstrutor() {
  const status = $("inste-cep-status");
  const cepDigits = $("inste-cep").value.replace(/\D/g, "");
  if (cepDigits.length !== 8) {
    status.className = "text-[11px] mt-1 text-rose-600";
    status.textContent = "Informe um CEP válido (8 dígitos) antes de pesquisar.";
    return;
  }

  const btn = $("btn-inste-buscar-cep");
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Buscando…";
  status.className = "text-[11px] mt-1 text-slate-400";
  status.textContent = "Consultando a base de CEPs…";

  try {
    const resp = await fetch(`https://brasilapi.com.br/api/cep/v2/${cepDigits}`);
    if (!resp.ok) throw new Error("CEP não encontrado");
    const dados = await resp.json();

    $("inste-endereco").value = dados.street || "";
    $("inste-bairro").value = dados.neighborhood || "";
    $("inste-cidade").value = dados.city || "";
    $("inste-uf").value = dados.state || "";

    status.className = "text-[11px] mt-1 text-teal-700";
    status.textContent = "✅ Endereço encontrado. Confira e complete o número/complemento.";
  } catch (e) {
    status.className = "text-[11px] mt-1 text-rose-600";
    status.textContent = "Não foi possível encontrar esse CEP. Confira o número e preencha o endereço manualmente.";
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }

  // Georreferencia automaticamente assim que o endereço é encontrado — sem precisar de outro clique.
  await geocodificarEnderecoInstrutorSelf();
}

async function geocodificarEnderecoInstrutorSelf() {
  const partes = [
    [$("inste-endereco").value.trim(), $("inste-numero").value.trim()].filter(Boolean).join(", "),
    $("inste-bairro").value.trim(),
    $("inste-cidade").value.trim(),
    $("inste-uf").value.trim(),
  ].filter(Boolean);
  const endereco = partes.join(", ");
  if (!endereco) return;
  try {
    const resultado = await geocodificarComFallback({
      textosLivres: [endereco],
      logradouro: $("inste-endereco").value.trim(),
      numero: $("inste-numero").value.trim(),
      bairro: $("inste-bairro").value.trim(),
      cidade: $("inste-cidade").value.trim(),
      uf: $("inste-uf").value.trim(),
      cep: $("inste-cep") ? $("inste-cep").value : "",
    });
    if (resultado) {
      $("inste-latitude").value = resultado.lat;
      $("inste-longitude").value = resultado.lon;
    }
  } catch (e) {
    // Falha silenciosa: não bloqueia o preenchimento do endereço pelo instrutor.
  }
}

$("btn-inste-buscar-cep").addEventListener("click", buscarCepInstrutor);

function renderizarDadosInstrutor() {
  const box = $("inst-dados");
  box.innerHTML = "";
  box.innerHTML += `<p class="flex items-center gap-1.5">✉️ ${perfilAtual.email}</p>`;
  if (perfilAtual.telefone) box.innerHTML += `<p class="flex items-center gap-1.5">📞 ${perfilAtual.telefone}</p>`;
  if (perfilAtual.carga_horaria) box.innerHTML += `<p>Carga horária: ${perfilAtual.carga_horaria}h/mês</p>`;

  if (perfilAtual.documento_url) {
    $("inst-doc-bloco").classList.remove("hidden");
    obterUrlDocumento(perfilAtual.documento_url).then((url) => {
      if (url) $("inst-doc-img").src = url;
    });
  } else {
    $("inst-doc-bloco").classList.add("hidden");
  }
}

function renderizarCalendarioInstrutor() {
  renderizarGradeCalendario({
    mes: mesCalendarioInstrutor,
    diasStatus: perfilAtual.dias_status,
    elLabel: $("inst-mes-label"),
    elSemana: $("inst-dias-semana"),
    elGrade: $("inst-grade-dias"),
    datasPreAgendadas: instrutorDatasPreAgendadas,
    aoClicarDia: (dataStr, statusAtual) => {
      const novoStatus = statusAtual === "disponivel" ? "bloqueado" : "disponivel";
      salvarDiasStatusInstrutor({ ...perfilAtual.dias_status, [dataStr]: novoStatus });
    },
  });

  const contagem = contarStatus(perfilAtual.dias_status);
  const preCount = [...instrutorDatasPreAgendadas].filter((d) => obterStatusDia(perfilAtual.dias_status, d) === "agendado").length;
  $("inst-contagem-dias").textContent = `${contagem.disponivel} dia(s) disponíveis · ${contagem.agendado} agendado(s)` +
    (preCount > 0 ? ` · ${preCount} pré-agendado(s)` : "");

  if (contagem.aguardando > 0) {
    $("inst-alerta-aguardando").classList.remove("hidden");
    $("inst-alerta-aguardando").querySelector("span").textContent =
      `${contagem.aguardando} dia(s) aguardando confirmação do agendamento`;
  } else {
    $("inst-alerta-aguardando").classList.add("hidden");
  }
}

async function salvarDiasStatusInstrutor(novoDiasStatus) {
  const { data, error } = await supabase
    .from("instrutores").update({ dias_status: novoDiasStatus }).eq("id", perfilAtual.id).select().single();
  if (!error) {
    perfilAtual = data;
    renderizarCalendarioInstrutor();
  }
}

$("inst-bloquear-mes").addEventListener("click", () => {
  salvarDiasStatusInstrutor(aplicarStatusNoMes(perfilAtual.dias_status, mesCalendarioInstrutor, "bloqueado"));
});
$("inst-disponibilizar-mes").addEventListener("click", () => {
  salvarDiasStatusInstrutor(aplicarStatusNoMes(perfilAtual.dias_status, mesCalendarioInstrutor, "disponivel"));
});

$("inst-mes-anterior").addEventListener("click", () => {
  mesCalendarioInstrutor = new Date(mesCalendarioInstrutor.getFullYear(), mesCalendarioInstrutor.getMonth() - 1, 1);
  renderizarCalendarioInstrutor();
});
$("inst-mes-proximo").addEventListener("click", () => {
  mesCalendarioInstrutor = new Date(mesCalendarioInstrutor.getFullYear(), mesCalendarioInstrutor.getMonth() + 1, 1);
  renderizarCalendarioInstrutor();
});

$("btn-sair-instrutor").addEventListener("click", async () => {
  await supabase.auth.signOut();
  perfilAtual = null;
  mostrarTela("tela-login");
});

$("btn-inst-trocar-senha").addEventListener("click", () => {
  telaAposLoginParaTrocaSenha = "tela-instrutor";
  $("ts-email").value = perfilAtual.email;
  esconderErro("ts-erro");
  mostrarTela("tela-trocar-senha");
});

$("inst-doc-abrir").addEventListener("click", () => {
  $("modal-doc-img").src = $("inst-doc-img").src;
  $("modal-doc-nome").textContent = perfilAtual.nome;
  $("modal-doc").classList.remove("hidden");
});
$("modal-doc").addEventListener("click", () => $("modal-doc").classList.add("hidden"));

async function obterUrlDocumento(path) {
  const { data, error } = await supabase.storage.from("documentos").createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}

// ===========================================================
// PAINEL ADMINISTRATIVO
// ===========================================================
async function entrarNoPainelAdmin() {
  permissoesAtual = {};
  if (usuarioSistemaAtual.role !== "admin") {
    const { data: permsData } = await supabase
      .from("permissoes").select("*").eq("usuario_id", usuarioSistemaAtual.id);
    (permsData || []).forEach((p) => { permissoesAtual[p.modulo] = p; });
  }
  mostrarTela("tela-admin");
  if ($("admin-usuario-nome")) {
    const nomeUsuario = usuarioSistemaAtual.nome || usuarioSistemaAtual.email || "";
    $("admin-usuario-nome").textContent = nomeUsuario;
    $("admin-usuario-nome").title = usuarioSistemaAtual.email || nomeUsuario;
  }
  try {
    const areaGuardada = sessionStorage.getItem("wf_area_ativa");
    sessionStorage.removeItem("wf_area_ativa");
    if (areaGuardada && AREAS.includes(areaGuardada)) areaAtiva = areaGuardada;
  } catch (e) { /* sem storage */ }
  renderizarNavAdmin();
  mostrarMenuInicio();
  carregarSituacaoAprovacaoReembolso();
  if ($("app-versao-label")) $("app-versao-label").textContent = `Versão: ${APP_VERSAO}`;
}

// Descobre se o usuário logado participa do fluxo de aprovação de reembolso
// (gestor direto de alguém, gestor financeiro, ou admin) para decidir se o
// módulo "Aprovações de Reembolso" (área Financeiro) aparece no menu. Como
// a chamada é assíncrona, o menu é re-renderizado quando ela volta.
async function carregarSituacaoAprovacaoReembolso() {
  const { data, error } = await supabase.rpc("reembolso_minha_situacao_aprovacao");
  aprovSituacao = error ? { eh_gestor: false, eh_financeiro: false, eh_admin: false } : (data || {});
  renderizarNavAdmin();
  if (moduloAtivo === null) mostrarMenuInicio();
}

// Áreas da empresa (Cadastros Básicos, Comercial, Compras, Logística, Operações, Financeiro)
// como botões no topo da página, abaixo do usuário logado. "Início" mostra todas as áreas.
// A área escolhida também filtra o menu lateral e a grade do menu inicial.
function renderizarAbasAreas() {
  const cont = $("admin-areas-topo");
  if (!cont) return;
  const inicioAtivo = moduloAtivo === null && areaAtiva === "Geral";
  cont.innerHTML = `
    <button data-area-topo="Geral" class="text-sm px-3 py-1.5 rounded-md border transition ${
      inicioAtivo ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-300 hover:border-amber-400"
    }">🏠 Início</button>` + AREAS.filter((a) => a !== "Geral").map((a) => {
    const qtd = MODULOS.filter((m) => m.grupo === a && podeFazer(m.id, "consultar")).length;
    return `
    <button data-area-topo="${a}" class="text-sm px-3 py-1.5 rounded-md border transition ${
      a === areaAtiva
        ? "bg-slate-900 text-white border-slate-900"
        : qtd === 0
          ? "bg-white text-slate-300 border-slate-200"
          : "bg-white text-slate-600 border-slate-300 hover:border-amber-400"
    }">${a}${qtd > 0 ? ` <span class="text-[10px] opacity-70">${qtd}</span>` : ""}</button>`;
  }).join("");
  cont.querySelectorAll("[data-area-topo]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (!sairEditorOrcamentoPermitido()) return;
      areaAtiva = btn.getAttribute("data-area-topo");
      voltarParaInicio();
    }));
}

// Voltar ao início: ao sair do cadastro de Empresas (lista grande) a página é
// recarregada, para liberar a memória e voltar com tudo atualizado. A área
// escolhida no menu é mantida.
function voltarParaInicio() {
  if (!sairEditorOrcamentoPermitido()) return;
  if (moduloAtivo === "empresas") {
    try { sessionStorage.setItem("wf_area_ativa", areaAtiva); } catch (e) { /* sem storage: volta para Geral */ }
    window.location.reload();
    return;
  }
  mostrarMenuInicio();
}

function mostrarMenuInicio() {
  verificarNovaVersao();
  moduloAtivo = null;
  document.querySelectorAll("#tela-admin main > section").forEach((s) => s.classList.add("hidden"));
  renderizarNavAdmin();

  const acessiveis = modulosDaArea();
  $("admin-eyebrow").textContent = "Work Fire mais perto de você";
  $("admin-titulo-pagina").textContent = areaAtiva === "Geral" ? "Geral" : areaAtiva;
  $("admin-descricao-pagina").textContent = MODULOS.some((m) => podeFazer(m.id, "consultar"))
    ? "Escolha a área da empresa e, em seguida, o cadastro ou operação."
    : "Seu usuário ainda não tem acesso a nenhum cadastro ou operação. Fale com o administrador.";

  $("secao-inicio").classList.remove("hidden");
  const grade = $("inicio-grade");
  if (acessiveis.length === 0) {
    grade.innerHTML = `<div class="col-span-full bg-white border border-dashed border-slate-300 rounded-lg py-16 text-center text-slate-500 text-sm">Nenhum item disponível nesta área.</div>`;
    return;
  }
  grade.innerHTML = acessiveis.map((m) => `
    <button data-inicio-modulo="${m.id}" class="text-left bg-white rounded-lg border border-slate-200 p-5 flex items-center gap-3 shadow-sm hover:border-amber-400 hover:shadow-md transition">
      <span class="text-2xl">${m.icone}</span>
      <div>
        <p class="font-serif text-base text-slate-900 leading-tight">${m.label}</p>
        <p class="text-[11px] text-slate-400 mt-0.5">${m.grupo}</p>
      </div>
    </button>
  `).join("");
  grade.querySelectorAll("[data-inicio-modulo]").forEach((btn) =>
    btn.addEventListener("click", () => irParaModulo(btn.getAttribute("data-inicio-modulo")))
  );
}

// ---------------------------------------------------------
// Navegação da área de trabalho (sidebar + troca de módulo)
// ---------------------------------------------------------
function renderizarNavAdmin() {
  const nav = $("admin-nav");
  const grupos = {};
  modulosDaArea().forEach((m) => {
    (grupos[m.grupo] = grupos[m.grupo] || []).push(m);
  });

  const botaoInicio = `
    <button data-nav-inicio class="flex items-center gap-2 rounded-md px-3 py-2 text-left w-full mb-3 ${
      moduloAtivo === null ? "bg-slate-800 text-white border-l-2 border-amber-500" : "hover:bg-slate-800 hover:text-white"
    }">🏠 Geral</button>
  `;

  nav.innerHTML = botaoInicio + (Object.keys(grupos).length === 0
    ? `<p class="text-[11px] text-slate-500 px-3 py-2">Nenhum item disponível nesta área.</p>` : "")
    + Object.entries(grupos).map(([grupo, itens]) => `
    <p class="text-[10px] uppercase tracking-wider text-slate-500 px-3 mt-4 mb-1 first:mt-0">${grupo}</p>
    ${itens.map((m) => `
      <button data-nav-modulo="${m.id}" class="flex items-center gap-2 rounded-md px-3 py-2 text-left w-full ${
        m.id === moduloAtivo ? "bg-slate-800 text-white border-l-2 border-amber-500" : "hover:bg-slate-800 hover:text-white"
      }">${m.icone} ${m.label}</button>
    `).join("")}
  `).join("");

  nav.querySelector("[data-nav-inicio]").addEventListener("click", voltarParaInicio);
  nav.querySelectorAll("[data-nav-modulo]").forEach((btn) =>
    btn.addEventListener("click", () => irParaModulo(btn.getAttribute("data-nav-modulo")))
  );
  renderizarAbasAreas();
}

function irParaModulo(id) {
  if (!sairEditorOrcamentoPermitido()) return;
  verificarNovaVersao();
  moduloAtivo = id;
  const metaArea = MODULOS.find((m) => m.id === id);
  if (metaArea && areaAtiva !== "Geral" && metaArea.grupo !== areaAtiva) areaAtiva = metaArea.grupo;
  document.querySelectorAll("#tela-admin main > section").forEach((s) => s.classList.add("hidden"));
  const meta = MODULOS.find((m) => m.id === id);
  $("admin-eyebrow").textContent = meta.grupo;
  $("admin-titulo-pagina").textContent = meta.label;
  renderizarNavAdmin();

  if (id === "instrutores") {
    $("admin-descricao-pagina").textContent = "Registre os instrutores que poderão ser alocados na agenda de turmas e treinamentos.";
    $("secao-instrutores").classList.remove("hidden");
    carregarListaAdmin();
  } else if (CRUD_CONFIG[id]) {
    $("secao-crud").classList.remove("hidden");
    carregarModuloCrud(id);
  } else if (id === "agendamentos") {
    $("secao-agendamentos").classList.remove("hidden");
    carregarAgendamentos();
  } else if (id === "orcamentos") {
    $("secao-orcamentos").classList.remove("hidden");
    carregarOrcamentos();
  } else if (id === "turmas") {
    $("secao-turmas").classList.remove("hidden");
    carregarTurmasInit();
  } else if (id === "agendamento_turmas") {
    $("secao-agendamento-turmas").classList.remove("hidden");
    carregarAgendamentoTurmasInit();
  } else if (id === "confirmacao_ct") {
    $("secao-confirmacao-ct").classList.remove("hidden");
    carregarConfirmacaoCtInit();
  } else if (id === "agenda_centros") {
    $("secao-agenda-centros").classList.remove("hidden");
    carregarAgendaCentrosInit();
  } else if (id === "disponibilidade_instrutores") {
    $("admin-descricao-pagina").textContent = "Consulte a disponibilidade dos instrutores mês a mês, por centro de treinamento.";
    $("secao-disponibilidade-instrutores").classList.remove("hidden");
    carregarDisponibilidadeInstrutoresInit();
  } else if (id === "documentos_turmas") {
    $("secao-documentos-turmas").classList.remove("hidden");
    carregarDocumentosTurmasInit();
  } else if (id === "treinamentos_capacitacao") {
    $("secao-treinamentos-capacitacao").classList.remove("hidden");
    carregarTreinamentosCapacitacaoInit();
  } else if (id === "aprovacoes_reembolso") {
    $("admin-descricao-pagina").textContent = "Reembolsos aguardando a sua decisão, como gestor direto e/ou gestor financeiro.";
    $("secao-aprov-reembolsos").classList.remove("hidden");
    carregarAprovacoesReembolsoInit();
  } else if (id === "consulta_reembolsos") {
    $("admin-descricao-pagina").textContent = "Todos os reembolsos dentro de um período, com filtros por solicitante, gestor direto e status.";
    $("secao-consulta-reembolsos").classList.remove("hidden");
    carregarConsultaReembolsosInit();
  }
}

async function carregarListaAdmin() {
  await carregarAptidoesRefs();
  const { data, error } = await supabase.from("instrutores").select("*").order("nome");
  if (!error) {
    listaInstrutoresAdmin = data.filter((i) => i.role !== "admin");
    $("btn-novo-instrutor").classList.toggle("hidden", !podeFazer("instrutores", "incluir"));
    renderizarListaAdmin();
  }
}

function renderizarListaAdmin() {
  const busca = $("admin-busca").value.toLowerCase();
  const filtroStatus = $("admin-filtro-status").value;

  const lista = listaInstrutoresAdmin
    .filter((i) => filtroStatus === "Todos" || i.status === filtroStatus)
    .filter((i) => `${i.nome} ${i.especialidade || ""} ${i.codigo || ""}`.toLowerCase().includes(busca));

  $("stat-total").textContent = listaInstrutoresAdmin.length;
  $("stat-ativos").textContent = listaInstrutoresAdmin.filter((i) => i.status === "Ativo").length;
  $("stat-especialidades").textContent = new Set(listaInstrutoresAdmin.map((i) => i.especialidade).filter(Boolean)).size;

  const container = $("admin-lista");
  if (lista.length === 0) {
    container.innerHTML = `<div class="col-span-full bg-white border border-dashed border-slate-300 rounded-lg py-16 text-center text-slate-500 text-sm">Nenhum instrutor encontrado.</div>`;
    return;
  }

  const podeAlterarInst = podeFazer("instrutores", "alterar");
  const podeExcluirInst = podeFazer("instrutores", "excluir");

  container.innerHTML = lista.map((inst) => {
    const c = contarStatus(inst.dias_status);
    return `
    <div class="bg-white rounded-lg border border-slate-200 border-t-4 ${inst.status === "Ativo" ? "border-t-teal-600" : "border-t-rose-400"} p-4 flex flex-col gap-2 shadow-sm">
      <div class="flex items-start justify-between">
        <div>
          <p class="font-mono text-[11px] text-slate-400">${inst.codigo || ""}</p>
          <p class="font-serif text-lg text-slate-900 leading-tight">${inst.nome}</p>
        </div>
        <span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${inst.status === "Ativo" ? "bg-teal-50 text-teal-700" : "bg-rose-50 text-rose-600"}">${inst.status}</span>
      </div>
      <p class="text-sm text-amber-700 font-medium">🏷️ ${inst.especialidade || "—"}</p>
      <div class="text-xs text-slate-500 space-y-1 mt-1">
        ${inst.email ? `<p>✉️ ${inst.email}</p>` : ""}
        ${inst.telefone ? `<p>📞 ${inst.telefone}</p>` : ""}
        ${inst.carga_horaria ? `<p>Carga horária: ${inst.carga_horaria}h/mês</p>` : ""}
        <p>📌 ${c.disponivel} disponíveis · 📘 ${c.agendado} agendados${c.aguardando > 0 ? ` · ⏳ ${c.aguardando} aguardando` : ""}</p>
        <p>${inst.user_id ? "✅ Já criou senha no app" : "⏳ Aguardando primeiro acesso"}</p>
        ${inst.centro_treinamento_principal_id ? `<p class="text-slate-500">🏫 CT principal: ${(centrosParaInstrutor.find((c) => c.id === inst.centro_treinamento_principal_id) || {}).nome || "—"}</p>` : ""}
        ${rotulosAptidoes(inst.id).length ? `<p class="text-slate-500">🗃️ Apto: ${rotulosAptidoes(inst.id).join(", ")}</p>` : ""}
        ${inst.reset_senha_liberado_em ? `<p class="text-teal-700">🔓 Redefinição de senha liberada</p>`
          : (inst.reset_senha_solicitado_em ? `<p class="text-amber-700 font-medium">🔑 Redefinição de senha SOLICITADA</p>` : "")}
      </div>
      <div class="flex flex-wrap gap-2 mt-2 pt-2 border-t border-slate-100">
        ${podeAlterarInst ? `<button data-editar="${inst.id}" class="flex-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md py-1.5">✏️ Editar</button>` : ""}
        ${podeExcluirInst ? `<button data-excluir="${inst.id}" class="flex-1 text-xs font-medium text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-md py-1.5">🗑️ Excluir</button>` : ""}
        ${podeAlterarInst && (inst.reset_senha_solicitado_em || inst.reset_senha_liberado_em)
          ? `<button data-liberar-reset="${inst.id}" data-liberado="${inst.reset_senha_liberado_em ? "1" : ""}" class="w-full text-xs font-medium ${inst.reset_senha_liberado_em ? "text-rose-600 hover:underline" : "text-white bg-teal-700 hover:bg-teal-800 rounded-md py-1.5"}">${inst.reset_senha_liberado_em ? "Cancelar liberação de senha" : "🔓 Liberar redefinição de senha"}</button>`
          : ""}
      </div>
    </div>
  `;
  }).join("");

  container.querySelectorAll("[data-editar]").forEach((btn) =>
    btn.addEventListener("click", () => abrirEdicao(btn.getAttribute("data-editar")))
  );
  container.querySelectorAll("[data-excluir]").forEach((btn) =>
    btn.addEventListener("click", () => excluirInstrutor(btn.getAttribute("data-excluir")))
  );
  container.querySelectorAll("[data-liberar-reset]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-liberar-reset");
      const jaLiberado = btn.getAttribute("data-liberado") === "1";
      btn.disabled = true;
      const { error } = await supabase.from("instrutores")
        .update({ reset_senha_liberado_em: jaLiberado ? null : new Date().toISOString() }).eq("id", id);
      if (error) { btn.disabled = false; return alert("Não foi possível atualizar. " + (error.message || "")); }
      if (!jaLiberado) alert("Redefinição liberada. Avise o instrutor: na tela de login, \"Esqueci minha senha\" → \"O administrador já liberou\" → definir a nova senha (validade 24h).");
      await carregarListaAdmin();
    })
  );
}

$("admin-busca").addEventListener("input", renderizarListaAdmin);
$("admin-filtro-status").addEventListener("change", renderizarListaAdmin);

function verTelaInstrutor() {
  mostrarTela("tela-login");
}
function trocarSenhaAdmin() {
  telaAposLoginParaTrocaSenha = "tela-admin";
  $("ts-email").value = usuarioSistemaAtual.email;
  esconderErro("ts-erro");
  mostrarTela("tela-trocar-senha");
}
async function sairAdmin() {
  fecharEditorOrcamento();
  await supabase.auth.signOut();
  usuarioSistemaAtual = null;
  permissoesAtual = {};
  moduloAtivo = null;
  mostrarTela("tela-acesso-admin");
}

["btn-ver-instrutor", "btn-ver-instrutor-desktop"].forEach((id) => $(id).addEventListener("click", verTelaInstrutor));
["btn-admin-trocar-senha", "btn-admin-trocar-senha-desktop"].forEach((id) => $(id).addEventListener("click", trocarSenhaAdmin));
["btn-admin-sair-mobile"].forEach((id) => $(id).addEventListener("click", sairAdmin));

// --- Formulário de cadastro/edição ---
function limparFormulario() {
  ["f-nome","f-cpf","f-email","f-telefone","f-especialidade","f-carga","f-observacoes","f-cep","f-endereco","f-numero","f-complemento","f-bairro","f-cidade","f-uf","f-latitude","f-longitude"].forEach((id) => ($(id).value = ""));
  $("f-cep-status").textContent = "";
  $("f-geo-status").textContent = "";
  $("f-status").value = "Ativo";
  if ($("f-gestor-direto")) $("f-gestor-direto").value = "";
  diasStatusForm = {};
  formDatasPreAgendadas = new Set();
  pendingDocFile = null;
  pendingDocPreviewUrl = null;
  docUrlAtualForm = null;
  $("f-doc-preview").classList.add("hidden");
  $("f-doc-upload-label").classList.remove("hidden");
  $("f-doc-input").value = "";
  mesCalendarioForm = new Date();
  aptidoesSelecionadas = new Set();
  esconderErro("form-erro");
  logConfirmacaoInstrutorLista = [];
  $("f-log-confirmacao-bloco").classList.add("hidden");
}

function preencherSelectGestorDireto(valorAtual, excluirId) {
  const sel = $("f-gestor-direto");
  if (!sel) return;
  const opcoes = usuariosSistemaRefGestores.filter((u) => u.id !== excluirId);
  sel.innerHTML = `<option value="">— Selecione —</option>` +
    opcoes.map((u) => `<option value="${u.id}" ${u.id === valorAtual ? "selected" : ""}>${u.nome}</option>`).join("");
}

$("btn-novo-instrutor").addEventListener("click", async () => {
  editandoId = null;
  limparFormulario();
  $("painel-titulo").textContent = "Novo instrutor";
  $("btn-salvar-instrutor").textContent = "Cadastrar instrutor";
  preencherCentroPrincipalForm("");
  renderizarAptidoesForm();
  renderizarCalendarioForm();
  await carregarUsuariosSistemaRefGestores();
  preencherSelectGestorDireto(null, null);
  $("painel-form").classList.remove("hidden");
});

async function abrirEdicao(id) {
  const inst = listaInstrutoresAdmin.find((i) => i.id === id);
  if (!inst) return;
  editandoId = id;
  limparFormulario();
  carregarDatasPreAgendadas(id).then((datas) => {
    formDatasPreAgendadas = datas;
    if (editandoId === id) renderizarCalendarioForm();
  });
  $("f-nome").value = inst.nome || "";
  $("f-cpf").value = inst.cpf || "";
  $("f-email").value = inst.email || "";
  $("f-telefone").value = inst.telefone || "";
  $("f-especialidade").value = inst.especialidade || "";
  $("f-carga").value = inst.carga_horaria || "";
  $("f-observacoes").value = inst.observacoes || "";
  $("f-cep").value = inst.cep || "";
  $("f-endereco").value = inst.endereco || "";
  $("f-numero").value = inst.numero || "";
  $("f-complemento").value = inst.complemento || "";
  $("f-bairro").value = inst.bairro || "";
  $("f-cidade").value = inst.cidade || "";
  $("f-uf").value = inst.uf || "";
  $("f-latitude").value = inst.latitude != null ? inst.latitude : "";
  $("f-longitude").value = inst.longitude != null ? inst.longitude : "";
  $("f-status").value = inst.status || "Ativo";
  diasStatusForm = { ...(inst.dias_status || {}) };
  docUrlAtualForm = inst.documento_url || null;

  if (docUrlAtualForm) {
    $("f-doc-preview").classList.remove("hidden");
    $("f-doc-upload-label").classList.add("hidden");
    obterUrlDocumento(docUrlAtualForm).then((url) => { if (url) $("f-doc-img").src = url; });
  }

  preencherCentroPrincipalForm(inst.centro_treinamento_principal_id || "");
  aptidoesSelecionadas = new Set(aptidoesPorInstrutor[id] || []);
  renderizarAptidoesForm();

  $("painel-titulo").textContent = "Editar instrutor";
  $("btn-salvar-instrutor").textContent = "Salvar alterações";
  renderizarCalendarioForm();
  $("painel-form").classList.remove("hidden");
  carregarLogConfirmacaoInstrutor(id);
  carregarUsuariosSistemaRefGestores().then(() => preencherSelectGestorDireto(inst.gestor_direto_id || null, null));
}

// ===========================================================
// Histórico de confirmações do instrutor (instrutor_confirmacao_log)
// Visível na tela de edição do instrutor; exclusão restrita a admin.
// ===========================================================
let logConfirmacaoInstrutorLista = [];

const LOG_CONFIRMACAO_TIPO_LABEL = {
  solicitacao_confirmacao: "📨 Solicitação de confirmação enviada",
  resposta_confirmacao: "✅ Resposta do instrutor à confirmação",
  solicitacao_cancelamento: "🚫 Instrutor pediu cancelamento",
  resposta_cancelamento: "📋 Centro de Treinamento respondeu ao cancelamento",
};

async function carregarLogConfirmacaoInstrutor(instrutorId) {
  $("f-log-confirmacao-bloco").classList.remove("hidden");
  $("f-log-confirmacao-lista").innerHTML = `<p class="text-xs text-slate-400">Carregando…</p>`;
  const { data, error } = await supabase
    .from("instrutor_confirmacao_log")
    .select("*, turmas(identificacao), usuarios_sistema(nome)")
    .eq("instrutor_id", instrutorId)
    .order("criado_em", { ascending: false });
  if (editandoId !== instrutorId) return; // painel pode ter mudado enquanto carregava
  if (error) {
    $("f-log-confirmacao-lista").innerHTML = `<p class="text-xs text-rose-500">Não foi possível carregar o histórico.</p>`;
    return;
  }
  logConfirmacaoInstrutorLista = data || [];
  renderizarLogConfirmacaoInstrutor();
}

function renderizarLogConfirmacaoInstrutor() {
  const el = $("f-log-confirmacao-lista");
  if (!logConfirmacaoInstrutorLista.length) {
    el.innerHTML = `<p class="text-xs text-slate-400">Nenhum registro encontrado.</p>`;
    return;
  }
  const podeExcluirLog = usuarioSistemaAtual && usuarioSistemaAtual.role === "admin";
  el.innerHTML = logConfirmacaoInstrutorLista.map((l) => {
    const dataHora = new Date(l.criado_em);
    const horaFmt = isNaN(dataHora) ? "" : dataHora.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const turmaLabel = l.turmas?.identificacao ? `Turma ${l.turmas.identificacao}` : "";
    const quemLabel = l.usuarios_sistema?.nome ? ` · por ${l.usuarios_sistema.nome}` : "";
    const corResposta = l.resposta === "confirmado" || l.resposta === "aprovado" ? "text-teal-700" : (l.resposta === "negado" || l.resposta === "rejeitado" ? "text-rose-600" : "text-slate-700");
    const respostaLabel = l.resposta ? ` — <span class="font-medium ${corResposta}">${l.resposta}</span>` : "";
    return `
    <div class="text-xs bg-white border border-slate-200 rounded-md px-2.5 py-2">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1">
          <p class="font-medium text-slate-700">${LOG_CONFIRMACAO_TIPO_LABEL[l.tipo_evento] || l.tipo_evento}${respostaLabel}</p>
          <p class="text-slate-500 mt-0.5">${[turmaLabel, `Data do treinamento: ${formatarDataBr(l.data_treinamento)}`].filter(Boolean).join(" · ")}</p>
          ${l.justificativa ? `<p class="text-slate-400 italic mt-0.5">"${l.justificativa}"</p>` : ""}
          <p class="text-slate-400 mt-0.5">${horaFmt}${quemLabel}</p>
        </div>
        ${podeExcluirLog ? `<button data-log-excluir="${l.id}" class="text-slate-400 hover:text-rose-600 text-xs shrink-0" title="Excluir registro">🗑️</button>` : ""}
      </div>
    </div>`;
  }).join("");
}

$("f-log-confirmacao-lista").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-log-excluir]");
  if (!btn) return;
  if (!(usuarioSistemaAtual && usuarioSistemaAtual.role === "admin")) return;
  if (!confirmarExclusao("este registro do histórico de confirmações")) return;
  const id = btn.getAttribute("data-log-excluir");
  const { error } = await supabase.from("instrutor_confirmacao_log").delete().eq("id", id);
  if (!error) {
    logConfirmacaoInstrutorLista = logConfirmacaoInstrutorLista.filter((l) => l.id !== id);
    renderizarLogConfirmacaoInstrutor();
  }
});

$("btn-fechar-painel").addEventListener("click", () => $("painel-form").classList.add("hidden"));
$("btn-cancelar-painel").addEventListener("click", () => $("painel-form").classList.add("hidden"));
$("painel-overlay").addEventListener("click", () => $("painel-form").classList.add("hidden"));

function renderizarCalendarioForm() {
  renderizarGradeCalendario({
    mes: mesCalendarioForm,
    diasStatus: diasStatusForm,
    elLabel: $("f-mes-label"),
    elSemana: $("f-dias-semana"),
    elGrade: $("f-grade-dias"),
    datasPreAgendadas: formDatasPreAgendadas,
    aoClicarDia: (dataStr, statusAtual) => {
      const novoStatus = statusAtual === "disponivel" ? "bloqueado" : "disponivel";
      diasStatusForm = { ...diasStatusForm, [dataStr]: novoStatus };
      renderizarCalendarioForm();
    },
  });
  const contagem = contarStatus(diasStatusForm);
  const preCount = [...formDatasPreAgendadas].filter((d) => obterStatusDia(diasStatusForm, d) === "agendado").length;
  $("f-dias-contagem").textContent = `${contagem.disponivel} disponíveis · ${contagem.agendado} agendados` +
    (preCount > 0 ? ` · ${preCount} pré-agendados` : "") +
    ` · ${contagem.aguardando} aguardando`;
}

$("f-bloquear-mes").addEventListener("click", () => {
  diasStatusForm = aplicarStatusNoMes(diasStatusForm, mesCalendarioForm, "bloqueado");
  renderizarCalendarioForm();
});
$("f-disponibilizar-mes").addEventListener("click", () => {
  diasStatusForm = aplicarStatusNoMes(diasStatusForm, mesCalendarioForm, "disponivel");
  renderizarCalendarioForm();
});

$("f-mes-anterior").addEventListener("click", () => {
  mesCalendarioForm = new Date(mesCalendarioForm.getFullYear(), mesCalendarioForm.getMonth() - 1, 1);
  renderizarCalendarioForm();
});
$("f-mes-proximo").addEventListener("click", () => {
  mesCalendarioForm = new Date(mesCalendarioForm.getFullYear(), mesCalendarioForm.getMonth() + 1, 1);
  renderizarCalendarioForm();
});

$("f-doc-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  pendingDocFile = file;
  pendingDocPreviewUrl = URL.createObjectURL(file);
  $("f-doc-img").src = pendingDocPreviewUrl;
  $("f-doc-preview").classList.remove("hidden");
  $("f-doc-upload-label").classList.add("hidden");
});
$("f-doc-remover").addEventListener("click", () => {
  pendingDocFile = null;
  pendingDocPreviewUrl = null;
  docUrlAtualForm = null;
  $("f-doc-input").value = "";
  $("f-doc-preview").classList.add("hidden");
  $("f-doc-upload-label").classList.remove("hidden");
});

$("btn-salvar-instrutor").addEventListener("click", salvarInstrutor);

async function salvarInstrutor() {
  esconderErro("form-erro");
  const nome = $("f-nome").value.trim();
  const especialidade = $("f-especialidade").value.trim();
  const email = $("f-email").value.trim();
  const gestorDiretoId = ($("f-gestor-direto") && $("f-gestor-direto").value) || null;
  if (!nome) return mostrarErro("form-erro", "Informe o nome do instrutor.");
  if (!especialidade) return mostrarErro("form-erro", "Informe a especialidade do instrutor.");
  if (!email) return mostrarErro("form-erro", "Informe o e-mail do instrutor.");
  if (!gestorDiretoId) return mostrarErro("form-erro", "Selecione o gestor direto do instrutor. Esse campo é obrigatório.");

  // Garante que todo instrutor fique georreferenciado, mesmo se o endereço foi digitado à mão
  // (sem usar a busca por CEP) e o operador nunca clicou em "Obter coordenadas".
  if ($("f-endereco").value.trim() && (!$("f-latitude").value || !$("f-longitude").value)) {
    await geocodificarInstrutor();
  }

  const payload = {
    nome,
    cpf: $("f-cpf").value.trim(),
    email,
    telefone: $("f-telefone").value.trim(),
    especialidade,
    carga_horaria: $("f-carga").value.trim(),
    status: $("f-status").value,
    observacoes: $("f-observacoes").value.trim(),
    cep: $("f-cep").value.trim(),
    endereco: $("f-endereco").value.trim(),
    numero: $("f-numero").value.trim(),
    complemento: $("f-complemento").value.trim(),
    bairro: $("f-bairro").value.trim(),
    cidade: $("f-cidade").value.trim(),
    uf: $("f-uf").value.trim().toUpperCase(),
    latitude: $("f-latitude").value === "" ? null : Number($("f-latitude").value),
    longitude: $("f-longitude").value === "" ? null : Number($("f-longitude").value),
    dias_status: diasStatusForm,
    centro_treinamento_principal_id: $("f-centro-principal").value || null,
    gestor_direto_id: gestorDiretoId,
  };

  $("btn-salvar-instrutor").disabled = true;
  $("btn-salvar-instrutor").textContent = "Salvando…";

  let linha, erro;
  if (editandoId) {
    ({ data: linha, error: erro } = await supabase.from("instrutores").update(payload).eq("id", editandoId).select().single());
  } else {
    ({ data: linha, error: erro } = await supabase.from("instrutores").insert(payload).select().single());
  }

  if (erro) {
    $("btn-salvar-instrutor").disabled = false;
    $("btn-salvar-instrutor").textContent = editandoId ? "Salvar alterações" : "Cadastrar instrutor";
    if (erro.message && erro.message.includes("duplicate")) {
      return mostrarErro("form-erro", "Já existe um instrutor cadastrado com esse e-mail.");
    }
    if (erro.message && erro.message.includes("gestor direto")) {
      return mostrarErro("form-erro", erro.message);
    }
    return mostrarErro("form-erro", "Não foi possível salvar. Tente novamente.");
  }

  // Upload do documento, se um novo arquivo foi selecionado
  if (pendingDocFile) {
    const caminho = `${linha.id}/documento_${Date.now()}.jpg`;
    const { error: erroUpload } = await supabase.storage.from("documentos").upload(caminho, pendingDocFile, { upsert: true });
    if (!erroUpload) {
      await supabase.from("instrutores").update({ documento_url: caminho }).eq("id", linha.id);
    }
  } else if (docUrlAtualForm === null && editandoId) {
    // documento foi removido no formulário
    await supabase.from("instrutores").update({ documento_url: null }).eq("id", linha.id);
  }

  await salvarAptidoesInstrutor(linha.id);

  $("btn-salvar-instrutor").disabled = false;
  $("painel-form").classList.add("hidden");
  await carregarListaAdmin();
}

async function excluirInstrutor(id) {
  const inst = listaInstrutoresAdmin.find((i) => i.id === id);
  if (!confirmarExclusao(`o instrutor "${inst?.nome || ""}"`.trim())) return;
  const { error } = await supabase.from("instrutores").delete().eq("id", id);
  if (!error) await carregarListaAdmin();
}

// ===========================================================
// CADASTROS SIMPLES (engine genérica): Empresas, Centros de
// Treinamento, Tipos de Treinamento e Usuários do Sistema
// ===========================================================
const CRUD_CONFIG = {
  empresas: {
    tabela: "empresas",
    titulo: "Empresa",
    descricao: "Empresas clientes que contratam treinamentos.",
    buscaPlaceholder: "Buscar por nome, nome fantasia ou CNPJ",
    ordenarPor: "nome",
    // Lista paginada no servidor: só 30 empresas por vez (a busca também roda no servidor).
    paginacao: { tamanho: 30, colunasTexto: ["nome", "nome_fantasia"], colunaDigitos: "cnpj_digitos" },
    campos: [
      { id: "nome", label: "Nome da empresa (razão social)", obrigatorio: true },
      { id: "nome_fantasia", label: "Nome fantasia" },
      { id: "cnpj", label: "CNPJ", mascara: "cnpj", botaoAcao: { id: "btn-buscar-cnpj", label: "🔎 Pesquisar Receita Federal", onClick: buscarCnpjReceitaFederal } },
      {
        id: "cnpj_grupo_economico",
        label: "CNPJ do Grupo Econômico (opcional)",
        mascara: "cnpj",
        validar: async (valor) => {
          if (!valor) return null;
          const alvo = valor.replace(/\D/g, "");
          const cnpjProprio = ($("crud-campo-cnpj").value || "").replace(/\D/g, "");
          if (cnpjProprio && cnpjProprio === alvo) return null; // pode ser o próprio CNPJ da empresa
          const { count } = await supabase.from("empresas").select("id", { count: "exact", head: true }).eq("cnpj_digitos", alvo);
          return count > 0 ? null : "Esse CNPJ do grupo econômico não corresponde a nenhuma empresa já cadastrada.";
        },
      },
      { id: "contato_nome", label: "Nome do contato" },
      { id: "contato_email", label: "E-mail do contato", tipo: "email" },
      { id: "contato_telefone", label: "Telefone do contato" },
      { id: "endereco", label: "Endereço" },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
    ],
    campoBusca: (i) => `${i.nome} ${i.nome_fantasia || ""} ${i.cnpj || ""}`,
    cardTitulo: (i) => i.nome,
    cardLinhas: (i) => [i.nome_fantasia && `Fantasia: ${i.nome_fantasia}`, i.cnpj && `CNPJ: ${i.cnpj}`, i.cnpj_grupo_economico && `Grupo: ${i.cnpj_grupo_economico}`, i.contato_nome, i.contato_email, i.contato_telefone].filter(Boolean),
    renderTabela: (lista, { podeAlterar, podeExcluir }) => {
      const badge = (s) => `<span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${s === "Inativo" ? "bg-rose-50 text-rose-600" : "bg-teal-50 text-teal-700"}">${s || "—"}</span>`;
      return `
      <table class="w-full text-xs bg-white border border-slate-200 rounded-lg">
        <thead>
          <tr class="bg-slate-50 text-left text-slate-500 uppercase tracking-wide text-[10px]">
            <th class="px-3 py-2 font-medium">Empresa</th>
            <th class="px-3 py-2 font-medium">Nome fantasia</th>
            <th class="px-3 py-2 font-medium">CNPJ</th>
            <th class="px-3 py-2 font-medium">Grupo econômico</th>
            <th class="px-3 py-2 font-medium">Contato</th>
            <th class="px-3 py-2 font-medium">Status</th>
            <th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${lista.map((i) => `
          <tr class="hover:bg-slate-50">
            <td class="px-3 py-2 text-slate-800 font-medium">${i.nome || "—"}</td>
            <td class="px-3 py-2 text-slate-600">${i.nome_fantasia || "—"}</td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${i.cnpj || "—"}</td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${i.cnpj_grupo_economico || "—"}</td>
            <td class="px-3 py-2 text-slate-600">${[i.contato_nome, i.contato_telefone, i.contato_email].filter(Boolean).join(" · ") || "—"}</td>
            <td class="px-3 py-2 whitespace-nowrap">${badge(i.status)}</td>
            <td class="px-3 py-2 text-right whitespace-nowrap">
              ${podeAlterar ? `<button data-crud-editar="${i.id}" class="text-slate-500 hover:text-slate-800 mr-2">✏️</button>` : ""}
              ${podeExcluir ? `<button data-crud-excluir="${i.id}" class="text-rose-500 hover:text-rose-700">🗑️</button>` : ""}
            </td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    },
  },
  centros_treinamento: {
    tabela: "centros_treinamento",
    titulo: "Centro de Treinamento",
    descricao: "Locais onde os treinamentos acontecem, com sua estrutura disponível.",
    buscaPlaceholder: "Buscar por nome",
    ordenarPor: "nome",
    campos: [
      { id: "nome", label: "Nome do centro", obrigatorio: true },
      { id: "cep", label: "CEP", mascara: "cep", botaoAcao: { id: "btn-buscar-cep-centro", label: "🔎 Buscar endereço", onClick: buscarCepCentro } },
      { id: "endereco", label: "Endereço", botaoAcao: { id: "btn-geocodificar-centro", label: "📍 Obter coordenadas", onClick: geocodificarCentro } },
      { id: "cidade", label: "Cidade (impressa na proposta)" },
      { id: "latitude", label: "Latitude", tipo: "number" },
      { id: "longitude", label: "Longitude", tipo: "number" },
      { id: "capacidade_diaria", label: "Capacidade diária (pessoas/dia)", tipo: "number" },
      { id: "qtd_salas_aula", label: "Qtd. Salas de Aula", tipo: "number" },
      { id: "qtd_pistas_treinamento", label: "Qtd. Pistas de Treinamento", tipo: "number" },
      { id: "qtd_torres_altura", label: "Qtd. Torres de Altura", tipo: "number" },
      { id: "qtd_espaco_confinado", label: "Qtd. Espaço Confinado", tipo: "number" },
      { id: "qtd_petrolifera", label: "Qtd. Petrolífera", tipo: "number" },
      { id: "qtd_uti", label: "Qtd. UTI", tipo: "number" },
      { id: "logotipo_esquerdo", label: "Logotipo esquerdo (proposta)", tipo: "imagem" },
      { id: "logotipo_direito", label: "Logotipo direito (proposta)", tipo: "imagem" },
      { id: "texto_rodape_pagina", label: "Rodapé das páginas da proposta (razão social, CNPJ, endereços, telefones… — se vazio, usa nome e endereço)", tipo: "textarea" },
      { id: "observacoes", label: "Observações", tipo: "textarea" },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
    ],
    campoBusca: (i) => `${i.nome} ${i.endereco || ""}`,
    cardTitulo: (i) => i.nome,
    cardLinhas: (i) => [
      i.endereco,
      i.capacidade_diaria && `👥 Capacidade diária: ${i.capacidade_diaria}/dia`,
      i.qtd_salas_aula && `🏫 ${i.qtd_salas_aula} sala(s) de aula`,
      i.qtd_pistas_treinamento && `🛣️ ${i.qtd_pistas_treinamento} pista(s) de treinamento`,
      i.qtd_torres_altura && `🗼 ${i.qtd_torres_altura} torre(s) de altura`,
      i.qtd_espaco_confinado && `🕳️ ${i.qtd_espaco_confinado} espaço(s) confinado(s)`,
      i.qtd_petrolifera && `🛢️ ${i.qtd_petrolifera} petrolífera(s)`,
      i.qtd_uti && `🏥 ${i.qtd_uti} UTI(s)`,
      i.latitude != null && i.longitude != null && `📍 <a href="https://www.google.com/maps?q=${i.latitude},${i.longitude}" target="_blank" rel="noopener" class="text-amber-600 underline">Ver no mapa</a>`,
    ].filter(Boolean),
    ajustarPayload: async (p) => {
      // Garante que todo centro fique georreferenciado, mesmo se o endereço foi digitado à mão
      // (sem usar a busca por CEP) e o operador nunca clicou em "Obter coordenadas".
      if (p.endereco && (p.latitude == null || p.longitude == null)) {
        try {
          const cidadeUf = extrairCidadeUfDeEndereco(p.endereco);
          const enderecoLimpo = p.endereco.replace(/\s*-\s*CEP\s*[\d-]+\s*$/i, "").replace(/\//g, ", ");
          const resultado = await geocodificarComFallback({
            textosLivres: [p.endereco, enderecoLimpo],
            cidade: cidadeUf ? cidadeUf.cidade : undefined,
            uf: cidadeUf ? cidadeUf.uf : undefined,
            cep: p.cep,
          });
          if (resultado) {
            p.latitude = resultado.lat;
            p.longitude = resultado.lon;
          }
        } catch (e) {
          // Falha silenciosa: não bloqueia o cadastro do centro por indisponibilidade do serviço de mapas.
        }
      }
    },
  },
  categorias_treinamento: {
    tabela: "categorias_treinamento",
    titulo: "Tipo de Treinamento",
    descricao: "Agrupa os treinamentos cadastrados. Cada treinamento é vinculado a um tipo.",
    buscaPlaceholder: "Buscar por código ou descrição",
    ordenarPor: "codigo",
    carregarRefs: async () => {
      const { data } = await supabase
        .from("tipos_treinamento").select("id, categoria_treinamento_id, status");
      catTreinoContagem = {};
      (data || []).forEach((t) => {
        if (!t.categoria_treinamento_id) return;
        const c = (catTreinoContagem[t.categoria_treinamento_id] =
          catTreinoContagem[t.categoria_treinamento_id] || { ativos: 0, inativos: 0 });
        if (t.status === "Ativo") c.ativos++; else c.inativos++;
      });
    },
    campos: [
      { id: "codigo", label: "Código", obrigatorio: true },
      { id: "descricao", label: "Descrição", obrigatorio: true },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
      {
        id: "qtd_ativos", label: "Treinamentos ativos", display: true,
        formato: (v, item) => String(contagemCategoria(item?.id).ativos),
      },
      {
        id: "qtd_inativos", label: "Treinamentos inativos", display: true,
        formato: (v, item) => String(contagemCategoria(item?.id).inativos),
      },
    ],
    campoBusca: (i) => `${i.codigo} ${i.descricao}`,
    cardTitulo: (i) => `${i.codigo} — ${i.descricao}`,
    cardLinhas: (i) => {
      const c = contagemCategoria(i.id);
      return [`✅ ${c.ativos} treinamento(s) ativo(s)`, `🚫 ${c.inativos} treinamento(s) inativo(s)`];
    },
  },
  tipos_treinamento: {
    tabela: "tipos_treinamento",
    titulo: "Treinamento",
    descricao: "Treinamentos oferecidos e o consumo de dias na operação (teoria, prática ou ambos).",
    buscaPlaceholder: "Buscar por nome",
    ordenarPor: "nome",
    painelLargo: true,
    carregarRefs: async () => {
      const [{ data }, { data: itens }, { data: unidades }, { data: contagem }] = await Promise.all([
        supabase.from("categorias_treinamento").select("id, codigo, descricao, status").order("codigo"),
        supabase.from("itens_custo").select("id, item, unidade_medida_id, valor, opcional, status").order("item"),
        supabase.from("unidades_medida").select("id, sigla, descricao, status").order("sigla"),
        supabase.from("treinamento_itens_custo").select("tipo_treinamento_id"),
      ]);
      treinoRefCategorias = data || [];
      treinoRefItensCusto = itens || [];
      treinoRefUnidades = unidades || [];
      treinoContagemItensCusto = {};
      (contagem || []).forEach((r) => { treinoContagemItensCusto[r.tipo_treinamento_id] = (treinoContagemItensCusto[r.tipo_treinamento_id] || 0) + 1; });
    },
    camposExtraHtml: () => htmlSecaoItensCustoTreinamento(),
    aoMontarForm: (item) => iniciarSecaoItensCustoTreinamento(item),
    validarForm: () => {
      for (const [id, rot] of [["perc_apoio", "% de apoio"], ["perc_margem", "% de margem"], ["perc_imposto", "% de imposto"], ["perc_margem_minima", "% de margem mínima"]]) {
        const v = ($("crud-campo-" + id)?.value || "").trim();
        if (v !== "" && !(Number(v) >= 0 && Number(v) <= 100)) return `${rot}: informe um valor entre 0 e 100.`;
      }
      const vd = ($("crud-campo-validade_padrao_dias")?.value || "").trim();
      if (vd !== "" && !(Number(vd) >= 1 && Number(vd) <= 3650)) return "Validade padrão da proposta: informe de 1 a 3650 dias.";
      return validarItensCustoTreinamento();
    },
    ajustarPayload: (p) => {
      ["perc_apoio", "perc_margem", "perc_imposto", "perc_margem_minima", "valor_margem_minimo"].forEach((k) => { if (p[k] == null) p[k] = 0; });
      if (p.validade_padrao_dias == null || !(p.validade_padrao_dias >= 1)) p.validade_padrao_dias = 30;
      p.validade_padrao_dias = Math.round(p.validade_padrao_dias);
    },
    aoSalvar: async (linha) => { await salvarItensCustoTreinamento(linha.id); },
    campos: [
      { id: "nome", label: "Nome do treinamento", obrigatorio: true },
      {
        id: "categoria_treinamento_id", label: "Tipo de treinamento", tipo: "select", obrigatorio: true,
        opcoesFn: () => [{ value: "", label: "— Selecione —" }].concat(
          treinoRefCategorias.filter((c) => c.status === "Ativo").map((c) => ({ value: c.id, label: `${c.codigo} — ${c.descricao}` }))
        ),
      },
      { id: "carga_horaria", label: "Carga horária" },
      { id: "categoria", label: "Categoria" },
      { id: "dias_teoria", label: "Dias de Teoria", tipo: "number" },
      { id: "dias_pratica", label: "Dias de Prática", tipo: "number" },
      { id: "dias_teoria_pratica", label: "Dias de Teoria com Prática", tipo: "number" },
      { id: "alunos_por_instrutor", label: "Alunos por Instrutor", tipo: "number" },
      { id: "somente_locacao_espaco", label: "Somente locação de espaço (sem instrutor — só o Centro de Treinamento confirma)", tipo: "checkbox", padrao: false },
      { id: "perc_apoio", label: "% de apoio", tipo: "number", min: 0, max: 100, step: "0.01", padrao: 0 },
      { id: "perc_margem", label: "% de margem", tipo: "number", min: 0, max: 100, step: "0.01", padrao: 0 },
      { id: "perc_imposto", label: "% de imposto", tipo: "number", min: 0, max: 100, step: "0.01", padrao: 0 },
      { id: "perc_margem_minima", label: "% de margem mínima (depois do desconto)", tipo: "number", min: 0, max: 100, step: "0.01", padrao: 0 },
      { id: "valor_margem_minimo", label: "Valor mínimo de margem por turma (R$)", tipo: "number", min: 0, step: "0.01", padrao: 0 },
      { id: "validade_padrao_dias", label: "Validade padrão da proposta (dias)", tipo: "number", min: 1, max: 3650, step: "1", padrao: 30 },
      { id: "descricao", label: "Descrição", tipo: "textarea" },
      { id: "descricao_impressao", label: "Descrição para impressão (parágrafo de abertura da proposta, após \"Apresentamos nossa proposta…\")", tipo: "textarea" },
      { id: "rodape", label: "Rodapé da proposta (Esclarecimento … Atenciosamente)", tipo: "textarea" },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
    ],
    campoBusca: (i) => `${i.nome} ${i.categoria || ""}`,
    cardTitulo: (i) => i.nome,
    cardLinhas: (i) => [
      rotuloCategoriaTreinamento(i.categoria_treinamento_id),
      i.somente_locacao_espaco && "🏢 Somente locação de espaço",
      i.categoria,
      i.carga_horaria && `Carga horária: ${i.carga_horaria}`,
      i.dias_teoria && `📘 ${i.dias_teoria} dia(s) de teoria`,
      i.dias_pratica && `🛠️ ${i.dias_pratica} dia(s) de prática`,
      i.dias_teoria_pratica && `📘🛠️ ${i.dias_teoria_pratica} dia(s) de teoria com prática`,
      i.alunos_por_instrutor && `👥 até ${i.alunos_por_instrutor} aluno(s) por instrutor`,
      treinoContagemItensCusto[i.id] && `🧾 ${treinoContagemItensCusto[i.id]} item(ns) de custo`,
      (Number(i.perc_apoio) || Number(i.perc_margem) || Number(i.perc_imposto)) && `📊 Apoio ${fmtPerc(i.perc_apoio)} · Margem ${fmtPerc(i.perc_margem)} · Imposto ${fmtPerc(i.perc_imposto)}`,
      (Number(i.perc_margem_minima) || Number(i.valor_margem_minimo)) && `🛡️ Margem mínima ${fmtPerc(i.perc_margem_minima)} · ${fmtBRL(i.valor_margem_minimo)} por turma`,
    ].filter(Boolean),
  },
  empresas_transporte: {
    tabela: "empresas_transporte",
    titulo: "Empresa de Transporte",
    descricao: "Empresas que fazem o transporte do instrutor até o local do treinamento.",
    buscaPlaceholder: "Buscar por nome",
    ordenarPor: "nome",
    campos: [
      { id: "nome", label: "Nome da empresa", obrigatorio: true },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
    ],
    campoBusca: (i) => i.nome,
    cardTitulo: (i) => i.nome,
    cardLinhas: () => [],
  },
  tipos_material: {
    tabela: "tipos_material",
    titulo: "Tipo de Material",
    descricao: "Categorias de materiais usadas no cadastro de Materiais.",
    buscaPlaceholder: "Buscar por descrição",
    ordenarPor: "descricao",
    carregarRefs: async () => {
      const { data } = await supabase.from("materiais").select("tipo_material_id");
      materialContagemPorTipo = {};
      (data || []).forEach((m) => {
        if (m.tipo_material_id) materialContagemPorTipo[m.tipo_material_id] = (materialContagemPorTipo[m.tipo_material_id] || 0) + 1;
      });
    },
    campos: [
      { id: "descricao", label: "Descritivo do tipo", obrigatorio: true },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
    ],
    campoBusca: (i) => i.descricao || "",
    cardTitulo: (i) => i.descricao,
    cardLinhas: (i) => [`📦 ${materialContagemPorTipo[i.id] || 0} material(is) cadastrado(s)`],
    renderTabela: (lista, { podeAlterar, podeExcluir }) => {
      const badge = (s) => `<span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${s === "Inativo" ? "bg-rose-50 text-rose-600" : "bg-teal-50 text-teal-700"}">${s || "—"}</span>`;
      return `
      <table class="w-full text-xs bg-white border border-slate-200 rounded-lg">
        <thead>
          <tr class="bg-slate-50 text-left text-slate-500 uppercase tracking-wide text-[10px]">
            <th class="px-3 py-2 font-medium">Descritivo</th>
            <th class="px-3 py-2 font-medium">Materiais</th>
            <th class="px-3 py-2 font-medium">Status</th>
            <th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${lista.map((i) => `
          <tr class="hover:bg-slate-50">
            <td class="px-3 py-2 text-slate-800">${i.descricao || "—"}</td>
            <td class="px-3 py-2 text-slate-600">${materialContagemPorTipo[i.id] || 0}</td>
            <td class="px-3 py-2 whitespace-nowrap">${badge(i.status)}</td>
            <td class="px-3 py-2 text-right whitespace-nowrap">
              ${podeAlterar ? `<button data-crud-editar="${i.id}" class="text-slate-500 hover:text-slate-800 mr-2">✏️</button>` : ""}
              ${podeExcluir ? `<button data-crud-excluir="${i.id}" class="text-rose-500 hover:text-rose-700">🗑️</button>` : ""}
            </td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    },
  },
  itens_custo: {
    tabela: "itens_custo",
    titulo: "Item de Custo",
    descricao: "Itens de custo com a unidade de medida e o valor de cada um.",
    buscaPlaceholder: "Buscar por item ou unidade",
    ordenarPor: "item",
    mensagemDuplicado: "Já existe um item de custo com esse nome e essa unidade de medida.",
    carregarRefs: async () => {
      const { data } = await supabase.from("unidades_medida").select("id, sigla, descricao, status").order("sigla");
      itemCustoRefUnidades = data || [];
    },
    campos: [
      { id: "item", label: "Item", obrigatorio: true },
      { id: "descricao_impressao", label: "Descrição para impressão", tipo: "textarea" },
      {
        id: "unidade_medida_id", label: "Unidade de medida", tipo: "select", obrigatorio: true,
        opcoesFn: () => [{ value: "", label: "— Selecione —" }].concat(
          itemCustoRefUnidades.filter((u) => u.status === "Ativo").map((u) => ({ value: u.id, label: `${u.sigla} — ${u.descricao}` }))
        ),
      },
      { id: "valor", label: "Valor (R$)", tipo: "number", min: 0, step: "0.01", obrigatorio: true },
      { id: "valor_adicional_in_company", label: "Valor adicional In Company (R$)", tipo: "number", min: 0, step: "0.01", padrao: 0 },
      { id: "opcional", label: "Item opcional", tipo: "checkbox", padrao: false },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
    ],
    ajustarPayload: (p) => { if (p.valor_adicional_in_company == null) p.valor_adicional_in_company = 0; },
    campoBusca: (i) => `${i.item || ""} ${i.descricao_impressao || ""} ${(itemCustoRefUnidades.find((u) => u.id === i.unidade_medida_id) || {}).sigla || ""}`,
    cardTitulo: (i) => i.item,
    cardLinhas: (i) => {
      const un = itemCustoRefUnidades.find((u) => u.id === i.unidade_medida_id);
      return [un && `📏 ${un.sigla} — ${un.descricao}`, `💰 ${fmtBRL(i.valor)}`, Number(i.valor_adicional_in_company) > 0 && `🏢 Adicional In Company: ${fmtBRL(i.valor_adicional_in_company)}`, i.opcional ? "☑️ Item opcional" : "Item obrigatório", i.descricao_impressao && `🖨️ ${i.descricao_impressao}`].filter(Boolean);
    },
    renderTabela: (lista, { podeAlterar, podeExcluir }) => {
      const un = (id) => { const u = itemCustoRefUnidades.find((x) => x.id === id); return u ? `${u.sigla} — ${u.descricao}` : "—"; };
      const badge = (s) => `<span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${s === "Inativo" ? "bg-rose-50 text-rose-600" : "bg-teal-50 text-teal-700"}">${s || "—"}</span>`;
      return `
      <table class="w-full text-xs bg-white border border-slate-200 rounded-lg">
        <thead>
          <tr class="bg-slate-50 text-left text-slate-500 uppercase tracking-wide text-[10px]">
            <th class="px-3 py-2 font-medium">Item</th>
            <th class="px-3 py-2 font-medium">Descrição para impressão</th>
            <th class="px-3 py-2 font-medium">Unidade</th>
            <th class="px-3 py-2 font-medium text-right">Valor</th>
            <th class="px-3 py-2 font-medium text-right">Adic. In Company</th>
            <th class="px-3 py-2 font-medium">Opcional</th>
            <th class="px-3 py-2 font-medium">Status</th>
            <th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${lista.map((i) => `
          <tr class="hover:bg-slate-50">
            <td class="px-3 py-2 text-slate-800 font-medium">${i.item || "—"}</td>
            <td class="px-3 py-2 text-slate-600"><div class="max-w-[320px] whitespace-normal">${i.descricao_impressao || "—"}</div></td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${un(i.unidade_medida_id)}</td>
            <td class="px-3 py-2 text-slate-700 text-right whitespace-nowrap">${fmtBRL(i.valor)}</td>
            <td class="px-3 py-2 text-slate-700 text-right whitespace-nowrap">${fmtBRL(i.valor_adicional_in_company || 0)}</td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${i.opcional ? "Sim" : "Não"}</td>
            <td class="px-3 py-2 whitespace-nowrap">${badge(i.status)}</td>
            <td class="px-3 py-2 text-right whitespace-nowrap">
              ${podeAlterar ? `<button data-crud-editar="${i.id}" class="text-slate-500 hover:text-slate-800 mr-2">✏️</button>` : ""}
              ${podeExcluir ? `<button data-crud-excluir="${i.id}" class="text-rose-500 hover:text-rose-700">🗑️</button>` : ""}
            </td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    },
  },
  unidades_medida: {
    tabela: "unidades_medida",
    titulo: "Unidade de Medida",
    descricao: "Unidades usadas para medir quantidades (ex.: UN, CX, KG, L, M).",
    buscaPlaceholder: "Buscar por sigla ou descrição",
    ordenarPor: "sigla",
    mensagemDuplicado: "Já existe uma unidade de medida com essa sigla.",
    campos: [
      { id: "sigla", label: "Sigla", obrigatorio: true },
      { id: "descricao", label: "Descrição", obrigatorio: true },
      {
        id: "base_calculo", label: "Origem da quantidade no cálculo do orçamento", tipo: "select",
        opcoes: [{ value: "", label: "— Não definida (tratada como manual) —" }].concat(BASES_CALCULO),
      },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
    ],
    campoBusca: (i) => `${i.sigla || ""} ${i.descricao || ""}`,
    cardTitulo: (i) => i.sigla,
    cardLinhas: (i) => [i.descricao, i.base_calculo && `🧮 ${rotuloBaseCalculo(i.base_calculo)}`].filter(Boolean),
    renderTabela: (lista, { podeAlterar, podeExcluir }) => {
      const badge = (s) => `<span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${s === "Inativo" ? "bg-rose-50 text-rose-600" : "bg-teal-50 text-teal-700"}">${s || "—"}</span>`;
      return `
      <table class="w-full text-xs bg-white border border-slate-200 rounded-lg">
        <thead>
          <tr class="bg-slate-50 text-left text-slate-500 uppercase tracking-wide text-[10px]">
            <th class="px-3 py-2 font-medium">Sigla</th>
            <th class="px-3 py-2 font-medium">Descrição</th>
            <th class="px-3 py-2 font-medium">Origem da quantidade</th>
            <th class="px-3 py-2 font-medium">Status</th>
            <th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${lista.map((i) => `
          <tr class="hover:bg-slate-50">
            <td class="px-3 py-2 text-slate-800 font-medium whitespace-nowrap">${i.sigla || "—"}</td>
            <td class="px-3 py-2 text-slate-600">${i.descricao || "—"}</td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${rotuloBaseCalculo(i.base_calculo) || '<span class="text-slate-300">—</span>'}</td>
            <td class="px-3 py-2 whitespace-nowrap">${badge(i.status)}</td>
            <td class="px-3 py-2 text-right whitespace-nowrap">
              ${podeAlterar ? `<button data-crud-editar="${i.id}" class="text-slate-500 hover:text-slate-800 mr-2">✏️</button>` : ""}
              ${podeExcluir ? `<button data-crud-excluir="${i.id}" class="text-rose-500 hover:text-rose-700">🗑️</button>` : ""}
            </td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    },
  },
  prazos_pagamento: {
    tabela: "prazos_pagamento",
    titulo: "Prazo de Pagamento",
    descricao: "Condições de pagamento usadas nas propostas dos orçamentos. Cada prazo tem suas parcelas (dias e percentual de cada uma, totalizando 100%).",
    buscaPlaceholder: "Buscar por descrição",
    ordenarPor: "descricao",
    carregarRefs: async () => {
      const { data } = await supabase.from("prazos_pagamento_parcelas").select("prazo_pagamento_id, numero, dias, percentual").order("numero");
      prazosParcelasPorPrazo = {};
      (data || []).forEach((r) => { (prazosParcelasPorPrazo[r.prazo_pagamento_id] = prazosParcelasPorPrazo[r.prazo_pagamento_id] || []).push(r); });
    },
    campos: [
      { id: "descricao", label: "Descrição (como será impressa na proposta)", obrigatorio: true },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
    ],
    camposExtraHtml: () => htmlSecaoParcelasPrazo(),
    aoMontarForm: (item) => iniciarSecaoParcelasPrazo(item),
    validarForm: () => validarParcelasPrazo(),
    aoSalvar: async (linha) => { await salvarParcelasPrazo(linha.id); },
    campoBusca: (i) => i.descricao || "",
    cardTitulo: (i) => i.descricao,
    cardLinhas: (i) => {
      const ps = prazosParcelasPorPrazo[i.id] || [];
      return [
        ps.length ? `${ps.length} parcela${ps.length > 1 ? "s" : ""}: ` + ps.map((p) => `${p.dias === 0 ? "à vista" : p.dias + "d"} ${fmtPercParcela(p.percentual)}%`).join(" · ") : "Sem parcelas cadastradas",
        i.status === "Inativo" && "🚫 Inativo",
      ].filter(Boolean);
    },
  },
  tipos_despesas: {
    tabela: "tipos_despesas",
    titulo: "Tipo de Despesa",
    descricao: "Categorias usadas para classificar despesas, com o centro de custo padrão de cada uma.",
    buscaPlaceholder: "Buscar por nome ou centro de custo",
    ordenarPor: "nome",
    campos: [
      { id: "nome", label: "Nome do tipo de despesa", obrigatorio: true },
      { id: "centro_custo", label: "Centro de custo" },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
    ],
    campoBusca: (i) => `${i.nome} ${i.centro_custo || ""}`,
    cardTitulo: (i) => i.nome,
    cardLinhas: (i) => [i.centro_custo && `Centro de custo: ${i.centro_custo}`].filter(Boolean),
    renderTabela: (lista, { podeAlterar, podeExcluir }) => {
      const badge = (s) => `<span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${s === "Inativo" ? "bg-rose-50 text-rose-600" : "bg-teal-50 text-teal-700"}">${s || "—"}</span>`;
      return `
      <table class="w-full text-xs bg-white border border-slate-200 rounded-lg">
        <thead>
          <tr class="bg-slate-50 text-left text-slate-500 uppercase tracking-wide text-[10px]">
            <th class="px-3 py-2 font-medium">Nome</th>
            <th class="px-3 py-2 font-medium">Centro de custo</th>
            <th class="px-3 py-2 font-medium">Status</th>
            <th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${lista.map((i) => `
          <tr class="hover:bg-slate-50">
            <td class="px-3 py-2 text-slate-800">${i.nome || "—"}</td>
            <td class="px-3 py-2 text-slate-600">${i.centro_custo || "—"}</td>
            <td class="px-3 py-2 whitespace-nowrap">${badge(i.status)}</td>
            <td class="px-3 py-2 text-right whitespace-nowrap">
              ${podeAlterar ? `<button data-crud-editar="${i.id}" class="text-slate-500 hover:text-slate-800 mr-2">✏️</button>` : ""}
              ${podeExcluir ? `<button data-crud-excluir="${i.id}" class="text-rose-500 hover:text-rose-700">🗑️</button>` : ""}
            </td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    },
  },
  fornecedores: {
    tabela: "fornecedores",
    titulo: "Fornecedor",
    descricao: "Fornecedores de materiais.",
    buscaPlaceholder: "Buscar por nome ou CNPJ",
    ordenarPor: "nome",
    campos: [
      { id: "nome", label: "Nome / Razão social", obrigatorio: true },
      { id: "cnpj", label: "CNPJ", mascara: "cnpj" },
      { id: "contato_nome", label: "Nome do contato" },
      { id: "contato_email", label: "E-mail do contato", tipo: "email" },
      { id: "contato_telefone", label: "Telefone do contato" },
      { id: "endereco", label: "Endereço" },
      { id: "observacoes", label: "Observações", tipo: "textarea" },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
    ],
    campoBusca: (i) => `${i.nome} ${i.cnpj || ""}`,
    cardTitulo: (i) => i.nome,
    cardLinhas: (i) => [i.cnpj && `CNPJ: ${i.cnpj}`, i.contato_nome, i.contato_email, i.contato_telefone].filter(Boolean),
  },
  materiais: {
    tabela: "materiais",
    titulo: "Material",
    descricao: "Materiais em estoque, com tipo, unidade, quantidade e dados da última compra.",
    buscaPlaceholder: "Buscar por descrição ou tipo",
    ordenarPor: "descricao",
    carregarRefs: async () => {
      const [{ data: tm }, { data: fo }] = await Promise.all([
        supabase.from("tipos_material").select("id, descricao, status").order("descricao"),
        supabase.from("fornecedores").select("id, nome, status").order("nome"),
      ]);
      materialRefTipos = tm || [];
      materialRefFornecedores = fo || [];
    },
    campos: [
      { id: "descricao", label: "Descritivo do material", tipo: "textarea", obrigatorio: true },
      {
        id: "tipo_material_id", label: "Tipo de material", tipo: "select", obrigatorio: true,
        opcoesFn: () => [{ value: "", label: "— Selecione —" }].concat(
          materialRefTipos.filter((t) => t.status === "Ativo").map((t) => ({ value: t.id, label: t.descricao }))
        ),
      },
      { id: "unidade_medida", label: "Unidade de medida (ex.: un, cx, kg, L, m)", obrigatorio: true },
      { id: "quantidade_estoque", label: "Quantidade em estoque", tipo: "number", min: 0 },
      { id: "valor_unitario_ultima_compra", label: "Valor unitário da última compra (R$)", tipo: "number", min: 0 },
      { id: "data_ultima_compra", label: "Data da última compra", tipo: "date" },
      {
        id: "fornecedor_ultima_compra_id", label: "Fornecedor da última compra", tipo: "select",
        opcoesFn: () => [{ value: "", label: "— Selecione —" }].concat(
          materialRefFornecedores.filter((f) => f.status === "Ativo").map((f) => ({ value: f.id, label: f.nome }))
        ),
      },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
    ],
    campoBusca: (i) => `${i.descricao || ""} ${(materialRefTipos.find((t) => t.id === i.tipo_material_id) || {}).descricao || ""}`,
    cardTitulo: (i) => ((i.descricao || "").length > 80 ? (i.descricao || "").slice(0, 80) + "…" : (i.descricao || "")) || "Material",
    cardLinhas: (i) => {
      const tipo = materialRefTipos.find((t) => t.id === i.tipo_material_id);
      const forn = materialRefFornecedores.find((f) => f.id === i.fornecedor_ultima_compra_id);
      const brl = (v) => (v == null || v === "" ? null : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
      return [
        tipo && `🧰 ${tipo.descricao}`,
        (i.quantidade_estoque != null) && `📦 Estoque: ${i.quantidade_estoque}${i.unidade_medida ? " " + i.unidade_medida : ""}`,
        brl(i.valor_unitario_ultima_compra) && `💰 Últ. compra: ${brl(i.valor_unitario_ultima_compra)}${i.data_ultima_compra ? " em " + i.data_ultima_compra : ""}`,
        forn && `🚚 ${forn.nome}`,
      ].filter(Boolean);
    },
    renderTabela: (lista, { podeAlterar, podeExcluir }) => {
      const tipoNome = (id) => (materialRefTipos.find((t) => t.id === id) || {}).descricao || "—";
      const fornNome = (id) => (materialRefFornecedores.find((f) => f.id === id) || {}).nome || "—";
      const brl = (v) => (v == null || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
      const dta = (s) => (s ? String(s).slice(0, 10).split("-").reverse().join("/") : "—");
      const badge = (s) => `<span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${s === "Inativo" ? "bg-rose-50 text-rose-600" : "bg-teal-50 text-teal-700"}">${s || "—"}</span>`;
      return `
      <table class="w-full text-xs bg-white border border-slate-200 rounded-lg">
        <thead>
          <tr class="bg-slate-50 text-left text-slate-500 uppercase tracking-wide text-[10px]">
            <th class="px-3 py-2 font-medium">Material</th>
            <th class="px-3 py-2 font-medium">Tipo</th>
            <th class="px-3 py-2 font-medium">Unid.</th>
            <th class="px-3 py-2 font-medium">Estoque</th>
            <th class="px-3 py-2 font-medium">Valor últ. compra</th>
            <th class="px-3 py-2 font-medium">Data últ. compra</th>
            <th class="px-3 py-2 font-medium">Fornecedor</th>
            <th class="px-3 py-2 font-medium">Status</th>
            <th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${lista.map((i) => `
          <tr class="hover:bg-slate-50 align-top">
            <td class="px-3 py-2"><div class="min-w-[180px] max-w-[320px] whitespace-normal text-slate-800">${i.descricao || "—"}</div></td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${tipoNome(i.tipo_material_id)}</td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${i.unidade_medida || "—"}</td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${i.quantidade_estoque != null ? i.quantidade_estoque : "—"}</td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${brl(i.valor_unitario_ultima_compra)}</td>
            <td class="px-3 py-2 text-slate-500 whitespace-nowrap">${dta(i.data_ultima_compra)}</td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${fornNome(i.fornecedor_ultima_compra_id)}</td>
            <td class="px-3 py-2 whitespace-nowrap">${badge(i.status)}</td>
            <td class="px-3 py-2 text-right whitespace-nowrap">
              ${podeAlterar ? `<button data-crud-editar="${i.id}" class="text-slate-500 hover:text-slate-800 mr-2">✏️</button>` : ""}
              ${podeExcluir ? `<button data-crud-excluir="${i.id}" class="text-rose-500 hover:text-rose-700">🗑️</button>` : ""}
            </td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    },
  },
  requisicoes_compra: {
    tabela: "requisicoes_compra",
    titulo: "Requisição de Compra",
    descricao: "Requisições de compra de materiais, vinculadas a uma OS. Valores são a soma dos itens.",
    buscaPlaceholder: "Buscar por número ou OS",
    ordenarPor: "created_at",
    ordenarAsc: false,
    corStatus: {
      "Planejada": "bg-slate-100 text-slate-600",
      "Aprovada": "bg-teal-50 text-teal-700",
      "Compra Parcial": "bg-amber-50 text-amber-700",
      "Compra Total": "bg-blue-50 text-blue-700",
    },
    carregarRefs: async () => {
      const [{ data: ce }, { data: us }, { data: mt }, { data: at }, { data: perms }, { data: admins }] = await Promise.all([
        supabase.from("centros_treinamento").select("id, nome, status").eq("status", "Ativo").order("nome"),
        supabase.from("usuarios_sistema").select("id, nome, status").eq("status", "Ativo").order("nome"),
        supabase.from("materiais").select("id, descricao, unidade_medida, status").eq("status", "Ativo").order("descricao"),
        supabase.from("atividades").select("id, os, descricao").order("os", { ascending: false }),
        supabase.from("permissoes").select("usuario_id").eq("modulo", "requisicoes_compra").eq("pode_aprovar_requisicao", true),
        supabase.from("usuarios_sistema").select("id").eq("role", "admin"),
      ]);
      reqRefCentros = ce || [];
      reqRefUsuarios = us || [];
      reqRefMateriais = mt || [];
      reqRefAtividades = at || [];
      const idsAprov = new Set([...(perms || []).map((p) => p.usuario_id), ...(admins || []).map((a) => a.id)]);
      reqRefAprovadores = reqRefUsuarios.filter((u) => idsAprov.has(u.id));
    },
    campos: [
      { id: "numero", label: "Número", display: true },
      {
        id: "atividade_id", label: "OS (Ordem de Serviço)", tipo: "select",
        opcoesFn: () => [{ value: "", label: "— Nenhuma —" }].concat(
          reqRefAtividades.map((a) => ({ value: a.id, label: `${a.os || "?"} — ${(a.descricao || "").slice(0, 50)}` }))
        ),
      },
      { id: "corporativo", label: "Corporativo (não vinculada a um Centro de Treinamento)", tipo: "checkbox", padrao: false },
      {
        id: "centro_treinamento_id", label: "Centro de Treinamento", tipo: "select",
        opcoesFn: () => [{ value: "", label: "— Selecione —" }].concat(reqRefCentros.map((c) => ({ value: c.id, label: c.nome }))),
        validar: (v) => {
          const corp = document.getElementById("crud-campo-corporativo");
          if (corp && corp.checked) return null;
          return v ? null : "Selecione o Centro de Treinamento ou marque Corporativo.";
        },
      },
      {
        id: "solicitante_id", label: "Usuário solicitante", tipo: "select", obrigatorio: true,
        opcoesFn: () => [{ value: "", label: "— Selecione —" }].concat(reqRefUsuarios.map((u) => ({ value: u.id, label: u.nome }))),
      },
      {
        id: "aprovador_id", label: "Usuário aprovador", tipo: "select",
        opcoesFn: () => [{ value: "", label: "— Selecione —" }].concat(reqRefAprovadores.map((u) => ({ value: u.id, label: u.nome }))),
      },
      {
        id: "status", label: "Status", tipo: "select", padrao: "Planejada",
        opcoesFn: () => {
          const todas = ["Planejada", "Aprovada", "Compra Parcial", "Compra Total"];
          const atual = crudItemEmEdicao && crudItemEmEdicao.status;
          const lista = podeAprovarRequisicao() ? todas : todas.filter((s) => s !== "Aprovada" || s === atual);
          return lista.map((s) => ({ value: s, label: s }));
        },
      },
      { id: "observacoes", label: "Observações", tipo: "textarea" },
      { id: "data_criacao", label: "Data de criação", display: true, formato: fmtDataHoraBR },
      { id: "data_aprovacao", label: "Data de aprovação", display: true, formato: fmtDataHoraBR },
      { id: "valor_estimado", label: "Valor estimado (total dos itens)", display: true, formato: fmtBRL },
      { id: "valor_realizado", label: "Valor realizado (total dos itens)", display: true, formato: fmtBRL },
    ],
    ajustarPayload: (p) => { if (p.corporativo) p.centro_treinamento_id = null; },
    aoMontarForm: (item) => {
      const chk = $("crud-campo-corporativo");
      const sel = $("crud-campo-centro_treinamento_id");
      if (chk && sel) {
        const sync = () => { sel.disabled = chk.checked; if (chk.checked) sel.value = ""; };
        chk.addEventListener("change", sync);
        sel.addEventListener("change", () => { if (sel.value) chk.checked = false; });
        if (!item && requisicaoAtividadePreset) {
          const a = $("crud-campo-atividade_id");
          if (a) { a.value = requisicaoAtividadePreset.id || ""; a.disabled = true; }
          chk.checked = !!requisicaoAtividadePreset.corporativo;
          sel.value = requisicaoAtividadePreset.centro_treinamento_id || "";
        }
        sync();
      }
      if (!item) {
        const s = $("crud-campo-solicitante_id");
        if (s && usuarioSistemaAtual && !s.value) s.value = usuarioSistemaAtual.id;
      }
      if (requisicaoAtividadePreset) requisicaoAtividadePreset = null;

      if (item) {
        $("req-item-material").innerHTML = `<option value="">— Material —</option>` +
          reqRefMateriais.map((m) => `<option value="${m.id}">${m.descricao}${m.unidade_medida ? " (" + m.unidade_medida + ")" : ""}</option>`).join("");
        carregarReqItens(item.id);
        const bAdd = $("btn-req-item-add");
        if (bAdd) bAdd.addEventListener("click", () => adicionarReqItem(item.id));
        const bApr = $("btn-req-aprovar");
        if (bApr) bApr.addEventListener("click", () => aprovarRequisicao(item.id));
      }
    },
    camposExtraHtml: (item) => {
      if (!item) return `<p class="text-[11px] text-slate-400">Salve a requisição para depois adicionar os materiais.</p>`;
      const aprovada = item.status === "Aprovada";
      return `
        <div class="border-t border-slate-100 pt-3">
          <p class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Materiais da requisição</p>
          <div id="req-itens-lista" class="space-y-1.5 mb-3 text-xs"></div>
          <div class="grid grid-cols-2 gap-2">
            <select id="req-item-material" class="col-span-2 rounded-md border border-slate-300 px-2 py-1.5 text-sm"></select>
            <input id="req-item-qtd" type="number" min="0" step="any" placeholder="Quantidade" class="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input id="req-item-vest" type="number" min="0" step="any" placeholder="Valor estimado (R$)" class="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input id="req-item-vreal" type="number" min="0" step="any" placeholder="Valor realizado (R$)" class="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <button type="button" id="btn-req-item-add" class="rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium px-3 py-1.5">+ Adicionar material</button>
          </div>
          <p id="req-itens-totais" class="text-[11px] font-medium text-slate-600 mt-2"></p>
        </div>
        ${!aprovada && podeAprovarRequisicao()
          ? `<div><button type="button" id="btn-req-aprovar" class="w-full text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-md py-2">✅ Aprovar requisição</button></div>`
          : ""}
        ${aprovada ? `<p class="text-[11px] text-teal-700">Aprovada${item.data_aprovacao ? " em " + fmtDataHoraBR(item.data_aprovacao) : ""}.</p>` : ""}`;
    },
    campoBusca: (i) => `${i.numero || ""} ${(reqRefAtividades.find((a) => a.id === i.atividade_id) || {}).os || ""}`,
    cardTitulo: (i) => i.numero || "Requisição",
    cardLinhas: () => [],
    renderTabela: (lista, { podeAlterar, podeExcluir }) => {
      const os = (id) => (reqRefAtividades.find((a) => a.id === id) || {}).os || "—";
      const centro = (i) => i.corporativo ? "🏢 Corporativo" : ((reqRefCentros.find((c) => c.id === i.centro_treinamento_id) || {}).nome || "—");
      const nomeU = (id) => (reqRefUsuarios.find((u) => u.id === id) || {}).nome || "—";
      const badge = (s) => `<span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${CRUD_CONFIG.requisicoes_compra.corStatus[s] || "bg-slate-100 text-slate-600"}">${s}</span>`;
      return `
      <table class="w-full text-xs bg-white border border-slate-200 rounded-lg">
        <thead>
          <tr class="bg-slate-50 text-left text-slate-500 uppercase tracking-wide text-[10px]">
            <th class="px-3 py-2 font-medium">Número</th>
            <th class="px-3 py-2 font-medium">OS</th>
            <th class="px-3 py-2 font-medium">Centro</th>
            <th class="px-3 py-2 font-medium">Solicitante</th>
            <th class="px-3 py-2 font-medium">Aprovador</th>
            <th class="px-3 py-2 font-medium">Status</th>
            <th class="px-3 py-2 font-medium">Valor estimado</th>
            <th class="px-3 py-2 font-medium">Valor realizado</th>
            <th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${lista.map((i) => `
          <tr class="hover:bg-slate-50">
            <td class="px-3 py-2 font-mono text-slate-700 whitespace-nowrap">${i.numero || "—"}</td>
            <td class="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">${os(i.atividade_id)}</td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${centro(i)}</td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${nomeU(i.solicitante_id)}</td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${i.aprovador_id ? nomeU(i.aprovador_id) : "—"}</td>
            <td class="px-3 py-2 whitespace-nowrap">${badge(i.status)}</td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${fmtBRL(i.valor_estimado)}</td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${fmtBRL(i.valor_realizado)}</td>
            <td class="px-3 py-2 text-right whitespace-nowrap">
              ${podeAlterar ? `<button data-crud-editar="${i.id}" class="text-slate-500 hover:text-slate-800 mr-2">✏️</button>` : ""}
              ${podeExcluir ? `<button data-crud-excluir="${i.id}" class="text-rose-500 hover:text-rose-700">🗑️</button>` : ""}
            </td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    },
  },
  usuarios_sistema: {
    aoSalvar: async (linha, { novo }) => {
      // Usuário recém-cadastrado recebe o convite de acesso automaticamente.
      if (novo) await enviarConviteUsuario(linha.id, true);
    },
    tabela: "usuarios_sistema",
    titulo: "Usuário do Sistema",
    permissoes: true,
    descricao: "Pessoas com acesso à área de trabalho e suas permissões.",
    buscaPlaceholder: "Buscar por nome ou e-mail",
    ordenarPor: "nome",
    carregarRefs: async () => { await carregarUsuariosSistemaRefGestores(true); },
    campos: [
      { id: "nome", label: "Nome completo", obrigatorio: true },
      { id: "email", label: "E-mail (login)", tipo: "email", obrigatorio: true },
      { id: "telefone", label: "Telefone (celular)", obrigatorio: true },
      { id: "role", label: "Perfil", tipo: "select", opcoes: [{ value: "usuario", label: "Usuário" }, { value: "admin", label: "Administrador" }], padrao: "usuario" },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
      {
        id: "gestor_direto_id", label: "Gestor direto", tipo: "select",
        opcoesFn: () => [{ value: "", label: "— Nenhum —" }].concat(
          usuariosSistemaRefGestores.filter((u) => u.id !== (crudItemEmEdicao && crudItemEmEdicao.id)).map((u) => ({ value: u.id, label: u.nome }))
        ),
      },
      { id: "gestor_financeiro", label: "É gestor financeiro (aprova reembolsos na 2ª fase)", tipo: "checkbox", padrao: false },
      { id: "aprovador_comercial", label: "É aprovador comercial (aprova propostas com margem abaixo da mínima)", tipo: "checkbox", padrao: false },
    ],
    campoBusca: (i) => `${i.nome} ${i.email} ${i.telefone || ""}`,
    cardTitulo: (i) => i.nome,
    cardLinhas: (i) => [
      i.email,
      i.telefone && `📞 ${i.telefone}`,
      i.role === "admin" ? "👑 Administrador" : "Usuário",
      i.user_id ? "✅ Já criou senha no app"
        : (i.convite_enviado_em ? `✉️ Convite enviado em ${new Date(i.convite_enviado_em).toLocaleDateString("pt-BR")}` : "⏳ Aguardando primeiro acesso"),
      i.reset_senha_liberado_em ? "🔓 Redefinição de senha liberada"
        : (i.reset_senha_solicitado_em ? "🔑 Redefinição de senha SOLICITADA" : null),
      i.gestor_direto_id ? `🧭 Gestor direto: ${(usuariosSistemaRefGestores.find((u) => u.id === i.gestor_direto_id) || {}).nome || "—"}` : null,
      i.gestor_financeiro ? "💰 Gestor financeiro (2ª fase de reembolsos)" : null,
      i.aprovador_comercial ? "✅ Aprovador comercial (propostas)" : null,
    ].filter(Boolean),
    camposExtraHtml: (item) => {
      if (!item) return "";
      const fmt = (s) => (s ? new Date(s).toLocaleString("pt-BR") : null);
      const sol = fmt(item.reset_senha_solicitado_em);
      const lib = fmt(item.reset_senha_liberado_em);
      const conv = fmt(item.convite_enviado_em);
      return `
        <div class="border-t border-slate-100 pt-3">
          <p class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Convite de acesso</p>
          <p class="text-[11px] ${item.user_id ? "text-teal-700" : conv ? "text-slate-500" : "text-slate-400"}">
            ${item.user_id ? "✅ O usuário já cadastrou a senha." : conv ? `✉️ Convite enviado em ${conv}.` : "Nenhum convite enviado ainda."}
          </p>
          <div class="mt-2">
            <button type="button" id="btn-enviar-convite" class="text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md px-3 py-1.5">${conv ? "Reenviar convite por e-mail" : "Enviar convite por e-mail"}</button>
          </div>
        </div>
        <div class="border-t border-slate-100 pt-3">
          <p class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Redefinição de senha</p>
          <p class="text-[11px] ${sol ? "text-amber-700" : "text-slate-400"}">${sol ? `🔑 Solicitada em ${sol}` : "Nenhum pedido pendente."}</p>
          ${lib ? `<p class="text-[11px] text-teal-700">🔓 Liberada em ${lib} — o usuário pode redefinir a senha por 24h</p>` : ""}
          <div class="mt-2 flex flex-wrap gap-2">
            <button type="button" id="btn-liberar-reset" class="text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-md px-3 py-1.5">Liberar redefinição de senha</button>
            ${lib ? `<button type="button" id="btn-cancelar-reset" class="text-xs font-medium text-rose-600 hover:underline">cancelar liberação</button>` : ""}
          </div>
        </div>`;
    },
    aoMontarForm: (item) => {
      if (!item) return;
      const recarregar = async () => { $("painel-crud").classList.add("hidden"); await carregarModuloCrud(crudModuloId); };
      const bLib = $("btn-liberar-reset");
      if (bLib) bLib.addEventListener("click", async () => {
        bLib.disabled = true;
        const { error } = await supabase.from("usuarios_sistema")
          .update({ reset_senha_liberado_em: new Date().toISOString() }).eq("id", item.id);
        bLib.disabled = false;
        if (error) return alert("Não foi possível liberar. " + (error.message || ""));
        alert("Redefinição liberada. Avise o usuário: na tela de login, \"Esqueci minha senha\" → \"O administrador já liberou\" → definir a nova senha (validade 24h).");
        await recarregar();
      });
      const bConv = $("btn-enviar-convite");
      if (bConv) bConv.addEventListener("click", async () => {
        bConv.disabled = true;
        bConv.textContent = "Enviando…";
        await enviarConviteUsuario(item.id);
        bConv.disabled = false;
        bConv.textContent = "Reenviar convite por e-mail";
        await recarregar();
      });
      const bCanc = $("btn-cancelar-reset");
      if (bCanc) bCanc.addEventListener("click", async () => {
        await supabase.from("usuarios_sistema").update({ reset_senha_liberado_em: null }).eq("id", item.id);
        await recarregar();
      });
    },
  },
  tipos_atividade: {
    tabela: "tipos_atividade",
    titulo: "Tipo de Atividade",
    descricao: "Categorias usadas para classificar as atividades no cadastro de Atividades.",
    buscaPlaceholder: "Buscar por nome",
    ordenarPor: "nome",
    campos: [
      { id: "nome", label: "Nome do tipo", obrigatorio: true },
      { id: "descricao", label: "Descrição", tipo: "textarea" },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
    ],
    campoBusca: (i) => `${i.nome} ${i.descricao || ""}`,
    cardTitulo: (i) => i.nome,
    cardLinhas: (i) => [i.descricao].filter(Boolean),
  },
  atividades: {
    tabela: "atividades",
    titulo: "Atividade",
    descricao: "Atividades dos usuários do sistema: responsável, prazos previstos/realizados e evolução.",
    buscaPlaceholder: "Buscar por descrição ou tipo",
    ordenarPor: "created_at",
    ordenarAsc: false,
    corStatus: {
      "Planejada": "bg-slate-100 text-slate-600",
      "Aguardando Materiais": "bg-amber-50 text-amber-700",
      "Em Execução": "bg-blue-50 text-blue-700",
      "Concluída": "bg-teal-50 text-teal-700",
      "Cancelada": "bg-rose-50 text-rose-600",
    },
    carregarRefs: async () => {
      const [{ data: us }, { data: ts }, { data: cs }] = await Promise.all([
        supabase.from("usuarios_sistema").select("id, nome, email, status").order("nome"),
        supabase.from("tipos_atividade").select("id, nome, status").order("nome"),
        supabase.from("centros_treinamento").select("id, nome, status").order("nome"),
      ]);
      atividadeRefUsuarios = us || [];
      atividadeRefTipos = ts || [];
      atividadeRefCentros = cs || [];
    },
    aoMontarForm: (item) => {
      const chk = $("crud-campo-corporativo");
      const sel = $("crud-campo-centro_treinamento_id");
      if (chk && sel) {
        const sincronizar = () => {
          sel.disabled = chk.checked;
          if (chk.checked) sel.value = "";
        };
        chk.addEventListener("change", sincronizar);
        sel.addEventListener("change", () => { if (sel.value) chk.checked = false; });
        sincronizar();
      }
      // Fotografia
      atividadeFotoPendente = null;
      atividadeFotoRemover = false;
      const input = $("atividade-foto-input");
      const preview = $("atividade-foto-preview");
      const img = $("atividade-foto-img");
      const btnRem = $("atividade-foto-remover");
      if (input) {
        input.addEventListener("change", (e) => {
          const f = e.target.files[0];
          if (!f) return;
          atividadeFotoPendente = f;
          atividadeFotoRemover = false;
          img.src = URL.createObjectURL(f);
          preview.classList.remove("hidden");
          btnRem.classList.remove("hidden");
        });
        btnRem.addEventListener("click", () => {
          atividadeFotoPendente = null;
          atividadeFotoRemover = true;
          input.value = "";
          preview.classList.add("hidden");
          btnRem.classList.add("hidden");
        });
        if (item && item.foto_path) {
          urlArquivoAtividade(item.foto_path).then((u) => {
            if (u) { img.src = u; preview.classList.remove("hidden"); btnRem.classList.remove("hidden"); }
          });
        }
      }
      const btnAnx = $("atividade-abrir-anexos");
      if (btnAnx && item) btnAnx.addEventListener("click", () => abrirPainelAtividadeAnexos(item.id));

      // Ao editar, trava a troca de responsável sem a permissão específica
      const selResp = $("crud-campo-responsavel_id");
      if (selResp && item && !podeAtividades("mudar_responsavel")) {
        selResp.disabled = true;
        selResp.title = "Você não tem permissão para mudar o responsável.";
      }
    },
    camposExtraHtml: (item) => {
      const dtHora = (s) => (s ? new Date(s).toLocaleString("pt-BR") : "—");
      const nomeU = (id) => (atividadeRefUsuarios.find((u) => u.id === id) || {}).nome || "—";
      const audit = item ? `
        <div class="grid grid-cols-2 gap-2 text-[11px] text-slate-400 border-t border-slate-100 pt-3">
          <p>Criada em<br><span class="text-slate-600">${dtHora(item.created_at)}</span></p>
          <p>Criada por<br><span class="text-slate-600">${nomeU(item.criado_por)}</span></p>
          <p>Última alteração<br><span class="text-slate-600">${dtHora(item.updated_at)}</span></p>
          <p>Alterada por<br><span class="text-slate-600">${nomeU(item.alterado_por)}</span></p>
        </div>` : "";
      return `
        <div>
          <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">Fotografia</label>
          <div id="atividade-foto-preview" class="hidden mt-1"><img id="atividade-foto-img" alt="" class="max-h-44 rounded-md border border-slate-200" /></div>
          <input type="file" id="atividade-foto-input" accept="image/*" class="mt-1 block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-white" />
          <button type="button" id="atividade-foto-remover" class="hidden mt-1 text-xs text-rose-600 hover:underline">remover fotografia</button>
        </div>
        ${item
          ? `<div><button type="button" id="atividade-abrir-anexos" class="w-full text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md py-2">📎 Anexos da atividade</button></div>`
          : `<p class="text-[11px] text-slate-400">A fotografia é enviada ao salvar. Os anexos podem ser adicionados depois, pela edição.</p>`}
        ${audit}`;
    },
    aoSalvar: async (linha) => {
      if (atividadeFotoPendente) {
        const ext = (atividadeFotoPendente.name.split(".").pop() || "jpg").toLowerCase();
        const caminho = `${linha.id}/foto_${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from("atividades").upload(caminho, atividadeFotoPendente, { upsert: true });
        if (error) throw error;
        await supabase.from("atividades").update({ foto_path: caminho }).eq("id", linha.id);
      } else if (atividadeFotoRemover && linha.foto_path) {
        await supabase.storage.from("atividades").remove([linha.foto_path]);
        await supabase.from("atividades").update({ foto_path: null }).eq("id", linha.id);
      }
      atividadeFotoPendente = null;
      atividadeFotoRemover = false;
    },
    aoMontarTabela: (cont) => {
      cont.querySelectorAll("[data-atividade-anexos]").forEach((btn) =>
        btn.addEventListener("click", () => abrirPainelAtividadeAnexos(btn.getAttribute("data-atividade-anexos")))
      );
      cont.querySelectorAll("[data-atividade-requisicao]").forEach((btn) =>
        btn.addEventListener("click", () => criarRequisicaoDaAtividade(btn.getAttribute("data-atividade-requisicao")))
      );
    },
    ajustarPayload: (p) => { if (p.corporativo) p.centro_treinamento_id = null; },
    renderTabela: (lista, { podeAlterar, podeExcluir }) => {
      const tipoNome = (id) => (atividadeRefTipos.find((t) => t.id === id) || {}).nome || "—";
      const respNome = (id) => (atividadeRefUsuarios.find((u) => u.id === id) || {}).nome || "—";
      const centroTxt = (i) => i.corporativo
        ? "🏢 Corporativo"
        : ((atividadeRefCentros.find((c) => c.id === i.centro_treinamento_id) || {}).nome || "—");
      const badge = (s) => `<span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${CRUD_CONFIG.atividades.corStatus[s] || "bg-slate-100 text-slate-600"}">${s}</span>`;
      const d = (x) => x || "—";
      return `
      <table class="w-full text-xs bg-white border border-slate-200 rounded-lg">
        <thead>
          <tr class="bg-slate-50 text-left text-slate-500 uppercase tracking-wide text-[10px]">
            <th class="px-3 py-2 font-medium">OS</th>
            <th class="px-3 py-2 font-medium">Atividade</th>
            <th class="px-3 py-2 font-medium">Tipo</th>
            <th class="px-3 py-2 font-medium">Responsável</th>
            <th class="px-3 py-2 font-medium">Centro</th>
            <th class="px-3 py-2 font-medium">Status</th>
            <th class="px-3 py-2 font-medium">%</th>
            <th class="px-3 py-2 font-medium">Início prev.</th>
            <th class="px-3 py-2 font-medium">Térm. prev.</th>
            <th class="px-3 py-2 font-medium">Início real.</th>
            <th class="px-3 py-2 font-medium">Térm. real.</th>
            <th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${lista.map((i) => `
          <tr class="hover:bg-slate-50 align-top">
            <td class="px-3 py-2 font-mono text-slate-700 whitespace-nowrap">${i.os || "—"}</td>
            <td class="px-3 py-2"><div class="min-w-[200px] max-w-[340px] whitespace-normal text-slate-800">${i.descricao || "—"}</div></td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${tipoNome(i.tipo_atividade_id)}</td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${respNome(i.responsavel_id)}</td>
            <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${centroTxt(i)}</td>
            <td class="px-3 py-2 whitespace-nowrap">${badge(i.status)}</td>
            <td class="px-3 py-2 text-slate-600">${i.percentual || 0}%</td>
            <td class="px-3 py-2 text-slate-500 whitespace-nowrap">${d(i.data_inicio_previsto)}</td>
            <td class="px-3 py-2 text-slate-500 whitespace-nowrap">${d(i.data_termino_previsto)}</td>
            <td class="px-3 py-2 text-slate-500 whitespace-nowrap">${d(i.data_inicio_realizado)}</td>
            <td class="px-3 py-2 text-slate-500 whitespace-nowrap">${d(i.data_termino_realizado)}</td>
            <td class="px-3 py-2 text-right whitespace-nowrap">
              <button data-atividade-requisicao="${i.id}" class="text-slate-500 hover:text-slate-800 mr-2" title="Requisição de compra">🛒</button>
              <button data-atividade-anexos="${i.id}" class="text-slate-500 hover:text-slate-800 mr-2" title="Anexos">📎</button>
              ${podeAlterar ? `<button data-crud-editar="${i.id}" class="text-slate-500 hover:text-slate-800 mr-2">✏️</button>` : ""}
              ${podeExcluir ? `<button data-crud-excluir="${i.id}" class="text-rose-500 hover:text-rose-700">🗑️</button>` : ""}
            </td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    },
    renderFiltros: () => {
      const rotulos = {
        data_inicio_previsto: "Início previsto",
        data_termino_previsto: "Término previsto",
        data_inicio_realizado: "Início realizado",
        data_termino_realizado: "Término realizado",
      };
      const ops = (arr) => arr.filter((x) => x.status === "Ativo").map((x) => `<option value="${x.id}">${x.nome}</option>`).join("");
      const selBase = "rounded-md border border-slate-300 px-2 py-1.5 bg-white";
      const dtBase = "w-full rounded-md border border-slate-300 px-2 py-1";
      return `
      <div class="grid gap-2 md:grid-cols-3 xl:grid-cols-4 text-[11px] text-slate-500">
        <label class="flex flex-col gap-1 uppercase tracking-wide">Status
          <select data-filtro="status" class="${selBase}">
            <option value="">Todos</option>
            ${["Planejada", "Aguardando Materiais", "Em Execução", "Concluída", "Cancelada"].map((s) => `<option value="${s}">${s}</option>`).join("")}
          </select>
        </label>
        <label class="flex flex-col gap-1 uppercase tracking-wide">Responsável
          <select data-filtro="responsavel_id" class="${selBase}"><option value="">Todos</option>${ops(atividadeRefUsuarios)}</select>
        </label>
        <label class="flex flex-col gap-1 uppercase tracking-wide">Tipo de atividade
          <select data-filtro="tipo_atividade_id" class="${selBase}"><option value="">Todos</option>${ops(atividadeRefTipos)}</select>
        </label>
        <label class="flex flex-col gap-1 uppercase tracking-wide">Centro de Treinamento
          <select data-filtro="centro_treinamento_id" class="${selBase}">
            <option value="">Todos</option>
            <option value="__corp__">🏢 Corporativo</option>
            ${ops(atividadeRefCentros)}
          </select>
        </label>
        ${Object.keys(rotulos).map((campo) => `
        <label class="flex flex-col gap-1 uppercase tracking-wide">${rotulos[campo]}
          <div class="flex items-center gap-1">
            <input type="date" data-filtro="${campo}__de" class="${dtBase}" title="de" />
            <span class="normal-case">a</span>
            <input type="date" data-filtro="${campo}__ate" class="${dtBase}" title="até" />
          </div>
        </label>`).join("")}
        <div class="flex items-end">
          <button id="crud-filtros-limpar" type="button" class="normal-case text-amber-700 hover:underline">limpar filtros</button>
        </div>
      </div>`;
    },
    aplicarFiltros: (lista) => {
      const v = (k) => {
        const el = document.querySelector(`#crud-filtros [data-filtro="${k}"]`);
        return el ? el.value : "";
      };
      let out = lista;
      ["status", "responsavel_id", "tipo_atividade_id"].forEach((k) => {
        const val = v(k);
        if (val) out = out.filter((i) => i[k] === val);
      });
      const centro = v("centro_treinamento_id");
      if (centro === "__corp__") out = out.filter((i) => i.corporativo);
      else if (centro) out = out.filter((i) => i.centro_treinamento_id === centro);
      ["data_inicio_previsto", "data_termino_previsto", "data_inicio_realizado", "data_termino_realizado"].forEach((campo) => {
        const de = v(campo + "__de");
        const ate = v(campo + "__ate");
        if (de) out = out.filter((i) => i[campo] && i[campo] >= de);
        if (ate) out = out.filter((i) => i[campo] && i[campo] <= ate);
      });
      return out;
    },
    campos: [
      { id: "os", label: "OS (Ordem de Serviço)", display: true },
      { id: "descricao", label: "Descritivo da atividade", tipo: "textarea", obrigatorio: true },
      {
        id: "tipo_atividade_id", label: "Tipo de atividade", tipo: "select", obrigatorio: true,
        opcoesFn: () => [{ value: "", label: "— Selecione —" }].concat(
          atividadeRefTipos.filter((t) => t.status === "Ativo").map((t) => ({ value: t.id, label: t.nome }))
        ),
      },
      {
        id: "responsavel_id", label: "Responsável por manter atualizado", tipo: "select", obrigatorio: true,
        opcoesFn: () => [{ value: "", label: "— Selecione —" }].concat(
          atividadeRefUsuarios.filter((u) => u.status === "Ativo").map((u) => ({ value: u.id, label: u.nome }))
        ),
      },
      { id: "corporativo", label: "Corporativo (atividade não vinculada a um Centro de Treinamento)", tipo: "checkbox", padrao: false },
      {
        id: "centro_treinamento_id", label: "Centro de Treinamento", tipo: "select",
        opcoesFn: () => [{ value: "", label: "— Selecione —" }].concat(
          atividadeRefCentros.filter((c) => c.status === "Ativo").map((c) => ({ value: c.id, label: c.nome }))
        ),
        validar: (v) => {
          const corp = document.getElementById("crud-campo-corporativo");
          if (corp && corp.checked) return null;
          return v ? null : "Selecione o Centro de Treinamento ou marque Corporativo.";
        },
      },
      {
        id: "status", label: "Status", tipo: "select", padrao: "Planejada",
        opcoesFn: () => {
          const base = ["Planejada", "Aguardando Materiais", "Em Execução"];
          const restritas = ["Concluída", "Cancelada"];
          const atual = crudItemEmEdicao && crudItemEmEdicao.status;
          const lista = podeAtividades("concluir_cancelar")
            ? base.concat(restritas)
            : base.concat(restritas.filter((s) => s === atual));
          return lista.map((s) => ({ value: s, label: s }));
        },
      },
      {
        id: "percentual", label: "% de evolução (atualizado pelo responsável)", tipo: "number", min: 0, max: 100, padrao: 0,
        validar: (v) => (v === "" || v == null ? null : (Number(v) < 0 || Number(v) > 100 ? "O percentual deve estar entre 0 e 100." : null)),
      },
      { id: "observacoes", label: "Observações", tipo: "textarea" },
      { id: "data_inicio_previsto", label: "Data de início previsto", tipo: "date" },
      { id: "data_termino_previsto", label: "Data de término previsto", tipo: "date" },
      { id: "data_inicio_realizado", label: "Data de início realizado", tipo: "date" },
      { id: "data_termino_realizado", label: "Data de término realizado", tipo: "date" },
    ],
    campoBusca: (i) => `${i.descricao || ""} ${(atividadeRefTipos.find((t) => t.id === i.tipo_atividade_id) || {}).nome || ""}`,
    cardTitulo: (i) => ((i.descricao || "").length > 80 ? (i.descricao || "").slice(0, 80) + "…" : (i.descricao || "")) || "Atividade",
    cardLinhas: (i) => {
      const tipo = atividadeRefTipos.find((t) => t.id === i.tipo_atividade_id);
      const resp = atividadeRefUsuarios.find((u) => u.id === i.responsavel_id);
      const centro = atividadeRefCentros.find((c) => c.id === i.centro_treinamento_id);
      return [
        tipo && `🗂️ ${tipo.nome}`,
        i.corporativo ? "🏢 Corporativo" : (centro && `🏫 ${centro.nome}`),
        resp && `👤 Responsável: ${resp.nome}`,
        `📊 ${i.percentual || 0}% concluído`,
        (i.data_inicio_previsto || i.data_termino_previsto) && `📅 Previsto: ${i.data_inicio_previsto || "—"} → ${i.data_termino_previsto || "—"}`,
        (i.data_inicio_realizado || i.data_termino_realizado) && `✅ Realizado: ${i.data_inicio_realizado || "—"} → ${i.data_termino_realizado || "—"}`,
      ].filter(Boolean);
    },
  },
};

function renderCampoHtml(campo, valor, item) {
  const val = valor == null ? "" : valor;
  if (campo.display) {
    const txt = campo.formato ? campo.formato(valor, item) : (val === "" ? "—" : val);
    return `<div>
      <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">${campo.label}</label>
      <p class="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">${txt}</p>
    </div>`;
  }
  if (campo.tipo === "select") {
    const fonte = campo.opcoesFn ? campo.opcoesFn() : campo.opcoes;
    const opcoes = fonte.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
    return `<div>
      <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">${campo.label}</label>
      <select id="crud-campo-${campo.id}" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
        ${opcoes.map((o) => `<option value="${o.value}" ${String(o.value) === String(val) ? "selected" : ""}>${o.label}</option>`).join("")}
      </select>
    </div>`;
  }
  if (campo.tipo === "textarea") {
    return `<div>
      <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">${campo.label}</label>
      <textarea id="crud-campo-${campo.id}" rows="3" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">${val}</textarea>
    </div>`;
  }
  if (campo.tipo === "imagem") {
    const tem = !!val;
    return `<div data-imagem-campo="${campo.id}">
      <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">${campo.label}</label>
      <input type="hidden" id="crud-campo-${campo.id}" value="${String(val).replace(/"/g, "&quot;")}" />
      <div class="mt-1 flex items-center gap-3">
        <div class="h-16 w-32 rounded-md border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden">
          <img data-imagem-prev class="max-h-full max-w-full object-contain ${tem ? "" : "hidden"}" ${tem ? `src="${String(val).replace(/"/g, "&quot;")}"` : ""} alt="" />
          <span data-imagem-vazio class="text-[11px] text-slate-400 ${tem ? "hidden" : ""}">sem imagem</span>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md px-3 py-1.5 cursor-pointer text-center">Escolher imagem
            <input type="file" accept="image/png,image/jpeg,image/webp" data-imagem-arquivo class="hidden" />
          </label>
          <button type="button" data-imagem-remover class="text-xs text-rose-600 hover:text-rose-800 ${tem ? "" : "hidden"}">Remover</button>
        </div>
      </div>
      <p data-imagem-msg class="text-[11px] mt-1 text-slate-400">PNG ou JPG; é reduzida automaticamente.</p>
    </div>`;
  }
  if (campo.tipo === "checkbox") {
    return `<label class="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" id="crud-campo-${campo.id}" ${val ? "checked" : ""} class="rounded border-slate-300" />
      <span>${campo.label}</span>
    </label>`;
  }
  const atributoMascara = campo.mascara ? ` data-mascara="${campo.mascara}"` : "";
  if (campo.botaoAcao) {
    return `<div>
      <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">${campo.label}</label>
      <div class="mt-1 flex gap-2">
        <input id="crud-campo-${campo.id}"${atributoMascara} type="${campo.tipo || "text"}" value="${String(val).replace(/"/g, "&quot;")}" class="flex-1 min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
        <button type="button" id="${campo.botaoAcao.id}" class="shrink-0 whitespace-nowrap text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md px-3">${campo.botaoAcao.label}</button>
      </div>
      <p id="${campo.botaoAcao.id}-status" class="text-[11px] mt-1"></p>
    </div>`;
  }
  const atributosNum = campo.tipo === "number"
    ? `${campo.min != null ? ` min="${campo.min}"` : ""}${campo.max != null ? ` max="${campo.max}"` : ""}${campo.step ? ` step="${campo.step}"` : ""}`
    : "";
  return `<div>
    <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">${campo.label}</label>
    <input id="crud-campo-${campo.id}"${atributoMascara}${atributosNum} type="${campo.tipo || "text"}" value="${String(val).replace(/"/g, "&quot;")}" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
  </div>`;
}

let crudPagina = 1;
let crudTotal = 0;
let crudBuscaTimer = null;

// Carrega a página atual de uma lista paginada no servidor (busca + contagem).
async function carregarPaginaCrud() {
  const cfg = CRUD_CONFIG[crudModuloId];
  const pg = cfg.paginacao;
  const tam = pg.tamanho;
  const termo = $("crud-busca").value.replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim();
  const montar = () => {
    let q = supabase.from(cfg.tabela).select("*", { count: "exact" });
    if (termo) {
      const filtros = pg.colunasTexto.map((c) => `${c}.ilike.%${termo}%`);
      const digitos = termo.replace(/\D/g, "");
      if (digitos.length >= 3 && /^[\d.\/\-\s]+$/.test(termo)) filtros.push(`${pg.colunaDigitos}.like.%${digitos}%`);
      q = q.or(filtros.join(","));
    }
    return q.order(cfg.ordenarPor, { ascending: cfg.ordenarAsc !== false }).order("id");
  };
  let { data, error, count } = await montar().range((crudPagina - 1) * tam, crudPagina * tam - 1);
  if (!error && (count || 0) > 0 && (data || []).length === 0 && crudPagina > 1) {
    // a página deixou de existir (ex.: último registro da página foi excluído)
    crudPagina = Math.max(1, Math.ceil(count / tam));
    ({ data, error, count } = await montar().range((crudPagina - 1) * tam, crudPagina * tam - 1));
  }
  crudLista = error ? [] : data || [];
  crudTotal = error ? 0 : count || 0;
  renderizarListaCrud();
}

function irParaPaginaCrud(n) {
  crudPagina = n;
  carregarPaginaCrud();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Paginador genérico (usado por Empresas e Orçamentos): devolve o HTML do painel
// "Mostrando X–Y de N" + Anterior / números / Próxima. Os botões levam o atributo
// data-pagina-<attr>; ligarPaginador() conecta os cliques.
function htmlPaginador(pagina, total, tamanho, attr) {
  const totalPaginas = Math.max(1, Math.ceil(total / tamanho));
  const de = (pagina - 1) * tamanho + 1;
  const ate = Math.min(pagina * tamanho, total);
  const paginas = new Set([1, totalPaginas]);
  for (let p = pagina - 2; p <= pagina + 2; p++) if (p >= 1 && p <= totalPaginas) paginas.add(p);
  const ordenadas = [...paginas].sort((x, y) => x - y);
  const botoes = [];
  ordenadas.forEach((p, i) => {
    if (i > 0 && p - ordenadas[i - 1] > 1) botoes.push(`<span class="px-1 text-slate-400">…</span>`);
    botoes.push(`<button data-pagina-${attr}="${p}" class="min-w-[2rem] px-2 py-1 rounded-md text-xs font-medium ${p === pagina ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-600 hover:bg-white"}">${p}</button>`);
  });
  const estiloNav = "px-2 py-1 rounded-md text-xs font-medium border border-slate-300 text-slate-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed";
  return `<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
    <p class="text-xs text-slate-500">Mostrando ${de.toLocaleString("pt-BR")}–${ate.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} · página ${pagina} de ${totalPaginas.toLocaleString("pt-BR")}</p>
    <div class="flex flex-wrap items-center gap-1">
      <button data-pagina-${attr}="${pagina - 1}" ${pagina <= 1 ? "disabled" : ""} class="${estiloNav}">‹ Anterior</button>
      ${botoes.join("")}
      <button data-pagina-${attr}="${pagina + 1}" ${pagina >= totalPaginas ? "disabled" : ""} class="${estiloNav}">Próxima ›</button>
    </div></div>`;
}
function ligarPaginador(el, attr, irPara) {
  el.querySelectorAll(`[data-pagina-${attr}]`).forEach((b) => b.addEventListener("click", () => {
    if (!b.disabled) irPara(Number(b.getAttribute(`data-pagina-${attr}`)));
  }));
}
// Preenche o painel do topo (cabeçalho da lista) e o do rodapé com o mesmo conteúdo.
function renderizarPaginadores(ids, pagina, total, tamanho, attr, irPara) {
  ids.forEach((id) => {
    const el = $(id);
    if (total === 0) { el.classList.add("hidden"); el.innerHTML = ""; return; }
    el.classList.remove("hidden");
    el.innerHTML = htmlPaginador(pagina, total, tamanho, attr);
    ligarPaginador(el, attr, irPara);
  });
}

function renderizarPaginacaoCrud() {
  const ids = ["crud-paginacao-topo", "crud-paginacao"];
  const cfg = CRUD_CONFIG[crudModuloId];
  if (!cfg || !cfg.paginacao) { ids.forEach((id) => { $(id).classList.add("hidden"); $(id).innerHTML = ""; }); return; }
  renderizarPaginadores(ids, crudPagina, crudTotal, cfg.paginacao.tamanho, "crud", irParaPaginaCrud);
}

async function carregarModuloCrud(id, opcoes = {}) {
  const mesmoModulo = crudModuloId === id;
  crudModuloId = id;
  const cfg = CRUD_CONFIG[id];
  $("admin-descricao-pagina").textContent = cfg.descricao;
  if (cfg.carregarRefs) await cfg.carregarRefs();
  if (id !== "empresas") $("crud-importacao-painel").classList.add("hidden");
  const manterEstado = !!(opcoes.manter && mesmoModulo && cfg.paginacao);
  if (!manterEstado) { $("crud-busca").value = ""; crudPagina = 1; }
  $("crud-busca").placeholder = cfg.buscaPlaceholder;
  if (cfg.paginacao) {
    // lista paginada: a primeira página é carregada ao final desta função
  } else {
    const { data, error } = await buscarTodos(() => supabase.from(cfg.tabela).select("*").order(cfg.ordenarPor, { ascending: cfg.ordenarAsc !== false }).order("id"));
    crudLista = error ? [] : data;
    crudTotal = crudLista.length;
  }
  $("btn-crud-novo").classList.toggle("hidden", !podeFazer(id, "incluir"));
  const ehEmpresasComPermissao = id === "empresas" && podeFazer(id, "incluir");
  $("btn-crud-importar-clientes").classList.toggle("hidden", !ehEmpresasComPermissao);
  $("btn-crud-completar-enderecos").classList.toggle("hidden", !ehEmpresasComPermissao);

  const elFiltros = $("crud-filtros");
  if (cfg.renderFiltros) {
    elFiltros.innerHTML = cfg.renderFiltros();
    elFiltros.classList.remove("hidden");
    elFiltros.querySelectorAll("input, select").forEach((el) => {
      el.addEventListener(el.tagName === "SELECT" || el.type === "date" ? "change" : "input", renderizarListaCrud);
    });
    const limpar = $("crud-filtros-limpar");
    if (limpar) limpar.addEventListener("click", () => {
      elFiltros.querySelectorAll("input, select").forEach((el) => { el.value = ""; });
      renderizarListaCrud();
    });
  } else {
    elFiltros.classList.add("hidden");
    elFiltros.innerHTML = "";
  }

  if (cfg.paginacao) await carregarPaginaCrud();
  else renderizarListaCrud();
}

function renderizarListaCrud() {
  const cfg = CRUD_CONFIG[crudModuloId];
  const busca = $("crud-busca").value.toLowerCase();
  let lista = cfg.paginacao ? crudLista : crudLista.filter((item) => cfg.campoBusca(item).toLowerCase().includes(busca));
  if (cfg.aplicarFiltros) lista = cfg.aplicarFiltros(lista);
  // Listas muito grandes (ex.: empresas importadas) mostram só as primeiras.
  const LIMITE_CRUD = 300;
  const totalFiltrado = lista.length;
  if (totalFiltrado > LIMITE_CRUD) lista = lista.slice(0, LIMITE_CRUD);
  renderizarPaginacaoCrud();
  const avisoLimite = totalFiltrado > LIMITE_CRUD
    ? `<p class="col-span-full text-xs text-slate-500 text-center py-3">Mostrando ${LIMITE_CRUD} de ${totalFiltrado} registros — use a busca para refinar.</p>`
    : "";
  const podeAlterar = podeFazer(crudModuloId, "alterar");
  const podeExcluir = podeFazer(crudModuloId, "excluir");
  const cont = $("crud-lista");

  const vazio = `<div class="bg-white border border-dashed border-slate-300 rounded-lg py-16 text-center text-slate-500 text-sm">Nenhum registro encontrado.</div>`;

  if (cfg.renderTabela) {
    cont.className = "overflow-x-auto";
    cont.innerHTML = lista.length === 0 ? vazio : cfg.renderTabela(lista, { podeAlterar, podeExcluir }) + avisoLimite;
    cont.querySelectorAll("[data-crud-editar]").forEach((btn) =>
      btn.addEventListener("click", () => abrirEdicaoCrud(btn.getAttribute("data-crud-editar")))
    );
    cont.querySelectorAll("[data-crud-excluir]").forEach((btn) =>
      btn.addEventListener("click", () => excluirCrud(btn.getAttribute("data-crud-excluir")))
    );
    if (cfg.aoMontarTabela) cfg.aoMontarTabela(cont);
    return;
  }

  cont.className = "grid sm:grid-cols-2 xl:grid-cols-3 gap-4";
  if (lista.length === 0) {
    cont.innerHTML = `<div class="col-span-full bg-white border border-dashed border-slate-300 rounded-lg py-16 text-center text-slate-500 text-sm">Nenhum registro encontrado.</div>`;
    return;
  }

  cont.innerHTML = lista.map((item) => `
    <div class="bg-white rounded-lg border border-slate-200 border-t-4 ${(item.status === "Inativo" || item.status === "Cancelada") ? "border-t-rose-400" : "border-t-teal-600"} p-4 flex flex-col gap-2 shadow-sm">
      <div class="flex items-start justify-between">
        <p class="font-serif text-lg text-slate-900 leading-tight">${cfg.cardTitulo(item)}</p>
        ${item.status ? `<span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${(cfg.corStatus && cfg.corStatus[item.status]) || (item.status === "Ativo" ? "bg-teal-50 text-teal-700" : "bg-rose-50 text-rose-600")}">${item.status}</span>` : ""}
      </div>
      <div class="text-xs text-slate-500 space-y-1">${cfg.cardLinhas(item).map((l) => `<p>${l}</p>`).join("")}</div>
      <div class="flex gap-2 mt-2 pt-2 border-t border-slate-100">
        ${podeAlterar ? `<button data-crud-editar="${item.id}" class="flex-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md py-1.5">✏️ Editar</button>` : ""}
        ${podeExcluir ? `<button data-crud-excluir="${item.id}" class="flex-1 text-xs font-medium text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-md py-1.5">🗑️ Excluir</button>` : ""}
      </div>
    </div>
  `).join("") + avisoLimite;

  cont.querySelectorAll("[data-crud-editar]").forEach((btn) =>
    btn.addEventListener("click", () => abrirEdicaoCrud(btn.getAttribute("data-crud-editar")))
  );
  cont.querySelectorAll("[data-crud-excluir]").forEach((btn) =>
    btn.addEventListener("click", () => excluirCrud(btn.getAttribute("data-crud-excluir")))
  );
}

$("crud-busca").addEventListener("input", () => {
  const cfg = CRUD_CONFIG[crudModuloId];
  if (cfg && cfg.paginacao) {
    // busca no servidor, com pequena espera para não consultar a cada tecla
    clearTimeout(crudBuscaTimer);
    crudBuscaTimer = setTimeout(() => { crudPagina = 1; carregarPaginaCrud(); }, 350);
  } else {
    renderizarListaCrud();
  }
});

function atualizarVisibilidadePermissoesPorRole(role) {
  $("crud-permissoes-admin-nota").classList.toggle("hidden", role !== "admin");
  $("crud-permissoes-tabela").classList.toggle("hidden", role === "admin");
}

async function carregarPermissoesParaForm(usuarioId) {
  const existentes = {};
  if (usuarioId) {
    const { data } = await supabase.from("permissoes").select("*").eq("usuario_id", usuarioId);
    (data || []).forEach((p) => (existentes[p.modulo] = p));
  }
  $("crud-permissoes-tabela").innerHTML = `
    <div class="grid grid-cols-[1fr,repeat(4,32px)] gap-1 px-3 py-2 bg-slate-50 font-semibold text-slate-500">
      <span>Módulo</span><span title="Consultar">C</span><span title="Incluir">I</span><span title="Alterar">A</span><span title="Excluir">E</span>
    </div>
    ${MODULOS.map((m, idx) => {
      const p = existentes[m.id] || {};
      const cabecalho = idx === 0 || MODULOS[idx - 1].grupo !== m.grupo
        ? `<div class="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-slate-400">${m.grupo}</div>` : "";
      return cabecalho + `<div class="grid grid-cols-[1fr,repeat(4,32px)] gap-1 px-3 py-2 items-center">
        <span class="text-slate-700">${m.icone} ${m.label}</span>
        <input type="checkbox" data-perm-modulo="${m.id}" data-perm-acao="consultar" ${p.pode_consultar ? "checked" : ""} />
        <input type="checkbox" data-perm-modulo="${m.id}" data-perm-acao="incluir" ${p.pode_incluir ? "checked" : ""} />
        <input type="checkbox" data-perm-modulo="${m.id}" data-perm-acao="alterar" ${p.pode_alterar ? "checked" : ""} />
        <input type="checkbox" data-perm-modulo="${m.id}" data-perm-acao="excluir" ${p.pode_excluir ? "checked" : ""} />
      </div>`;
    }).join("")}
    <div class="px-3 py-3 bg-slate-50 space-y-1.5">
      <p class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Atividades — controles adicionais</p>
      ${[
        ["pode_acessar_monitor", "Acessar o app Monitor (workfire-monitor)"],
        ["pode_mudar_responsavel", "Mudar o responsável de uma atividade"],
        ["pode_concluir_cancelar", "Concluir ou cancelar atividades"],
      ].map(([campo, rotulo]) => `
        <label class="flex items-center gap-2 text-slate-700">
          <input type="checkbox" data-permx="${campo}" ${(existentes["atividades"] || {})[campo] ? "checked" : ""} />
          <span>${rotulo}</span>
        </label>`).join("")}
    </div>
    <div class="px-3 py-3 bg-slate-50 space-y-1.5">
      <p class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Requisições de Compra — controle adicional</p>
      <label class="flex items-center gap-2 text-slate-700">
        <input type="checkbox" data-permx="pode_aprovar_requisicao" ${(existentes["requisicoes_compra"] || {}).pode_aprovar_requisicao ? "checked" : ""} />
        <span>Aprovar requisições de compra</span>
      </label>
    </div>
  `;
}

function montarBlocoPermissoes(cfg, item) {
  if (crudModuloId !== "usuarios_sistema") {
    $("crud-permissoes-bloco").classList.add("hidden");
    return;
  }
  $("crud-permissoes-bloco").classList.remove("hidden");
  const role = item ? item.role : "usuario";
  atualizarVisibilidadePermissoesPorRole(role);
  carregarPermissoesParaForm(item ? item.id : null);
  $("crud-campo-role").addEventListener("change", (e) => atualizarVisibilidadePermissoesPorRole(e.target.value));
}

// Formulários com seção de itens (ex.: Treinamentos) usam o painel lateral mais largo.
function ajustarLarguraPainelCrud(cfg) {
  const caixa = $("painel-crud-caixa");
  if (!caixa) return;
  caixa.classList.toggle("max-w-md", !cfg.painelLargo);
  caixa.classList.toggle("max-w-3xl", !!cfg.painelLargo);
}

function abrirNovoCrud() {
  crudEditandoId = null;
  crudItemEmEdicao = null;
  const cfg = CRUD_CONFIG[crudModuloId];
  esconderErro("crud-form-erro");
  $("painel-crud-titulo").textContent = "Novo " + cfg.titulo.toLowerCase();
  $("btn-salvar-crud").textContent = "Cadastrar";
  ajustarLarguraPainelCrud(cfg);
  $("crud-campos").innerHTML = cfg.campos.map((c) => renderCampoHtml(c, c.padrao)).join("")
    + (cfg.camposExtraHtml ? cfg.camposExtraHtml(null) : "");
  ligarBotoesAcaoCampos(cfg);
  montarBlocoPermissoes(cfg, null);
  $("painel-crud").classList.remove("hidden");
}

function abrirEdicaoCrud(id) {
  crudEditandoId = id;
  const cfg = CRUD_CONFIG[crudModuloId];
  const item = crudLista.find((i) => i.id === id);
  if (!item) return;
  crudItemEmEdicao = item;
  esconderErro("crud-form-erro");
  $("painel-crud-titulo").textContent = "Editar " + cfg.titulo.toLowerCase();
  $("btn-salvar-crud").textContent = "Salvar alterações";
  ajustarLarguraPainelCrud(cfg);
  $("crud-campos").innerHTML = cfg.campos.map((c) => renderCampoHtml(c, item[c.id], item)).join("")
    + (cfg.camposExtraHtml ? cfg.camposExtraHtml(item) : "");
  ligarBotoesAcaoCampos(cfg);
  montarBlocoPermissoes(cfg, item);
  $("painel-crud").classList.remove("hidden");
}

function ligarBotoesAcaoCampos(cfg) {
  cfg.campos.forEach((c) => {
    if (c.botaoAcao) $(c.botaoAcao.id).addEventListener("click", c.botaoAcao.onClick);
  });
  ligarMascaras(cfg);
  if (cfg.aoMontarForm) cfg.aoMontarForm(crudItemEmEdicao);
}

const MASCARAS = {
  cnpj: (v) => {
    const d = v.replace(/\D/g, "").slice(0, 14);
    if (d.length > 12) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})/, "$1.$2.$3/$4-$5");
    if (d.length > 8) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{0,4})/, "$1.$2.$3/$4");
    if (d.length > 5) return d.replace(/^(\d{2})(\d{3})(\d{0,3})/, "$1.$2.$3");
    if (d.length > 2) return d.replace(/^(\d{2})(\d{0,3})/, "$1.$2");
    return d;
  },
  cpf: (v) => {
    const d = v.replace(/\D/g, "").slice(0, 11);
    if (d.length > 9) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{0,2})/, "$1.$2.$3-$4");
    if (d.length > 6) return d.replace(/^(\d{3})(\d{3})(\d{0,3})/, "$1.$2.$3");
    if (d.length > 3) return d.replace(/^(\d{3})(\d{0,3})/, "$1.$2");
    return d;
  },
  cep: (v) => {
    const d = v.replace(/\D/g, "").slice(0, 8);
    if (d.length > 5) return d.replace(/^(\d{5})(\d{0,3})/, "$1-$2");
    return d;
  },
};

function cpfValido(valor) {
  const d = (valor || "").replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(d[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== Number(d[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(d[i]) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== Number(d[10])) return false;
  return true;
}

// Campo de imagem (logotipos): reduz no navegador e guarda como data URL no próprio registro.
function reduzirImagemArquivo(arquivo, maxLado) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const esc = Math.min(1, maxLado / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * esc));
      const h = Math.max(1, Math.round(img.height * esc));
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d");
      const png = /png|webp/i.test(arquivo.type);
      if (!png) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ dataUrl: png ? cv.toDataURL("image/png") : cv.toDataURL("image/jpeg", 0.88), w, h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("imagem inválida")); };
    img.src = url;
  });
}
document.addEventListener("change", async (e) => {
  const inp = e.target.closest ? e.target.closest("[data-imagem-arquivo]") : null;
  if (!inp) return;
  const caixa = inp.closest("[data-imagem-campo]");
  const msg = caixa.querySelector("[data-imagem-msg]");
  const arquivo = inp.files && inp.files[0];
  if (!arquivo) return;
  if (arquivo.size > 8 * 1024 * 1024) { msg.textContent = "Arquivo muito grande (máx. 8 MB)."; msg.className = "text-[11px] mt-1 text-rose-600"; return; }
  try {
    const r = await reduzirImagemArquivo(arquivo, 480);
    caixa.querySelector("input[type=hidden]").value = r.dataUrl;
    const prev = caixa.querySelector("[data-imagem-prev]");
    prev.src = r.dataUrl; prev.classList.remove("hidden");
    caixa.querySelector("[data-imagem-vazio]").classList.add("hidden");
    caixa.querySelector("[data-imagem-remover]").classList.remove("hidden");
    msg.textContent = `Imagem pronta (${r.w}×${r.h}px). Salve o cadastro para gravar.`; msg.className = "text-[11px] mt-1 text-emerald-600";
  } catch (err) {
    msg.textContent = "Não foi possível ler essa imagem."; msg.className = "text-[11px] mt-1 text-rose-600";
  }
  inp.value = "";
});
document.addEventListener("click", (e) => {
  const b = e.target.closest ? e.target.closest("[data-imagem-remover]") : null;
  if (!b) return;
  const caixa = b.closest("[data-imagem-campo]");
  caixa.querySelector("input[type=hidden]").value = "";
  const prev = caixa.querySelector("[data-imagem-prev]");
  prev.removeAttribute("src"); prev.classList.add("hidden");
  caixa.querySelector("[data-imagem-vazio]").classList.remove("hidden");
  b.classList.add("hidden");
});

function ligarMascaras(cfg) {
  cfg.campos.forEach((c) => {
    if (!c.mascara || !MASCARAS[c.mascara]) return;
    const el = $("crud-campo-" + c.id);
    if (!el) return;
    el.addEventListener("input", () => {
      const pos = el.selectionStart;
      const antes = el.value.length;
      el.value = MASCARAS[c.mascara](el.value);
      const depois = el.value.length;
      el.setSelectionRange(pos + (depois - antes), pos + (depois - antes));
    });
  });
}

// ===========================================================
// IMPORTAÇÃO DE CLIENTES (planilha do gestor3s) + endereços pela Receita
// Regras: só entram CNPJ (dígitos verificadores ok) e CPF válidos; CNPJ
// zerado/vazio/inválido é ignorado; linhas repetidas (mesmo documento + razão
// + fantasia) entram uma vez; documentos que já existiam no cadastro antes da
// importação não são tocados; registros marcados teste/duplicado são pulados.
// O endereço vem da planilha e, quando faltar, é completado pela Receita.
// ===========================================================
const IMPORT_LIXO = /\bteste\b|duplicado|n[ãa]o considerar|\bapagar\b|n[ãa]o usar/i;

function validarCnpjDigitos(c) {
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dv = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((acc, p, i) => acc + Number(c[i]) * p, 0);
    const r = soma % 11;
    return String(r < 2 ? 0 : 11 - r);
  };
  return c[12] === dv(12) && c[13] === dv(13);
}
function validarCpfDigitos(c) {
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(c[n])) return false;
  }
  return true;
}
function formatarDocumentoImport(c) {
  return c.length === 14
    ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
    : `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
}
function textoCelulaImport(v) {
  if (v == null) return "";
  if (typeof v === "object" && typeof v.text === "function") v = v.text();
  return String(v).replace(/\s+/g, " ").trim();
}
function cepImport(v) {
  let c = textoCelulaImport(v).replace(/\D/g, "");
  if (c.length === 7) c = "0" + c;
  return c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : "";
}
function enderecoPlanilhaImport(r) {
  const log = textoCelulaImport(r[3]).replace(/,+\s*$/, "").trim();
  if (!log) return "";
  const num = textoCelulaImport(r[4]);
  const comp = textoCelulaImport(r[5]);
  const bairro = textoCelulaImport(r[6]);
  const uf = textoCelulaImport(r[7]);
  const mun = textoCelulaImport(r[8]);
  const cep = cepImport(r[9]);
  const partes = [];
  if (["S/N", "SN"].includes(num.toUpperCase())) partes.push(`${log}, s/n`);
  else partes.push(num && num !== "0" ? `${log}, ${num}` : log);
  if (comp) partes.push(comp);
  if (bairro) partes.push(bairro);
  const loc = mun && uf ? `${mun}/${uf}` : (mun || uf);
  if (loc) partes.push(loc);
  if (cep) partes.push(`CEP ${cep}`);
  return partes.join(" - ");
}
function telefonePlanilhaImport(r) {
  const a = textoCelulaImport(r[11]);
  const b = textoCelulaImport(r[13]);
  if (a && b && a.replace(/\D/g, "") !== b.replace(/\D/g, "")) return `${a} / ${b}`;
  return a || b;
}

// Lê as linhas da planilha e aplica as regras; devolve { registros, resumo }.
function prepararClientesPlanilha(linhas) {
  const resumo = { total: 0, zerado: 0, semCnpj: 0, invalido: 0, teste: 0, repetido: 0, ok: 0, comEndereco: 0, semEndereco: 0, cpf: 0 };
  const registros = [];
  const vistos = new Set();
  linhas.slice(1).forEach((r) => {
    resumo.total++;
    const c = textoCelulaImport(r[2]).replace(/\D/g, "");
    if (!c) { resumo.semCnpj++; return; }
    if (/^0+$/.test(c)) { resumo.zerado++; return; }
    if (!((c.length === 14 && validarCnpjDigitos(c)) || (c.length === 11 && validarCpfDigitos(c)))) { resumo.invalido++; return; }
    const razao = textoCelulaImport(r[1]);
    const fantasia = textoCelulaImport(r[0]);
    if (IMPORT_LIXO.test(`${razao} ${fantasia}`)) { resumo.teste++; return; }
    const nome = razao || fantasia;
    const chave = `${c}|${nome.toUpperCase()}|${fantasia.toUpperCase()}`;
    if (vistos.has(chave)) { resumo.repetido++; return; }
    vistos.add(chave);
    const endereco = enderecoPlanilhaImport(r);
    if (endereco) resumo.comEndereco++; else resumo.semEndereco++;
    if (c.length === 11) resumo.cpf++;
    registros.push({
      digitos: c,
      nome,
      nome_fantasia: fantasia && fantasia.toUpperCase() !== nome.toUpperCase() ? fantasia : null,
      cnpj: formatarDocumentoImport(c),
      endereco: endereco || null,
      contato_nome: textoCelulaImport(r[10]) || null,
      contato_telefone: telefonePlanilhaImport(r) || null,
      status: "Ativo",
      origem: "gestor3s",
    });
  });
  resumo.ok = registros.length;
  return { registros, resumo };
}

let importacaoClientesPendente = null;
let importacaoEnderecosParar = false;

function painelImportacao(html) {
  const el = $("crud-importacao-painel");
  el.innerHTML = html;
  el.classList.remove("hidden");
  return el;
}

async function lerPlanilhaClientes(arquivo) {
  painelImportacao(`<p class="text-slate-600">Lendo a planilha…</p>`);
  try {
    const buffer = await arquivo.arrayBuffer();
    const wb = await XlsxPopulate.fromDataAsync(buffer);
    const linhas = wb.sheet(0).usedRange().value();
    const cab = textoCelulaImport(linhas[0]?.[2]).toUpperCase();
    if (!cab.includes("CNPJ")) throw new Error("A 3ª coluna da planilha deveria ser o CNPJ. Confira se é o arquivo exportado de Clientes do gestor3s.");
    const { registros, resumo } = prepararClientesPlanilha(linhas);

    painelImportacao(`<p class="text-slate-600">Comparando com as empresas já cadastradas…</p>`);
    const { data: existentes, error } = await buscarTodos(() => supabase.from("empresas").select("id, nome, cnpj, origem").order("id"));
    if (error) throw new Error(error.message);
    const digitos = (s) => (s || "").replace(/\D/g, "");
    const docsAntigos = new Set((existentes || []).filter((e) => e.origem !== "gestor3s").map((e) => digitos(e.cnpj)).filter(Boolean));
    const jaImportados = new Set((existentes || []).filter((e) => e.origem === "gestor3s").map((e) => `${digitos(e.cnpj)}|${(e.nome || "").toUpperCase()}`));
    let jaExistem = 0;
    let jaImportadosAntes = 0;
    const novos = registros.filter((r) => {
      if (docsAntigos.has(r.digitos)) { jaExistem++; return false; }
      if (jaImportados.has(`${r.digitos}|${r.nome.toUpperCase()}`)) { jaImportadosAntes++; return false; }
      return true;
    });
    importacaoClientesPendente = novos;
    const semEnd = novos.filter((r) => !r.endereco && r.digitos.length === 14).length;
    painelImportacao(`
      <p class="font-medium text-slate-800 mb-2">Conferência da planilha (${resumo.total} linhas)</p>
      <ul class="text-xs text-slate-600 space-y-0.5 mb-3">
        <li>✅ Válidas (CNPJ/CPF ok): <strong>${resumo.ok}</strong> ${resumo.cpf ? `(${resumo.cpf} com CPF)` : ""}</li>
        <li>⛔ Ignoradas — CNPJ zerado: ${resumo.zerado} · sem CNPJ: ${resumo.semCnpj} · documento inválido: ${resumo.invalido}</li>
        <li>⛔ Ignoradas — teste/duplicado: ${resumo.teste} · linhas repetidas: ${resumo.repetido}</li>
        <li>⏭️ Já existem no cadastro (documento já cadastrado antes): ${jaExistem}${jaImportadosAntes ? ` · já importadas antes: ${jaImportadosAntes}` : ""}</li>
        <li>📍 Das que serão importadas, <strong>${semEnd}</strong> não têm endereço na planilha (depois você pode completar pela Receita Federal)</li>
      </ul>
      <p class="mb-3 text-slate-800"><strong>${novos.length}</strong> empresa(s) serão importadas como <strong>Ativo</strong>.</p>
      <div class="flex gap-2">
        <button id="btn-importar-confirmar" class="text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-md px-4 py-2" ${novos.length ? "" : "disabled"}>Importar ${novos.length} empresa(s)</button>
        <button id="btn-importar-cancelar" class="text-xs font-medium text-slate-600 border border-slate-300 rounded-md px-4 py-2">Cancelar</button>
      </div>`);
    $("btn-importar-confirmar").addEventListener("click", executarImportacaoClientes);
    $("btn-importar-cancelar").addEventListener("click", () => { importacaoClientesPendente = null; $("crud-importacao-painel").classList.add("hidden"); });
  } catch (e) {
    painelImportacao(`<p class="text-rose-700">Não foi possível ler a planilha: ${e.message || e}</p>`);
  }
}

async function executarImportacaoClientes() {
  const lista = importacaoClientesPendente;
  if (!lista || lista.length === 0) return;
  importacaoClientesPendente = null;
  const tam = 500;
  let gravadas = 0;
  for (let i = 0; i < lista.length; i += tam) {
    const lote = lista.slice(i, i + tam).map(({ digitos, ...resto }) => resto);
    painelImportacao(`<p class="text-slate-700">Importando… <strong>${gravadas}</strong> de ${lista.length}</p>`);
    const { error } = await supabase.from("empresas").insert(lote);
    if (error) {
      painelImportacao(`<p class="text-rose-700">Erro após ${gravadas} empresa(s) gravadas: ${error.message}. Nada foi duplicado: ao enviar a planilha de novo, o que já entrou é reconhecido e pulado.</p>`);
      return;
    }
    gravadas += lote.length;
  }
  await carregarModuloCrud("empresas");
  painelImportacao(`
    <p class="text-teal-700 font-medium mb-2">✅ ${gravadas} empresa(s) importadas.</p>
    <p class="text-xs text-slate-600">Agora você pode completar os endereços que faltam pela Receita Federal.</p>`);
}

function montarEnderecoReceita(d) {
  return [
    [d.logradouro, d.numero].filter(Boolean).join(", "),
    d.complemento,
    d.bairro,
    d.municipio && d.uf ? `${d.municipio}/${d.uf}` : d.municipio || d.uf,
    d.cep ? `CEP ${d.cep}` : null,
  ].filter(Boolean).join(" - ");
}

async function completarEnderecosReceita() {
  if (!confirm("Buscar na Receita Federal o endereço das empresas que estão sem endereço? Pode levar alguns minutos; você pode interromper e continuar depois.")) return;
  importacaoEnderecosParar = false;
  painelImportacao(`<p class="text-slate-600">Procurando empresas sem endereço…</p>`);
  const { data, error } = await buscarTodos(() => supabase.from("empresas").select("id, cnpj, endereco").or("endereco.is.null,endereco.eq.").order("id"));
  if (error) return painelImportacao(`<p class="text-rose-700">Erro ao consultar: ${error.message}</p>`);
  const porCnpj = new Map();
  (data || []).forEach((e) => {
    const d = (e.cnpj || "").replace(/\D/g, "");
    if (d.length !== 14) return;
    if (!porCnpj.has(d)) porCnpj.set(d, []);
    porCnpj.get(d).push(e.id);
  });
  const fila = [...porCnpj.entries()];
  if (fila.length === 0) return painelImportacao(`<p class="text-teal-700">Nenhuma empresa com CNPJ e sem endereço. Nada a fazer.</p>`);

  let feitos = 0, achados = 0, naoAchados = 0, falhas = 0;
  const atualizar = (fim) => painelImportacao(`
    <p class="text-slate-700 mb-2">${fim ? "Concluído" : "Consultando a Receita Federal…"} <strong>${feitos}</strong> de ${fila.length} CNPJs · endereços preenchidos: ${achados} · não encontrados: ${naoAchados} · falhas: ${falhas}</p>
    ${fim ? "" : `<button id="btn-enderecos-parar" class="text-xs font-medium text-slate-600 border border-slate-300 rounded-md px-3 py-1.5">Interromper</button>`}`);
  atualizar(false);
  const botaoParar = () => { const b = $("btn-enderecos-parar"); if (b) b.onclick = () => { importacaoEnderecosParar = true; }; };
  botaoParar();

  for (const [cnpjDigitos, ids] of fila) {
    if (importacaoEnderecosParar) break;
    let dados = null;
    for (let tentativa = 0; tentativa < 3 && !dados; tentativa++) {
      try {
        const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjDigitos}`);
        if (resp.status === 404) { naoAchados++; dados = false; break; }
        if (resp.status === 429) { await new Promise((r) => setTimeout(r, 5000)); continue; }
        if (!resp.ok) throw new Error(String(resp.status));
        dados = await resp.json();
      } catch (e) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (dados) {
      const endereco = montarEnderecoReceita(dados);
      if (endereco) {
        const { error: eUp } = await supabase.from("empresas").update({ endereco }).in("id", ids);
        if (eUp) falhas++; else achados++;
      } else naoAchados++;
    } else if (dados === null) falhas++;
    feitos++;
    if (feitos % 5 === 0) { atualizar(false); botaoParar(); }
    await new Promise((r) => setTimeout(r, 450));
  }
  await carregarModuloCrud("empresas");
  atualizar(true);
  if (importacaoEnderecosParar) $("crud-importacao-painel").insertAdjacentHTML("beforeend", `<p class="text-xs text-slate-500">Interrompido por você. Clique em "Completar endereços" de novo para continuar de onde parou.</p>`);
}

$("btn-crud-importar-clientes").addEventListener("click", () => $("crud-importar-arquivo").click());
$("crud-importar-arquivo").addEventListener("change", (ev) => {
  const arquivo = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (arquivo) lerPlanilhaClientes(arquivo);
});
$("btn-crud-completar-enderecos").addEventListener("click", completarEnderecosReceita);

async function buscarCnpjReceitaFederal() {
  const status = $("btn-buscar-cnpj-status");
  const cnpjDigits = $("crud-campo-cnpj").value.replace(/\D/g, "");
  if (cnpjDigits.length !== 14) {
    status.className = "text-[11px] mt-1 text-rose-600";
    status.textContent = "Informe um CNPJ válido (14 dígitos) antes de pesquisar.";
    return;
  }

  const btn = $("btn-buscar-cnpj");
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Buscando…";
  status.className = "text-[11px] mt-1 text-slate-400";
  status.textContent = "Consultando a Receita Federal…";

  try {
    const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjDigits}`);
    if (!resp.ok) throw new Error("CNPJ não encontrado");
    const dados = await resp.json();

    if ($("crud-campo-nome")) $("crud-campo-nome").value = dados.razao_social || dados.nome_fantasia || "";
    if ($("crud-campo-nome_fantasia") && dados.nome_fantasia) $("crud-campo-nome_fantasia").value = dados.nome_fantasia;
    if ($("crud-campo-endereco")) {
      const partes = [
        [dados.logradouro, dados.numero].filter(Boolean).join(", "),
        dados.complemento,
        dados.bairro,
        dados.municipio && dados.uf ? `${dados.municipio}/${dados.uf}` : dados.municipio || dados.uf,
        dados.cep ? `CEP ${dados.cep}` : null,
      ].filter(Boolean);
      $("crud-campo-endereco").value = partes.join(" - ");
    }
    if ($("crud-campo-contato_telefone") && dados.ddd_telefone_1) {
      $("crud-campo-contato_telefone").value = dados.ddd_telefone_1;
    }

    status.className = "text-[11px] mt-1 text-teal-700";
    status.textContent = `✅ ${dados.razao_social || "Empresa encontrada"}${dados.descricao_situacao_cadastral ? ` — ${dados.descricao_situacao_cadastral}` : ""}`;
  } catch (e) {
    status.className = "text-[11px] mt-1 text-rose-600";
    status.textContent = "Não foi possível encontrar esse CNPJ na Receita Federal. Confira o número e tente novamente.";
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ---------------------------------------------------------
// Endereço do treinamento in-company (orçamento) — Teoria / Prática
// ---------------------------------------------------------
// "prefixo" é "teo" ou "pra". Quando "usar o mesmo endereço da empresa"
// está marcado, o endereço cadastrado da empresa (texto único, sem campos
// separados) é guardado no próprio campo "logradouro" e os demais campos
// de endereço ficam em branco — "mesmo_empresa" é o que diferencia esse
// caso na hora de exibir/reabrir o orçamento. O endereço é georreferenciado
// automaticamente (latitude/longitude), sem precisar de botão: ao achar o
// CEP, ao marcar "usar o mesmo endereço da empresa", e como garantia final
// no momento de salvar, caso alguma dessas etapas não tenha rodado.

function empresaSelecionadaOrc() {
  return listaEmpresasAtivas.find((e) => e.id === $("orc-empresa").value);
}

function atualizarPreviewEnderecoEmpresaOrc() {
  const emp = empresaSelecionadaOrc();
  const texto = emp?.endereco ? emp.endereco : "Nenhum endereço cadastrado para esta empresa.";
  if ($("orc-teo-empresa-endereco-preview")) $("orc-teo-empresa-endereco-preview").textContent = texto;
  if ($("orc-pra-empresa-endereco-preview")) $("orc-pra-empresa-endereco-preview").textContent = texto;
}

// Mostra/esconde os blocos de endereço conforme o formato escolhido para
// teoria/prática, e esconde o bloco da prática quando ele está marcado
// como "mesmo endereço da teoria".
function atualizarBlocosEnderecoInCompanyOrc() {
  const teoriaInCompany = $("orc-formato-teoria").value === "InCompany";
  const praticaInCompany = $("orc-formato-pratica").value === "InCompany";
  const ambosInCompany = teoriaInCompany && praticaInCompany;

  $("orc-endereco-teoria-bloco").classList.toggle("hidden", !teoriaInCompany);
  $("orc-mesmo-endereco-bloco").classList.toggle("hidden", !ambosInCompany);
  if (!ambosInCompany) $("orc-pra-mesmo-teoria").checked = false;

  const praticaSincronizada = ambosInCompany && $("orc-pra-mesmo-teoria").checked;
  $("orc-endereco-pratica-bloco").classList.toggle("hidden", !praticaInCompany || praticaSincronizada);

  atualizarPreviewEnderecoEmpresaOrc();
}

function resetarEnderecoOrc(prefixo) {
  $(`orc-${prefixo}-usar-empresa`).checked = false;
  ["cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf"].forEach((c) => {
    $(`orc-${prefixo}-${c}`).value = "";
  });
  $(`orc-${prefixo}-latitude`).value = "";
  $(`orc-${prefixo}-longitude`).value = "";
  $(`orc-${prefixo}-cep-status`).classList.add("hidden");
  $(`orc-${prefixo}-geo-status`).textContent = "";
  $(`orc-${prefixo}-endereco-campos`).classList.remove("hidden");
}

function preencherEnderecoOrc(prefixo, o, sufixoDb) {
  $(`orc-${prefixo}-usar-empresa`).checked = !!o[`endereco_${sufixoDb}_mesmo_empresa`];
  $(`orc-${prefixo}-cep`).value = o[`endereco_${sufixoDb}_cep`] || "";
  $(`orc-${prefixo}-logradouro`).value = o[`endereco_${sufixoDb}_logradouro`] || "";
  $(`orc-${prefixo}-numero`).value = o[`endereco_${sufixoDb}_numero`] || "";
  $(`orc-${prefixo}-complemento`).value = o[`endereco_${sufixoDb}_complemento`] || "";
  $(`orc-${prefixo}-bairro`).value = o[`endereco_${sufixoDb}_bairro`] || "";
  $(`orc-${prefixo}-cidade`).value = o[`endereco_${sufixoDb}_cidade`] || "";
  $(`orc-${prefixo}-uf`).value = o[`endereco_${sufixoDb}_uf`] || "";
  $(`orc-${prefixo}-latitude`).value = o[`endereco_${sufixoDb}_latitude`] != null ? o[`endereco_${sufixoDb}_latitude`] : "";
  $(`orc-${prefixo}-longitude`).value = o[`endereco_${sufixoDb}_longitude`] != null ? o[`endereco_${sufixoDb}_longitude`] : "";
  $(`orc-${prefixo}-cep-status`).classList.add("hidden");
  atualizarStatusGeoOrc(prefixo);
  $(`orc-${prefixo}-endereco-campos`).classList.toggle("hidden", $(`orc-${prefixo}-usar-empresa`).checked);
}

function ligarToggleUsarEnderecoEmpresaOrc(prefixo) {
  $(`orc-${prefixo}-usar-empresa`).addEventListener("change", async () => {
    const usarEmpresa = $(`orc-${prefixo}-usar-empresa`).checked;
    $(`orc-${prefixo}-endereco-campos`).classList.toggle("hidden", usarEmpresa);
    if (usarEmpresa) await geocodificarEnderecoEmpresaOrc(prefixo);
  });
}

function ligarMascaraCepOrc(prefixo) {
  const el = $(`orc-${prefixo}-cep`);
  el.addEventListener("input", () => { el.value = MASCARAS.cep(el.value); });
  el.addEventListener("blur", () => buscarCepOrcamento(prefixo));
}

// Consulta o CEP na mesma API já usada para o CNPJ (BrasilAPI) e preenche
// logradouro/bairro/cidade/uf automaticamente — número e complemento ficam
// para o usuário completar.
async function buscarCepOrcamento(prefixo) {
  const status = $(`orc-${prefixo}-cep-status`);
  const digits = $(`orc-${prefixo}-cep`).value.replace(/\D/g, "");
  status.classList.remove("hidden");
  if (digits.length !== 8) {
    status.className = "text-[11px] mt-1 text-rose-600";
    status.textContent = "Informe um CEP válido (8 dígitos).";
    return;
  }
  status.className = "text-[11px] mt-1 text-slate-400";
  status.textContent = "Consultando o CEP…";
  $(`orc-${prefixo}-latitude`).value = "";
  $(`orc-${prefixo}-longitude`).value = "";
  try {
    const resp = await fetch(`https://brasilapi.com.br/api/cep/v2/${digits}`);
    if (!resp.ok) throw new Error("CEP não encontrado");
    const dados = await resp.json();
    $(`orc-${prefixo}-logradouro`).value = dados.street || "";
    $(`orc-${prefixo}-bairro`).value = dados.neighborhood || "";
    $(`orc-${prefixo}-cidade`).value = dados.city || "";
    $(`orc-${prefixo}-uf`).value = dados.state || "";
    status.className = "text-[11px] mt-1 text-teal-700";
    status.textContent = "✅ Endereço encontrado — confira o número e o complemento.";
  } catch (e) {
    status.className = "text-[11px] mt-1 text-rose-600";
    status.textContent = "Não foi possível encontrar esse CEP. Confira o número ou preencha o endereço manualmente.";
    return;
  }
  // Georreferencia automaticamente assim que o endereço é encontrado — sem precisar de outro clique.
  await geocodificarEnderecoOrc(prefixo);
}

// Georreferencia o endereço estruturado (teoria ou prática) digitado/buscado
// via CEP, usando o mesmo fallback progressivo dos demais cadastros do app.
async function geocodificarEnderecoOrc(prefixo) {
  const status = $(`orc-${prefixo}-geo-status`);
  const logradouro = $(`orc-${prefixo}-logradouro`).value.trim();
  const numero = $(`orc-${prefixo}-numero`).value.trim();
  const bairro = $(`orc-${prefixo}-bairro`).value.trim();
  const cidade = $(`orc-${prefixo}-cidade`).value.trim();
  const uf = $(`orc-${prefixo}-uf`).value.trim();
  const cep = $(`orc-${prefixo}-cep`).value;
  const textoLivre = [[logradouro, numero].filter(Boolean).join(", "), bairro, cidade, uf].filter(Boolean).join(", ");
  if (!textoLivre && !cep) return;
  status.textContent = "Localizando no mapa…";
  try {
    const resultado = await geocodificarComFallback({ textosLivres: [textoLivre], logradouro, numero, bairro, cidade, uf, cep });
    if (resultado) {
      $(`orc-${prefixo}-latitude`).value = resultado.lat;
      $(`orc-${prefixo}-longitude`).value = resultado.lon;
    }
  } catch (e) {
    // Falha silenciosa: não bloqueia o preenchimento do endereço.
  }
  atualizarStatusGeoOrc(prefixo);
}

// Georreferencia o endereço (texto único) da empresa selecionada, usado
// quando "usar o mesmo endereço da empresa" está marcado.
async function geocodificarEnderecoEmpresaOrc(prefixo) {
  const status = $(`orc-${prefixo}-geo-status`);
  const emp = empresaSelecionadaOrc();
  $(`orc-${prefixo}-latitude`).value = "";
  $(`orc-${prefixo}-longitude`).value = "";
  if (!emp?.endereco) { status.textContent = ""; return; }
  status.textContent = "Localizando no mapa…";
  try {
    const cidadeUf = extrairCidadeUfDeEndereco(emp.endereco);
    const enderecoLimpo = emp.endereco.replace(/\s*-\s*CEP\s*[\d-]+\s*$/i, "").replace(/\//g, ", ");
    const resultado = await geocodificarComFallback({
      textosLivres: [emp.endereco, enderecoLimpo],
      cidade: cidadeUf ? cidadeUf.cidade : undefined,
      uf: cidadeUf ? cidadeUf.uf : undefined,
    });
    if (resultado) {
      $(`orc-${prefixo}-latitude`).value = resultado.lat;
      $(`orc-${prefixo}-longitude`).value = resultado.lon;
    }
  } catch (e) {
    // Falha silenciosa.
  }
  atualizarStatusGeoOrc(prefixo);
}

function atualizarStatusGeoOrc(prefixo) {
  const status = $(`orc-${prefixo}-geo-status`);
  const lat = $(`orc-${prefixo}-latitude`).value;
  const lon = $(`orc-${prefixo}-longitude`).value;
  if (lat && lon) {
    status.innerHTML = `📍 <a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" rel="noopener" class="text-amber-600 underline">Ver no mapa</a>`;
  } else {
    status.textContent = "";
  }
}

// Monta o objeto de endereço (teoria ou prática) a partir dos campos do
// formulário, para gravar no orçamento — garantindo, como última instância,
// que o endereço fique georreferenciado mesmo se a busca automática por CEP
// não tiver rodado (por exemplo, endereço digitado à mão).
async function coletarEnderecoOrc(prefixo) {
  if ($(`orc-${prefixo}-usar-empresa`).checked) {
    const emp = empresaSelecionadaOrc();
    if (emp?.endereco && (!$(`orc-${prefixo}-latitude`).value || !$(`orc-${prefixo}-longitude`).value)) {
      await geocodificarEnderecoEmpresaOrc(prefixo);
    }
    return {
      mesmo_empresa: true,
      cep: null,
      logradouro: emp?.endereco || null,
      numero: null,
      complemento: null,
      bairro: null,
      cidade: null,
      uf: null,
      latitude: $(`orc-${prefixo}-latitude`).value === "" ? null : Number($(`orc-${prefixo}-latitude`).value),
      longitude: $(`orc-${prefixo}-longitude`).value === "" ? null : Number($(`orc-${prefixo}-longitude`).value),
    };
  }
  if (!$(`orc-${prefixo}-latitude`).value || !$(`orc-${prefixo}-longitude`).value) {
    await geocodificarEnderecoOrc(prefixo);
  }
  return {
    mesmo_empresa: false,
    cep: $(`orc-${prefixo}-cep`).value.trim() || null,
    logradouro: $(`orc-${prefixo}-logradouro`).value.trim() || null,
    numero: $(`orc-${prefixo}-numero`).value.trim() || null,
    complemento: $(`orc-${prefixo}-complemento`).value.trim() || null,
    bairro: $(`orc-${prefixo}-bairro`).value.trim() || null,
    cidade: $(`orc-${prefixo}-cidade`).value.trim() || null,
    uf: $(`orc-${prefixo}-uf`).value.trim().toUpperCase() || null,
    latitude: $(`orc-${prefixo}-latitude`).value === "" ? null : Number($(`orc-${prefixo}-latitude`).value),
    longitude: $(`orc-${prefixo}-longitude`).value === "" ? null : Number($(`orc-${prefixo}-longitude`).value),
  };
}

// Retorna uma mensagem de erro (ou null se estiver ok) exigindo que o
// endereço do treinamento in-company esteja informado: ou "usar o mesmo
// endereço da empresa" marcado (com a empresa tendo endereço cadastrado),
// ou logradouro + cidade + UF preenchidos manualmente.
function validarEnderecoInCompanyOrc(prefixo, rotulo) {
  if ($(`orc-${prefixo}-usar-empresa`).checked) {
    const emp = empresaSelecionadaOrc();
    if (!emp?.endereco) {
      return `A empresa selecionada não tem endereço cadastrado. Desmarque "usar o mesmo endereço da empresa" e informe o endereço do treinamento in-company (${rotulo}) manualmente.`;
    }
    return null;
  }
  const logradouro = $(`orc-${prefixo}-logradouro`).value.trim();
  const cidade = $(`orc-${prefixo}-cidade`).value.trim();
  const uf = $(`orc-${prefixo}-uf`).value.trim();
  if (!logradouro || !cidade || !uf) {
    return `Informe o endereço do treinamento in-company (${rotulo}): logradouro, cidade e UF são obrigatórios (ou marque "usar o mesmo endereço da empresa").`;
  }
  return null;
}

// ---------------------------------------------------------
// Horário de início da aula (orçamento) — Teoria / Prática
// ---------------------------------------------------------
// Padrão: 7:30 em Centro de Treinamento, 7:00 em InCompany (os demais
// formatos usam 7:30 como referência geral). O usuário pode alterar
// livremente — trocar o formato só atualiza o horário enquanto o campo
// não tiver sido editado à mão. Só existem dois horários independentes
// quando teoria e prática têm endereços distintos: quando estão
// sincronizadas pelo "mesmo endereço da teoria", o horário da prática
// acompanha o da teoria (o campo fica oculto).
function horarioDefaultPorFormato(formato) {
  return formato === "InCompany" ? "07:00" : "07:30";
}

function atualizarHorarioPadraoTeoriaOrc() {
  if (orcHorarioTeoriaEditadoManualmente) return;
  const formato = $("orc-formato-teoria").value;
  $("orc-horario-teoria").value = formato ? horarioDefaultPorFormato(formato) : "";
}

function atualizarHorarioPadraoPraticaOrc() {
  if (orcHorarioPraticaEditadoManualmente) return;
  const formato = $("orc-formato-pratica").value;
  $("orc-horario-pratica").value = formato ? horarioDefaultPorFormato(formato) : "";
}

function praticaSincronizadaComTeoriaOrc() {
  const teoriaInCompany = $("orc-formato-teoria").value === "InCompany";
  const praticaInCompany = $("orc-formato-pratica").value === "InCompany";
  return teoriaInCompany && praticaInCompany && $("orc-pra-mesmo-teoria").checked;
}

// Mostra/esconde o campo de horário da prática conforme ela está ou não
// sincronizada com o endereço da teoria.
function atualizarBlocoHorarioPraticaOrc() {
  const sincronizado = praticaSincronizadaComTeoriaOrc();
  $("orc-horario-pratica-bloco").classList.toggle("hidden", sincronizado);
  if (sincronizado) $("orc-horario-pratica").value = $("orc-horario-teoria").value;
}

function resetarHorarioOrc() {
  $("orc-horario-teoria").value = "";
  $("orc-horario-pratica").value = "";
  orcHorarioTeoriaEditadoManualmente = false;
  orcHorarioPraticaEditadoManualmente = false;
}

function preencherHorarioOrc(o) {
  $("orc-horario-teoria").value = o.horario_inicio_teoria ? o.horario_inicio_teoria.slice(0, 5) : "";
  $("orc-horario-pratica").value = o.horario_inicio_pratica ? o.horario_inicio_pratica.slice(0, 5) : "";
  // Já preenchido a partir do orçamento salvo — troca de formato não deve sobrescrever.
  orcHorarioTeoriaEditadoManualmente = true;
  orcHorarioPraticaEditadoManualmente = true;
}

$("orc-horario-teoria").addEventListener("input", () => { orcHorarioTeoriaEditadoManualmente = true; });
$("orc-horario-pratica").addEventListener("input", () => { orcHorarioPraticaEditadoManualmente = true; });

$("orc-formato-teoria").addEventListener("change", () => {
  atualizarBlocosEnderecoInCompanyOrc();
  atualizarHorarioPadraoTeoriaOrc();
  atualizarBlocoHorarioPraticaOrc();
});
$("orc-formato-pratica").addEventListener("change", () => {
  atualizarBlocosEnderecoInCompanyOrc();
  atualizarHorarioPadraoPraticaOrc();
  atualizarBlocoHorarioPraticaOrc();
});
// Contato do orçamento: copia o contato cadastrado na empresa (só ao trocar a empresa);
// depois disso os campos são do orçamento e podem ser editados sem afetar a empresa.
function preencherContatoOrcDaEmpresa() {
  const emp = empresaSelecionadaOrc();
  $("orc-contato-nome").value = emp?.contato_nome || "";
  $("orc-contato-telefone").value = emp?.contato_telefone || "";
  $("orc-contato-email").value = emp?.contato_email || "";
}
$("orc-empresa").addEventListener("change", () => {
  atualizarPreviewEnderecoEmpresaOrc();
  preencherContatoOrcDaEmpresa();
});
$("orc-pra-mesmo-teoria").addEventListener("change", () => {
  atualizarBlocosEnderecoInCompanyOrc();
  atualizarBlocoHorarioPraticaOrc();
});
ligarToggleUsarEnderecoEmpresaOrc("teo");
ligarToggleUsarEnderecoEmpresaOrc("pra");
ligarMascaraCepOrc("teo");
ligarMascaraCepOrc("pra");

async function buscarCep() {
  const status = $("f-cep-status");
  const cepDigits = $("f-cep").value.replace(/\D/g, "");
  if (cepDigits.length !== 8) {
    status.className = "text-[11px] mt-1 text-rose-600";
    status.textContent = "Informe um CEP válido (8 dígitos) antes de pesquisar.";
    return;
  }

  const btn = $("btn-buscar-cep");
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Buscando…";
  status.className = "text-[11px] mt-1 text-slate-400";
  status.textContent = "Consultando a base de CEPs…";

  try {
    const resp = await fetch(`https://brasilapi.com.br/api/cep/v2/${cepDigits}`);
    if (!resp.ok) throw new Error("CEP não encontrado");
    const dados = await resp.json();

    $("f-endereco").value = dados.street || "";
    $("f-bairro").value = dados.neighborhood || "";
    $("f-cidade").value = dados.city || "";
    $("f-uf").value = dados.state || "";

    status.className = "text-[11px] mt-1 text-teal-700";
    status.textContent = "✅ Endereço encontrado. Confira e complete o número/complemento.";
  } catch (e) {
    status.className = "text-[11px] mt-1 text-rose-600";
    status.textContent = "Não foi possível encontrar esse CEP. Confira o número e preencha o endereço manualmente.";
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }

  // Georreferencia automaticamente assim que o endereço é encontrado — sem precisar de outro clique.
  await geocodificarInstrutor();
}

if ($("f-cep")) {
  $("f-cep").addEventListener("input", () => {
    const el = $("f-cep");
    const pos = el.selectionStart;
    const antes = el.value.length;
    el.value = MASCARAS.cep(el.value);
    const depois = el.value.length;
    el.setSelectionRange(pos + (depois - antes), pos + (depois - antes));
  });
}
if ($("btn-buscar-cep")) $("btn-buscar-cep").addEventListener("click", buscarCep);

async function geocodificarInstrutor() {
  const status = $("f-geo-status");
  const partes = [
    [$("f-endereco").value.trim(), $("f-numero").value.trim()].filter(Boolean).join(", "),
    $("f-bairro").value.trim(),
    $("f-cidade").value.trim(),
    $("f-uf").value.trim(),
  ].filter(Boolean);
  const endereco = partes.join(", ");
  if (!endereco) {
    status.className = "text-[11px] mt-1 text-rose-600";
    status.textContent = "Preencha o endereço antes de obter as coordenadas.";
    return;
  }

  const btn = $("btn-geocodificar-instrutor");
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Localizando…";
  status.className = "text-[11px] mt-1 text-slate-400";
  status.textContent = "Consultando geolocalização…";

  try {
    const resultado = await geocodificarComFallback({
      textosLivres: [endereco],
      logradouro: $("f-endereco").value.trim(),
      numero: $("f-numero").value.trim(),
      bairro: $("f-bairro").value.trim(),
      cidade: $("f-cidade").value.trim(),
      uf: $("f-uf").value.trim(),
      cep: $("f-cep") ? $("f-cep").value : "",
    });
    if (!resultado) throw new Error("Endereço não encontrado");
    $("f-latitude").value = resultado.lat;
    $("f-longitude").value = resultado.lon;
    status.className = "text-[11px] mt-1 text-teal-700";
    status.textContent = `✅ Coordenadas encontradas: ${resultado.lat}, ${resultado.lon}`;
  } catch (e) {
    status.className = "text-[11px] mt-1 text-rose-600";
    status.textContent = "Não foi possível localizar esse endereço no mapa. Confira o endereço e tente novamente.";
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}
if ($("btn-geocodificar-instrutor")) $("btn-geocodificar-instrutor").addEventListener("click", geocodificarInstrutor);

async function buscarCepCentro() {
  const status = $("btn-buscar-cep-centro-status");
  const cepDigits = $("crud-campo-cep").value.replace(/\D/g, "");
  if (cepDigits.length !== 8) {
    status.className = "text-[11px] mt-1 text-rose-600";
    status.textContent = "Informe um CEP válido (8 dígitos) antes de pesquisar.";
    return;
  }

  const btn = $("btn-buscar-cep-centro");
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Buscando…";
  status.className = "text-[11px] mt-1 text-slate-400";
  status.textContent = "Consultando a base de CEPs…";

  try {
    const resp = await fetch(`https://brasilapi.com.br/api/cep/v2/${cepDigits}`);
    if (!resp.ok) throw new Error("CEP não encontrado");
    const dados = await resp.json();

    if ($("crud-campo-endereco")) {
      const partes = [
        [dados.street, dados.neighborhood].filter(Boolean).join(", "),
        dados.city && dados.state ? `${dados.city}/${dados.state}` : dados.city || dados.state,
        dados.cep ? `CEP ${dados.cep}` : null,
      ].filter(Boolean);
      $("crud-campo-endereco").value = partes.join(" - ");
    }

    status.className = "text-[11px] mt-1 text-teal-700";
    status.textContent = "✅ Endereço encontrado.";
  } catch (e) {
    status.className = "text-[11px] mt-1 text-rose-600";
    status.textContent = "Não foi possível encontrar esse CEP. Confira o número e preencha o endereço manualmente.";
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }

  // Georreferencia automaticamente assim que o endereço é encontrado — sem precisar de outro clique.
  await geocodificarCentro();
}

// ---------------------------------------------------------
// GEORREFERENCIAMENTO (latitude/longitude a partir do endereço, via OpenStreetMap Nominatim)
// ---------------------------------------------------------
async function geocodificarComParametros(params) {
  try {
    const query = new URLSearchParams({ format: "json", limit: "1", countrycodes: "br", ...params });
    const url = `https://nominatim.openstreetmap.org/search?${query.toString()}`;
    const resp = await fetch(url, { headers: { "Accept-Language": "pt-BR" } });
    if (!resp.ok) return null;
    const dados = await resp.json();
    if (!Array.isArray(dados) || !dados.length) return null;
    return { lat: Number(dados[0].lat), lon: Number(dados[0].lon) };
  } catch (e) {
    return null;
  }
}

async function geocodificarEndereco(enderecoTexto) {
  return geocodificarComParametros({ q: enderecoTexto });
}

// Extrai "cidade" e "UF" de um texto de endereço no formato "... - Cidade/UF - CEP xxxxx"
// (formato usado no campo de endereço em texto único dos centros de treinamento).
function extrairCidadeUfDeEndereco(enderecoTexto) {
  if (!enderecoTexto) return null;
  const m = enderecoTexto.match(/-\s*([^-\/]+?)\s*\/\s*([A-Za-z]{2})\s*(?:-\s*CEP|$)/i);
  if (!m) return null;
  return { cidade: m[1].trim(), uf: m[2].trim().toUpperCase() };
}

// Tenta georreferenciar um endereço em vários níveis de detalhe, do mais específico ao
// mais genérico, parando no primeiro resultado encontrado. O Nominatim não faz busca
// "aproximada": qualquer trecho não reconhecido no texto (um número de casa que não
// consta no mapa, um bairro raro, o sufixo "- CEP ...") faz a consulta inteira falhar,
// mesmo que o restante do endereço esteja correto — por isso tentamos várias formas
// antes de desistir.
async function geocodificarComFallback({ textosLivres = [], logradouro, numero, bairro, cidade, uf, cep } = {}) {
  const tentativas = [];

  for (const texto of textosLivres) {
    if (texto && texto.trim()) tentativas.push(() => geocodificarComParametros({ q: texto.trim() }));
  }

  if (logradouro && cidade && uf) {
    const street = [logradouro, numero].filter(Boolean).join(", ");
    tentativas.push(() => geocodificarComParametros({ street, city: cidade, state: uf }));
    if (numero) {
      tentativas.push(() => geocodificarComParametros({ street: logradouro, city: cidade, state: uf }));
    }
  }

  if (cep) {
    const cepDigits = cep.replace(/\D/g, "");
    if (cepDigits.length === 8) {
      tentativas.push(() => geocodificarComParametros({ postalcode: cepDigits, country: "Brazil" }));
    }
  }

  if (bairro && cidade && uf) {
    tentativas.push(() => geocodificarComParametros({ q: `${bairro}, ${cidade}, ${uf}` }));
  }

  if (cidade && uf) {
    tentativas.push(() => geocodificarComParametros({ city: cidade, state: uf, country: "Brazil" }));
  }

  for (const tentativa of tentativas) {
    const resultado = await tentativa();
    if (resultado) return resultado;
  }
  return null;
}

async function geocodificarCentro() {
  const status = $("btn-geocodificar-centro-status");
  const endereco = $("crud-campo-endereco").value.trim();
  if (!endereco) {
    status.className = "text-[11px] mt-1 text-rose-600";
    status.textContent = "Preencha o endereço antes de obter as coordenadas.";
    return;
  }

  const btn = $("btn-geocodificar-centro");
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Localizando…";
  status.className = "text-[11px] mt-1 text-slate-400";
  status.textContent = "Consultando geolocalização…";

  try {
    const cepCentro = $("crud-campo-cep") ? $("crud-campo-cep").value : "";
    const cidadeUf = extrairCidadeUfDeEndereco(endereco);
    const enderecoLimpo = endereco.replace(/\s*-\s*CEP\s*[\d-]+\s*$/i, "").replace(/\//g, ", ");
    const resultado = await geocodificarComFallback({
      textosLivres: [endereco, enderecoLimpo],
      cidade: cidadeUf ? cidadeUf.cidade : undefined,
      uf: cidadeUf ? cidadeUf.uf : undefined,
      cep: cepCentro,
    });
    if (!resultado) throw new Error("Endereço não encontrado");
    if ($("crud-campo-latitude")) $("crud-campo-latitude").value = resultado.lat;
    if ($("crud-campo-longitude")) $("crud-campo-longitude").value = resultado.lon;
    status.className = "text-[11px] mt-1 text-teal-700";
    status.textContent = `✅ Coordenadas encontradas: ${resultado.lat}, ${resultado.lon}`;
  } catch (e) {
    status.className = "text-[11px] mt-1 text-rose-600";
    status.textContent = "Não foi possível localizar esse endereço no mapa. Confira o endereço e tente novamente.";
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

if ($("inste-cep")) {
  $("inste-cep").addEventListener("input", () => {
    const el = $("inste-cep");
    const pos = el.selectionStart;
    const antes = el.value.length;
    el.value = MASCARAS.cep(el.value);
    const depois = el.value.length;
    el.setSelectionRange(pos + (depois - antes), pos + (depois - antes));
  });
}

$("btn-crud-novo").addEventListener("click", abrirNovoCrud);
$("btn-fechar-painel-crud").addEventListener("click", () => $("painel-crud").classList.add("hidden"));
$("btn-cancelar-painel-crud").addEventListener("click", () => $("painel-crud").classList.add("hidden"));
$("painel-crud-overlay").addEventListener("click", () => $("painel-crud").classList.add("hidden"));

async function salvarPermissoesForm(usuarioId) {
  // Todas as linhas precisam ter o MESMO conjunto de chaves — o upsert em
  // lote do PostgREST falha se um objeto do array tiver chaves a mais.
  const permx = (flag) => !!qs(`[data-permx="${flag}"]`)?.checked;
  const linhas = MODULOS.map((m) => ({
    usuario_id: usuarioId,
    modulo: m.id,
    pode_consultar: !!qs(`[data-perm-modulo="${m.id}"][data-perm-acao="consultar"]`)?.checked,
    pode_incluir: !!qs(`[data-perm-modulo="${m.id}"][data-perm-acao="incluir"]`)?.checked,
    pode_alterar: !!qs(`[data-perm-modulo="${m.id}"][data-perm-acao="alterar"]`)?.checked,
    pode_excluir: !!qs(`[data-perm-modulo="${m.id}"][data-perm-acao="excluir"]`)?.checked,
    pode_acessar_monitor: m.id === "atividades" && permx("pode_acessar_monitor"),
    pode_mudar_responsavel: m.id === "atividades" && permx("pode_mudar_responsavel"),
    pode_concluir_cancelar: m.id === "atividades" && permx("pode_concluir_cancelar"),
    pode_aprovar_requisicao: m.id === "requisicoes_compra" && permx("pode_aprovar_requisicao"),
  }));
  const { error } = await supabase.from("permissoes").upsert(linhas, { onConflict: "usuario_id,modulo" });
  if (error) {
    console.error("Falha ao gravar permissões:", error);
    mostrarErro("crud-form-erro", "Usuário salvo, mas as permissões não foram gravadas: " + (error.message || "erro desconhecido"));
    throw error;
  }
}


// ===========================================================
// Parcelas do prazo de pagamento (dentro do cadastro de Prazos de Pagamento)
// Cada parcela: nº, dias após o faturamento e % do total; a soma deve fechar 100%.
// ===========================================================
let prazosParcelasPorPrazo = {};
let prazoParcelasForm = [];
let prazoParcelasOriginais = [];
let prazoParcelasSeq = 0;

function fmtPercParcela(v) {
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function htmlSecaoParcelasPrazo() {
  return `
  <div id="prazo-parcelas-bloco" class="pt-4 mt-2 border-t border-slate-200">
    <div class="flex items-center justify-between mb-1">
      <p class="text-xs font-medium text-slate-500 uppercase tracking-wide">Parcelas</p>
      <button type="button" id="btn-prazo-parcela-add" class="text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md px-3 py-1.5">+ Adicionar parcela</button>
    </div>
    <p class="text-[11px] text-slate-400 mb-3">Informe, para cada parcela, os dias após o faturamento (0 = à vista) e o percentual do valor total. A soma dos percentuais deve ser 100%.</p>
    <div id="prazo-parcelas-lista" class="space-y-2"></div>
    <p id="prazo-parcelas-total" class="text-xs mt-2 text-right"></p>
  </div>`;
}

function novaLinhaParcelaPrazo(base = {}) {
  return {
    chave: `p${++prazoParcelasSeq}`,
    id: base.id || null,
    dias: base.dias != null ? String(base.dias) : "30",
    percentual: base.percentual != null ? String(Number(base.percentual)) : "",
  };
}

async function iniciarSecaoParcelasPrazo(item) {
  prazoParcelasForm = [];
  prazoParcelasOriginais = [];
  const lista = $("prazo-parcelas-lista");
  if (!lista) return;
  $("btn-prazo-parcela-add").addEventListener("click", () => {
    const ult = prazoParcelasForm[prazoParcelasForm.length - 1];
    const dias = ult ? (parseInt(ult.dias, 10) || 0) + 30 : 30;
    const soma = prazoParcelasForm.reduce((t, x) => t + (Number(x.percentual) || 0), 0);
    prazoParcelasForm.push(novaLinhaParcelaPrazo({ dias, percentual: soma > 0 && soma < 100 ? Math.round((100 - soma) * 100) / 100 : (prazoParcelasForm.length ? "" : 100) }));
    renderizarParcelasPrazo();
  });
  lista.addEventListener("input", (ev) => {
    const el = ev.target.closest("[data-parcela-campo]");
    const linhaEl = ev.target.closest("[data-parcela-linha]");
    if (!el || !linhaEl) return;
    const l = prazoParcelasForm.find((x) => x.chave === linhaEl.getAttribute("data-parcela-linha"));
    if (l) l[el.getAttribute("data-parcela-campo")] = el.value;
    atualizarTotalParcelasPrazo();
  });
  lista.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-parcela-remover]");
    if (!b) return;
    prazoParcelasForm = prazoParcelasForm.filter((x) => x.chave !== b.getAttribute("data-parcela-remover"));
    renderizarParcelasPrazo();
  });
  if (item && item.id) {
    lista.innerHTML = `<p class="text-xs text-slate-400">Carregando parcelas…</p>`;
    const { data, error } = await supabase.from("prazos_pagamento_parcelas").select("*").eq("prazo_pagamento_id", item.id).order("numero");
    if (error) {
      lista.innerHTML = `<p class="text-xs text-rose-600">Não foi possível carregar as parcelas deste prazo.</p>`;
      return;
    }
    prazoParcelasOriginais = data || [];
    prazoParcelasForm = prazoParcelasOriginais.map((r) => novaLinhaParcelaPrazo(r));
  } else {
    prazoParcelasForm = [novaLinhaParcelaPrazo({ dias: 0, percentual: 100 })];
  }
  renderizarParcelasPrazo();
}

function somaParcelasPrazo() {
  return prazoParcelasForm.reduce((t, x) => t + (Number(String(x.percentual).replace(",", ".")) || 0), 0);
}

function atualizarTotalParcelasPrazo() {
  const el = $("prazo-parcelas-total");
  if (!el) return;
  const soma = Math.round(somaParcelasPrazo() * 100) / 100;
  const ok = Math.abs(soma - 100) < 0.005;
  el.className = "text-xs mt-2 text-right font-medium " + (ok ? "text-teal-700" : "text-rose-600");
  el.textContent = `Total: ${fmtPercParcela(soma)}%` + (ok ? " ✓" : ` — faltam ${fmtPercParcela(Math.round((100 - soma) * 100) / 100)}% para fechar 100%`);
}

function renderizarParcelasPrazo() {
  const lista = $("prazo-parcelas-lista");
  if (!lista) return;
  if (prazoParcelasForm.length === 0) {
    lista.innerHTML = `<p class="text-xs text-slate-400 border border-dashed border-slate-300 rounded-md px-3 py-4 text-center">Nenhuma parcela. Adicione ao menos uma.</p>`;
    atualizarTotalParcelasPrazo();
    return;
  }
  const classeCampo = "mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500";
  const rotulo = "text-[10px] font-medium text-slate-500 uppercase tracking-wide";
  lista.innerHTML = prazoParcelasForm.map((l, i) => `
    <div data-parcela-linha="${l.chave}" class="grid grid-cols-12 gap-2 items-end border border-slate-200 rounded-md p-2.5 bg-slate-50">
      <div class="col-span-2 sm:col-span-2"><p class="${rotulo}">Parcela</p><p class="mt-1.5 text-sm font-medium text-slate-700">${i + 1}ª</p></div>
      <div class="col-span-4 sm:col-span-4">
        <label class="${rotulo}">Dias após faturamento</label>
        <input data-parcela-campo="dias" type="number" min="0" max="3650" step="1" value="${l.dias}" class="${classeCampo}" />
      </div>
      <div class="col-span-4 sm:col-span-4">
        <label class="${rotulo}">% do total</label>
        <input data-parcela-campo="percentual" type="number" min="0" max="100" step="any" value="${l.percentual}" class="${classeCampo}" />
      </div>
      <div class="col-span-2 sm:col-span-2 text-right">
        <button type="button" data-parcela-remover="${l.chave}" title="Remover parcela" class="text-rose-500 hover:text-rose-700 px-2 py-1.5">🗑️</button>
      </div>
    </div>`).join("");
  atualizarTotalParcelasPrazo();
}

function validarParcelasPrazo() {
  if (prazoParcelasForm.length === 0) return "Cadastre ao menos uma parcela para o prazo de pagamento.";
  for (let i = 0; i < prazoParcelasForm.length; i++) {
    const l = prazoParcelasForm[i];
    const n = `Parcela ${i + 1}`;
    const d = String(l.dias).trim();
    if (d === "" || !(Number.isInteger(Number(d)) && Number(d) >= 0 && Number(d) <= 3650)) return `${n}: informe os dias (número inteiro de 0 a 3650).`;
    const p = Number(String(l.percentual).replace(",", "."));
    if (String(l.percentual).trim() === "" || !(p > 0 && p <= 100)) return `${n}: informe o percentual (maior que 0 e até 100).`;
  }
  const soma = Math.round(somaParcelasPrazo() * 100) / 100;
  if (Math.abs(soma - 100) >= 0.005) return `A soma dos percentuais das parcelas é ${fmtPercParcela(soma)}%. Ajuste para totalizar exatamente 100%.`;
  return null;
}

// Regrava o conjunto de parcelas: insere as novas e só depois remove as antigas (não perde dados se a inserção falhar).
async function salvarParcelasPrazo(prazoId) {
  const falha = (e) => Object.assign(new Error(e?.message || "erro"), { mensagemUsuario: `Prazo salvo, mas as parcelas não foram gravadas: ${e?.message || "erro desconhecido"}. Tente novamente pela edição.` });
  try {
    const antigos = prazoParcelasOriginais.map((o) => o.id);
    // numero tem unicidade por prazo: remove as antigas antes, guardando-as para restaurar em caso de erro
    if (antigos.length) {
      const { error } = await supabase.from("prazos_pagamento_parcelas").delete().in("id", antigos);
      if (error) throw error;
    }
    const linhas = prazoParcelasForm.map((l, i) => ({
      prazo_pagamento_id: prazoId, numero: i + 1, dias: parseInt(l.dias, 10), percentual: Math.round(Number(String(l.percentual).replace(",", ".")) * 100) / 100,
    }));
    const { error: eIns } = await supabase.from("prazos_pagamento_parcelas").insert(linhas);
    if (eIns) {
      if (prazoParcelasOriginais.length) {
        await supabase.from("prazos_pagamento_parcelas").insert(prazoParcelasOriginais.map((o) => ({ prazo_pagamento_id: prazoId, numero: o.numero, dias: o.dias, percentual: o.percentual })));
      }
      throw eIns;
    }
  } catch (e) {
    console.error("Falha ao gravar parcelas do prazo:", e);
    throw falha(e);
  }
}


// ===========================================================
// Itens de custo do treinamento (dentro do cadastro de Treinamentos)
// Cada linha: item de custo + divisor (opcional) + unidade do divisor + múltiplo + imprime + ordem de impressão.
// ===========================================================
function htmlSecaoItensCustoTreinamento() {
  return `
  <div id="treino-itens-custo-bloco" class="pt-4 mt-2 border-t border-slate-200">
    <div class="flex items-center justify-between mb-1">
      <p class="text-xs font-medium text-slate-500 uppercase tracking-wide">Itens de custo do treinamento</p>
      <button type="button" id="btn-treino-item-add" class="text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md px-3 py-1.5">+ Adicionar item</button>
    </div>
    <p class="text-[11px] text-slate-400 mb-3">Para cada item informe o divisor (ex.: 20) com a sua unidade (ex.: aluno) — o divisor pode ficar em branco, e então a unidade também — e o múltiplo. Marque "Imprime" para o item sair na impressão e defina a ordem.</p>
    <div id="treino-itens-custo-lista" class="space-y-2"></div>
  </div>`;
}

function novaLinhaItemCustoTreino(base = {}) {
  return {
    chave: `n${++treinoItensSeq}`,
    id: base.id || null,
    item_custo_id: base.item_custo_id || "",
    divisor: base.divisor != null ? String(Number(base.divisor)) : "",
    unidade_divisor_id: base.unidade_divisor_id || "",
    multiplo: base.multiplo != null ? String(Number(base.multiplo)) : "1",
    imprime: !!base.imprime,
    ordem_impressao: base.ordem_impressao != null ? String(base.ordem_impressao) : "",
  };
}

async function iniciarSecaoItensCustoTreinamento(item) {
  treinoItensCustoForm = [];
  treinoItensCustoOriginais = [];
  const lista = $("treino-itens-custo-lista");
  if (!lista) return;
  $("btn-treino-item-add").addEventListener("click", () => {
    const maior = treinoItensCustoForm.reduce((m, x) => Math.max(m, parseInt(x.ordem_impressao, 10) || 0), 0);
    treinoItensCustoForm.push(novaLinhaItemCustoTreino({ ordem_impressao: maior + 1 }));
    renderizarItensCustoTreinamento();
  });
  // um único conjunto de ouvintes (delegação) para alterações e remoções
  lista.addEventListener("input", (ev) => {
    const el = ev.target.closest("[data-treino-campo]");
    const linhaEl = ev.target.closest("[data-treino-linha]");
    if (!el || !linhaEl) return;
    const l = treinoItensCustoForm.find((x) => x.chave === linhaEl.getAttribute("data-treino-linha"));
    if (l) l[el.getAttribute("data-treino-campo")] = el.type === "checkbox" ? el.checked : el.value;
  });
  lista.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-treino-remover]");
    if (!b) return;
    treinoItensCustoForm = treinoItensCustoForm.filter((x) => x.chave !== b.getAttribute("data-treino-remover"));
    renderizarItensCustoTreinamento();
  });
  if (item && item.id) {
    lista.innerHTML = `<p class="text-xs text-slate-400">Carregando itens de custo…</p>`;
    const { data, error } = await supabase.from("treinamento_itens_custo").select("*").eq("tipo_treinamento_id", item.id).order("ordem_impressao", { nullsFirst: false }).order("created_at").order("id");
    if (error) {
      lista.innerHTML = `<p class="text-xs text-rose-600">Não foi possível carregar os itens de custo deste treinamento.</p>`;
      return;
    }
    treinoItensCustoOriginais = data || [];
    treinoItensCustoForm = treinoItensCustoOriginais.map((r) => novaLinhaItemCustoTreino(r));
  }
  renderizarItensCustoTreinamento();
}

function renderizarItensCustoTreinamento() {
  const lista = $("treino-itens-custo-lista");
  if (!lista) return;
  if (treinoItensCustoForm.length === 0) {
    lista.innerHTML = `<p class="text-xs text-slate-400 border border-dashed border-slate-300 rounded-md px-3 py-4 text-center">Nenhum item de custo cadastrado para este treinamento.</p>`;
    return;
  }
  const classeCampo = "mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500";
  const rotulo = "text-[10px] font-medium text-slate-500 uppercase tracking-wide";
  const opcoesItens = (sel) => `<option value="">— Selecione —</option>` + treinoRefItensCusto
    .filter((i) => i.status === "Ativo" || i.id === sel)
    .map((i) => {
      const u = treinoRefUnidades.find((x) => x.id === i.unidade_medida_id);
      return `<option value="${i.id}" ${i.id === sel ? "selected" : ""}>${i.item}${u ? ` (${u.sigla})` : ""}${i.opcional ? " · opcional" : ""}${i.status === "Inativo" ? " · inativo" : ""}</option>`;
    }).join("");
  const opcoesUnidades = (sel) => `<option value="">— Selecione —</option>` + treinoRefUnidades
    .filter((u) => u.status === "Ativo" || u.id === sel)
    .map((u) => `<option value="${u.id}" ${u.id === sel ? "selected" : ""}>${u.sigla} — ${u.descricao}${u.status === "Inativo" ? " (inativa)" : ""}</option>`).join("");
  lista.innerHTML = treinoItensCustoForm.map((l) => `
    <div data-treino-linha="${l.chave}" class="grid grid-cols-12 gap-2 items-end border border-slate-200 rounded-md p-2.5 bg-slate-50">
      <div class="col-span-12 sm:col-span-5">
        <label class="${rotulo}">Item de custo</label>
        <select data-treino-campo="item_custo_id" class="${classeCampo}">${opcoesItens(l.item_custo_id)}</select>
      </div>
      <div class="col-span-4 sm:col-span-2">
        <label class="${rotulo}">Divisor <span class="normal-case text-slate-400">(opcional)</span></label>
        <input data-treino-campo="divisor" type="number" min="0" step="any" value="${l.divisor}" class="${classeCampo}" />
      </div>
      <div class="col-span-8 sm:col-span-3">
        <label class="${rotulo}">Unidade do divisor</label>
        <select data-treino-campo="unidade_divisor_id" class="${classeCampo}">${opcoesUnidades(l.unidade_divisor_id)}</select>
      </div>
      <div class="col-span-8 sm:col-span-2">
        <label class="${rotulo}">Múltiplo</label>
        <input data-treino-campo="multiplo" type="number" min="0" step="any" value="${l.multiplo}" class="${classeCampo}" />
      </div>
      <div class="col-span-6 sm:col-span-3 flex items-center pb-1.5">
        <label class="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input data-treino-campo="imprime" type="checkbox" ${l.imprime ? "checked" : ""} class="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500" />
          Imprime
        </label>
      </div>
      <div class="col-span-6 sm:col-span-3">
        <label class="${rotulo}">Ordem de impressão</label>
        <input data-treino-campo="ordem_impressao" type="number" min="0" step="1" value="${l.ordem_impressao}" class="${classeCampo}" />
      </div>
      <div class="col-span-12 sm:col-span-6 text-right">
        <button type="button" data-treino-remover="${l.chave}" title="Remover item" class="text-rose-500 hover:text-rose-700 px-2 py-1.5">🗑️ Remover</button>
      </div>
    </div>`).join("");
}

function validarItensCustoTreinamento() {
  const vistos = new Set();
  for (let i = 0; i < treinoItensCustoForm.length; i++) {
    const l = treinoItensCustoForm[i];
    const n = `Item de custo ${i + 1}`;
    if (!l.item_custo_id) return `${n}: selecione o item de custo (ou remova a linha).`;
    if (vistos.has(l.item_custo_id)) {
      const nome = (treinoRefItensCusto.find((x) => x.id === l.item_custo_id) || {}).item || "";
      return `${n}: o item "${nome}" já foi adicionado a este treinamento.`;
    }
    vistos.add(l.item_custo_id);
    const temDivisor = String(l.divisor).trim() !== "";
    if (temDivisor && !(Number(l.divisor) > 0)) return `${n}: o divisor deve ser maior que zero (ou deixe em branco).`;
    if (temDivisor && !l.unidade_divisor_id) return `${n}: selecione a unidade do divisor (ou deixe o divisor em branco).`;
    if (!(Number(l.multiplo) > 0)) return `${n}: informe o múltiplo (maior que zero).`;
    const temOrdem = String(l.ordem_impressao).trim() !== "";
    if (temOrdem && !(Number.isInteger(Number(l.ordem_impressao)) && Number(l.ordem_impressao) >= 0)) return `${n}: a ordem de impressão deve ser um número inteiro (0 ou mais).`;
    if (l.imprime && !temOrdem) return `${n}: informe a ordem de impressão (o item está marcado para imprimir).`;
  }
  return null;
}

// Grava só o que mudou: remove as linhas retiradas, atualiza as alteradas e inclui as novas.
async function salvarItensCustoTreinamento(tipoTreinamentoId) {
  const falha = (e) => Object.assign(new Error(e?.message || "erro"), { mensagemUsuario: `Treinamento salvo, mas os itens de custo não foram gravados: ${e?.message || "erro desconhecido"}. Tente novamente pela edição.` });
  const linhas = treinoItensCustoForm.map((l) => ({
    tipo_treinamento_id: tipoTreinamentoId,
    item_custo_id: l.item_custo_id,
    divisor: String(l.divisor).trim() === "" ? null : Number(l.divisor),
    unidade_divisor_id: String(l.divisor).trim() === "" ? null : (l.unidade_divisor_id || null),
    multiplo: Number(l.multiplo),
    imprime: !!l.imprime,
    ordem_impressao: String(l.ordem_impressao).trim() === "" ? null : Number(l.ordem_impressao),
  }));
  const substituirTudo = async () => {
    const { error: eDel } = await supabase.from("treinamento_itens_custo").delete().eq("tipo_treinamento_id", tipoTreinamentoId);
    if (eDel) throw eDel;
    if (linhas.length) {
      const { error: eIns } = await supabase.from("treinamento_itens_custo").insert(linhas);
      if (eIns) throw eIns;
    }
  };
  try {
    const mantidos = new Set(treinoItensCustoForm.filter((l) => l.id).map((l) => l.id));
    const removidos = treinoItensCustoOriginais.filter((o) => !mantidos.has(o.id)).map((o) => o.id);
    if (removidos.length) {
      const { error } = await supabase.from("treinamento_itens_custo").delete().in("id", removidos);
      if (error) throw error;
    }
    for (const l of treinoItensCustoForm.filter((x) => x.id)) {
      const ori = treinoItensCustoOriginais.find((o) => o.id === l.id);
      const novo = linhas[treinoItensCustoForm.indexOf(l)];
      const igual = ori && ori.item_custo_id === novo.item_custo_id && (ori.unidade_divisor_id || null) === novo.unidade_divisor_id
        && (ori.divisor == null ? null : Number(ori.divisor)) === novo.divisor && Number(ori.multiplo) === novo.multiplo
        && !!ori.imprime === novo.imprime && (ori.ordem_impressao == null ? null : Number(ori.ordem_impressao)) === novo.ordem_impressao;
      if (igual) continue;
      const { error } = await supabase.from("treinamento_itens_custo").update({
        item_custo_id: novo.item_custo_id, divisor: novo.divisor, unidade_divisor_id: novo.unidade_divisor_id, multiplo: novo.multiplo,
        imprime: novo.imprime, ordem_impressao: novo.ordem_impressao,
      }).eq("id", l.id);
      if (error) {
        if (error.code === "23505") { await substituirTudo(); return; } // troca de itens entre linhas: regrava tudo
        throw error;
      }
    }
    const novas = treinoItensCustoForm.map((l, idx) => ({ l, row: linhas[idx] })).filter((x) => !x.l.id).map((x) => x.row);
    if (novas.length) {
      const { error } = await supabase.from("treinamento_itens_custo").insert(novas);
      if (error) throw error;
    }
  } catch (e) {
    throw falha(e);
  }
}

async function salvarCrud() {
  esconderErro("crud-form-erro");
  const cfg = CRUD_CONFIG[crudModuloId];
  const payload = {};
  for (const campo of cfg.campos) {
    if (campo.display) continue;
    const el = $("crud-campo-" + campo.id);
    let valor = campo.tipo === "checkbox"
      ? el.checked
      : (typeof el.value === "string" ? el.value.trim() : el.value);
    if (campo.obrigatorio && campo.tipo !== "checkbox" && !valor) return mostrarErro("crud-form-erro", `Informe: ${campo.label}.`);
    if (campo.validar) {
      const erroValidacao = await campo.validar(valor);
      if (erroValidacao) return mostrarErro("crud-form-erro", erroValidacao);
    }
    if (campo.tipo === "number") valor = valor === "" ? null : Number(valor);
    else if (campo.tipo === "date") valor = valor === "" ? null : valor;
    else if (campo.tipo === "select" && valor === "") valor = null;
    else if (campo.tipo === "imagem" && valor === "") valor = null;
    payload[campo.id] = valor;
  }

  if (cfg.validarForm) {
    const msgForm = cfg.validarForm();
    if (msgForm) return mostrarErro("crud-form-erro", msgForm);
  }

  if (cfg.ajustarPayload) await cfg.ajustarPayload(payload);

  $("btn-salvar-crud").disabled = true;
  $("btn-salvar-crud").textContent = "Salvando…";

  let linha, erro;
  if (crudEditandoId) {
    ({ data: linha, error: erro } = await supabase.from(cfg.tabela).update(payload).eq("id", crudEditandoId).select().single());
  } else {
    ({ data: linha, error: erro } = await supabase.from(cfg.tabela).insert(payload).select().single());
  }

  if (erro) {
    $("btn-salvar-crud").disabled = false;
    $("btn-salvar-crud").textContent = crudEditandoId ? "Salvar alterações" : "Cadastrar";
    if (erro.message && erro.message.includes("duplicate")) {
      return mostrarErro("crud-form-erro", cfg.mensagemDuplicado || "Já existe um registro com esse valor único (ex: e-mail).");
    }
    return mostrarErro("crud-form-erro", "Não foi possível salvar. Tente novamente.");
  }

  if (crudModuloId === "usuarios_sistema" && payload.role !== "admin") {
    try {
      await salvarPermissoesForm(linha.id);
    } catch (e) {
      $("btn-salvar-crud").disabled = false;
      $("btn-salvar-crud").textContent = crudEditandoId ? "Salvar alterações" : "Cadastrar";
      return; // erro já exibido em salvarPermissoesForm
    }
  }

  if (cfg.aoSalvar) {
    try {
      await cfg.aoSalvar(linha, { novo: !crudEditandoId });
    } catch (e) {
      $("btn-salvar-crud").disabled = false;
      $("btn-salvar-crud").textContent = crudEditandoId ? "Salvar alterações" : "Cadastrar";
      return mostrarErro("crud-form-erro", (e && e.mensagemUsuario) || "Registro salvo, mas houve falha ao enviar o arquivo. Tente novamente pela edição.");
    }
  }

  $("btn-salvar-crud").disabled = false;
  $("btn-salvar-crud").textContent = crudEditandoId ? "Salvar alterações" : "Cadastrar";
  $("painel-crud").classList.add("hidden");
  await carregarModuloCrud(crudModuloId, { manter: true });
}

$("btn-salvar-crud").addEventListener("click", salvarCrud);

async function excluirCrud(id) {
  const cfg = CRUD_CONFIG[crudModuloId];
  const item = crudLista.find((i) => i.id === id);
  const rotulo = item ? `${cfg.titulo.toLowerCase()} "${cfg.cardTitulo(item)}"` : `este registro (${cfg.titulo.toLowerCase()})`;
  if (!confirmarExclusao(rotulo)) return;
  const { error } = await supabase.from(cfg.tabela).delete().eq("id", id);
  if (error) {
    const vinculo = error.code === "23503" || /foreign key|violates foreign key/i.test(error.message || "");
    alert(
      vinculo
        ? `Não é possível excluir ${rotulo}: há registros vinculados (por exemplo, orçamentos ou agendamentos).\n\nPara tirá-lo de uso sem apagar o histórico, altere o Status para "Inativo".`
        : `Não foi possível excluir ${rotulo}. Tente novamente.`
    );
    return;
  }
  await carregarModuloCrud(crudModuloId, { manter: true });
}

// ===========================================================
// Itens e aprovação da Requisição de Compra
// ===========================================================
async function carregarReqItens(requisicaoId) {
  const { data } = await supabase.from("requisicao_compra_itens").select("*").eq("requisicao_id", requisicaoId).order("created_at");
  reqItensAtual = data || [];
  renderReqItens();
}

function renderReqItens() {
  const cont = $("req-itens-lista");
  if (!cont) return;
  const nomeMat = (id) => (reqRefMateriais.find((m) => m.id === id) || {}).descricao || "—";
  const unMat = (id) => (reqRefMateriais.find((m) => m.id === id) || {}).unidade_medida || "";
  if (reqItensAtual.length === 0) {
    cont.innerHTML = `<p class="text-slate-400">Nenhum material adicionado.</p>`;
  } else {
    cont.innerHTML = reqItensAtual.map((it) => `
      <div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-1">
        <div>
          <p class="text-slate-700">${nomeMat(it.material_id)}${it.quantidade != null ? ` · ${it.quantidade}${unMat(it.material_id) ? " " + unMat(it.material_id) : ""}` : ""}</p>
          <p class="text-slate-400">Est.: ${fmtBRL(it.valor_estimado)} · Real.: ${fmtBRL(it.valor_realizado)}</p>
        </div>
        <button data-req-item-del="${it.id}" class="text-rose-500 hover:text-rose-700 shrink-0">🗑️</button>
      </div>`).join("");
    cont.querySelectorAll("[data-req-item-del]").forEach((b) =>
      b.addEventListener("click", () => excluirReqItem(b.getAttribute("data-req-item-del")))
    );
  }
  const est = reqItensAtual.reduce((s, i) => s + Number(i.valor_estimado || 0), 0);
  const real = reqItensAtual.reduce((s, i) => s + Number(i.valor_realizado || 0), 0);
  if ($("req-itens-totais")) $("req-itens-totais").textContent = `Total estimado: ${fmtBRL(est)} · Total realizado: ${fmtBRL(real)}`;
}

async function adicionarReqItem(requisicaoId) {
  const materialId = $("req-item-material").value;
  if (!materialId) return mostrarErro("crud-form-erro", "Selecione o material do item.");
  esconderErro("crud-form-erro");
  const qtd = $("req-item-qtd").value === "" ? null : Number($("req-item-qtd").value);
  const vEst = $("req-item-vest").value === "" ? 0 : Number($("req-item-vest").value);
  const vReal = $("req-item-vreal").value === "" ? 0 : Number($("req-item-vreal").value);
  const { error } = await supabase.from("requisicao_compra_itens").insert({
    requisicao_id: requisicaoId, material_id: materialId, quantidade: qtd, valor_estimado: vEst, valor_realizado: vReal,
  });
  if (error) return mostrarErro("crud-form-erro", "Não foi possível adicionar o material.");
  $("req-item-material").value = ""; $("req-item-qtd").value = ""; $("req-item-vest").value = ""; $("req-item-vreal").value = "";
  await carregarReqItens(requisicaoId);
}

async function excluirReqItem(id) {
  const it = reqItensAtual.find((x) => x.id === id);
  if (!confirmarExclusao(`o item "${(reqRefMateriais.find((m) => m.id === (it || {}).material_id) || {}).descricao || ""}"`.trim())) return;
  const { error } = await supabase.from("requisicao_compra_itens").delete().eq("id", id);
  if (!error && it) await carregarReqItens(it.requisicao_id);
}

async function aprovarRequisicao(id) {
  if (!confirm("Aprovar esta requisição de compra?")) return;
  const { error } = await supabase.from("requisicoes_compra").update({ status: "Aprovada" }).eq("id", id);
  if (error) return mostrarErro("crud-form-erro", error.message || "Não foi possível aprovar.");
  $("painel-crud").classList.add("hidden");
  await carregarModuloCrud("requisicoes_compra");
}

async function criarRequisicaoDaAtividade(atividadeId) {
  const at = (crudLista || []).find((a) => a.id === atividadeId);
  const { data: jaExiste } = await supabase.from("requisicoes_compra").select("id").eq("atividade_id", atividadeId).limit(1);
  irParaModulo("requisicoes_compra");
  await carregarModuloCrud("requisicoes_compra");
  requisicaoAtividadePreset = at
    ? { id: at.id, os: at.os, corporativo: at.corporativo, centro_treinamento_id: at.centro_treinamento_id }
    : { id: atividadeId };
  if (jaExiste && jaExiste.length) abrirEdicaoCrud(jaExiste[0].id);
  else abrirNovoCrud();
}

// ===========================================================
// Anexos e fotografia da Atividade (bucket "atividades")
// ===========================================================
async function urlArquivoAtividade(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("atividades").createSignedUrl(path, 60 * 60);
  return error ? null : data.signedUrl;
}

async function abrirPainelAtividadeAnexos(atividadeId) {
  atividadeAnexosAbertaId = atividadeId;
  const a = (crudLista || []).find((x) => x.id === atividadeId);
  $("painel-atividade-anexos-titulo").textContent = `Anexos — OS ${a?.os || ""}`;
  $("painel-atividade-anexos-descricao").textContent = a?.descricao || "";
  esconderErro("anexo-atividade-form-erro");
  $("anexo-atividade-descricao").value = "";
  $("anexo-atividade-input").value = "";
  const podeIncluir = podeFazer("atividades", "incluir");
  $("bloco-novo-anexo-atividade").classList.toggle("hidden", !podeIncluir);
  $("painel-atividade-anexos").classList.remove("hidden");
  await carregarAnexosAtividade();
}

async function carregarAnexosAtividade() {
  const { data } = await supabase
    .from("atividade_anexos").select("*").eq("atividade_id", atividadeAnexosAbertaId)
    .order("created_at", { ascending: false });
  anexosDaAtividadeAtual = data || [];
  renderizarListaAnexosAtividade();
}

function renderizarListaAnexosAtividade() {
  const podeExcluir = podeFazer("atividades", "excluir");
  const dtHora = (s) => (s ? new Date(s).toLocaleString("pt-BR") : "—");
  const nomeU = (id) => (atividadeRefUsuarios.find((u) => u.id === id) || {}).nome || "—";
  const corpo = $("anexo-atividade-lista");
  if (anexosDaAtividadeAtual.length === 0) {
    corpo.innerHTML = `<tr><td colspan="4" class="text-center text-slate-400 text-xs py-6">Nenhum anexo cadastrado.</td></tr>`;
    return;
  }
  corpo.innerHTML = anexosDaAtividadeAtual.map((x) => `
    <tr class="border-t border-slate-100">
      <td class="py-1.5 pr-2">${x.descricao || "—"}</td>
      <td class="py-1.5 pr-2 whitespace-nowrap">${dtHora(x.created_at)}</td>
      <td class="py-1.5 pr-2 whitespace-nowrap">${nomeU(x.criado_por)}</td>
      <td class="py-1.5 text-right whitespace-nowrap">
        <button data-anexo-abrir="${x.id}" class="text-slate-500 hover:text-slate-800 text-xs mr-2">abrir</button>
        ${podeExcluir ? `<button data-anexo-excluir="${x.id}" class="text-rose-500 hover:text-rose-700 text-xs">🗑️</button>` : ""}
      </td>
    </tr>
  `).join("");
  corpo.querySelectorAll("[data-anexo-abrir]").forEach((btn) => btn.addEventListener("click", async () => {
    const x = anexosDaAtividadeAtual.find((a) => a.id === btn.getAttribute("data-anexo-abrir"));
    const u = await urlArquivoAtividade(x?.arquivo_path);
    if (u) window.open(u, "_blank");
  }));
  corpo.querySelectorAll("[data-anexo-excluir]").forEach((btn) =>
    btn.addEventListener("click", () => excluirAnexoAtividade(btn.getAttribute("data-anexo-excluir")))
  );
}

async function salvarAnexoAtividade() {
  esconderErro("anexo-atividade-form-erro");
  const descricao = $("anexo-atividade-descricao").value.trim();
  const file = $("anexo-atividade-input").files[0];
  if (!descricao) return mostrarErro("anexo-atividade-form-erro", "Informe o descritivo do anexo.");
  if (!file) return mostrarErro("anexo-atividade-form-erro", "Selecione o arquivo do anexo.");

  const btn = $("btn-salvar-anexo-atividade");
  btn.disabled = true;
  btn.textContent = "Enviando…";

  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const caminho = `${atividadeAnexosAbertaId}/anexo_${Date.now()}.${ext}`;
  let falhou = false;
  const { error: erroUp } = await supabase.storage.from("atividades").upload(caminho, file, { upsert: true });
  if (erroUp) {
    falhou = true;
  } else {
    const { error: erroIns } = await supabase.from("atividade_anexos").insert({
      atividade_id: atividadeAnexosAbertaId, descricao, arquivo_path: caminho,
    });
    if (erroIns) falhou = true;
  }
  btn.disabled = false;
  btn.textContent = "+ Adicionar anexo";
  if (falhou) return mostrarErro("anexo-atividade-form-erro", "Não foi possível salvar o anexo. Tente novamente.");

  $("anexo-atividade-descricao").value = "";
  $("anexo-atividade-input").value = "";
  await carregarAnexosAtividade();
}

async function excluirAnexoAtividade(id) {
  const x = anexosDaAtividadeAtual.find((a) => a.id === id);
  if (!confirmarExclusao(`o anexo "${x?.descricao || ""}"`.trim())) return;
  if (x?.arquivo_path) await supabase.storage.from("atividades").remove([x.arquivo_path]);
  const { error } = await supabase.from("atividade_anexos").delete().eq("id", id);
  if (!error) await carregarAnexosAtividade();
}

$("btn-salvar-anexo-atividade").addEventListener("click", salvarAnexoAtividade);
$("btn-fechar-painel-atividade-anexos").addEventListener("click", () => $("painel-atividade-anexos").classList.add("hidden"));
$("painel-atividade-anexos-overlay").addEventListener("click", () => $("painel-atividade-anexos").classList.add("hidden"));

// ===========================================================
// Auxiliares compartilhados por Agendamentos / Orçamentos / Turmas
// ===========================================================
function preencherSelect(id, itens, valueKey, labelFn, opcaoVazia) {
  const el = $(id);
  el.innerHTML = (opcaoVazia ? `<option value="">${opcaoVazia}</option>` : "") +
    itens.map((i) => `<option value="${i[valueKey]}">${labelFn(i)}</option>`).join("");
}

// Seletor de empresa com filtro por texto (nome, fantasia ou CNPJ): com
// milhares de empresas, a caixa acima do select reduz as opções.
let orcEmpresasIncompleta = false;
let orcEmpresaDoOrcamento = null; // empresa gravada no orçamento aberto: fica alocada durante toda a edição

// Garante que a empresa gravada no orçamento esteja na lista do seletor, mesmo que a lista de
// clientes ativos tenha vindo incompleta (falha de rede) ou que o cliente tenha sido inativado.
async function garantirEmpresaDoOrcamento(o) {
  if (!o || !o.empresa_id) return;
  if (listaEmpresasAtivas.some((e) => e.id === o.empresa_id)) return;
  let emp = null;
  for (let t = 1; t <= 3 && !emp; t++) {
    const { data } = await supabase.from("empresas").select("*").eq("id", o.empresa_id).maybeSingle();
    if (data) emp = data; else if (t < 3) await new Promise((r) => setTimeout(r, 400 * t));
  }
  // Último recurso: o nome que já veio na listagem de orçamentos.
  if (!emp) emp = { id: o.empresa_id, nome: (o.empresas && o.empresas.nome) || "(cliente do orçamento)", nome_fantasia: null, cnpj: null };
  listaEmpresasAtivas = [emp, ...listaEmpresasAtivas];
}

function rotuloEmpresa(e) {
  return e.nome_fantasia ? `${e.nome} — ${e.nome_fantasia}` : e.nome;
}
function preencherSelectEmpresa(selectId, lista, opcaoVazia) {
  const sel = $(selectId);
  sel._empresasLista = lista;
  sel._empresasVazia = opcaoVazia;
  let busca = $(`${selectId}-busca`);
  if (!busca) {
    busca = document.createElement("input");
    busca.id = `${selectId}-busca`;
    busca.type = "search";
    busca.placeholder = "🔎 Digite nome, fantasia ou CNPJ para filtrar…";
    busca.className = "mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500";
    sel.parentNode.insertBefore(busca, sel);
    const info = document.createElement("p");
    info.id = `${selectId}-busca-info`;
    info.className = "mt-0.5 text-[11px] text-slate-400";
    sel.parentNode.insertBefore(info, sel);
    busca.addEventListener("input", () => { filtrarSelectEmpresa(selectId); buscarEmpresasNoServidor(selectId); });
  }
  busca.value = "";
  if ($(`${selectId}-busca-info`)) $(`${selectId}-busca-info`).textContent = "";
  preencherSelect(selectId, lista, "id", rotuloEmpresa, opcaoVazia);
}
function filtrarSelectEmpresa(selectId) {
  const sel = $(selectId);
  const termo = $(`${selectId}-busca`).value.trim().toLowerCase();
  const termoDigitos = termo.replace(/\D/g, "");
  const atual = sel.value;
  const todas = sel._empresasLista || [];
  const casa = (e) =>
    (e.nome || "").toLowerCase().includes(termo) ||
    (e.nome_fantasia || "").toLowerCase().includes(termo) ||
    (termoDigitos.length >= 3 && (e.cnpj || "").replace(/\D/g, "").includes(termoDigitos));
  let lista = todas;
  let achadas = 0;
  if (termo) {
    lista = todas.filter(casa);
    achadas = lista.length;
    lista = lista.slice(0, 200);
    if (atual && !lista.some((e) => e.id === atual)) {
      const sel0 = todas.find((e) => e.id === atual);
      if (sel0) lista = [sel0, ...lista];
    }
  }
  preencherSelect(selectId, lista, "id", rotuloEmpresa, sel._empresasVazia);
  sel.value = atual && lista.some((e) => e.id === atual) ? atual : "";
  const info = $(`${selectId}-busca-info`);
  if (info) info.textContent = termo ? (achadas ? `${achadas} empresa(s) encontrada(s)${achadas > 200 ? " — mostrando as 200 primeiras, refine a busca" : ""}` : "Nenhuma empresa encontrada na lista carregada…") : "";
}

// A lista carregada no navegador pode estar desatualizada ou incompleta (empresa cadastrada depois, falha de rede
// em alguma página). Por isso, ao digitar 3+ caracteres, a busca também consulta o cadastro no servidor
// (nome, fantasia ou CNPJ) e acrescenta ao seletor o que ainda não estava na lista.
const empresaBuscaTimers = {};
function buscarEmpresasNoServidor(selectId) {
  clearTimeout(empresaBuscaTimers[selectId]);
  const busca = $(`${selectId}-busca`);
  if (!busca || busca.value.trim().length < 3) return;
  empresaBuscaTimers[selectId] = setTimeout(async () => {
    const termo = busca.value.trim();
    const t = termo.replace(/[,()*%\\]/g, " ").replace(/\s+/g, " ").trim();
    if (t.length < 3) return;
    const filtros = [`nome.ilike.%${t}%`, `nome_fantasia.ilike.%${t}%`];
    const dig = termo.replace(/\D/g, "");
    if (dig.length >= 3 && /^[\d.\/\-\s]+$/.test(termo)) filtros.push(`cnpj_digitos.like.%${dig}%`);
    const { data, error } = await supabase.from("empresas").select("*").eq("status", "Ativo").or(filtros.join(",")).order("nome").limit(50);
    if (error || !data || busca.value.trim() !== termo) return; // falhou ou o texto já mudou
    const sel = $(selectId);
    const todas = sel._empresasLista || [];
    const ja = new Set(todas.map((e) => e.id));
    const novas = data.filter((e) => !ja.has(e.id));
    if (novas.length) {
      sel._empresasLista = [...novas, ...todas];
      const jaGlobal = new Set(listaEmpresasAtivas.map((e) => e.id));
      const novasGlobal = novas.filter((e) => !jaGlobal.has(e.id));
      if (novasGlobal.length) listaEmpresasAtivas = [...novasGlobal, ...listaEmpresasAtivas]; // preenchimento de contato/endereço usa esta lista
    }
    filtrarSelectEmpresa(selectId);
    const info = $(`${selectId}-busca-info`);
    if (info && !data.length && !novas.length && /^Nenhuma/.test(info.textContent)) info.textContent = "Nenhuma empresa encontrada.";
  }, 400);
}
// Define a empresa escolhida mesmo que o filtro esteja escondendo-a.
function definirEmpresaSelect(selectId, id) {
  const sel = $(selectId);
  $(`${selectId}-busca`) && ($(`${selectId}-busca`).value = "");
  preencherSelect(selectId, sel._empresasLista || [], "id", rotuloEmpresa, sel._empresasVazia);
  sel.value = id || "";
}

// ===========================================================
// OPERAÇÃO: AGENDAR TREINAMENTO
// ===========================================================
async function carregarAgendamentos() {
  $("admin-descricao-pagina").textContent = "Agende treinamentos vinculando instrutor, tipo, centro e datas.";
  const [{ data: ags }, { data: insts }, { data: tipos }, { data: centros }, { data: empresas }] = await Promise.all([
    supabase.from("agendamentos").select("*, instrutores(nome, email), tipos_treinamento(nome), centros_treinamento(nome), empresas(nome)").order("created_at", { ascending: false }),
    supabase.from("instrutores").select("*").eq("status", "Ativo").order("nome"),
    supabase.from("tipos_treinamento").select("*").eq("status", "Ativo").order("nome"),
    supabase.from("centros_treinamento").select("*").eq("status", "Ativo").order("nome"),
    buscarTodos(() => supabase.from("empresas").select("*").eq("status", "Ativo").order("nome").order("id")),
  ]);
  listaAgendamentos = ags || [];
  listaInstrutoresAtivos = insts || [];
  listaTiposAtivos = tipos || [];
  listaCentrosAtivos = centros || [];
  listaEmpresasAtivas = empresas || [];
  $("btn-ag-novo").classList.toggle("hidden", !podeFazer("agendamentos", "incluir"));
  computarListaNegativas();
  computarListaDesmarcacoes();
  renderizarAbasAgendamentos();
  renderizarListaAgendamentos();
  renderizarListaNegativas();
  renderizarListaDesmarcacoes();
}

// Achata datas_status (só as negadas) de todos os agendamentos numa lista única,
// cruzando com negativas_resolvidas para saber o que já foi tratado pelo operador.
function computarListaNegativas() {
  const negativas = [];
  listaAgendamentos.forEach((a) => {
    const datasStatus = a.datas_status || {};
    const resolvidas = a.negativas_resolvidas || {};
    Object.entries(datasStatus).forEach(([data, info]) => {
      if (!info || info.status !== "negado") return;
      const resolucao = resolvidas[data] || null;
      const solicitacao = info.solicitacao_cancelamento || null;
      negativas.push({
        agendamentoId: a.id,
        instrutorNome: a.instrutores?.nome || "Instrutor removido",
        instrutorEmail: a.instrutores?.email || "",
        data,
        justificativa: info.justificativa || "",
        // veio de um pedido de desmarcação aprovado (a aula já estava confirmada),
        // e não de uma recusa comum antes da confirmação
        veioDeDesmarcacao: !!(solicitacao && solicitacao.aprovado),
        desmarcadoEm: solicitacao?.resolvido_em || null,
        tipoNome: a.tipos_treinamento?.nome || "—",
        centroNome: a.centros_treinamento?.nome || "",
        empresaNome: a.empresas?.nome || "",
        tipoId: a.tipo_treinamento_id,
        centroId: a.centro_treinamento_id,
        empresaId: a.empresa_id,
        resolvida: !!resolucao,
        resolvidoEm: resolucao?.resolvido_em || null,
        novoAgendamentoId: resolucao?.novo_agendamento_id || null,
      });
    });
  });
  negativas.sort((x, y) => {
    if (x.resolvida !== y.resolvida) return x.resolvida ? 1 : -1;
    return x.data < y.data ? -1 : x.data > y.data ? 1 : 0;
  });
  listaNegativas = negativas;
}

// Achata os pedidos de desmarcação (instrutor já tinha confirmado a aula e
// pediu para desmarcar, com justificativa) que ainda aguardam decisão.
function computarListaDesmarcacoes() {
  const pedidos = [];
  listaAgendamentos.forEach((a) => {
    Object.entries(a.datas_status || {}).forEach(([data, info]) => {
      const solicitacao = info && info.solicitacao_cancelamento;
      if (!solicitacao || !solicitacao.pendente) return;
      pedidos.push({
        agendamentoId: a.id,
        instrutorNome: a.instrutores?.nome || "Instrutor removido",
        data,
        justificativa: solicitacao.justificativa || "",
        solicitadoEm: solicitacao.solicitado_em || null,
        tipoNome: a.tipos_treinamento?.nome || "—",
        centroNome: a.centros_treinamento?.nome || "",
        empresaNome: a.empresas?.nome || "",
      });
    });
  });
  pedidos.sort((x, y) => (x.data < y.data ? -1 : x.data > y.data ? 1 : 0));
  listaDesmarcacoes = pedidos;
}

function renderizarAbasAgendamentos() {
  const pendentes = listaNegativas.filter((n) => !n.resolvida).length;
  const badge = $("ag-negativas-badge");
  badge.textContent = String(pendentes);
  badge.classList.toggle("hidden", pendentes === 0);

  const badgeDesm = $("ag-desmarcacoes-badge");
  badgeDesm.textContent = String(listaDesmarcacoes.length);
  badgeDesm.classList.toggle("hidden", listaDesmarcacoes.length === 0);

  const ativa = "border-slate-900 text-slate-900";
  const inativa = "border-transparent text-slate-500 hover:text-slate-800";
  $("ag-aba-lista").className = `inline-flex items-center gap-2 text-sm font-medium px-3 py-2 border-b-2 -mb-px ${agAbaAtiva === "lista" ? ativa : inativa}`;
  $("ag-aba-negativas").className = `inline-flex items-center gap-2 text-sm font-medium px-3 py-2 border-b-2 -mb-px ${agAbaAtiva === "negativas" ? ativa : inativa}`;
  $("ag-aba-desmarcacoes").className = `inline-flex items-center gap-2 text-sm font-medium px-3 py-2 border-b-2 -mb-px ${agAbaAtiva === "desmarcacoes" ? ativa : inativa}`;
  $("ag-conteudo-lista").classList.toggle("hidden", agAbaAtiva !== "lista");
  $("ag-conteudo-negativas").classList.toggle("hidden", agAbaAtiva !== "negativas");
  $("ag-conteudo-desmarcacoes").classList.toggle("hidden", agAbaAtiva !== "desmarcacoes");
}

function renderizarListaDesmarcacoes() {
  const podeAlterar = podeFazer("agendamentos", "alterar");
  const cont = $("ag-desmarcacoes-lista");
  if (listaDesmarcacoes.length === 0) {
    cont.innerHTML = `<div class="bg-white border border-dashed border-slate-300 rounded-lg py-16 text-center text-slate-500 text-sm">Nenhum pedido de desmarcação pendente.</div>`;
    return;
  }
  cont.innerHTML = listaDesmarcacoes.map((d, idx) => `
    <div class="bg-white rounded-lg border border-amber-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <p class="font-serif text-lg text-slate-900 leading-tight">${d.instrutorNome}</p>
          <span class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">Aguardando decisão</span>
        </div>
        <p class="text-sm text-amber-700 font-medium mt-1">🗓️ ${formatarDataAbrev(d.data)} · 🏷️ ${d.tipoNome}</p>
        <div class="text-xs text-slate-500 space-y-0.5 mt-1">
          ${d.centroNome ? `<p>🏫 ${d.centroNome}</p>` : ""}
          ${d.empresaNome ? `<p>🏢 ${d.empresaNome}</p>` : ""}
          <p class="text-slate-600">💬 ${d.justificativa || "Sem justificativa informada."}</p>
          ${d.solicitadoEm ? `<p class="text-slate-400">Pedido em ${new Date(d.solicitadoEm).toLocaleDateString("pt-BR")}</p>` : ""}
        </div>
      </div>
      ${podeAlterar ? `
      <div class="flex sm:flex-col gap-2 shrink-0">
        <button data-desmarcacao-aprovar="${idx}" class="text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-md px-3 py-1.5 whitespace-nowrap">✓ Aprovar desmarcação</button>
        <button data-desmarcacao-rejeitar="${idx}" class="text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-md px-3 py-1.5 whitespace-nowrap">✕ Rejeitar</button>
      </div>` : ""}
    </div>`).join("");
  cont.querySelectorAll("[data-desmarcacao-aprovar]").forEach((btn) =>
    btn.addEventListener("click", () => resolverDesmarcacao(listaDesmarcacoes[Number(btn.getAttribute("data-desmarcacao-aprovar"))], true))
  );
  cont.querySelectorAll("[data-desmarcacao-rejeitar]").forEach((btn) =>
    btn.addEventListener("click", () => resolverDesmarcacao(listaDesmarcacoes[Number(btn.getAttribute("data-desmarcacao-rejeitar"))], false))
  );
}

// Aprova ou rejeita o pedido de desmarcação. Aprovando, a data é liberada
// (instrutor volta a ficar disponível, turma volta para "A agendar") e passa
// a aparecer na aba de negativas para substituição.
async function resolverDesmarcacao(d, aprovar) {
  const pergunta = aprovar
    ? `Aprovar a desmarcação de ${d.instrutorNome} em ${formatarDataAbrev(d.data)}?\n\nA data será liberada e vai aparecer em "Negativas de instrutores" para você substituir o instrutor.`
    : `Rejeitar o pedido de ${d.instrutorNome} em ${formatarDataAbrev(d.data)}?\n\nA aula continua confirmada para ele.`;
  if (!confirm(pergunta)) return;
  const { error } = await supabase.rpc("resolver_desmarcacao_agendamento", {
    p_agendamento_id: d.agendamentoId,
    p_data: d.data,
    p_aprovar: aprovar,
  });
  if (error) {
    alert("Não foi possível processar o pedido: " + error.message);
    return;
  }
  await carregarAgendamentos();
}

document.querySelectorAll("[data-ag-aba]").forEach((btn) =>
  btn.addEventListener("click", () => {
    agAbaAtiva = btn.getAttribute("data-ag-aba");
    renderizarAbasAgendamentos();
  })
);

function renderizarListaNegativas() {
  const podeAlterar = podeFazer("agendamentos", "alterar");
  const podeIncluir = podeFazer("agendamentos", "incluir");
  const cont = $("ag-negativas-lista");
  if (listaNegativas.length === 0) {
    cont.innerHTML = `<div class="bg-white border border-dashed border-slate-300 rounded-lg py-16 text-center text-slate-500 text-sm">Nenhuma negativa registrada.</div>`;
    return;
  }
  cont.innerHTML = listaNegativas.map((n, idx) => `
    <div class="bg-white rounded-lg border ${n.resolvida ? "border-slate-200 opacity-60" : "border-rose-200"} p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <p class="font-serif text-lg text-slate-900 leading-tight">${n.instrutorNome}</p>
          <span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${n.resolvida ? "bg-slate-100 text-slate-500" : "bg-rose-50 text-rose-600"}">${n.resolvida ? "Resolvida" : "Pendente"}</span>
          ${n.veioDeDesmarcacao ? `<span class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700" title="A aula já estava confirmada e o instrutor pediu para desmarcar">⚠️ Desmarcou aula confirmada</span>` : ""}
        </div>
        <p class="text-sm text-amber-700 font-medium mt-1">🗓️ ${formatarDataAbrev(n.data)} · 🏷️ ${n.tipoNome}</p>
        <div class="text-xs text-slate-500 space-y-0.5 mt-1">
          ${n.centroNome ? `<p>🏫 ${n.centroNome}</p>` : ""}
          ${n.empresaNome ? `<p>🏢 ${n.empresaNome}</p>` : ""}
          <p class="text-slate-600">💬 ${n.justificativa || "Sem justificativa informada."}</p>
          ${n.veioDeDesmarcacao && n.desmarcadoEm ? `<p class="text-amber-700">🗓️ Desmarcação aprovada em ${new Date(n.desmarcadoEm).toLocaleDateString("pt-BR")}</p>` : ""}
          ${n.resolvida ? `<p class="text-slate-400">✔️ Resolvida em ${new Date(n.resolvidoEm).toLocaleDateString("pt-BR")}</p>` : ""}
        </div>
      </div>
      ${!n.resolvida ? `
      <div class="flex sm:flex-col gap-2 shrink-0">
        ${podeIncluir ? `<button data-negativa-substituir="${idx}" class="text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-md px-3 py-1.5 whitespace-nowrap">🔁 Substituir instrutor</button>` : ""}
        ${podeAlterar ? `<button data-negativa-resolver="${idx}" class="text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-md px-3 py-1.5 whitespace-nowrap">✔️ Marcar como resolvida</button>` : ""}
      </div>` : ""}
    </div>`).join("");
  cont.querySelectorAll("[data-negativa-substituir]").forEach((btn) =>
    btn.addEventListener("click", () => abrirSubstituicaoNegativa(listaNegativas[Number(btn.getAttribute("data-negativa-substituir"))]))
  );
  cont.querySelectorAll("[data-negativa-resolver]").forEach((btn) =>
    btn.addEventListener("click", () => marcarNegativaResolvidaManual(listaNegativas[Number(btn.getAttribute("data-negativa-resolver"))]))
  );
}

// Marca a negativa como resolvida sem criar um novo agendamento (ex: operador
// já resolveu por fora, ou decidiu cancelar aquela data).
async function marcarNegativaResolvidaManual(n) {
  if (!confirm(`Marcar a negativa de ${n.instrutorNome} em ${formatarDataAbrev(n.data)} como resolvida?\n\nIsso não cria um novo agendamento — use "Substituir instrutor" se ainda precisa alocar alguém.`)) return;
  const a = listaAgendamentos.find((x) => x.id === n.agendamentoId);
  const resolvidas = { ...((a && a.negativas_resolvidas) || {}) };
  resolvidas[n.data] = { resolvido_em: new Date().toISOString(), novo_agendamento_id: null };
  const { error } = await supabase.from("agendamentos").update({ negativas_resolvidas: resolvidas }).eq("id", n.agendamentoId);
  if (!error) await carregarAgendamentos();
}

// Abre o painel de "Agendar treinamento" pré-preenchido para alocar um novo
// instrutor na mesma data/tipo/centro/empresa da negativa selecionada.
function abrirSubstituicaoNegativa(n) {
  negativaEmSubstituicao = { agendamentoId: n.agendamentoId, data: n.data };
  abrirNovoAgendamento({ tipoId: n.tipoId, centroId: n.centroId, empresaId: n.empresaId, data: n.data });
  $("ag-aviso-substituicao").textContent = `Substituindo ${n.instrutorNome} em ${formatarDataAbrev(n.data)} (negou: "${n.justificativa || "sem justificativa"}"). Escolha o novo instrutor abaixo.`;
  $("ag-aviso-substituicao").classList.remove("hidden");
}

function renderizarListaAgendamentos() {
  const busca = $("ag-busca").value.toLowerCase();
  const podeAlterar = podeFazer("agendamentos", "alterar");
  const podeExcluir = podeFazer("agendamentos", "excluir");
  const lista = listaAgendamentos.filter((a) =>
    `${a.instrutores?.nome || ""} ${a.tipos_treinamento?.nome || ""} ${a.empresas?.nome || ""}`.toLowerCase().includes(busca)
  );
  const cont = $("ag-lista");
  if (lista.length === 0) {
    cont.innerHTML = `<div class="col-span-full bg-white border border-dashed border-slate-300 rounded-lg py-16 text-center text-slate-500 text-sm">Nenhum agendamento encontrado.</div>`;
    return;
  }
  const corStatus = { Confirmado: "bg-blue-50 text-blue-700", Cancelado: "bg-rose-50 text-rose-600", Aguardando: "bg-amber-50 text-amber-700" };
  cont.innerHTML = lista.map((a) => {
    const datas = (a.datas || []).slice().sort();
    const datasLabel = datas.length ? `${datas[0]}${datas.length > 1 ? ` … ${datas[datas.length - 1]} (${datas.length} dias)` : ""}` : "—";
    return `
    <div class="bg-white rounded-lg border border-slate-200 p-4 flex flex-col gap-2 shadow-sm">
      <div class="flex items-start justify-between">
        <p class="font-serif text-lg text-slate-900 leading-tight">${a.instrutores?.nome || "Instrutor removido"}</p>
        <span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${corStatus[a.status] || ""}">${a.status}</span>
      </div>
      <p class="text-sm text-amber-700 font-medium">🏷️ ${a.tipos_treinamento?.nome || "—"}</p>
      <div class="text-xs text-slate-500 space-y-1">
        ${a.centros_treinamento?.nome ? `<p>🏫 ${a.centros_treinamento.nome}</p>` : ""}
        ${a.empresas?.nome ? `<p>🏢 ${a.empresas.nome}</p>` : ""}
        <p>🗓️ ${datasLabel}</p>
        ${a.horario ? `<p>⏰ ${a.horario}</p>` : ""}
      </div>
      <div class="flex gap-2 mt-2 pt-2 border-t border-slate-100">
        ${podeAlterar ? `<button data-ag-editar="${a.id}" class="flex-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md py-1.5">✏️ Editar</button>` : ""}
        ${podeExcluir ? `<button data-ag-excluir="${a.id}" class="flex-1 text-xs font-medium text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-md py-1.5">🗑️ Excluir</button>` : ""}
      </div>
    </div>`;
  }).join("");
  cont.querySelectorAll("[data-ag-editar]").forEach((btn) => btn.addEventListener("click", () => abrirEdicaoAgendamento(btn.getAttribute("data-ag-editar"))));
  cont.querySelectorAll("[data-ag-excluir]").forEach((btn) => btn.addEventListener("click", () => excluirAgendamento(btn.getAttribute("data-ag-excluir"))));
}

$("ag-busca").addEventListener("input", renderizarListaAgendamentos);

function renderizarCalendarioAgendamento() {
  const mes = agMesCalendario;
  $("ag-mes-label").textContent = `${nomesMeses[mes.getMonth()]} ${mes.getFullYear()}`;
  $("ag-dias-semana").innerHTML = diasSemana.map((d) => `<div class="text-center text-[10px] font-medium text-slate-400 py-1">${d}</div>`).join("");

  const grade = gerarGradeMes(mes.getFullYear(), mes.getMonth());
  const diasStatus = (agInstrutorSelecionado && agInstrutorSelecionado.dias_status) || {};
  const mesmoInstrutorDaEdicao = editandoAgendamentoId && agInstrutorSelecionado && agInstrutorSelecionado.id === agendamentoInstrutorOriginalId;
  const el = $("ag-grade-dias");
  el.innerHTML = "";

  grade.forEach((dia) => {
    if (!dia) { el.innerHTML += `<div></div>`; return; }
    const dataStr = formatarData(dia);
    const statusOriginal = obterStatusDia(diasStatus, dataStr);
    const selecionado = agDatasSelecionadas.has(dataStr);
    const pertenceEdicao = mesmoInstrutorDaEdicao && agendamentoOriginalDatas.includes(dataStr);
    const selecionavel = statusOriginal === "disponivel" || pertenceEdicao || selecionado || dataStr === agDataForcada;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = dia.getDate();
    let classe = "bg-slate-200 text-slate-400 cursor-not-allowed opacity-70";
    if (selecionado) classe = "bg-amber-500 text-white hover:opacity-80";
    else if (selecionavel) classe = "bg-teal-600 text-white hover:opacity-80";
    btn.className = `aspect-square rounded-md text-xs font-medium transition-colors ${classe}`;
    if (selecionavel) {
      btn.addEventListener("click", () => {
        if (agDatasSelecionadas.has(dataStr)) agDatasSelecionadas.delete(dataStr);
        else agDatasSelecionadas.add(dataStr);
        renderizarCalendarioAgendamento();
        atualizarContagemAgDatas();
      });
    }
    el.appendChild(btn);
  });
}

function atualizarContagemAgDatas() {
  $("ag-dias-contagem").textContent = `${agDatasSelecionadas.size} selecionado(s)`;
}

$("ag-mes-anterior").addEventListener("click", () => {
  agMesCalendario = new Date(agMesCalendario.getFullYear(), agMesCalendario.getMonth() - 1, 1);
  renderizarCalendarioAgendamento();
});
$("ag-mes-proximo").addEventListener("click", () => {
  agMesCalendario = new Date(agMesCalendario.getFullYear(), agMesCalendario.getMonth() + 1, 1);
  renderizarCalendarioAgendamento();
});

$("ag-instrutor").addEventListener("change", () => {
  const id = $("ag-instrutor").value;
  agInstrutorSelecionado = listaInstrutoresAtivos.find((i) => i.id === id) || null;
  if (agInstrutorSelecionado) {
    $("ag-sem-instrutor").classList.add("hidden");
    $("ag-calendario").classList.remove("hidden");
    renderizarCalendarioAgendamento();
  } else {
    $("ag-sem-instrutor").classList.remove("hidden");
    $("ag-calendario").classList.add("hidden");
  }
  atualizarContagemAgDatas();
});

function abrirNovoAgendamento(prefill) {
  editandoAgendamentoId = null;
  agendamentoOriginalDatas = [];
  agendamentoInstrutorOriginalId = null;
  if (!prefill) negativaEmSubstituicao = null; // preservado quando chamado por abrirSubstituicaoNegativa
  agDataForcada = (prefill && prefill.data) || null;
  esconderErro("ag-form-erro");
  $("ag-aviso-substituicao").classList.add("hidden");
  preencherSelect("ag-instrutor", listaInstrutoresAtivos, "id", (i) => i.nome, "— Selecione —");
  preencherSelect("ag-tipo", listaTiposAtivos, "id", (i) => i.nome, "— Selecione —");
  preencherSelect("ag-centro", listaCentrosAtivos, "id", (i) => i.nome, "— Selecione —");
  preencherSelectEmpresa("ag-empresa", listaEmpresasAtivas, "— Nenhuma —");
  $("ag-tipo").value = (prefill && prefill.tipoId) || "";
  $("ag-centro").value = (prefill && prefill.centroId) || "";
  definirEmpresaSelect("ag-empresa", prefill && prefill.empresaId);
  $("ag-horario").value = "";
  $("ag-status").value = "Aguardando";
  $("ag-observacoes").value = "";
  agInstrutorSelecionado = null;
  agDatasSelecionadas = agDataForcada ? new Set([agDataForcada]) : new Set();
  agMesCalendario = agDataForcada ? new Date(agDataForcada) : new Date();
  $("ag-sem-instrutor").classList.remove("hidden");
  $("ag-calendario").classList.add("hidden");
  atualizarContagemAgDatas();
  $("painel-agendamento-titulo").textContent = prefill ? "Substituir instrutor" : "Agendar treinamento";
  $("btn-salvar-agendamento").textContent = "Salvar agendamento";
  $("painel-agendamento").classList.remove("hidden");
}

function abrirEdicaoAgendamento(id) {
  const a = listaAgendamentos.find((x) => x.id === id);
  if (!a) return;
  editandoAgendamentoId = id;
  agendamentoOriginalDatas = a.datas || [];
  agendamentoInstrutorOriginalId = a.instrutor_id;
  negativaEmSubstituicao = null;
  agDataForcada = null;
  esconderErro("ag-form-erro");
  $("ag-aviso-substituicao").classList.add("hidden");
  preencherSelect("ag-instrutor", listaInstrutoresAtivos, "id", (i) => i.nome, "— Selecione —");
  preencherSelect("ag-tipo", listaTiposAtivos, "id", (i) => i.nome, "— Selecione —");
  preencherSelect("ag-centro", listaCentrosAtivos, "id", (i) => i.nome, "— Selecione —");
  preencherSelectEmpresa("ag-empresa", listaEmpresasAtivas, "— Nenhuma —");
  $("ag-instrutor").value = a.instrutor_id || "";
  $("ag-tipo").value = a.tipo_treinamento_id || "";
  $("ag-centro").value = a.centro_treinamento_id || "";
  definirEmpresaSelect("ag-empresa", a.empresa_id);
  $("ag-horario").value = a.horario || "";
  $("ag-status").value = a.status === "Cancelado" ? "Aguardando" : a.status;
  $("ag-observacoes").value = a.observacoes || "";
  agInstrutorSelecionado = listaInstrutoresAtivos.find((i) => i.id === a.instrutor_id) || null;
  agDatasSelecionadas = new Set(a.datas || []);
  agMesCalendario = agDatasSelecionadas.size ? new Date([...agDatasSelecionadas][0]) : new Date();
  if (agInstrutorSelecionado) {
    $("ag-sem-instrutor").classList.add("hidden");
    $("ag-calendario").classList.remove("hidden");
    renderizarCalendarioAgendamento();
  }
  atualizarContagemAgDatas();
  $("painel-agendamento-titulo").textContent = "Editar agendamento";
  $("btn-salvar-agendamento").textContent = "Salvar alterações";
  $("painel-agendamento").classList.remove("hidden");
}

$("btn-ag-novo").addEventListener("click", abrirNovoAgendamento);
$("btn-fechar-painel-agendamento").addEventListener("click", () => $("painel-agendamento").classList.add("hidden"));
$("btn-cancelar-painel-agendamento").addEventListener("click", () => $("painel-agendamento").classList.add("hidden"));
$("painel-agendamento-overlay").addEventListener("click", () => $("painel-agendamento").classList.add("hidden"));

async function salvarAgendamento() {
  esconderErro("ag-form-erro");
  const instrutorId = $("ag-instrutor").value;
  const tipoId = $("ag-tipo").value;
  if (!instrutorId) return mostrarErro("ag-form-erro", "Selecione o instrutor.");
  if (!tipoId) return mostrarErro("ag-form-erro", "Selecione o tipo de treinamento.");
  if (agDatasSelecionadas.size === 0) return mostrarErro("ag-form-erro", "Selecione ao menos uma data.");

  const status = $("ag-status").value;
  const datas = Array.from(agDatasSelecionadas).sort();
  const payload = {
    instrutor_id: instrutorId,
    tipo_treinamento_id: tipoId,
    centro_treinamento_id: $("ag-centro").value || null,
    empresa_id: $("ag-empresa").value || null,
    horario: $("ag-horario").value.trim(),
    status,
    observacoes: $("ag-observacoes").value.trim(),
    datas,
  };

  $("btn-salvar-agendamento").disabled = true;
  $("btn-salvar-agendamento").textContent = "Salvando…";

  let erro, novoAgendamento;
  if (editandoAgendamentoId) {
    ({ error: erro } = await supabase.from("agendamentos").update(payload).eq("id", editandoAgendamentoId));
  } else if (negativaEmSubstituicao) {
    ({ data: novoAgendamento, error: erro } = await supabase.from("agendamentos").insert(payload).select().single());
  } else {
    ({ error: erro } = await supabase.from("agendamentos").insert(payload));
  }

  if (erro) {
    $("btn-salvar-agendamento").disabled = false;
    $("btn-salvar-agendamento").textContent = editandoAgendamentoId ? "Salvar alterações" : "Salvar agendamento";
    return mostrarErro("ag-form-erro", "Não foi possível salvar. Tente novamente.");
  }

  // Substituição de negativa: grava a resolução no agendamento original,
  // apontando para o novo agendamento recém-criado. Não mexe em datas nem
  // em datas_status do agendamento original — a negativa continua registrada.
  if (negativaEmSubstituicao && novoAgendamento) {
    const original = listaAgendamentos.find((x) => x.id === negativaEmSubstituicao.agendamentoId);
    const resolvidas = { ...((original && original.negativas_resolvidas) || {}) };
    resolvidas[negativaEmSubstituicao.data] = { resolvido_em: new Date().toISOString(), novo_agendamento_id: novoAgendamento.id };
    await supabase.from("agendamentos").update({ negativas_resolvidas: resolvidas }).eq("id", negativaEmSubstituicao.agendamentoId);
    negativaEmSubstituicao = null;
    agDataForcada = null;
  }

  // Reflete o agendamento no calendário do instrutor: libera datas removidas
  // (em edição) e marca as datas escolhidas com o status do agendamento.
  const novoStatus = status === "Confirmado" ? "agendado" : "aguardando";
  const diasStatus = { ...((agInstrutorSelecionado && agInstrutorSelecionado.dias_status) || {}) };
  if (editandoAgendamentoId && agendamentoInstrutorOriginalId === instrutorId) {
    agendamentoOriginalDatas.forEach((d) => { if (!datas.includes(d)) diasStatus[d] = "disponivel"; });
  }
  datas.forEach((d) => { diasStatus[d] = novoStatus; });
  await supabase.from("instrutores").update({ dias_status: diasStatus }).eq("id", instrutorId);

  $("btn-salvar-agendamento").disabled = false;
  $("painel-agendamento").classList.add("hidden");
  await carregarAgendamentos();
}

$("btn-salvar-agendamento").addEventListener("click", salvarAgendamento);

async function excluirAgendamento(id) {
  const a = listaAgendamentos.find((x) => x.id === id);
  if (!confirmarExclusao("este agendamento")) return;
  if (a && a.instrutor_id) {
    const { data: inst } = await supabase.from("instrutores").select("dias_status").eq("id", a.instrutor_id).maybeSingle();
    if (inst) {
      const diasStatus = { ...(inst.dias_status || {}) };
      (a.datas || []).forEach((d) => { diasStatus[d] = "disponivel"; });
      await supabase.from("instrutores").update({ dias_status: diasStatus }).eq("id", a.instrutor_id);
    }
  }
  const { error } = await supabase.from("agendamentos").delete().eq("id", id);
  if (!error) await carregarAgendamentos();
}

// ===========================================================
// OPERAÇÃO: ORÇAMENTOS
// ===========================================================

// Gera a identificação alfabética das turmas: 0→A, 1→B, ..., 25→Z, 26→AA...
function letraIndice(i) {
  let n = i, letra = "";
  do {
    letra = String.fromCharCode(65 + (n % 26)) + letra;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letra;
}

// Valor do orçamento na lista, com a situação de aprovação do gestor.
//  - proposta válida que precisa de aprovação: pendente (⏳ vermelho) ou aprovada (✔ verde);
//  - sem proposta válida: ⚠ quando a margem calculada está abaixo do mínimo.
function htmlValorOrcamentoLista(o) {
  const val = (o.orcamento_propostas || []).find((p) => p.status !== "Inválida");
  let cls = "", mark = "", tip = "";
  if (val && val.requer_aprovacao) {
    if (val.aprovado_em) { cls = "text-emerald-700 font-semibold"; mark = "✔ "; tip = "Proposta aprovada pelo gestor (margem abaixo do mínimo)"; }
    else { cls = "text-rose-600 font-semibold"; mark = "⏳ "; tip = "Proposta aguardando aprovação do gestor (margem abaixo do mínimo)"; }
  } else if (!val && o.requer_aprovacao_gestor) {
    cls = "text-rose-600 font-semibold"; mark = "⚠ "; tip = "Margem abaixo do mínimo: precisará de aprovação do gestor após gerar a proposta";
  }
  return `<span class="${cls}" ${tip ? `title="${tip}"` : ""}>${mark}${fmtBRL(o.valor_final)}</span>`;
}

const ORC_TAMANHO_PAGINA = 20;
let orcPagina = 1;
let orcTotal = 0;
let orcBuscaTimer = null;

// Tabelas auxiliares do orçamento (Treinamento, Centro de Treinamento, Prazo de Pagamento e suas parcelas).
// São consultadas no banco a cada abertura do orçamento (e quando o seletor é usado depois de um tempo ou
// está vazio), com novas tentativas — assim uma falha momentânea de rede não deixa a lista vazia.
let orcRefsCarregadoEm = 0;
async function carregarReferenciasOrcamento() {
  const tentar = async (fn) => {
    let r;
    for (let t = 1; t <= 3; t++) {
      r = await fn();
      if (!r.error) return r;
      if (t < 3) await new Promise((res) => setTimeout(res, 400 * t));
    }
    return r;
  };
  const [rt, rc, rp, rpp] = await Promise.all([
    tentar(() => supabase.from("tipos_treinamento").select("*").eq("status", "Ativo").order("nome")),
    tentar(() => supabase.from("centros_treinamento").select("*").eq("status", "Ativo").order("nome")),
    tentar(() => supabase.from("prazos_pagamento").select("id, descricao, status").order("descricao")),
    tentar(() => supabase.from("prazos_pagamento_parcelas").select("prazo_pagamento_id, numero, dias, percentual").order("numero")),
  ]);
  const falhas = [];
  if (rt.error) falhas.push("treinamentos"); else listaTiposAtivos = rt.data || [];
  if (rc.error) falhas.push("centros de treinamento"); else listaCentrosAtivos = rc.data || [];
  if (rp.error || rpp.error) falhas.push("prazos de pagamento");
  else orcPrazosPagamento = (rp.data || []).map((p) => ({ ...p, parcelas: (rpp.data || []).filter((x) => x.prazo_pagamento_id === p.id).sort((a, b) => a.numero - b.numero) }));
  if (!falhas.length) orcRefsCarregadoEm = Date.now();
  return falhas;
}

// Garante que o treinamento e o centro gravados no orçamento apareçam no seletor mesmo se estiverem inativos.
async function garantirReferenciasDoOrcamento(o) {
  const incluir = async (tabela, id, lista) => {
    if (!id || lista.some((x) => x.id === id)) return lista;
    const { data } = await supabase.from(tabela).select("*").eq("id", id).maybeSingle();
    return data ? [...lista, { ...data, nome: data.status && data.status !== "Ativo" ? `${data.nome} (inativo)` : data.nome }] : lista;
  };
  listaTiposAtivos = await incluir("tipos_treinamento", o.tipo_treinamento_id, listaTiposAtivos);
  listaCentrosAtivos = await incluir("centros_treinamento", o.centro_treinamento_id, listaCentrosAtivos);
}

// Ao usar um seletor auxiliar com a lista vazia ou antiga (> 45 s), consulta o banco de novo e repovoa o seletor.
async function atualizarSeletorAuxiliarOrcamento(selectId) {
  const lista = selectId === "orc-tipo" ? listaTiposAtivos : selectId === "orc-centro" ? listaCentrosAtivos : orcPrazosPagamento;
  if (lista.length > 0 && Date.now() - orcRefsCarregadoEm < 45000) return;
  const sel = $(selectId);
  if (sel.disabled) return;
  const atual = sel.value;
  const assinatura = () => (selectId === "orc-tipo" ? listaTiposAtivos : selectId === "orc-centro" ? listaCentrosAtivos : orcPrazosPagamento).map((x) => x.id).join(",");
  const antes = assinatura();
  const falhas = await carregarReferenciasOrcamento();
  if (assinatura() === antes) { /* nada mudou: não mexe no seletor (evita fechar a lista aberta) */ }
  else if (selectId === "orc-prazo") orcPreencherPrazos(atual);
  else {
    const nova = selectId === "orc-tipo" ? listaTiposAtivos : listaCentrosAtivos;
    preencherSelect(selectId, nova, "id", (i) => i.nome, "— Selecione —");
    sel.value = nova.some((x) => x.id === atual) ? atual : "";
  }
  if (falhas.length) mostrarErro("orc-form-erro", `Não foi possível carregar: ${falhas.join(", ")}. Verifique a conexão e tente novamente.`);
}
["orc-tipo", "orc-centro", "orc-prazo"].forEach((id) => {
  $(id).addEventListener("mousedown", () => atualizarSeletorAuxiliarOrcamento(id));
  $(id).addEventListener("focus", () => atualizarSeletorAuxiliarOrcamento(id));
});

async function carregarOrcamentos() {
  $("admin-descricao-pagina").textContent = "Registre orçamentos de treinamento por empresa. Ao criar um novo orçamento, as turmas já são geradas automaticamente.";
  const [{ data: empresas, error: erroEmpresas }, falhasRefs] = await Promise.all([
    buscarTodos(() => supabase.from("empresas").select("*").eq("status", "Ativo").order("nome").order("id")),
    carregarReferenciasOrcamento(),
  ]);
  listaEmpresasAtivas = empresas || [];
  orcEmpresasIncompleta = !!erroEmpresas;
  if (erroEmpresas) $("admin-descricao-pagina").textContent += " ⚠ A lista de clientes não carregou por completo; recarregue a página. (O cliente de um orçamento já gravado continua sendo exibido.)";
  if (falhasRefs.length) $("admin-descricao-pagina").textContent += ` ⚠ Não foi possível carregar: ${falhasRefs.join(", ")}. Ao abrir o orçamento a lista será consultada de novo.`;
  $("btn-orc-novo").classList.toggle("hidden", !podeFazer("orcamentos", "incluir"));
  $("btn-orc-importar").classList.toggle("hidden", !podeFazer("orcamentos", "incluir"));
  $("btn-orc-historico").classList.toggle("hidden", !podeFazer("orcamentos", "incluir"));
  $("orc-importacao-painel").classList.add("hidden");
  renderizarFiltroStatusOrcamento();
  await carregarPaginaOrcamentos();
}

// Consulta a página atual de orçamentos no servidor, respeitando os filtros de
// status e a busca (número, empresa, fantasia ou CNPJ). Devolve { data, count, error }.
async function consultarPaginaOrcamentos() {
  if (orcFiltroStatus.size === 0) return { data: [], count: 0, error: null };
  const termo = $("orc-busca").value.replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim();
  let filtroOr = null;
  if (termo) {
    const filtrosEmp = [`nome.ilike.%${termo}%`, `nome_fantasia.ilike.%${termo}%`];
    const digitos = termo.replace(/\D/g, "");
    if (digitos.length >= 3 && /^[\d.\/\-\s]+$/.test(termo)) filtrosEmp.push(`cnpj_digitos.like.%${digitos}%`);
    const { data: emps } = await supabase.from("empresas").select("id").or(filtrosEmp.join(",")).limit(150);
    const ids = (emps || []).map((e) => e.id);
    filtroOr = `numero.ilike.%${termo}%` + (ids.length ? `,empresa_id.in.(${ids.join(",")})` : "");
  }
  const montar = () => {
    let q = supabase.from("orcamentos")
      .select("*, empresas(nome), centros_treinamento(nome), tipos_treinamento(nome), orcamento_propostas(status, requer_aprovacao, aprovado_em)", { count: "exact" })
      .in("status", [...orcFiltroStatus]);
    if (filtroOr) q = q.or(filtroOr);
    return q.order("data", { ascending: false }).order("created_at", { ascending: false }).order("id");
  };
  const tam = ORC_TAMANHO_PAGINA;
  let resp = await montar().range((orcPagina - 1) * tam, orcPagina * tam - 1);
  if (!resp.error && (resp.count || 0) > 0 && (resp.data || []).length === 0 && orcPagina > 1) {
    // a página deixou de existir (ex.: último orçamento da página foi excluído)
    orcPagina = Math.max(1, Math.ceil(resp.count / tam));
    resp = await montar().range((orcPagina - 1) * tam, orcPagina * tam - 1);
  }
  return resp;
}

async function carregarPaginaOrcamentos() {
  const { data, error, count } = await consultarPaginaOrcamentos();
  listaOrcamentos = error ? [] : data || [];
  orcTotal = error ? 0 : count || 0;
  renderizarListaOrcamentos();
}

function irParaPaginaOrcamentos(n) {
  orcPagina = n;
  carregarPaginaOrcamentos();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderizarFiltroStatusOrcamento() {
  const cont = $("orc-filtro-status");
  cont.innerHTML = ORCAMENTO_STATUS.map((s) => `
    <label class="inline-flex items-center gap-1.5">
      <input type="checkbox" data-filtro-status="${s}" ${orcFiltroStatus.has(s) ? "checked" : ""} class="rounded border-slate-300" />
      ${s}
    </label>
  `).join("");
  cont.querySelectorAll("[data-filtro-status]").forEach((el) => {
    el.addEventListener("change", (e) => {
      const s = e.target.getAttribute("data-filtro-status");
      if (e.target.checked) orcFiltroStatus.add(s);
      else orcFiltroStatus.delete(s);
      orcPagina = 1;
      carregarPaginaOrcamentos();
    });
  });
}

function renderizarListaOrcamentos() {
  const podeAlterar = podeFazer("orcamentos", "alterar");
  const podeExcluir = usuarioEhAdmin();
  const lista = listaOrcamentos;
  const cont = $("orc-lista");
  renderizarPaginadores(["orc-paginacao-topo", "orc-paginacao"], orcPagina, orcTotal, ORC_TAMANHO_PAGINA, "orc", irParaPaginaOrcamentos);
  if (lista.length === 0) {
    cont.innerHTML = `<tr><td colspan="9" class="text-center text-slate-500 text-sm py-16">Nenhum orçamento encontrado.</td></tr>`;
    return;
  }
  const corStatus = {
    Aberto: "bg-amber-50 text-amber-700",
    "Aberto e Pré-Agendado": "bg-yellow-50 text-yellow-700",
    "Aberto e Pré-Confirmado": "bg-orange-50 text-orange-700",
    Aprovado: "bg-teal-50 text-teal-700",
    "Aprovado e Agendado": "bg-sky-50 text-sky-700",
    "Aprovado e Confirmado": "bg-emerald-50 text-emerald-700",
    Recusado: "bg-rose-50 text-rose-600",
    "Concluído": "bg-blue-50 text-blue-700",
  };
  cont.innerHTML = lista.map((o) => `
    <tr class="hover:bg-slate-50">
      <td class="px-3 py-2 font-mono text-slate-700 cursor-pointer select-none" data-orc-numero="${o.id}" title="Dois cliques para editar">${o.numero}</td>
      <td class="px-3 py-2 text-slate-700">${o.empresas?.nome || "—"}</td>
      <td class="px-3 py-2 text-slate-500">${o.tipos_treinamento?.nome || "—"}</td>
      <td class="px-3 py-2 text-slate-500">${o.centros_treinamento?.nome || "—"}</td>
      <td class="px-3 py-2"><span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${corStatus[o.status] || ""}">${o.status}</span></td>
      <td class="px-3 py-2 text-slate-500">${o.qtd_turmas || 0}</td>
      <td class="px-3 py-2 text-slate-500">${o.qtd_alunos || 0}</td>
      <td class="px-3 py-2 text-slate-500">${o.qtd_localidades || 1}</td>
      <td class="px-3 py-2 text-slate-500">${o.data || "—"}</td>
      <td class="px-3 py-2 text-right whitespace-nowrap text-slate-700">${o.calculado_em ? htmlValorOrcamentoLista(o) : '<span class="text-slate-300" title="Orçamento ainda sem cálculo">—</span>'}</td>
      <td class="px-3 py-2 text-right whitespace-nowrap">
        ${podeAlterar ? `<button data-orc-editar="${o.id}" title="Editar orçamento" class="text-slate-500 hover:text-slate-800 px-2 py-1">✏️</button>` : ""}
        ${podeExcluir ? `<button data-orc-excluir="${o.id}" title="Excluir orçamento" class="text-rose-500 hover:text-rose-700 px-2 py-1">🗑️</button>` : ""}
      </td>
    </tr>
  `).join("");
  if (podeAlterar) {
    cont.querySelectorAll("[data-orc-numero]").forEach((el) => el.addEventListener("dblclick", () => abrirEdicaoOrcamento(el.getAttribute("data-orc-numero"))));
    cont.querySelectorAll("[data-orc-editar]").forEach((btn) => btn.addEventListener("click", () => abrirEdicaoOrcamento(btn.getAttribute("data-orc-editar"))));
  }
  cont.querySelectorAll("[data-orc-excluir]").forEach((btn) => btn.addEventListener("click", () => excluirOrcamento(btn.getAttribute("data-orc-excluir"))));
}

$("orc-busca").addEventListener("input", () => {
  clearTimeout(orcBuscaTimer);
  orcBuscaTimer = setTimeout(() => { orcPagina = 1; carregarPaginaOrcamentos(); }, 350);
});

// Alunos por turma é calculado: alunos ÷ turmas, arredondado para cima (como na planilha de cálculo).
function atualizarQtdAlunosCalculado() {
  const q = orcQuantidades();
  $("orc-qtd-alunos-turma").value = q.alunos > 0 ? q.alunosPorTurma : "";
  atualizarNecessitaDoisInstrutores();
  recalcularOrcamentoTela();
  orcAtualizarAbas();
}

// Marca automaticamente "Necessita dois instrutores" quando a quantidade de
// alunos por turma passa da capacidade por instrutor do treinamento selecionado.
function atualizarNecessitaDoisInstrutores() {
  const porTurma = Number($("orc-qtd-alunos-turma").value) || 0;
  const tipo = listaTiposAtivos.find((t) => t.id === $("orc-tipo").value);
  const capacidade = tipo ? Number(tipo.alunos_por_instrutor) || 0 : 0;
  $("orc-dois-instrutores").checked = capacidade > 0 && porTurma > capacidade;
}
$("orc-qtd-turmas").addEventListener("input", atualizarQtdAlunosCalculado);
$("orc-qtd-alunos").addEventListener("input", atualizarQtdAlunosCalculado);
$("orc-qtd-localidades").addEventListener("input", atualizarQtdAlunosCalculado);
$("orc-validade-dias").addEventListener("input", () => { orcValidadeManual = true; });
$("orc-tipo").addEventListener("change", () => {
  if (!orcValidadeManual || !$("orc-validade-dias").value) {
    const t = listaTiposAtivos.find((x) => x.id === $("orc-tipo").value);
    $("orc-validade-dias").value = t ? (Number(t.validade_padrao_dias) || 30) : "";
    orcValidadeManual = false;
  }
  atualizarNecessitaDoisInstrutores();
  orcAtualizarAbas();
  aplicarCadastroNoCalculo().catch((e) => mostrarErro("orc-form-erro", "Não foi possível carregar os itens de custo do treinamento: " + (e?.message || "erro desconhecido")));
});

// ---------------------------------------------------------
// Editor de orçamento em tela cheia (fica abaixo do menu superior)
// ---------------------------------------------------------
let orcEditorSujo = false;

function orcEditorAberto() { return !$("painel-orcamento").classList.contains("hidden"); }

function ajustarTopoEditorOrcamento() {
  const painel = $("painel-orcamento");
  if (painel.classList.contains("hidden")) return;
  const ref = $("admin-areas-topo");
  const r = ref ? ref.getBoundingClientRect() : { bottom: 0 };
  painel.style.top = Math.max(0, Math.round(r.bottom + 8)) + "px";
}
window.addEventListener("resize", ajustarTopoEditorOrcamento);

function abrirEditorOrcamento() {
  document.body.classList.add("orc-editando");
  window.scrollTo(0, 0);
  $("painel-orcamento").classList.remove("hidden");
  ajustarTopoEditorOrcamento();
  $("orc-editor-scroll").scrollTop = 0;
  irParaAbaOrc(1); // sempre abre nos dados gerais
  orcEditorSujo = false;
}

function fecharEditorOrcamento() {
  $("painel-orcamento").classList.add("hidden");
  document.body.classList.remove("orc-editando");
  orcEditorSujo = false;
}

// Usada pelos menus: se houver alterações não salvas, pergunta antes de sair do editor.
function sairEditorOrcamentoPermitido() {
  if (!orcEditorAberto()) return true;
  if (orcEditorSujo && !window.confirm("Há alterações não salvas neste orçamento. Sair sem salvar?")) return false;
  fecharEditorOrcamento();
  return true;
}

$("orc-editor-scroll").addEventListener("input", () => { orcEditorSujo = true; });
$("orc-editor-scroll").addEventListener("change", () => { orcEditorSujo = true; });

// ---- Abas do editor: 1 Dados gerais · 2 Cálculo do orçamento · 3 Turmas ----
let orcAbaAtiva = 1;
function irParaAbaOrc(n) {
  orcAbaAtiva = n;
  document.querySelectorAll("[data-orc-aba]").forEach((b) => {
    const ativa = Number(b.getAttribute("data-orc-aba")) === n;
    b.classList.toggle("ativa", ativa);
    b.setAttribute("aria-selected", ativa ? "true" : "false");
  });
  document.querySelectorAll("[data-orc-pagina]").forEach((p) => p.classList.toggle("hidden", Number(p.getAttribute("data-orc-pagina")) !== n));
  $("orc-editor-scroll").scrollTop = 0;
  orcAtualizarAbas();
}
document.querySelectorAll("[data-orc-aba]").forEach((b) => b.addEventListener("click", () => irParaAbaOrc(Number(b.getAttribute("data-orc-aba")))));

// Selos das abas e faixa de resumo (valor final e margem ficam à vista em qualquer aba).
function orcAtualizarAbas() {
  const resumo = $("orc-abas-resumo");
  if (!resumo) return;
  const c = calcularOrcamento();
  const temCalc = c.itens.length > 0 && c.valido;
  const bd2 = $("orc-aba-bd-2");
  bd2.classList.toggle("hidden", !c.precisaAprovacao);
  orcAtualizarAprovacao(c);
  const grupos = orcTurmasGrupos.length;
  const dias = orcTurmasGrupos.reduce((t, g) => t + (g.linhas ? g.linhas.length : 0), 0);
  const bd3 = $("orc-aba-bd-3");
  bd3.classList.toggle("hidden", grupos === 0);
  bd3.textContent = `${grupos} turma(s) · ${dias} dia(s)`;
  const cor = c.precisaAprovacao ? "text-rose-600" : "text-slate-800";
  resumo.classList.toggle("hidden", false);
  resumo.innerHTML = temCalc
    ? `<span>Valor final <b class="text-sm ${cor}">${fmtBRL(c.final)}</b></span><span>Margem <b class="text-sm ${cor}">${fmtPercOrc(c.margemPerc)}</b></span><span>${c.q.alunos} alunos · ${c.q.turmas} turma(s)</span>`
    : `<span>${c.q.alunos} alunos · ${c.q.turmas} turma(s)</span>`;
}

// ---------------------------------------------------------
// Cálculo do orçamento (planilha "Rotina de Calculo")
//  - itens de custo vêm do cadastro do treinamento e são copiados para o orçamento;
//  - valor da turma = custo da turma ÷ (100% − apoio − imposto − margem);
//  - total do orçamento = valor da turma × quantidade de turmas.
// ---------------------------------------------------------
let orcLinhasCalc = [];      // linhas exibidas/gravadas
let orcCalcOrigem = "vazio"; // "vazio" | "cadastro" | "salvo"
let orcCalcSalvoEm = null;
let orcCalcSeq = 0;
let orcCalcToken = 0;
let orcDescontoModo = "percentual"; // "percentual" (digitou o %) ou "valor" (digitou o R$; o % é derivado)
let orcCalcPendentes = 0;    // cargas em andamento (não deixa salvar enquanto carrega)
let orcCalcCarregandoInicial = false; // mostra "Carregando…" na tabela ao abrir um orçamento para edição
let orcPropostas = [];       // histórico de propostas do orçamento aberto (mais recente primeiro, sem o snapshot)
let orcPropostaTravada = false; // há proposta gerada e o cálculo está bloqueado até acionar "Nova proposta"
let orcPrazosPagamento = []; // cadastro de prazos de pagamento (ativos)
let orcValidadeManual = false; // usuário digitou a validade; não sobrescreve com o padrão do treinamento
let orcGerandoProposta = false;
let orcCalcErro = null;      // falha ao carregar o cálculo (bloqueia o salvamento para não apagar o que já estava gravado)
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const fmtQtd = (n) => Number(n || 0).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const fmtPercOrc = (v) => `${Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

function orcQuantidades() {
  const alunos = Math.max(0, Math.floor(Number($("orc-qtd-alunos").value) || 0));
  const turmas = Math.max(1, Math.floor(Number($("orc-qtd-turmas").value)) || 1);
  const localidades = Math.max(1, Math.floor(Number($("orc-qtd-localidades").value)) || 1);
  return { alunos, turmas, localidades, alunosPorTurma: Math.ceil(alunos / turmas) };
}

function orcQtdDaBase(base, q) {
  switch (base) {
    case "turma": return 1;
    case "alunos_por_turma": return q.alunosPorTurma;
    case "qtde_turmas": return q.turmas;
    case "localidades": return q.localidades;
    default: return null; // "manual" ou sem base definida: quantidade digitada
  }
}

function calcularLinhaOrcamento(l, q) {
  const doItem = orcQtdDaBase(l.base_calculo, q);
  const K = doItem == null ? (Number(l.qtd_manual) || 0) : doItem;        // quantidade primária
  const divisor = Number(l.divisor) || 0;
  let M = 1;                                                              // referência do divisor
  if (divisor > 0) { const ref = orcQtdDaBase(l.base_divisor, q); M = ref == null ? 1 : ref; }
  const N = divisor > 0 ? divisor : 1;
  const O = Math.max(0, Math.ceil(M / N - 1e-9));                         // arredonda para cima
  const P = Number(l.multiplo) > 0 ? Number(l.multiplo) : 1;              // multiplicador
  const Q = K * O * P;                                                    // quantidade aplicável
  return { K, M, N, O, P, Q, total: (Number(l.valor_unitario) || 0) * Q };
}

function calcularOrcamento() {
  const q = orcQuantidades();
  const itens = orcLinhasCalc.map((l) => ({ l, ...calcularLinhaOrcamento(l, q) }));
  const custo = itens.reduce((s, i) => s + i.total, 0);
  const apoio = Number($("orc-perc-apoio").value) || 0;
  const margem = Number($("orc-perc-margem").value) || 0;
  const imposto = Number($("orc-perc-imposto").value) || 0;
  const pctCusto = 1 - (apoio + margem + imposto) / 100;
  const valido = pctCusto > 0.000001;
  // Margem garantida: vale a MAIOR entre a margem pelo % aplicado e o valor mínimo de margem por turma
  // (R$) do cadastro do treinamento. Margem = valor da turma − custo − apoio − imposto.
  const tipo = listaTiposAtivos.find((t) => t.id === $("orc-tipo").value);
  const minPerc = tipo ? Number(tipo.perc_margem_minima) || 0 : 0;
  const minValor = tipo ? Number(tipo.valor_margem_minimo) || 0 : 0;
  const valorTurmaPerc = valido ? custo / pctCusto : 0;
  const fatorLiquido = 1 - (apoio + imposto) / 100;                      // sobra após apoio e imposto
  const valorTurmaMinimo = valido && minValor > 0 && custo > 0 ? (custo + minValor) / fatorLiquido : 0;
  const margemMinimaAplicada = valido && valorTurmaMinimo > valorTurmaPerc + 0.005;
  const valorTurma = margemMinimaAplicada ? valorTurmaMinimo : valorTurmaPerc;
  const pctCustoEfetivo = valorTurma > 0 ? custo / valorTurma : pctCusto;
  const total = valorTurma * q.turmas;
  // Desconto: o usuário informa o percentual OU o valor em R$ (o outro é calculado).
  let desconto, valorDesc;
  if (orcDescontoModo === "valor") {
    valorDesc = Math.max(0, Number($("orc-valor-desconto").value) || 0);
    desconto = total > 0 ? valorDesc / total * 100 : 0;
  } else {
    desconto = Number($("orc-perc-desconto").value) || 0;
    valorDesc = total * desconto / 100;
  }
  const final = total - valorDesc;
  // Margem final, depois do desconto: o apoio e o imposto continuam sendo percentuais do valor cobrado.
  const finalTurma = q.turmas > 0 ? final / q.turmas : 0;
  const margemTurma = finalTurma * (1 - (apoio + imposto) / 100) - custo;
  const margemPerc = finalTurma > 0 ? margemTurma / finalTurma * 100 : 0;
  // Margem mínima do treinamento (percentual e/ou valor por turma): abaixo de qualquer uma, precisa de aprovação do gestor.
  const abaixoPerc = minPerc > 0 && r2(margemPerc) < r2(minPerc);
  const abaixoValor = minValor > 0 && r2(margemTurma) < r2(minValor);
  const precisaAprovacao = itens.length > 0 && valido && (abaixoPerc || abaixoValor);
  return {
    q, itens, custo, apoio, margem, imposto, desconto, pctCusto, pctCustoEfetivo, margemMinimaAplicada, valorTurmaPerc, valido, valorTurma, total, valorDesc, final,
    finalTurma, margemTurma, margemPerc, margemTotal: margemTurma * q.turmas, minPerc, minValor, abaixoPerc, abaixoValor, precisaAprovacao,
    descontoInvalido: valorDesc > total + 0.005 || desconto > 100.0001,
    apoioV: valorTurma * apoio / 100, impostoV: valorTurma * imposto / 100,
    margemV: valorTurma - custo - valorTurma * (apoio + imposto) / 100,
    margemEfetivaPerc: valorTurma > 0 ? (valorTurma - custo - valorTurma * (apoio + imposto) / 100) / valorTurma * 100 : margem,
    porAluno: q.alunosPorTurma ? valorTurma / q.alunosPorTurma : 0,
    finalAluno: q.alunos ? final / q.alunos : 0,
  };
}

async function orcCarregarRefsCalculo() {
  const [{ data: unidades, error: e1 }, { data: itens, error: e2 }] = await Promise.all([
    supabase.from("unidades_medida").select("id, sigla, base_calculo"),
    supabase.from("itens_custo").select("id, item, descricao_impressao, unidade_medida_id, valor, opcional, status"),
  ]);
  if (e1 || e2) throw (e1 || e2);
  return { unidades: unidades || [], itens: itens || [] };
}

// Monta as linhas de cálculo a partir dos itens de custo cadastrados no treinamento.
async function linhasDoCadastroDoTreinamento(tipoId) {
  if (!tipoId) return [];
  const [refs, { data: vinculos, error }] = await Promise.all([
    orcCarregarRefsCalculo(),
    supabase.from("treinamento_itens_custo").select("*").eq("tipo_treinamento_id", tipoId),
  ]);
  if (error) throw error;
  const unid = (id) => refs.unidades.find((u) => u.id === id) || null;
  // Itens marcados como opcionais no cadastro não entram sozinhos: o usuário os acrescenta no orçamento.
  const linhas = (vinculos || []).filter((v) => !(refs.itens.find((x) => x.id === v.item_custo_id) || {}).opcional).map((v) => {
    const it = refs.itens.find((x) => x.id === v.item_custo_id) || {};
    const un = unid(it.unidade_medida_id);
    const ud = v.unidade_divisor_id ? unid(v.unidade_divisor_id) : null;
    const valor = Number(it.valor) || 0;
    return {
      chave: `c${++orcCalcSeq}`,
      item_custo_id: v.item_custo_id,
      item: it.item || "(item removido)",
      descricao_impressao: it.descricao_impressao || null,
      valor_cadastro: valor,
      valor_unitario: valor,
      unidade_sigla: un ? un.sigla : null,
      base_calculo: un ? un.base_calculo : null,
      divisor: v.divisor != null ? Number(v.divisor) : null,
      unidade_divisor_sigla: ud ? ud.sigla : null,
      base_divisor: ud ? ud.base_calculo : null,
      multiplo: Number(v.multiplo) > 0 ? Number(v.multiplo) : 1,
      imprime: !!v.imprime,
      ordem_impressao: v.ordem_impressao != null ? Number(v.ordem_impressao) : null,
      qtd_manual: 1,
      opcional: false,
    };
  });
  linhas.sort((a, b) => (a.ordem_impressao ?? 1e9) - (b.ordem_impressao ?? 1e9) || a.item.localeCompare(b.item, "pt-BR"));
  return linhas;
}

// Traz do cadastro do treinamento os itens de custo e os percentuais (apoio, margem, imposto).
// O desconto é só do orçamento e não é alterado aqui.
async function aplicarCadastroNoCalculo() {
  const token = ++orcCalcToken;
  const tipoId = $("orc-tipo").value;
  const tipo = listaTiposAtivos.find((t) => t.id === tipoId);
  orcCalcPendentes++;
  let linhas;
  try {
    linhas = await linhasDoCadastroDoTreinamento(tipoId);
  } catch (e) {
    if (token === orcCalcToken) orcCalcErro = "Os itens de custo do treinamento não foram carregados. Escolha o treinamento de novo ou feche e abra o orçamento.";
    throw e;
  } finally {
    orcCalcPendentes--;
  }
  if (token !== orcCalcToken) return; // o usuário trocou de treinamento enquanto carregava
  orcCalcErro = null;
  orcLinhasCalc = linhas;
  $("orc-perc-apoio").value = tipo ? Number(tipo.perc_apoio) || 0 : 0;
  $("orc-perc-margem").value = tipo ? Number(tipo.perc_margem) || 0 : 0;
  $("orc-perc-imposto").value = tipo ? Number(tipo.perc_imposto) || 0 : 0;
  orcCalcOrigem = tipoId ? "cadastro" : "vazio";
  orcCalcSalvoEm = null;
  renderizarCalcOrcamento();
}

function limparCalculoOrcamento(carregando = false) {
  orcCalcCarregandoInicial = carregando;
  orcCalcToken++;
  orcCalcErro = null;
  orcLinhasCalc = [];
  orcCalcOrigem = "vazio";
  orcCalcSalvoEm = null;
  ["apoio", "margem", "imposto", "desconto"].forEach((k) => { $("orc-perc-" + k).value = 0; });
  orcDescontoModo = "percentual";
  $("orc-valor-desconto").value = 0;
  $("orc-calc-detalhes").checked = false;
  $("orc-calc-tabela").classList.remove("mostrar-det");
  renderizarCalcOrcamento();
}

// Edição: usa o cálculo gravado; se ainda não houver (orçamento antigo/importado), parte do cadastro.
async function carregarCalculoDoOrcamento(o) {
  const token = ++orcCalcToken;
  orcCalcPendentes++;
  let data, error;
  try {
    ({ data, error } = await supabase.from("orcamento_itens_custo").select("*").eq("orcamento_id", o.id).order("ordem"));
  } finally {
    orcCalcPendentes--;
  }
  if (token !== orcCalcToken) return;
  if (error) {
    orcCalcErro = "Não foi possível carregar o cálculo gravado deste orçamento. Feche e abra o orçamento novamente.";
    mostrarErro("orc-form-erro", orcCalcErro);
    return;
  }
  if (data && data.length) {
    orcLinhasCalc = data.map((r) => ({
      chave: `s${++orcCalcSeq}`, item_custo_id: r.item_custo_id, item: r.item, descricao_impressao: r.descricao_impressao,
      valor_cadastro: Number(r.valor_cadastro) || 0, valor_unitario: Number(r.valor_unitario) || 0,
      unidade_sigla: r.unidade_sigla, base_calculo: r.base_calculo,
      divisor: r.divisor != null ? Number(r.divisor) : null, unidade_divisor_sigla: r.unidade_divisor_sigla, base_divisor: r.base_divisor,
      multiplo: Number(r.multiplo) > 0 ? Number(r.multiplo) : 1, imprime: !!r.imprime, ordem_impressao: r.ordem_impressao,
      qtd_manual: Number(r.qtd_manual) || 0, opcional: !!r.opcional,
    }));
    $("orc-perc-apoio").value = Number(o.perc_apoio) || 0;
    $("orc-perc-margem").value = Number(o.perc_margem) || 0;
    $("orc-perc-imposto").value = Number(o.perc_imposto) || 0;
    orcDescontoModo = o.desconto_modo === "valor" ? "valor" : "percentual";
    $("orc-perc-desconto").value = Number(o.perc_desconto) || 0;
    $("orc-valor-desconto").value = Number(o.valor_desconto) || 0;
    orcCalcOrigem = "salvo";
    orcCalcSalvoEm = o.calculado_em || null;
    renderizarCalcOrcamento();
    return;
  }
  try {
    await aplicarCadastroNoCalculo();
    $("orc-perc-desconto").value = Number(o.perc_desconto) || 0;
    recalcularOrcamentoTela();
  } catch (e) {
    mostrarErro("orc-form-erro", "Não foi possível carregar os itens de custo do treinamento: " + (e?.message || "erro desconhecido"));
  }
}

function renderizarCalcOrcamento() {
  const th = "px-2 py-1.5 font-medium whitespace-nowrap";
  const cinza = "orc-det bg-slate-100";
  $("orc-calc-thead").innerHTML = `<tr class="bg-slate-50 text-left text-slate-500 uppercase tracking-wide text-[10px]">
    <th class="${th}">Item</th><th class="${th} text-right">Valor unit.</th><th class="${th}">Unidade</th><th class="${th} text-right">Qtde</th>
    <th class="${th} text-right">Valor do item</th><th class="${th}">Divisor</th><th class="${th}">Un. divisor</th><th class="${th} text-right">Múltiplo</th><th class="${th}">Imprime · ordem</th>
    <th class="${th} ${cinza} text-right">Qtde primária</th><th class="${th} ${cinza} text-right">Ref. divisor</th><th class="${th} ${cinza} text-right">Divisor</th><th class="${th} ${cinza} text-right">⌈Ref÷Div⌉</th><th class="${th} ${cinza} text-right">Multiplic.</th></tr>`;
  const corpo = $("orc-calc-tbody");
  if (orcLinhasCalc.length === 0) {
    const msg = (orcCalcCarregandoInicial || orcCalcPendentes > 0) ? "Carregando itens de custo…"
      : !$("orc-tipo").value ? "Selecione o treinamento para trazer os itens de custo."
      : "Este treinamento não tem itens de custo cadastrados (cadastre em Treinamentos → Itens de custo).";
    corpo.innerHTML = `<tr><td colspan="14" class="px-3 py-6 text-center text-slate-400">${msg}</td></tr>`;
    $("orc-calc-tfoot").innerHTML = "";
  } else {
    const campo = "w-24 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-xs";
    corpo.innerHTML = orcLinhasCalc.map((l) => {
      const manual = orcQtdDaBase(l.base_calculo, { alunosPorTurma: 0, turmas: 0, localidades: 0 }) == null;
      const trava = orcPropostaTravada ? " disabled" : "";
      return `<tr data-orc-linha="${l.chave}">
        <td class="px-2 py-1 font-semibold text-slate-800 whitespace-nowrap" title="${(l.descricao_impressao || "").replace(/"/g, "&quot;")}">${l.item}${l.opcional ? ` <span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">opcional</span>${orcPropostaTravada ? "" : ` <button type="button" data-orc-remover="${l.chave}" class="text-rose-500 hover:text-rose-700 text-xs" title="Tirar este item opcional do cálculo">✕</button>`}` : ""}</td>
        <td class="px-2 py-1 text-right whitespace-nowrap bg-amber-50"><input data-orc-campo="valor_unitario" type="number" min="0" step="0.01" value="${l.valor_unitario}" class="${campo}"${trava} /><span data-c="chg" class="text-amber-600 text-[10px] ml-1"></span></td>
        <td class="px-2 py-1 whitespace-nowrap"><span class="text-[11px] px-2 py-0.5 rounded-full ${manual ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}">${l.unidade_sigla || "—"}</span></td>
        <td class="px-2 py-1 text-right whitespace-nowrap ${manual ? "bg-amber-50" : ""}">${manual
          ? `<input data-orc-campo="qtd_manual" type="number" min="0" step="any" value="${l.qtd_manual}" class="w-20 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-xs"${trava} /><span data-c="qtd-extra" class="text-slate-400 text-[10px] ml-1"></span>`
          : `<span data-c="qtd"></span>`}</td>
        <td class="px-2 py-1 text-right font-semibold whitespace-nowrap" data-c="total"></td>
        <td class="px-2 py-1 whitespace-nowrap">${Number(l.divisor) > 0 ? fmtQtd(l.divisor) : "—"}</td>
        <td class="px-2 py-1 whitespace-nowrap">${Number(l.divisor) > 0 ? (l.unidade_divisor_sigla || "—") : "—"}</td>
        <td class="px-2 py-1 text-right">${Number(l.multiplo) !== 1 ? fmtQtd(l.multiplo) : "—"}</td>
        <td class="px-2 py-1 whitespace-nowrap bg-amber-50"><label class="inline-flex items-center gap-1 cursor-pointer"><input data-orc-campo="imprime" type="checkbox" ${l.imprime ? "checked" : ""}${trava} /> <span class="text-[11px] text-slate-600">imprime</span></label>
          <input data-orc-campo="ordem_impressao" type="number" min="0" step="1" value="${l.ordem_impressao ?? ""}" placeholder="ordem" title="Ordem de impressão na proposta" class="ml-1 w-16 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-xs"${trava} /></td>
        <td class="orc-det bg-slate-100 px-2 py-1 text-right" data-c="K"></td><td class="orc-det bg-slate-100 px-2 py-1 text-right" data-c="M"></td>
        <td class="orc-det bg-slate-100 px-2 py-1 text-right" data-c="N"></td><td class="orc-det bg-slate-100 px-2 py-1 text-right" data-c="O"></td>
        <td class="orc-det bg-slate-100 px-2 py-1 text-right" data-c="P"></td></tr>`;
    }).join("");
    $("orc-calc-tfoot").innerHTML = `<tr class="bg-slate-50 font-semibold"><td colspan="4" class="px-2 py-1.5 text-right">Custo da turma</td><td id="orc-calc-custo" class="px-2 py-1.5 text-right"></td><td colspan="9"></td></tr>`;
  }
  recalcularOrcamentoTela();
}

// Atualiza os números na tela sem refazer a tabela (não tira o foco do campo que está sendo digitado).
function recalcularOrcamentoTela() {
  const c = calcularOrcamento();
  $("orc-p-apt").textContent = c.q.alunos > 0 ? c.q.alunosPorTurma : "—";
  $("orc-p-turmas").textContent = c.q.turmas;
  $("orc-p-loc").textContent = c.q.localidades;
  c.itens.forEach((i) => {
    const tr = $("orc-calc-tbody").querySelector(`[data-orc-linha="${i.l.chave}"]`);
    if (!tr) return;
    const set = (k, v) => { const el = tr.querySelector(`[data-c="${k}"]`); if (el) el.textContent = v; };
    set("qtd", fmtQtd(i.Q));
    set("qtd-extra", i.Q !== i.K ? `→ ${fmtQtd(i.Q)}` : "");
    set("total", fmtBRL(i.total));
    set("K", fmtQtd(i.K)); set("M", fmtQtd(i.M)); set("N", fmtQtd(i.N)); set("O", fmtQtd(i.O)); set("P", fmtQtd(i.P));
    const mudou = Math.abs((Number(i.l.valor_unitario) || 0) - (Number(i.l.valor_cadastro) || 0)) > 0.0049;
    const chg = tr.querySelector('[data-c="chg"]');
    chg.textContent = mudou ? "✎" : "";
    chg.title = mudou ? `Valor no cadastro: ${fmtBRL(i.l.valor_cadastro)}` : "";
  });
  const custoEl = $("orc-calc-custo");
  if (custoEl) custoEl.textContent = fmtBRL(c.custo);
  const aviso = $("orc-r-aviso");
  aviso.classList.toggle("hidden", c.valido);
  if (!c.valido) aviso.textContent = "A soma de apoio, margem e imposto precisa ser menor que 100%.";
  $("orc-r-custo").textContent = fmtBRL(c.custo);
  $("orc-r-pct-custo").textContent = c.valido ? fmtPercOrc(c.pctCustoEfetivo * 100) : "—";
  $("orc-r-apoio").textContent = `${fmtBRL(c.apoioV)} · ${fmtPercOrc(c.apoio)}`;
  $("orc-r-imposto").textContent = `${fmtBRL(c.impostoV)} · ${fmtPercOrc(c.imposto)}`;
  $("orc-r-margem").textContent = c.margemMinimaAplicada
    ? `${fmtBRL(c.margemV)} · ${fmtPercOrc(c.margemEfetivaPerc)} (margem mínima de ${fmtBRL(c.minValor)} aplicada; pelo % seria ${fmtPercOrc(c.margem)})`
    : `${fmtBRL(c.margemV)} · ${fmtPercOrc(c.margem)}`;
  $("orc-r-turma").textContent = fmtBRL(c.valorTurma);
  $("orc-r-por-aluno").textContent = fmtBRL(c.porAluno);
  $("orc-r-qt").textContent = c.q.turmas;
  $("orc-r-total").textContent = fmtBRL(c.total);
  $("orc-r-desc-pct").textContent = Number(c.desconto).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  $("orc-r-desc").textContent = `− ${fmtBRL(c.valorDesc)}`;
  $("orc-r-final").textContent = fmtBRL(c.final);
  $("orc-r-final-aluno").textContent = fmtBRL(c.finalAluno);
  // o campo de desconto que o usuário NÃO está digitando mostra o valor calculado
  if (orcDescontoModo === "valor") {
    if (document.activeElement !== $("orc-perc-desconto")) $("orc-perc-desconto").value = r2(c.desconto);
  } else if (document.activeElement !== $("orc-valor-desconto")) {
    $("orc-valor-desconto").value = r2(c.valorDesc);
  }
  // margem final (depois do desconto) e aprovação do gestor
  const temCalc = c.itens.length > 0 && c.valido;
  $("orc-r-margem-final").textContent = temCalc ? `${fmtBRL(c.margemTurma)} · ${fmtPercOrc(c.margemPerc)}` : "—";
  $("orc-r-margem-total").textContent = temCalc ? fmtBRL(c.margemTotal) : "—";
  $("orc-r-margem-minima").textContent = (c.minPerc > 0 || c.minValor > 0)
    ? `Mínimo do treinamento: ${c.minPerc > 0 ? fmtPercOrc(c.minPerc) : "—"} · ${c.minValor > 0 ? fmtBRL(c.minValor) + " por turma" : "—"}`
    : "Treinamento sem margem mínima definida";
  ["orc-r-final", "orc-r-final-aluno", "orc-r-margem-final"].forEach((id) => {
    $(id).classList.toggle("text-rose-600", c.precisaAprovacao);
  });
  $("orc-r-margem-final").classList.toggle("font-semibold", c.precisaAprovacao);
  const avisoDesc = $("orc-r-aviso-desc");
  avisoDesc.classList.toggle("hidden", !c.descontoInvalido);
  if (c.descontoInvalido) avisoDesc.textContent = "O desconto não pode ser maior que o total do orçamento.";

  const origem = $("orc-calc-origem");
  origem.textContent = orcCalcOrigem === "salvo" ? "Itens e valores gravados neste orçamento"
    : orcCalcOrigem === "cadastro" ? "Itens e percentuais vindos do cadastro do treinamento"
    : "";
  const tag = $("orc-tag-calculo");
  tag.classList.remove("hidden", "bg-emerald-100", "text-emerald-700", "bg-amber-100", "text-amber-800");
  if (orcCalcOrigem === "salvo") {
    tag.classList.add("bg-emerald-100", "text-emerald-700");
    tag.textContent = orcCalcSalvoEm ? `Cálculo salvo em ${new Date(orcCalcSalvoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : "Cálculo salvo";
  } else if (orcCalcOrigem === "cadastro") {
    tag.classList.add("bg-amber-100", "text-amber-800");
    tag.textContent = "Cálculo ainda não salvo — será gravado ao salvar o orçamento";
  } else {
    tag.classList.add("hidden");
  }
  atualizarNotaDockTurmas();
  orcAtualizarAvisoProposta();
  orcAtualizarAbas();
}

$("orc-calc-tbody").addEventListener("input", (ev) => {
  const el = ev.target.closest("[data-orc-campo]");
  const tr = ev.target.closest("[data-orc-linha]");
  if (!el || !tr) return;
  const l = orcLinhasCalc.find((x) => x.chave === tr.getAttribute("data-orc-linha"));
  if (!l) return;
  const nome = el.getAttribute("data-orc-campo");
  if (nome === "imprime") l.imprime = el.checked;
  else if (nome === "ordem_impressao") l.ordem_impressao = el.value === "" ? null : Math.max(0, Math.floor(Number(el.value) || 0));
  else l[nome] = el.value === "" ? 0 : Number(el.value);
  recalcularOrcamentoTela();
});
$("orc-calc-tbody").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-orc-remover]");
  if (!b || orcPropostaTravada) return;
  orcLinhasCalc = orcLinhasCalc.filter((x) => x.chave !== b.getAttribute("data-orc-remover"));
  orcEditorSujo = true;
  renderizarCalcOrcamento();
});

// ---- Itens opcionais: itens de custo marcados como "opcional" que o usuário acrescenta neste orçamento ----
async function orcAbrirPainelOpcional() {
  if (orcPropostaTravada) return;
  const painel = $("orc-opcional-painel");
  const sel = $("orc-opcional-select");
  const msg = $("orc-opcional-msg");
  painel.classList.remove("hidden");
  msg.textContent = "Carregando…";
  sel.innerHTML = "";
  try {
    const refs = await orcCarregarRefsCalculo();
    const usados = new Set(orcLinhasCalc.map((l) => l.item_custo_id).filter(Boolean));
    const disp = refs.itens.filter((i) => i.opcional && i.status !== "Inativo" && !usados.has(i.id)).sort((a, b) => (a.item || "").localeCompare(b.item || "", "pt-BR"));
    sel.innerHTML = disp.map((i) => `<option value="${i.id}">${i.item} — ${fmtBRL(i.valor)}</option>`).join("");
    msg.textContent = disp.length ? "" : "Não há itens opcionais disponíveis (cadastre em Itens de Custo, marcando “Opcional”).";
    $("btn-orc-opcional-add").disabled = disp.length === 0;
  } catch (e) {
    msg.textContent = "Não foi possível carregar os itens opcionais.";
  }
}
async function orcAdicionarOpcional() {
  const itemId = $("orc-opcional-select").value;
  if (!itemId || orcPropostaTravada) return;
  const tipoId = $("orc-tipo").value;
  $("btn-orc-opcional-add").disabled = true;
  try {
    const [refs, vinc] = await Promise.all([
      orcCarregarRefsCalculo(),
      tipoId ? supabase.from("treinamento_itens_custo").select("*").eq("tipo_treinamento_id", tipoId).eq("item_custo_id", itemId).limit(1) : Promise.resolve({ data: [] }),
    ]);
    if (vinc.error) throw vinc.error;
    const it = refs.itens.find((x) => x.id === itemId);
    if (!it) throw new Error("item não encontrado");
    const v = (vinc.data || [])[0] || null; // se o treinamento já tem parâmetros para o item, usa os dele
    const unid = (id) => refs.unidades.find((u) => u.id === id) || null;
    const un = unid(it.unidade_medida_id);
    const ud = v && v.unidade_divisor_id ? unid(v.unidade_divisor_id) : null;
    const valor = Number(it.valor) || 0;
    const maiorOrdem = orcLinhasCalc.reduce((m, l) => Math.max(m, l.ordem_impressao != null ? Number(l.ordem_impressao) : 0), 0);
    orcLinhasCalc.push({
      chave: `c${++orcCalcSeq}`, item_custo_id: it.id, item: it.item, descricao_impressao: it.descricao_impressao || null,
      valor_cadastro: valor, valor_unitario: valor,
      unidade_sigla: un ? un.sigla : null, base_calculo: un ? un.base_calculo : null,
      divisor: v && v.divisor != null ? Number(v.divisor) : null, unidade_divisor_sigla: ud ? ud.sigla : null, base_divisor: ud ? ud.base_calculo : null,
      multiplo: v && Number(v.multiplo) > 0 ? Number(v.multiplo) : 1,
      imprime: v ? !!v.imprime : true,
      ordem_impressao: v && v.ordem_impressao != null ? Number(v.ordem_impressao) : maiorOrdem + 1,
      qtd_manual: 1, opcional: true,
    });
    orcEditorSujo = true;
    $("orc-opcional-painel").classList.add("hidden");
    renderizarCalcOrcamento();
  } catch (e) {
    $("orc-opcional-msg").textContent = "Não foi possível acrescentar o item: " + (e?.message || "erro desconhecido");
    $("btn-orc-opcional-add").disabled = false;
  }
}
$("btn-orc-opcional").addEventListener("click", orcAbrirPainelOpcional);
$("btn-orc-opcional-add").addEventListener("click", orcAdicionarOpcional);
$("btn-orc-opcional-fechar").addEventListener("click", () => $("orc-opcional-painel").classList.add("hidden"));
["apoio", "margem", "imposto"].forEach((k) => $("orc-perc-" + k).addEventListener("input", recalcularOrcamentoTela));
$("orc-perc-desconto").addEventListener("input", () => { orcDescontoModo = "percentual"; recalcularOrcamentoTela(); });
$("orc-valor-desconto").addEventListener("input", () => { orcDescontoModo = "valor"; recalcularOrcamentoTela(); });
$("orc-calc-detalhes").addEventListener("change", () => $("orc-calc-tabela").classList.toggle("mostrar-det", $("orc-calc-detalhes").checked));
$("btn-orc-restaurar").addEventListener("click", () => {
  const desconto = $("orc-perc-desconto").value, descontoValor = $("orc-valor-desconto").value;
  aplicarCadastroNoCalculo().then(() => { $("orc-perc-desconto").value = desconto; $("orc-valor-desconto").value = descontoValor; recalcularOrcamentoTela(); orcEditorSujo = true; })
    .catch((e) => mostrarErro("orc-form-erro", "Não foi possível carregar os itens de custo do treinamento: " + (e?.message || "erro desconhecido")));
});

// Grava as linhas do cálculo: insere as novas e só depois remove as antigas (nunca fica sem linhas se a gravação falhar).
async function salvarLinhasCalculoOrcamento(orcamentoId, calc) {
  const { data: antigas, error: e0 } = await supabase.from("orcamento_itens_custo").select("id").eq("orcamento_id", orcamentoId);
  if (e0) throw e0;
  const novas = calc.itens.map((i, idx) => ({
    orcamento_id: orcamentoId,
    item_custo_id: i.l.item_custo_id || null,
    ordem: idx,
    item: i.l.item,
    descricao_impressao: i.l.descricao_impressao || null,
    valor_cadastro: r2(i.l.valor_cadastro),
    valor_unitario: r2(i.l.valor_unitario),
    unidade_sigla: i.l.unidade_sigla || null,
    base_calculo: i.l.base_calculo || null,
    divisor: Number(i.l.divisor) > 0 ? Number(i.l.divisor) : null,
    unidade_divisor_sigla: Number(i.l.divisor) > 0 ? (i.l.unidade_divisor_sigla || null) : null,
    base_divisor: Number(i.l.divisor) > 0 ? (i.l.base_divisor || null) : null,
    multiplo: i.P,
    imprime: !!i.l.imprime,
    ordem_impressao: i.l.ordem_impressao != null ? i.l.ordem_impressao : null,
    opcional: !!i.l.opcional,
    qtd_manual: Number(i.l.qtd_manual) || 0,
    qtd_aplicavel: i.Q,
    valor_total: r2(i.total),
  }));
  if (novas.length) {
    const { error } = await supabase.from("orcamento_itens_custo").insert(novas);
    if (error) throw error;
  }
  const ids = (antigas || []).map((x) => x.id);
  if (ids.length) {
    const { error } = await supabase.from("orcamento_itens_custo").delete().in("id", ids);
    if (error) throw error;
  }
}

async function abrirNovoOrcamento() {
  const btn = $("btn-orc-novo");
  if (btn.disabled) return;
  btn.disabled = true;
  let falhasRefs = [];
  try { falhasRefs = await carregarReferenciasOrcamento(); } finally { btn.disabled = false; } // sempre busca as listas atuais no banco
  editandoOrcamentoId = null;
  orcEmpresaDoOrcamento = null;
  $("btn-orc-excluir-editor").classList.add("hidden");
  esconderErro("orc-form-erro");
  $("orc-numero").value = "";
  $("orc-numero").disabled = false;
  preencherSelectEmpresa("orc-empresa", listaEmpresasAtivas, "— Selecione —");
  $("orc-contato-nome").value = "";
  $("orc-contato-telefone").value = "";
  $("orc-contato-email").value = "";
  preencherSelect("orc-centro", listaCentrosAtivos, "id", (i) => i.nome, "— Selecione —");
  preencherSelect("orc-tipo", listaTiposAtivos, "id", (i) => i.nome, "— Selecione —");
  preencherSelect("orc-formato-teoria", FORMATOS_TEORIA.map((f) => ({ id: f, nome: f })), "id", (i) => i.nome, "— Selecione —");
  preencherSelect("orc-formato-pratica", FORMATOS_PRATICA.map((f) => ({ id: f, nome: f })), "id", (i) => i.nome, "— Selecione —");
  $("orc-qtd-turmas").value = "1";
  $("orc-qtd-localidades").value = "1";
  $("orc-qtd-alunos").value = "";
  $("orc-data").value = formatarData(new Date());
  $("orc-validade-dias").value = "";
  orcValidadeManual = false;
  orcPreencherPrazos(null);
  $("orc-status").value = "Aberto";
  $("orc-observacoes").value = "";
  $("orc-observacao-ct").value = "";
  resetarEnderecoOrc("teo");
  resetarEnderecoOrc("pra");
  resetarHorarioOrc();
  $("orc-pra-mesmo-teoria").checked = false;
  atualizarBlocosEnderecoInCompanyOrc();
  atualizarBlocoHorarioPraticaOrc();
  orcPropostas = [];
  orcPropostaTravada = false;
  limparCalculoOrcamento();
  atualizarQtdAlunosCalculado();
  orcAtualizarModoProposta();
  $("painel-orcamento-titulo").textContent = "Novo orçamento";
  $("orc-tag-numero").classList.add("hidden");
  $("btn-salvar-orcamento").textContent = "Salvar orçamento";
  abrirEditorOrcamento();
  if (falhasRefs.length) mostrarErro("orc-form-erro", `Não foi possível carregar: ${falhasRefs.join(", ")}. Clique no campo para tentar de novo ou verifique a conexão.`);
  carregarTabelaTurmasOrcamento(null);
}

async function abrirEdicaoOrcamento(id) {
  const o = listaOrcamentos.find((x) => x.id === id);
  if (!o) return;
  editandoOrcamentoId = id;
  esconderErro("orc-form-erro");
  const falhasRefs = await carregarReferenciasOrcamento(); // sempre busca as listas atuais no banco
  await garantirReferenciasDoOrcamento(o);
  await garantirEmpresaDoOrcamento(o);
  orcEmpresaDoOrcamento = o.empresa_id || null;
  $("orc-numero").value = o.numero || "";
  $("orc-numero").disabled = true; // número já definido não muda mais, evita conflito de unicidade
  preencherSelectEmpresa("orc-empresa", listaEmpresasAtivas, "— Selecione —");
  definirEmpresaSelect("orc-empresa", o.empresa_id);
  $("orc-contato-nome").value = o.contato_nome || "";
  $("orc-contato-telefone").value = o.contato_telefone || "";
  $("orc-contato-email").value = o.contato_email || "";
  preencherSelect("orc-centro", listaCentrosAtivos, "id", (i) => i.nome, "— Selecione —");
  $("orc-centro").value = o.centro_treinamento_id || "";
  preencherSelect("orc-tipo", listaTiposAtivos, "id", (i) => i.nome, "— Selecione —");
  $("orc-tipo").value = o.tipo_treinamento_id || "";
  preencherSelect("orc-formato-teoria", FORMATOS_TEORIA.map((f) => ({ id: f, nome: f })), "id", (i) => i.nome, "— Selecione —");
  $("orc-formato-teoria").value = o.formato_teoria || "";
  preencherSelect("orc-formato-pratica", FORMATOS_PRATICA.map((f) => ({ id: f, nome: f })), "id", (i) => i.nome, "— Selecione —");
  $("orc-formato-pratica").value = o.formato_pratica || "";
  $("orc-qtd-turmas").value = o.qtd_turmas || "";
  $("orc-qtd-localidades").value = o.qtd_localidades || 1;
  $("orc-qtd-alunos").value = o.qtd_alunos || ((Number(o.qtd_turmas) || 0) * (Number(o.qtd_alunos_por_turma) || 0)) || "";
  $("orc-data").value = o.data || "";
  {
    let dias = Number(o.validade_dias) || 0;
    if (!dias && o.validade && o.data) dias = Math.round((new Date(o.validade + "T00:00:00") - new Date(o.data + "T00:00:00")) / 86400000); // orçamentos antigos só tinham a data
    $("orc-validade-dias").value = dias > 0 ? dias : "";
    orcValidadeManual = dias > 0;
  }
  orcPreencherPrazos(o.prazo_pagamento_id);
  $("orc-status").value = o.status;
  $("orc-observacoes").value = o.observacoes || "";
  $("orc-observacao-ct").value = o.observacao_ct || "";
  preencherEnderecoOrc("teo", o, "teoria");
  preencherEnderecoOrc("pra", o, "pratica");
  preencherHorarioOrc(o);
  $("orc-pra-mesmo-teoria").checked = !!o.endereco_pratica_mesmo_teoria;
  atualizarBlocosEnderecoInCompanyOrc();
  atualizarBlocoHorarioPraticaOrc();
  orcPropostas = [];
  orcPropostaTravada = false;
  limparCalculoOrcamento(true);
  atualizarQtdAlunosCalculado();
  orcAtualizarModoProposta();
  // "Necessita dois instrutores" volta ao valor gravado (a regra automática só vale ao editar os números)
  $("orc-dois-instrutores").checked = !!o.necessita_dois_instrutores;
  $("painel-orcamento-titulo").textContent = "Editar orçamento";
  $("orc-tag-numero").textContent = o.numero || "";
  $("orc-tag-numero").classList.remove("hidden");
  $("btn-salvar-orcamento").textContent = "Salvar alterações";
  $("btn-orc-excluir-editor").classList.toggle("hidden", !usuarioEhAdmin());
  abrirEditorOrcamento();
  if (falhasRefs.length) mostrarErro("orc-form-erro", `Não foi possível carregar: ${falhasRefs.join(", ")}. Clique no campo para tentar de novo ou verifique a conexão.`);
  await Promise.all([
    carregarCalculoDoOrcamento(o).finally(() => { orcCalcCarregandoInicial = false; renderizarCalcOrcamento(); }),
    carregarTabelaTurmasOrcamento(id),
    carregarPropostasDoOrcamento(o),
  ]);
}

// Um dia só precisa de empresa de transporte quando o formato daquele dia
// exige deslocamento até um local físico (CT ou Móvel). InCompany/EAD (teoria)
// e InCompany/Móvel (prática, o instrutor já vai até o cliente ou é o próprio
// veículo) não precisam de transporte contratado.
function transporteAplicavel(t) {
  const teoriaSemTransporte = ["InCompany", "EAD", "EAD Síncrono"];
  const praticaSemTransporte = ["InCompany", "Móvel"];
  if (t.tipo_dia === "Teoria") return !teoriaSemTransporte.includes(t.formato_teoria);
  if (t.tipo_dia === "Prática") return !praticaSemTransporte.includes(t.formato_pratica);
  if (t.tipo_dia === "Teoria com Prática") {
    return !teoriaSemTransporte.includes(t.formato_teoria) || !praticaSemTransporte.includes(t.formato_pratica);
  }
  return true;
}

// Rodapé do editor: navegação pelas turmas do orçamento (A, B, C…). Cada turma mostra os seus dias;
// Data, Instrutor 1, Instrutor 2 e Empresa de Transporte (ou "N/A" quando o formato do dia não exige
// deslocamento) são editáveis aqui e gravam automaticamente ao alterar.
let orcTurmasGrupos = [];   // [{ letra, linhas }]
let orcTurmasRef = { instrutores: [], transportadoras: [] };

function agruparTurmasOrcamento(turmas) {
  const mapa = new Map();
  turmas.forEach((t) => {
    const m = /^([A-Za-z]+)(\d+)$/.exec(t.identificacao || "");
    const letra = m ? m[1].toUpperCase() : "—";
    if (!mapa.has(letra)) mapa.set(letra, []);
    mapa.get(letra).push({ t, n: m ? Number(m[2]) : 0 });
  });
  return [...mapa.entries()]
    .sort((a, b) => a[0].length - b[0].length || a[0].localeCompare(b[0]))
    .map(([letra, itens]) => ({ letra, linhas: itens.sort((a, b) => a.n - b.n).map((x) => x.t) }));
}

let orcTurmasOrcId = null;
async function carregarTabelaTurmasOrcamento(orcamentoId) {
  if (orcTurmasOrcId !== orcamentoId) { orcTurmasOrcId = orcamentoId; orcTurmasPagina = 1; }
  if (!orcamentoId) {
    orcTurmasGrupos = [];
    renderizarDockTurmas("As turmas são geradas automaticamente quando você salvar o orçamento.");
    return;
  }
  const [{ data }, { data: insts }, { data: transportadoras }] = await Promise.all([
    supabase.from("turmas").select("*").eq("orcamento_id", orcamentoId).order("identificacao"),
    supabase.from("instrutores").select("*").eq("status", "Ativo").order("nome"),
    supabase.from("empresas_transporte").select("*").eq("status", "Ativo").order("nome"),
  ]);
  listaInstrutoresAtivos = insts || [];
  orcTurmasRef = { instrutores: insts || [], transportadoras: transportadoras || [] };
  orcTurmasGrupos = agruparTurmasOrcamento(data || []);
  renderizarDockTurmas("Este orçamento ainda não tem turmas geradas.");
}

const ORC_TURMAS_TAMANHO_PAGINA = 10;
let orcTurmasPagina = 1;
const orcTurmasListaPlana = () => orcTurmasGrupos.flatMap((g) => g.linhas);

function atualizarNotaDockTurmas() {
  const nota = $("orc-turmas-nota");
  if (!nota) return;
  orcAtualizarAbas();
  if (orcTurmasGrupos.length === 0) { nota.textContent = ""; return; }
  const c = calcularOrcamento();
  nota.textContent = `${orcTurmasGrupos.length} turma(s) · ${orcTurmasListaPlana().length} dia(s)` +
    (c.q.alunos > 0 ? ` · ${c.q.alunosPorTurma} alunos por turma` : "") +
    (orcLinhasCalc.length && c.valido ? ` · valor da turma ${fmtBRL(c.valorTurma)}` : "");
}

function irParaPaginaTurmasOrc(p) {
  orcTurmasPagina = p;
  renderizarDockTurmas();
}

function renderizarDockTurmas(msgVazio) {
  const bloco = $("orc-turmas-bloco");
  const corpo = $("orc-turmas-tbody");
  const vazio = $("orc-turmas-vazio");
  const lista = orcTurmasListaPlana();
  if (lista.length === 0) {
    bloco.classList.add("hidden");
    corpo.innerHTML = "";
    $("orc-turmas-pag-topo").classList.add("hidden");
    $("orc-turmas-pag").classList.add("hidden");
    vazio.textContent = msgVazio || "";
    vazio.classList.remove("hidden");
    atualizarNotaDockTurmas();
    return;
  }
  vazio.classList.add("hidden");
  bloco.classList.remove("hidden");
  const totalPaginas = Math.max(1, Math.ceil(lista.length / ORC_TURMAS_TAMANHO_PAGINA));
  orcTurmasPagina = Math.min(Math.max(1, orcTurmasPagina), totalPaginas);
  renderizarPaginadores(["orc-turmas-pag-topo", "orc-turmas-pag"], orcTurmasPagina, lista.length, ORC_TURMAS_TAMANHO_PAGINA, "orcturma", irParaPaginaTurmasOrc);
  const pagina = lista.slice((orcTurmasPagina - 1) * ORC_TURMAS_TAMANHO_PAGINA, orcTurmasPagina * ORC_TURMAS_TAMANHO_PAGINA);

  const corTipoDia = { "Teoria": "bg-blue-50 text-blue-700", "Prática": "bg-amber-50 text-amber-700", "Teoria com Prática": "bg-purple-50 text-purple-700" };
  const corAgend = { "Agendado": "bg-emerald-50 text-emerald-700", "Aguardando confirmação": "bg-amber-50 text-amber-700" };
  const opcoesInstrutor = (val) => `<option value="">—</option>` + orcTurmasRef.instrutores.map((i) => `<option value="${i.id}" ${i.id === val ? "selected" : ""}>${i.nome}</option>`).join("");
  const opcoesTransporte = (val) => `<option value="">—</option>` + orcTurmasRef.transportadoras.map((e) => `<option value="${e.id}" ${e.id === val ? "selected" : ""}>${e.nome}</option>`).join("");
  const campoCls = "w-full text-xs rounded-md border border-slate-300 px-2 py-1";
  corpo.innerHTML = pagina.map((t) => `
    <tr data-turma-linha="${t.id}">
      <td class="px-2 py-1 font-mono text-slate-500">${t.identificacao || "—"}</td>
      <td class="px-2 py-1">${t.tipo_dia ? `<span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${corTipoDia[t.tipo_dia] || ""}">${t.tipo_dia}</span>` : "—"}</td>
      <td class="px-2 py-1"><input type="date" data-turma-campo="data_inicio" value="${t.data_inicio || ""}" class="${campoCls}" /></td>
      <td class="px-2 py-1"><select data-turma-campo="instrutor1_id" class="${campoCls}">${opcoesInstrutor(t.instrutor1_id)}</select></td>
      <td class="px-2 py-1"><select data-turma-campo="instrutor2_id" class="${campoCls}">${opcoesInstrutor(t.instrutor2_id)}</select></td>
      <td class="px-2 py-1">${transporteAplicavel(t)
        ? `<select data-turma-campo="empresa_transporte_id" class="${campoCls}">${opcoesTransporte(t.empresa_transporte_id)}</select>`
        : `<span class="text-slate-400">N/A</span>`}</td>
      <td class="px-2 py-1 whitespace-nowrap"><span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${corAgend[t.status_agendamento] || "bg-slate-100 text-slate-500"}">${t.status_agendamento || "Não agendado"}</span></td>
    </tr>`).join("");

  corpo.querySelectorAll("[data-turma-campo]").forEach((el) => {
    el.addEventListener("change", async (e) => {
      const linha = e.target.closest("[data-turma-linha]");
      const turmaId = linha.getAttribute("data-turma-linha");
      const campo = e.target.getAttribute("data-turma-campo");
      const valor = e.target.value || null;
      const t = orcTurmasListaPlana().find((x) => x.id === turmaId);
      if (t) t[campo] = valor;
      await supabase.from("turmas").update({ [campo]: valor }).eq("id", turmaId);
    });
  });
  atualizarNotaDockTurmas();
}

$("btn-orc-novo").addEventListener("click", abrirNovoOrcamento);
$("btn-orc-excluir-editor").addEventListener("click", () => {
  if (editandoOrcamentoId) excluirOrcamento(editandoOrcamentoId, $("orc-tag-numero").textContent);
});
$("btn-cancelar-painel-orcamento").addEventListener("click", () => { sairEditorOrcamentoPermitido(); });

// Mostra o erro e leva o usuário à aba onde está o campo com problema.
function orcFalha(aba, msg) {
  if (aba && orcAbaAtiva !== aba) irParaAbaOrc(aba);
  return mostrarErro("orc-form-erro", msg);
}

// opts.gerandoProposta: salva para em seguida gerar a proposta (mantém o editor aberto e devolve { linha, calc }).
async function salvarOrcamento(opts = {}) {
  if (opts instanceof Event) opts = {};
  esconderErro("orc-form-erro");
  const numero = $("orc-numero").value.trim();
  // Em edição o cliente do orçamento não pode ficar em branco: se o seletor perdeu o valor, restaura o gravado.
  if (editandoOrcamentoId && orcEmpresaDoOrcamento && !$("orc-empresa").value) {
    await garantirEmpresaDoOrcamento({ empresa_id: orcEmpresaDoOrcamento });
    definirEmpresaSelect("orc-empresa", orcEmpresaDoOrcamento);
  }
  const empresaId = $("orc-empresa").value;
  const centroId = $("orc-centro").value;
  const tipoId = $("orc-tipo").value;
  const qtdTurmas = Number($("orc-qtd-turmas").value) || 0;
  const qtdLocalidades = Math.floor(Number($("orc-qtd-localidades").value) || 0);
  if (!numero) return orcFalha(1, "Informe o número do orçamento.");
  if (!empresaId) return orcFalha(1, "Selecione a empresa.");
  if (!centroId) return orcFalha(1, "Selecione o centro de treinamento.");
  if (!tipoId) return orcFalha(1, "Selecione o treinamento.");
  if (qtdTurmas < 1) return orcFalha(1, "Informe a quantidade de turmas (mínimo 1).");
  if (qtdLocalidades < 1) return orcFalha(1, "Informe a quantidade de localidades do cliente onde os alunos vão treinar (mínimo 1).");
  const qtdAlunos = Math.floor(Number($("orc-qtd-alunos").value) || 0);
  if (qtdAlunos < 1) return orcFalha(1, "Informe a quantidade de alunos (mínimo 1).");
  if (orcCalcPendentes > 0) return orcFalha(2, "Aguarde: os itens de custo ainda estão sendo carregados.");
  if (orcCalcErro) return orcFalha(2, orcCalcErro);
  const calc = calcularOrcamento();
  if (calc.descontoInvalido) return orcFalha(2, "O desconto não pode ser maior que o total do orçamento.");
  for (const [v, rot] of [[calc.apoio, "% de apoio"], [calc.margem, "% de margem"], [calc.imposto, "% de imposto"], [calc.desconto, "% de desconto"]]) {
    if (!(v >= 0 && v <= 100)) return orcFalha(2, `${rot}: informe um valor entre 0 e 100.`);
  }
  if (orcLinhasCalc.length && !calc.valido) return orcFalha(2, "No cálculo, a soma de apoio, margem e imposto precisa ser menor que 100%.");

  const teoriaInCompany = $("orc-formato-teoria").value === "InCompany";
  const praticaInCompany = $("orc-formato-pratica").value === "InCompany";
  const praticaSincronizada = teoriaInCompany && praticaInCompany && $("orc-pra-mesmo-teoria").checked;
  if (teoriaInCompany) {
    const erroEnderecoTeoria = validarEnderecoInCompanyOrc("teo", "teoria");
    if (erroEnderecoTeoria) return orcFalha(1, erroEnderecoTeoria);
  }
  if (praticaInCompany && !praticaSincronizada) {
    const erroEnderecoPratica = validarEnderecoInCompanyOrc("pra", "prática");
    if (erroEnderecoPratica) return orcFalha(1, erroEnderecoPratica);
  }

  const enderecoVazio = { mesmo_empresa: false, cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null, latitude: null, longitude: null };
  // coletarEnderecoOrc georreferencia (se ainda não tiver coordenadas) antes de retornar —
  // garante que o orçamento nunca seja salvo com um endereço in-company sem lat/long.
  const enderecoTeoria = teoriaInCompany ? await coletarEnderecoOrc("teo") : enderecoVazio;
  let enderecoPratica = { mesmo_teoria: false, ...enderecoVazio };
  if (praticaInCompany) {
    enderecoPratica = praticaSincronizada
      ? { mesmo_teoria: true, ...enderecoTeoria }
      : { mesmo_teoria: false, ...(await coletarEnderecoOrc("pra")) };
  }

  // Garante um horário de início preenchido sempre que houver formato definido,
  // mesmo que a troca de formato não tenha rodado (ex.: valor carregado de fora).
  if (!$("orc-horario-teoria").value && $("orc-formato-teoria").value) {
    $("orc-horario-teoria").value = horarioDefaultPorFormato($("orc-formato-teoria").value);
  }
  if (!praticaSincronizada && !$("orc-horario-pratica").value && $("orc-formato-pratica").value) {
    $("orc-horario-pratica").value = horarioDefaultPorFormato($("orc-formato-pratica").value);
  }
  const horarioInicioTeoria = $("orc-horario-teoria").value || null;
  const horarioInicioPratica = praticaSincronizada ? horarioInicioTeoria : ($("orc-horario-pratica").value || null);

  const qtdAlunosPorTurma = Math.ceil(qtdAlunos / Math.max(1, qtdTurmas));
  const validadeTxt = $("orc-validade-dias").value.trim();
  const validadeDias = validadeTxt === "" ? null : Math.floor(Number(validadeTxt));
  if (validadeDias != null && !(validadeDias >= 1 && validadeDias <= 3650)) return orcFalha(1, "Validade: informe de 1 a 3650 dias.");
  let validadeData = null;
  if (validadeDias != null && $("orc-data").value) {
    const dv = new Date($("orc-data").value + "T00:00:00");
    dv.setDate(dv.getDate() + validadeDias);
    validadeData = formatarData(dv);
  }
  const contatoEmail = $("orc-contato-email").value.trim();
  // aceita mais de um e-mail no mesmo campo (separados por vírgula ou ponto e vírgula)
  if (contatoEmail && !contatoEmail.split(/[;,]/).map((x) => x.trim()).filter(Boolean).every((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))) return orcFalha(1, "O e-mail do contato parece inválido. Se houver mais de um, separe por vírgula.");
  const payload = {
    empresa_id: empresaId,
    contato_nome: $("orc-contato-nome").value.trim() || null,
    contato_telefone: $("orc-contato-telefone").value.trim() || null,
    contato_email: contatoEmail || null,
    centro_treinamento_id: centroId,
    tipo_treinamento_id: tipoId,
    formato_teoria: $("orc-formato-teoria").value || null,
    formato_pratica: $("orc-formato-pratica").value || null,
    qtd_turmas: qtdTurmas,
    qtd_localidades: qtdLocalidades,
    qtd_alunos_por_turma: qtdAlunosPorTurma || null,
    qtd_alunos: qtdAlunos,
    perc_apoio: calc.apoio,
    perc_margem: calc.margem,
    perc_imposto: calc.imposto,
    perc_desconto: r2(calc.desconto),
    desconto_modo: orcDescontoModo,
    ...(orcLinhasCalc.length ? {
      custo_turma: r2(calc.custo), valor_turma: r2(calc.valorTurma), valor_total: r2(calc.total), valor_desconto: r2(calc.valorDesc),
      valor_final: r2(calc.final), valor_por_aluno: r2(calc.porAluno), valor_final_aluno: r2(calc.finalAluno), calculado_em: new Date().toISOString(),
      margem_final_valor: r2(calc.margemTurma), margem_final_perc: r2(calc.margemPerc),
      margem_minima_perc: calc.minPerc, margem_minima_valor: r2(calc.minValor), requer_aprovacao_gestor: calc.precisaAprovacao,
    } : {
      custo_turma: null, valor_turma: null, valor_total: null, valor_desconto: null, valor_final: null, valor_por_aluno: null, valor_final_aluno: null, calculado_em: null,
      margem_final_valor: null, margem_final_perc: null, margem_minima_perc: null, margem_minima_valor: null, requer_aprovacao_gestor: false,
    }),
    necessita_dois_instrutores: $("orc-dois-instrutores").checked,
    data: $("orc-data").value || null,
    validade: validadeData,
    validade_dias: validadeDias,
    prazo_pagamento_id: $("orc-prazo").value || null,
    proposta_em_elaboracao: false,
    status: $("orc-status").value,
    observacoes: $("orc-observacoes").value.trim(),
    observacao_ct: $("orc-observacao-ct").value.trim() || null,
    horario_inicio_teoria: horarioInicioTeoria,
    horario_inicio_pratica: horarioInicioPratica,
    endereco_teoria_mesmo_empresa: enderecoTeoria.mesmo_empresa,
    endereco_teoria_cep: enderecoTeoria.cep,
    endereco_teoria_logradouro: enderecoTeoria.logradouro,
    endereco_teoria_numero: enderecoTeoria.numero,
    endereco_teoria_complemento: enderecoTeoria.complemento,
    endereco_teoria_bairro: enderecoTeoria.bairro,
    endereco_teoria_cidade: enderecoTeoria.cidade,
    endereco_teoria_uf: enderecoTeoria.uf,
    endereco_teoria_latitude: enderecoTeoria.latitude,
    endereco_teoria_longitude: enderecoTeoria.longitude,
    endereco_pratica_mesmo_teoria: enderecoPratica.mesmo_teoria,
    endereco_pratica_mesmo_empresa: enderecoPratica.mesmo_empresa,
    endereco_pratica_cep: enderecoPratica.cep,
    endereco_pratica_logradouro: enderecoPratica.logradouro,
    endereco_pratica_numero: enderecoPratica.numero,
    endereco_pratica_complemento: enderecoPratica.complemento,
    endereco_pratica_bairro: enderecoPratica.bairro,
    endereco_pratica_cidade: enderecoPratica.cidade,
    endereco_pratica_uf: enderecoPratica.uf,
    endereco_pratica_latitude: enderecoPratica.latitude,
    endereco_pratica_longitude: enderecoPratica.longitude,
  };
  if (!editandoOrcamentoId) payload.numero = numero;

  $("btn-salvar-orcamento").disabled = true;
  $("btn-salvar-orcamento").textContent = "Salvando…";

  let linha, erro;
  if (editandoOrcamentoId) {
    ({ data: linha, error: erro } = await supabase.from("orcamentos").update(payload).eq("id", editandoOrcamentoId).select().single());
  } else {
    ({ data: linha, error: erro } = await supabase.from("orcamentos").insert(payload).select().single());
  }

  if (erro) {
    $("btn-salvar-orcamento").disabled = false;
    $("btn-salvar-orcamento").textContent = editandoOrcamentoId ? "Salvar alterações" : "Salvar orçamento";
    if (erro.message && erro.message.includes("duplicate")) {
      return orcFalha(1, "Já existe um orçamento com esse número.");
    }
    return mostrarErro("orc-form-erro", "Não foi possível salvar. Tente novamente.");
  }

  $("btn-salvar-orcamento").disabled = false;

  // Grava as linhas do cálculo (itens de custo copiados do treinamento, com os valores deste orçamento).
  const eraNovo = !editandoOrcamentoId;
  let erroCalculo = null;
  try {
    await salvarLinhasCalculoOrcamento(linha.id, calc);
    orcCalcOrigem = orcLinhasCalc.length ? "salvo" : "vazio";
    orcCalcSalvoEm = linha.calculado_em || null;
  } catch (e) {
    erroCalculo = e?.message || "erro desconhecido";
  }
  orcEditorSujo = false;

  if (eraNovo) {
    await gerarTurmasParaOrcamento(linha, qtdTurmas);
    // Mantém o painel aberto, já em modo edição, para preencher a tabela de turmas geradas.
    editandoOrcamentoId = linha.id;
    $("orc-numero").disabled = true;
    $("painel-orcamento-titulo").textContent = "Editar orçamento";
    $("orc-tag-numero").textContent = linha.numero || "";
    $("orc-tag-numero").classList.remove("hidden");
    $("btn-salvar-orcamento").textContent = "Salvar alterações";
    recalcularOrcamentoTela();
    await carregarTabelaTurmasOrcamento(linha.id);
    await carregarPaginaOrcamentos();
    orcAtualizarModoProposta();
    if (erroCalculo) { mostrarErro("orc-form-erro", `Orçamento salvo, mas o cálculo não foi gravado: ${erroCalculo}. Clique em "Salvar alterações" para tentar de novo.`); return null; }
    return { linha, calc };
  }

  if (erroCalculo) {
    $("btn-salvar-orcamento").textContent = "Salvar alterações";
    await carregarPaginaOrcamentos();
    mostrarErro("orc-form-erro", `Orçamento salvo, mas o cálculo não foi gravado: ${erroCalculo}. Clique em "Salvar alterações" para tentar de novo.`);
    return null;
  }

  if (opts.gerandoProposta) {
    $("btn-salvar-orcamento").textContent = "Salvar alterações";
    await carregarPaginaOrcamentos();
    return { linha, calc };
  }
  fecharEditorOrcamento();
  await carregarPaginaOrcamentos();
  return { linha, calc };
}

$("btn-salvar-orcamento").addEventListener("click", () => salvarOrcamento());

// =====================================================================
// PROPOSTA COMERCIAL do orçamento
//  - cada "Gerar proposta" grava um instantâneo (orcamento_propostas.dados) e gera o PDF;
//  - nº da proposta = nº do orçamento + data + hora (ex.: 4080-20261005-1432);
//  - com proposta gerada o cálculo fica bloqueado; "Nova proposta" libera para alterar e gerar outra versão.
// =====================================================================
const CAMPOS_TRAVA_PROPOSTA = ["orc-tipo", "orc-qtd-alunos", "orc-qtd-turmas", "orc-qtd-localidades", "orc-perc-apoio", "orc-perc-margem", "orc-perc-imposto", "orc-perc-desconto", "orc-valor-desconto", "orc-prazo", "orc-validade-dias", "btn-orc-restaurar", "btn-orc-opcional"];

function orcPreencherPrazos(selecionado) {
  const sel = $("orc-prazo");
  const lista = orcPrazosPagamento.filter((p) => p.status !== "Inativo" || p.id === selecionado);
  sel.innerHTML = `<option value="">— Selecione —</option>` + lista.map((p) => `<option value="${p.id}">${p.descricao}${p.status === "Inativo" ? " (inativo)" : ""}</option>`).join("");
  sel.value = selecionado || "";
}

const PROPOSTA_CAMPOS = "id, numero, versao, valor_final, gerado_por, created_at, status, requer_aprovacao, margem_final_valor, margem_final_perc, margem_minima_perc, margem_minima_valor, aprovado_em, aprovado_por, justificativa_aprovacao, invalidada_em, invalidada_por, motivo_invalidacao";
const escHtmlOrc = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const propostaVigente = () => orcPropostas.find((p) => p.status !== "Inválida") || null; // a proposta Válida (só pode haver uma)
const usuarioPodeAprovar = () => !!usuarioSistemaAtual && (usuarioSistemaAtual.role === "admin" || !!usuarioSistemaAtual.aprovador_comercial);
// Marca d'água do PDF de uma proposta gravada: "NÃO APROVADA" enquanto exigir aprovação do gestor e não a tiver.
const marcaDaProposta = (p) => (p && p.requer_aprovacao && !p.aprovado_em ? "NÃO APROVADA" : null);

async function carregarPropostasDoOrcamento(o) {
  const { data, error } = await supabase.from("orcamento_propostas")
    .select(PROPOSTA_CAMPOS)
    .eq("orcamento_id", o.id).order("created_at", { ascending: false });
  if (error) {
    orcPropostas = [];
    orcPropostaTravada = false;
    mostrarErro("orc-form-erro", "Não foi possível carregar as propostas deste orçamento: " + (error.message || "erro desconhecido"));
  } else {
    orcPropostas = data || [];
    orcPropostaTravada = !!propostaVigente();
  }
  orcAtualizarModoProposta();
  renderizarCalcOrcamento();
}

function orcAtualizarModoProposta() {
  const tem = orcPropostas.length > 0;
  const trav = orcPropostaTravada;
  $("btn-orc-nova-proposta").classList.toggle("hidden", !(editandoOrcamentoId && trav));
  $("btn-orc-gerar-proposta").classList.toggle("hidden", trav);
  $("btn-orc-previa").classList.toggle("hidden", trav);
  $("btn-orc-gerar-proposta").disabled = orcGerandoProposta;
  $("btn-orc-previa").disabled = orcGerandoProposta;
  CAMPOS_TRAVA_PROPOSTA.forEach((id) => {
    const el = $(id);
    el.disabled = trav;
    el.classList.toggle("opacity-50", trav);
    el.classList.toggle("cursor-not-allowed", trav);
  });
  if (trav) $("orc-opcional-painel").classList.add("hidden");
  $("orc-proposta-faixa").classList.toggle("hidden", !tem);
  orcAtualizarAprovacao();
  if (!tem) return;
  const v = propostaVigente();
  const u = v || orcPropostas[0];
  $("orc-proposta-texto").textContent = (v ? "Proposta válida" : "Última proposta (inválida)")
    + `: nº ${u.numero} · versão ${u.versao} · gerada em ${formatarDataHoraBr(u.created_at)}${u.gerado_por ? " por " + u.gerado_por : ""} · ${fmtBRL(u.valor_final)}`
    + (v ? " · itens bloqueados (use “Nova negociação” para alterar)" : " · em negociação: gere uma nova proposta");
  const hist = $("orc-proposta-hist");
  hist.innerHTML = orcPropostas.map((p) => `<div class="flex items-center gap-3 py-0.5 flex-wrap"><span class="font-mono">${escHtmlOrc(p.numero)}</span><span>v${p.versao}</span><span>${formatarDataHoraBr(p.created_at)}</span><span>${escHtmlOrc(p.gerado_por || "")}</span><span class="font-semibold">${fmtBRL(p.valor_final)}</span><span class="${p.status === "Inválida" ? "text-slate-500" : "text-emerald-700 font-medium"}">${p.status === "Inválida" ? "Inválida" : "Válida"}</span><button type="button" data-prop-pdf="${p.id}" class="underline hover:text-amber-700">⬇ PDF</button></div>`).join("");
  orcAtualizarAvisoProposta();
}

function orcAtualizarAvisoProposta() {
  const av = $("orc-proposta-aviso");
  if (!orcPropostas.length) { av.classList.add("hidden"); return; }
  let msg = "";
  const v = propostaVigente();
  if (!v) msg = "Nova negociação em andamento — as alterações valem para a próxima proposta.";
  else if (orcLinhasCalc.length && Math.abs(calcularOrcamento().final - Number(v.valor_final || 0)) > 0.01) msg = "O valor deste orçamento difere da proposta válida.";
  av.textContent = msg;
  av.classList.toggle("hidden", !msg);
}

// ---- Aprovação do gestor (aba 4), selo do cabeçalho e aviso do cálculo ----
// Estado: a aprovação fica vinculada à PROPOSTA válida (que guarda o cálculo e a margem do momento em que foi gerada).
function orcAtualizarAprovacao(c) {
  if (!$("orc-apr-estado")) return;
  c = c || calcularOrcamento();
  const v = propostaVigente();
  const tag = $("orc-tag-aprovacao");
  const bd4 = $("orc-aba-bd-4");
  const est = $("orc-apr-estado");
  const caixaCor = (cl) => { est.className = "rounded-md border px-3 py-2 text-sm " + cl; };
  const margens = $("orc-apr-margens");
  const form = $("orc-apr-form");
  const feito = $("orc-apr-feito");
  margens.classList.add("hidden"); form.classList.add("hidden"); feito.classList.add("hidden");
  tag.classList.remove("bg-rose-100", "text-rose-700", "bg-emerald-100", "text-emerald-700", "bg-amber-100", "text-amber-800");
  bd4.classList.remove("bg-rose-100", "text-rose-700", "bg-emerald-100", "text-emerald-700");

  // aviso na aba de cálculo (valor ao vivo, antes de gerar proposta)
  const aviso = $("orc-aviso-aprovacao");
  const mostrarAviso = c.precisaAprovacao && !v;
  aviso.classList.toggle("hidden", !mostrarAviso);
  if (mostrarAviso) {
    const motivos = [];
    if (c.abaixoPerc) motivos.push(`${fmtPercOrc(c.margemPerc)} (mínimo ${fmtPercOrc(c.minPerc)})`);
    if (c.abaixoValor) motivos.push(`${fmtBRL(c.margemTurma)} por turma (mínimo ${fmtBRL(c.minValor)})`);
    $("orc-aviso-aprovacao-texto").textContent = `Este orçamento precisa de aprovação do gestor: a margem final depois do desconto está abaixo do mínimo do treinamento — ${motivos.join(" e ")}. Gere a proposta e peça a aprovação na aba “Aprovação do gestor”; a proposta sai com a marca d'água NÃO APROVADA até lá.`;
  }

  if (!v) {
    if (c.precisaAprovacao) {
      tag.textContent = "⚠ Margem abaixo do mínimo — precisa de aprovação";
      tag.classList.add("bg-rose-100", "text-rose-700"); tag.classList.remove("hidden");
      caixaCor("border-amber-200 bg-amber-50 text-amber-900");
      est.innerHTML = `A margem calculada está abaixo do mínimo do treinamento. A aprovação do gestor é feita <b>depois que a proposta for gerada</b> (o botão “Gerar proposta” grava o cálculo), e fica vinculada àquela proposta.`;
    } else {
      tag.classList.add("hidden");
      caixaCor("border-slate-200 bg-slate-50 text-slate-600");
      est.textContent = orcPropostas.length
        ? "Não há proposta válida (negociação em andamento). Gere uma nova proposta; se a margem ficar abaixo do mínimo, ela precisará de aprovação."
        : "Ainda não há proposta gerada. A aprovação do gestor só é necessária quando a margem da proposta fica abaixo do mínimo do treinamento.";
    }
    bd4.classList.add("hidden");
  } else if (!v.requer_aprovacao) {
    tag.classList.add("hidden"); bd4.classList.add("hidden");
    caixaCor("border-emerald-200 bg-emerald-50 text-emerald-800");
    est.innerHTML = `A proposta <b>${escHtmlOrc(v.numero)}</b> está dentro da margem mínima do treinamento: não precisa de aprovação do gestor.`;
  } else if (v.aprovado_em) {
    tag.textContent = "✔ Proposta aprovada pelo gestor"; tag.classList.add("bg-emerald-100", "text-emerald-700"); tag.classList.remove("hidden");
    bd4.textContent = "✔ aprovada"; bd4.classList.add("bg-emerald-100", "text-emerald-700"); bd4.classList.remove("hidden");
    caixaCor("border-emerald-200 bg-emerald-50 text-emerald-800");
    est.innerHTML = `A proposta <b>${escHtmlOrc(v.numero)}</b> foi aprovada com a margem abaixo do mínimo.`;
    margens.classList.remove("hidden");
    feito.classList.remove("hidden");
    feito.innerHTML = `<p><b>Aprovada por ${escHtmlOrc(v.aprovado_por || "—")}</b> em ${formatarDataHoraBr(v.aprovado_em)}</p><p class="text-xs uppercase tracking-wide text-emerald-700 mt-1">Justificativa</p><p class="whitespace-pre-wrap">${escHtmlOrc(v.justificativa_aprovacao || "")}</p>`;
  } else {
    tag.textContent = "⏳ Aguardando aprovação do gestor"; tag.classList.add("bg-rose-100", "text-rose-700"); tag.classList.remove("hidden");
    bd4.textContent = "⏳ pendente"; bd4.classList.add("bg-rose-100", "text-rose-700"); bd4.classList.remove("hidden");
    caixaCor("border-rose-300 bg-rose-50 text-rose-800");
    est.innerHTML = `A proposta <b>${escHtmlOrc(v.numero)}</b> tem margem abaixo do mínimo do treinamento e <b>ainda não foi aprovada</b>. O PDF dela sai com a marca d'água “NÃO APROVADA”.`;
    margens.classList.remove("hidden");
    if (usuarioPodeAprovar()) form.classList.remove("hidden");
    else est.innerHTML += `<br><span class="text-xs">Somente o administrador ou um aprovador comercial pode aprovar.</span>`;
  }

  if (v && v.requer_aprovacao) {
    const card = (rot, val, sub) => `<div class="rounded-md border border-slate-200 px-3 py-2"><p class="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">${rot}</p><p class="text-sm font-semibold text-slate-800">${val}</p>${sub ? `<p class="text-[11px] text-slate-500">${sub}</p>` : ""}</div>`;
    margens.innerHTML =
      card("Valor final da proposta", fmtBRL(v.valor_final), "") +
      card("Margem final (por turma)", `${fmtBRL(v.margem_final_valor)} · ${fmtPercOrc(v.margem_final_perc)}`, "depois do desconto") +
      card("Mínimo do treinamento", `${Number(v.margem_minima_perc) > 0 ? fmtPercOrc(v.margem_minima_perc) : "—"} · ${Number(v.margem_minima_valor) > 0 ? fmtBRL(v.margem_minima_valor) : "—"}`, "% e R$ por turma");
  }

  // histórico de propostas e aprovações
  const hist = $("orc-apr-hist");
  if (!orcPropostas.length) { hist.innerHTML = `<p class="text-xs text-slate-400">Nenhuma proposta gerada ainda.</p>`; return; }
  hist.innerHTML = `<table class="w-full text-xs"><thead><tr class="text-slate-500 text-left"><th class="px-2 py-1 font-medium">Proposta</th><th class="px-2 py-1 font-medium">Situação</th><th class="px-2 py-1 font-medium text-right">Valor final</th><th class="px-2 py-1 font-medium">Margem</th><th class="px-2 py-1 font-medium">Aprovação do gestor</th><th class="px-2 py-1 font-medium">Invalidada</th></tr></thead><tbody>` +
    orcPropostas.map((p) => {
      const inval = p.status === "Inválida";
      const apr = !p.requer_aprovacao ? `<span class="text-slate-400">não necessária</span>`
        : p.aprovado_em ? `<span class="text-emerald-700">✔ ${escHtmlOrc(p.aprovado_por || "")} · ${formatarDataHoraBr(p.aprovado_em)}</span><div class="text-slate-500 whitespace-pre-wrap">${escHtmlOrc(p.justificativa_aprovacao || "")}</div>`
        : `<span class="${inval ? "text-slate-500" : "text-rose-600"}">${inval ? "não aprovada" : "⏳ pendente"}</span>`;
      const inv = inval ? `${formatarDataHoraBr(p.invalidada_em)}${p.invalidada_por ? " · " + escHtmlOrc(p.invalidada_por) : ""}<div class="text-slate-500 whitespace-pre-wrap">${escHtmlOrc(p.motivo_invalidacao || "")}</div>` : "";
      return `<tr class="border-t border-slate-100 align-top"><td class="px-2 py-1.5"><span class="font-mono">${escHtmlOrc(p.numero)}</span> <span class="text-slate-400">v${p.versao}</span></td><td class="px-2 py-1.5 ${inval ? "text-slate-500" : "text-emerald-700 font-medium"}">${inval ? "Inválida" : "Válida"}</td><td class="px-2 py-1.5 text-right whitespace-nowrap">${fmtBRL(p.valor_final)}</td><td class="px-2 py-1.5 whitespace-nowrap">${p.margem_final_perc != null ? fmtPercOrc(p.margem_final_perc) : "—"}</td><td class="px-2 py-1.5">${apr}</td><td class="px-2 py-1.5">${inv}</td></tr>`;
    }).join("") + `</tbody></table>`;
}

$("btn-orc-aprovar").addEventListener("click", async () => {
  const v = propostaVigente();
  const erro = $("orc-apr-erro");
  erro.classList.add("hidden");
  if (!v || !v.requer_aprovacao || v.aprovado_em) return;
  if (!usuarioPodeAprovar()) { erro.textContent = "Somente o administrador ou um aprovador comercial pode aprovar propostas."; erro.classList.remove("hidden"); return; }
  const just = $("orc-apr-justificativa").value.trim();
  if (just.length < 5) { erro.textContent = "Descreva a justificativa da aprovação (mínimo de 5 caracteres)."; erro.classList.remove("hidden"); return; }
  const btn = $("btn-orc-aprovar");
  btn.disabled = true;
  try {
    const campos = { aprovado_em: new Date().toISOString(), aprovado_por: usuarioSistemaAtual.nome, aprovado_por_id: usuarioSistemaAtual.id, justificativa_aprovacao: just };
    const { data, error } = await supabase.from("orcamento_propostas").update(campos).eq("id", v.id).is("aprovado_em", null).is("invalidada_em", null).select(PROPOSTA_CAMPOS).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("a proposta não está mais válida ou já foi aprovada — recarregue o orçamento");
    orcPropostas = orcPropostas.map((p) => (p.id === v.id ? { ...p, ...data } : p));
    $("orc-apr-justificativa").value = "";
    orcAtualizarModoProposta();
    await carregarPaginaOrcamentos();
  } catch (e) {
    erro.textContent = "Não foi possível aprovar: " + (e?.message || "erro desconhecido");
    erro.classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
});

// ---- Nova negociação: invalida a proposta válida (guardando o motivo) e libera os itens ----
function abrirModalNovaNegociacao() {
  const v = propostaVigente();
  if (!v) return;
  $("neg-proposta-numero").textContent = v.numero;
  $("neg-motivo").value = "";
  $("neg-erro").classList.add("hidden");
  $("modal-nova-negociacao").classList.remove("hidden");
  setTimeout(() => $("neg-motivo").focus(), 30);
}
function fecharModalNovaNegociacao() { $("modal-nova-negociacao").classList.add("hidden"); }
$("btn-orc-nova-proposta").addEventListener("click", abrirModalNovaNegociacao);
$("btn-neg-cancelar").addEventListener("click", fecharModalNovaNegociacao);
$("btn-neg-confirmar").addEventListener("click", async () => {
  const v = propostaVigente();
  const erro = $("neg-erro");
  erro.classList.add("hidden");
  if (!v) return fecharModalNovaNegociacao();
  const motivo = $("neg-motivo").value.trim();
  if (motivo.length < 3) { erro.textContent = "Informe por que a proposta precisa ser alterada."; erro.classList.remove("hidden"); return; }
  const btn = $("btn-neg-confirmar");
  btn.disabled = true;
  try {
    const campos = { status: "Inválida", motivo_invalidacao: motivo, invalidada_em: new Date().toISOString(), invalidada_por: usuarioSistemaAtual ? usuarioSistemaAtual.nome : null };
    const { data, error } = await supabase.from("orcamento_propostas").update(campos).eq("id", v.id).eq("status", "Válida").select(PROPOSTA_CAMPOS).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("a proposta já não está válida — recarregue o orçamento");
    orcPropostas = orcPropostas.map((p) => (p.id === v.id ? { ...p, ...data } : p));
    orcPropostaTravada = !!propostaVigente();
    fecharModalNovaNegociacao();
    orcAtualizarModoProposta();
    renderizarCalcOrcamento();
    await carregarPaginaOrcamentos();
  } catch (e) {
    erro.textContent = "Não foi possível iniciar a nova negociação: " + (e?.message || "erro desconhecido");
    erro.classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
});
$("btn-orc-proposta-hist").addEventListener("click", () => $("orc-proposta-hist").classList.toggle("hidden"));
$("btn-orc-proposta-pdf").addEventListener("click", () => { if (orcPropostas[0]) baixarPropostaPdf(orcPropostas[0].id); });
$("orc-proposta-hist").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-prop-pdf]");
  if (b) baixarPropostaPdf(b.getAttribute("data-prop-pdf"));
});

function baixarBlobArquivo(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function baixarPropostaPdf(id) {
  esconderErro("orc-form-erro");
  try {
    const { data, error } = await supabase.from("orcamento_propostas").select("numero, dados, requer_aprovacao, aprovado_em").eq("id", id).single();
    if (error || !data) throw error || new Error("proposta não encontrada");
    // a marca d'água acompanha a situação ATUAL da aprovação (gera "NÃO APROVADA" até o gestor aprovar)
    const blob = await gerarPdfProposta(data.dados, { marca: marcaDaProposta(data) });
    baixarBlobArquivo(blob, `Proposta ${data.numero}.pdf`);
  } catch (e) {
    mostrarErro("orc-form-erro", "Não foi possível gerar o PDF: " + (e?.message || "erro desconhecido"));
  }
}

// Itens que vão impressos: marcados em "Imprime", na ordem de impressão deste orçamento, sem descrição "N/A".
function itensParaImpressaoProposta(itens) {
  return itens
    .map((i, idx) => ({ i, idx }))
    .filter(({ i }) => i.imprime)
    .sort((a, b) => (a.i.ordem_impressao ?? 1e9) - (b.i.ordem_impressao ?? 1e9) || a.idx - b.idx)
    .map(({ i }) => String(i.descricao_impressao || i.item || "").trim())
    .filter((t) => t && !/^(n\/?a|-|—)$/i.test(t));
}

function numeroDaProposta(numeroOrc, agora, comSegundos) {
  const p = pad2;
  return `${numeroOrc}-${agora.getFullYear()}${p(agora.getMonth() + 1)}${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}${comSegundos ? p(agora.getSeconds()) : ""}`;
}

// Parcelas do prazo de pagamento aplicadas ao total geral (a última absorve a diferença de centavos).
function parcelasDaProposta(prazo, total) {
  const ps = prazo && Array.isArray(prazo.parcelas) ? prazo.parcelas : [];
  if (!ps.length) return [];
  let acum = 0;
  return ps.map((p, i) => {
    const perc = Number(p.percentual);
    const valor = i === ps.length - 1 ? r2(total - acum) : r2(total * perc / 100);
    acum = r2(acum + valor);
    return { numero: p.numero, dias: p.dias, percentual: perc, valor };
  });
}

function montarDadosProposta(linha, calc, agora, numero, versao) {
  const emp = listaEmpresasAtivas.find((e) => e.id === linha.empresa_id) || {};
  const ct = listaCentrosAtivos.find((c) => c.id === linha.centro_treinamento_id) || {};
  const tipo = listaTiposAtivos.find((t) => t.id === linha.tipo_treinamento_id) || {};
  const prazo = orcPrazosPagamento.find((p) => p.id === linha.prazo_pagamento_id) || null;
  const dias = Number(linha.validade_dias) || 0;
  const ate = new Date(agora.getTime());
  ate.setDate(ate.getDate() + dias);
  const itens = calc.itens.map((i) => ({
    item: i.l.item, descricao_impressao: i.l.descricao_impressao || null, imprime: !!i.l.imprime, ordem_impressao: i.l.ordem_impressao ?? null,
    opcional: !!i.l.opcional, valor_unitario: r2(i.l.valor_unitario), qtd_aplicavel: i.Q, valor_total: r2(i.total),
  }));
  return {
    proposta_numero: numero, versao, orcamento_numero: linha.numero,
    gerada_em: agora.toISOString(), gerado_por: usuarioSistemaAtual ? usuarioSistemaAtual.nome : null,
    empresa: { id: emp.id || null, nome: emp.nome || "" },
    contato: { nome: linha.contato_nome || "", telefone: linha.contato_telefone || "", email: linha.contato_email || "" },
    centro: { id: ct.id || null, nome: ct.nome || "", cidade: ct.cidade || "", endereco: ct.endereco || "", rodape_pagina: ct.texto_rodape_pagina || "", logotipo_esquerdo: ct.logotipo_esquerdo || null, logotipo_direito: ct.logotipo_direito || null },
    treinamento: { id: tipo.id || null, nome: tipo.nome || "", descricao_impressao: tipo.descricao_impressao || "", rodape: tipo.rodape || "" },
    quantidades: { alunos: calc.q.alunos, turmas: calc.q.turmas, alunos_por_turma: calc.q.alunosPorTurma, localidades: calc.q.localidades },
    percentuais: { apoio: calc.apoio, margem: calc.margem, imposto: calc.imposto, desconto: r2(calc.desconto), desconto_modo: orcDescontoModo },
    calculo: {
      custo_turma: r2(calc.custo), valor_turma: r2(calc.valorTurma), valor_total: r2(calc.total), valor_desconto: r2(calc.valorDesc),
      valor_final: r2(calc.final), valor_final_turma: r2(calc.finalTurma), valor_final_aluno: r2(calc.finalAluno),
      margem_final_valor: r2(calc.margemTurma), margem_final_perc: r2(calc.margemPerc), requer_aprovacao_gestor: calc.precisaAprovacao,
      margem_minima_perc: calc.minPerc, margem_minima_valor: r2(calc.minValor),
    },
    itens,
    itens_impressao: itensParaImpressaoProposta(itens),
    prazo_pagamento: prazo ? prazo.descricao : "",
    parcelas: parcelasDaProposta(prazo, r2(calc.final)),
    validade_dias: dias, validade_ate: formatarData(ate),
    data_impressao: formatarData(agora),
  };
}

async function gerarPropostaOrcamento() {
  if (orcGerandoProposta || orcPropostaTravada) return;
  esconderErro("orc-form-erro");
  if (!$("orc-prazo").value) return orcFalha(1, "Selecione o prazo de pagamento da proposta.");
  const dias = Math.floor(Number($("orc-validade-dias").value) || 0);
  if (!(dias >= 1)) return orcFalha(1, "Informe a validade da proposta em dias.");
  const previa = calcularOrcamento();
  if (!previa.itens.length) return orcFalha(2, "Não há itens de custo no cálculo para gerar a proposta.");
  if (itensParaImpressaoProposta(previa.itens.map((i) => i.l)).length === 0) return orcFalha(2, "Marque ao menos um item do cálculo para imprimir (coluna “Imprime”), com descrição para impressão.");
  orcGerandoProposta = true;
  const btn = $("btn-orc-gerar-proposta");
  btn.disabled = true; btn.textContent = "Gerando…";
  try {
    const r = await salvarOrcamento({ gerandoProposta: true });
    if (!r) return; // erro já exibido
    const { linha, calc } = r;
    const agora = new Date();
    const versao = orcPropostas.reduce((m, p) => Math.max(m, p.versao || 0), 0) + 1;
    let gravada = null, blob = null, dados = null;
    for (let tent = 0; tent < 2 && !gravada; tent++) {
      const numero = numeroDaProposta(linha.numero, agora, tent > 0);
      dados = montarDadosProposta(linha, calc, agora, numero, versao);
      blob = await gerarPdfProposta(dados, { marca: calc.precisaAprovacao ? "NÃO APROVADA" : null }); // se o PDF falhar, nada é gravado
      const { data, error } = await supabase.from("orcamento_propostas").insert({
        orcamento_id: linha.id, numero, versao, valor_final: dados.calculo.valor_final,
        gerado_por: dados.gerado_por, dados, status: "Válida",
        requer_aprovacao: !!calc.precisaAprovacao,
        margem_final_valor: dados.calculo.margem_final_valor, margem_final_perc: dados.calculo.margem_final_perc,
        margem_minima_perc: dados.calculo.margem_minima_perc, margem_minima_valor: dados.calculo.margem_minima_valor,
      }).select(PROPOSTA_CAMPOS).single();
      if (!error) { gravada = data; break; }
      if (/valida_uq/i.test(error.message || "")) throw new Error("já existe uma proposta válida para este orçamento (gerada por outro usuário). Feche e reabra o orçamento.");
      if (!(error.code === "23505" || /duplicate/i.test(error.message || ""))) throw error;
    }
    if (!gravada) throw new Error("não foi possível numerar a proposta");
    orcPropostas = [gravada, ...orcPropostas];
    orcPropostaTravada = true;
    orcEditorSujo = false;
    orcAtualizarModoProposta();
    renderizarCalcOrcamento();
    baixarBlobArquivo(blob, `Proposta ${gravada.numero}.pdf`);
    if (gravada.requer_aprovacao) irParaAbaOrc(4);
  } catch (e) {
    mostrarErro("orc-form-erro", "Não foi possível gerar a proposta: " + (e?.message || "erro desconhecido"));
  } finally {
    orcGerandoProposta = false;
    btn.textContent = "📄 Gerar proposta";
    orcAtualizarModoProposta();
  }
}
$("btn-orc-gerar-proposta").addEventListener("click", gerarPropostaOrcamento);

// Prévia: PDF de rascunho (marca d'água "EM ELABORAÇÃO"), sem gravar proposta nem o orçamento.
async function gerarPreviaProposta() {
  if (orcGerandoProposta || orcPropostaTravada) return;
  esconderErro("orc-form-erro");
  if (!$("orc-empresa").value) return orcFalha(1, "Selecione a empresa para gerar a prévia.");
  if (!$("orc-tipo").value) return orcFalha(1, "Selecione o treinamento para gerar a prévia.");
  if (!$("orc-prazo").value) return orcFalha(1, "Selecione o prazo de pagamento da proposta.");
  const dias = Math.floor(Number($("orc-validade-dias").value) || 0);
  if (!(dias >= 1)) return orcFalha(1, "Informe a validade da proposta em dias.");
  const calc = calcularOrcamento();
  if (!calc.itens.length || !calc.valido) return orcFalha(2, "Não há cálculo válido para gerar a prévia.");
  if (itensParaImpressaoProposta(calc.itens.map((i) => i.l)).length === 0) return orcFalha(2, "Marque ao menos um item do cálculo para imprimir (coluna “Imprime”), com descrição para impressão.");
  orcGerandoProposta = true;
  const btn = $("btn-orc-previa");
  btn.disabled = true; btn.textContent = "Gerando…";
  try {
    const agora = new Date();
    const numeroOrc = $("orc-numero").value.trim() || "novo";
    const linha = {
      numero: numeroOrc, empresa_id: $("orc-empresa").value, contato_nome: $("orc-contato-nome").value.trim(), contato_telefone: $("orc-contato-telefone").value.trim(),
      contato_email: $("orc-contato-email").value.trim(), centro_treinamento_id: $("orc-centro").value || null, tipo_treinamento_id: $("orc-tipo").value,
      prazo_pagamento_id: $("orc-prazo").value, validade_dias: dias,
    };
    const versao = orcPropostas.reduce((m, p) => Math.max(m, p.versao || 0), 0) + 1;
    const dados = montarDadosProposta(linha, calc, agora, `${numeroOrc}-PREVIA`, versao);
    const blob = await gerarPdfProposta(dados, { marca: "EM ELABORAÇÃO" });
    baixarBlobArquivo(blob, `Previa orcamento ${numeroOrc}.pdf`);
  } catch (e) {
    mostrarErro("orc-form-erro", "Não foi possível gerar a prévia: " + (e?.message || "erro desconhecido"));
  } finally {
    orcGerandoProposta = false;
    btn.textContent = "👁 Prévia";
    orcAtualizarModoProposta();
  }
}
$("btn-orc-previa").addEventListener("click", gerarPreviaProposta);

// ---------------------------------------------------------------------
// PDF da proposta (jsPDF carregado sob demanda)
// ---------------------------------------------------------------------
let jsPdfPromise = null;
function carregarJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!jsPdfPromise) {
    jsPdfPromise = new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js";
      sc.onload = () => (window.jspdf && window.jspdf.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error("gerador de PDF indisponível")));
      sc.onerror = () => { jsPdfPromise = null; reject(new Error("não foi possível carregar o gerador de PDF (verifique a conexão)")); };
      document.head.appendChild(sc);
    });
  }
  return jsPdfPromise;
}
function infoImagemPdf(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) return resolve(null);
    const im = new Image();
    im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => resolve(null);
    im.src = dataUrl;
  });
}
// A fonte padrão do PDF cobre o alfabeto latino (acentos do português); o resto vira um equivalente simples.
const pdfTxt = (t) => String(t == null ? "" : t).replace(/\r\n?/g, "\n").replace(/→/g, "->").replace(/[✓✔]/g, "v").replace(/[^\n\x20-\x7E\xA0-\xFF–—‘-„•…€]/g, "");
const dataBrDeIso = (s) => (s ? String(s).slice(0, 10).split("-").reverse().join("/") : "");

async function gerarPdfProposta(d, opts = {}) {
  const JsPDF = await carregarJsPdf();
  const doc = new JsPDF({ unit: "mm", format: "a4", compress: true });
  const W = 210, H = 297, M = 17, CW = W - 2 * M, BASE = H - 26;
  const INK = [31, 41, 55], ACC = [194, 65, 12], MUT = [107, 114, 128], LINE = [226, 228, 232], SOFT = [248, 247, 244], BRANCO = [255, 255, 255];
  const cor = (c) => doc.setTextColor(c[0], c[1], c[2]);
  const preenche = (c) => doc.setFillColor(c[0], c[1], c[2]);
  const traco = (c, w) => { doc.setDrawColor(c[0], c[1], c[2]); doc.setLineWidth(w || 0.2); };
  let y = M;
  const novaPagina = () => { doc.addPage(); y = 26; };
  const garantir = (h) => { if (y + h > BASE) novaPagina(); };
  const fonte = (estilo, tam) => { doc.setFont("helvetica", estilo); doc.setFontSize(tam); };
  const quebra = (txt, larg) => doc.splitTextToSize(pdfTxt(txt), larg);

  // Cabeçalho: logotipos do Centro de Treinamento (esquerdo e direito)
  const ct = d.centro || {};
  const [infoE, infoD] = await Promise.all([infoImagemPdf(ct.logotipo_esquerdo), infoImagemPdf(ct.logotipo_direito)]);
  const caixaLogo = (dataUrl, info, x, alinharDireita) => {
    const maxW = 58, maxH = 20;
    if (!dataUrl || !info) return;
    const esc = Math.min(maxW / info.w, maxH / info.h);
    const w = info.w * esc, h = info.h * esc;
    const fmt = /^data:image\/jpe?g/i.test(dataUrl) ? "JPEG" : "PNG";
    doc.addImage(dataUrl, fmt, alinharDireita ? x + maxW - w : x, y + (maxH - h) / 2, w, h);
  };
  caixaLogo(ct.logotipo_esquerdo, infoE, M, false);
  caixaLogo(ct.logotipo_direito, infoD, W - M - 58, true);
  if (!infoE && !infoD && ct.nome) { fonte("bold", 13); cor(INK); doc.text(pdfTxt(ct.nome).toUpperCase(), M, y + 9); }
  y += 23;
  traco(LINE, 0.3); doc.line(M, y, W - M, y);
  traco(ACC, 1); doc.line(M, y, M + 26, y);
  y += 9;

  // Título e local/data
  fonte("bold", 19); cor(INK);
  doc.text("PROPOSTA COMERCIAL", M, y, { charSpace: 0.9 });
  const cidadeData = [pdfTxt(ct.cidade), dataBrDeIso(d.data_impressao)].filter(Boolean).join(", ");
  fonte("normal", 9.5); cor(MUT);
  doc.text(cidadeData, W - M, y, { align: "right" });
  y += 7;

  // Painel do cliente (esquerda) + identificação da proposta (direita)
  const hPainel = 33, wDir = 56, wEsq = CW - wDir - 5;
  preenche(SOFT); doc.roundedRect(M, y, wEsq, hPainel, 2, 2, "F");
  const rotulo = (txt, x, yy) => { fonte("bold", 6.8); cor(MUT); doc.text(txt, x, yy, { charSpace: 0.4 }); };
  const valor = (txt, x, yy, larg, tam) => { fonte("normal", tam || 9.5); cor(INK); const l = quebra(txt || "—", larg)[0] || "—"; doc.text(l, x, yy); };
  rotulo("EMPRESA", M + 5, y + 6);
  fonte("bold", 11); cor(INK); doc.text(quebra(d.empresa.nome || "—", wEsq - 10)[0], M + 5, y + 11.5);
  rotulo("CONTATO", M + 5, y + 18); valor(d.contato.nome, M + 5, y + 23, wEsq / 2 - 8);
  rotulo("FONE", M + wEsq / 2 + 2, y + 18); valor(d.contato.telefone, M + wEsq / 2 + 2, y + 23, wEsq / 2 - 8);
  rotulo("E-MAIL", M + 5, y + 28.5); valor(d.contato.email, M + 5, y + 32, wEsq - 10, 9);
  const xd = W - M - wDir;
  preenche(BRANCO); traco(ACC, 0.5); doc.roundedRect(xd, y, wDir, hPainel, 2, 2, "S");
  rotulo("PROPOSTA Nº", xd + 5, y + 6); fonte("bold", 11); cor(ACC); doc.text(pdfTxt(d.proposta_numero), xd + 5, y + 12);
  rotulo("ORÇAMENTO Nº", xd + 5, y + 19); fonte("bold", 11); cor(INK); doc.text(pdfTxt(d.orcamento_numero), xd + 5, y + 25);
  fonte("normal", 8); cor(MUT); doc.text(`Versão ${d.versao}`, xd + 5, y + 30.5);
  y += hPainel + 7;

  // Parágrafo de abertura (cadastro do treinamento)
  const paragrafo = (txt, tam, justificar, corTxt, lead) => {
    fonte("normal", tam); cor(corTxt || INK);
    const entrelinha = lead || tam * 0.5;
    String(txt).split(/\n/).forEach((par) => {
      if (!par.trim()) { y += entrelinha * 0.6; return; }
      const rotuloSozinho = /^[A-ZÀ-Ý][A-ZÀ-Ý \/-]{3,}:\s*$/.test(par.trim());
      if (rotuloSozinho) { fonte("bold", tam); cor(ACC); } else { fonte("normal", tam); cor(corTxt || INK); }
      const linhas = quebra(par, CW);
      linhas.forEach((ln, idx) => {
        garantir(entrelinha);
        const ultima = idx === linhas.length - 1;
        if (justificar && !ultima && ln.includes(" ")) doc.text(ln, M, y, { align: "justify", maxWidth: CW });
        else doc.text(ln, M, y);
        y += entrelinha;
      });
    });
  };
  const abertura = (d.treinamento.descricao_impressao || "").trim() || `Apresentamos nossa proposta para ${d.treinamento.nome}, conforme segue:`;
  paragrafo(abertura, 10, true, INK, 5);
  y += 4;

  // Escopo: itens numerados (sem valores de custo)
  garantir(20);
  fonte("bold", 8); cor(ACC); doc.text("ESCOPO DA PROPOSTA", M, y, { charSpace: 0.8 });
  traco(LINE, 0.3); doc.line(M + 50, y - 1, W - M, y - 1);
  y += 6;
  (d.itens_impressao || []).forEach((txt, idx) => {
    fonte("normal", 9.5);
    const linhas = quebra(txt, CW - 10);
    const hItem = Math.max(7, linhas.length * 4.6 + 2.2);
    garantir(hItem);
    preenche(ACC); doc.circle(M + 3, y + 0.4, 3, "F");
    fonte("bold", 8); cor(BRANCO); doc.text(String(idx + 1), M + 3, y + 1.8, { align: "center" });
    fonte("normal", 9.5); cor(INK);
    linhas.forEach((ln, k) => doc.text(ln, M + 10, y + 1.3 + k * 4.6));
    y += hItem;
    if (idx < d.itens_impressao.length - 1) { traco(LINE, 0.2); doc.line(M + 10, y - 2.9, W - M, y - 2.9); }
  });
  y += 4;

  // Valores
  garantir(50);
  const hVal = 31;
  preenche(INK); doc.roundedRect(M, y, CW, hVal, 2.5, 2.5, "F");
  fonte("normal", 9.5); cor([209, 213, 219]); doc.text("TOTAL POR GRUPO", M + 7, y + 10, { charSpace: 0.5 });
  fonte("bold", 13); cor(BRANCO); doc.text(pdfTxt(fmtBRL(d.calculo.valor_final_turma)), W - M - 7, y + 10.5, { align: "right" });
  traco([75, 85, 99], 0.3); doc.line(M + 7, y + 15, W - M - 7, y + 15);
  fonte("bold", 10); cor([251, 146, 60]); doc.text("TOTAL GERAL", M + 7, y + 25, { charSpace: 0.5 });
  fonte("bold", 19); cor(BRANCO); doc.text(pdfTxt(fmtBRL(d.calculo.valor_final)), W - M - 7, y + 26, { align: "right" });
  y += hVal + 4;

  const cel = [
    ["QUANTIDADE DE GRUPOS", String(d.quantidades.turmas)],
    ["PARTICIPANTES POR GRUPO", String(d.quantidades.alunos_por_turma)],
    ["TOTAL DE PARTICIPANTES", String(d.quantidades.alunos)],
  ];
  const wc = (CW - 6) / 3;
  cel.forEach(([rot, v], k) => {
    const x = M + k * (wc + 3);
    preenche(SOFT); doc.roundedRect(x, y, wc, 14, 2, 2, "F");
    rotulo(rot, x + 4, y + 5.5); fonte("bold", 12); cor(INK); doc.text(v, x + 4, y + 11.5);
  });
  y += 20;

  // Condições comerciais
  garantir(22);
  const wm = (CW - 3) / 2;
  [["PRAZO DE PAGAMENTO", d.prazo_pagamento || "—"], ["VALIDADE DA PROPOSTA", `${d.validade_dias} dias${d.validade_ate ? " (até " + dataBrDeIso(d.validade_ate) + ")" : ""}`]].forEach(([rot, v], k) => {
    const x = M + k * (wm + 3);
    traco(LINE, 0.3); doc.roundedRect(x, y, wm, 15, 2, 2, "S");
    rotulo(rot, x + 4, y + 5.5); fonte("bold", 10.5); cor(INK); doc.text(quebra(v, wm - 8)[0], x + 4, y + 11.5);
  });
  y += 22;

  // Parcelas do prazo de pagamento (só quando há mais de uma parcela ou prazo após o faturamento)
  const parc = Array.isArray(d.parcelas) ? d.parcelas : [];
  if (parc.length && (parc.length > 1 || parc.some((x) => Number(x.dias) > 0))) {
    garantir(18 + parc.length * 6.2);
    fonte("bold", 8); cor(ACC); doc.text("PARCELAS", M, y, { charSpace: 0.8 });
    traco(LINE, 0.3); doc.line(M + 24, y - 1, W - M, y - 1);
    y += 3;
    preenche(SOFT); doc.roundedRect(M, y, CW, 6.2, 1.2, 1.2, "F");
    const cx = [M + 4, M + 30, M + 100, W - M - 4];
    fonte("bold", 6.8); cor(MUT);
    doc.text("PARCELA", cx[0], y + 4.1, { charSpace: 0.4 });
    doc.text("VENCIMENTO", cx[1], y + 4.1, { charSpace: 0.4 });
    doc.text("PERCENTUAL", cx[2], y + 4.1, { charSpace: 0.4 });
    doc.text("VALOR", cx[3], y + 4.1, { align: "right", charSpace: 0.4 });
    y += 6.2;
    parc.forEach((x, k) => {
      fonte("normal", 9.5); cor(INK);
      doc.text(`${x.numero}ª`, cx[0], y + 4.4);
      doc.text(Number(x.dias) === 0 ? "À vista" : `${x.dias} dias após o faturamento`, cx[1], y + 4.4);
      doc.text(`${Number(x.percentual).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`, cx[2], y + 4.4);
      fonte("bold", 9.5); doc.text(pdfTxt(fmtBRL(x.valor)), cx[3], y + 4.4, { align: "right" });
      y += 6.2;
      if (k < parc.length - 1) { traco(LINE, 0.2); doc.line(M, y, W - M, y); }
    });
    y += 8;
  }

  // Esclarecimento / rodapé do treinamento + assinatura
  const rodape = (d.treinamento.rodape || "").trim();
  if (rodape) paragrafo(rodape, 9, true, [55, 65, 81], 4.4);
  garantir(34);
  y += 4;
  if (!/atenciosamente/i.test(rodape)) { fonte("normal", 10); cor(INK); doc.text("Atenciosamente,", M, y); y += 4; }
  y += 12;
  traco(INK, 0.3); doc.line(M, y, M + 62, y);
  y += 5;
  fonte("bold", 10); cor(INK); doc.text(pdfTxt(d.gerado_por || "").toUpperCase(), M, y);
  y += 4.6;
  fonte("normal", 8.5); cor(MUT); doc.text(pdfTxt(ct.nome || ""), M, y);

  // Rodapé e cabeçalho de continuação em todas as páginas
  const total = doc.getNumberOfPages();
  const textoRodape = (ct.rodape_pagina || "").trim() || [ct.nome, ct.endereco].filter(Boolean).join(" - ");
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    if (p > 1) {
      fonte("bold", 8); cor(MUT); doc.text(`PROPOSTA ${pdfTxt(d.proposta_numero)}`, M, 14, { charSpace: 0.4 });
      fonte("normal", 8); doc.text(pdfTxt(d.empresa.nome || ""), W - M, 14, { align: "right" });
      traco(LINE, 0.3); doc.line(M, 17, W - M, 17);
    }
    traco(LINE, 0.3); doc.line(M, H - 19, W - M, H - 19);
    fonte("normal", 7); cor(MUT);
    const linhasRod = quebra(textoRodape, CW).slice(0, 3);
    linhasRod.forEach((ln, k) => doc.text(ln, W / 2, H - 15 + k * 3.1, { align: "center" }));
    fonte("normal", 7);
    doc.text(`Proposta ${pdfTxt(d.proposta_numero)}`, M, H - 5);
    doc.text(`Página ${p} de ${total}`, W - M, H - 5, { align: "right" });
  }

  // Marca d'água diagonal em todas as páginas (NÃO APROVADA / EM ELABORAÇÃO)
  if (opts.marca) {
    const texto = pdfTxt(opts.marca);
    const ang = 55, rad = (ang * Math.PI) / 180;
    const cor3 = /ELABORA/i.test(texto) ? [71, 85, 105] : [220, 38, 38];
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.17 }));
      doc.setFont("helvetica", "bold");
      doc.setFontSize(100);
      const w100 = doc.getTextWidth(texto);               // largura em mm com 100pt
      const alvo = 235;                                    // comprimento desejado ao longo da diagonal (mm)
      const tam = Math.min(100, (100 * alvo) / w100);
      doc.setFontSize(tam);
      const w = doc.getTextWidth(texto);
      const capH = tam * 0.3528 * 0.72;                    // altura das maiúsculas em mm
      // ponto inicial para que o texto fique centralizado na página (direção do texto e normal "para cima")
      const dx = Math.cos(rad), dy = -Math.sin(rad), nx = -Math.sin(rad), ny = -Math.cos(rad);
      const x0 = W / 2 - (w / 2) * dx - (capH / 2) * nx;
      const y0 = H / 2 - (w / 2) * dy - (capH / 2) * ny;
      doc.setTextColor(cor3[0], cor3[1], cor3[2]);
      doc.text(texto, x0, y0, { angle: ang });
      doc.restoreGraphicsState();
    }
  }
  return doc.output("blob");
}

// Cria automaticamente as linhas de turma do orçamento: uma linha por DIA
// de treinamento de cada turma, marcada com o tipo do dia (Teoria, Prática
// ou Teoria com Prática) conforme os dias do treinamento selecionado.
// Ex.: 3 dias de teoria + 2 de prática + 1 de teoria com prática, 2 turmas →
// A1,A2,A3 teoria / A4,A5 prática / A6 teoria com prática, e o mesmo para B.
function montarTurmasOrcamento(orcamento, qtdTurmas) {
  const tipo = listaTiposAtivos.find((t) => t.id === orcamento.tipo_treinamento_id);
  const diasTeoria = tipo ? Math.max(0, Math.floor(Number(tipo.dias_teoria) || 0)) : 0;
  const diasPratica = tipo ? Math.max(0, Math.floor(Number(tipo.dias_pratica) || 0)) : 0;
  const diasTeoriaPratica = tipo ? Math.max(0, Math.floor(Number(tipo.dias_teoria_pratica) || 0)) : 0;
  const diasTotais = diasTeoria + diasPratica + diasTeoriaPratica;

  const sequenciaDias = [
    ...Array(diasTeoria).fill("Teoria"),
    ...Array(diasPratica).fill("Prática"),
    ...Array(diasTeoriaPratica).fill("Teoria com Prática"),
  ];
  if (sequenciaDias.length === 0) sequenciaDias.push(null); // treinamento sem dias configurados: gera 1 dia sem tipo

  // Agendas: CT/Móvel dependem só do formato do orçamento (mesmo em todas as
  // linhas); instrutor 2 depende de "necessita dois instrutores"; instrutor 1
  // é sempre necessário; transporte depende do dia (calculado por linha).
  const ctAplicavel = orcamento.formato_teoria === "CT" || orcamento.formato_pratica === "CT";
  const movelAplicavel = orcamento.formato_teoria === "Móvel" || orcamento.formato_pratica === "Móvel";
  // Locação de espaço sempre acontece no CT: o CT é o único que confirma.
  const agendaCt = (ctAplicavel || !!tipo?.somente_locacao_espaco) ? "A agendar" : "Não aplicável";
  const agendaMovel = movelAplicavel ? "A agendar" : "Não aplicável";
  // Treinamento "somente locação de espaço": sem instrutor (só o CT confirma).
  const somenteLocacao = !!tipo?.somente_locacao_espaco;
  const agendaInstrutor1 = somenteLocacao ? "Não aplicável" : "A agendar";
  const agendaInstrutor2 = (!somenteLocacao && orcamento.necessita_dois_instrutores) ? "A agendar" : "Não aplicável";

  // Horário de início já definido no orçamento (padrão 7:30 no CT / 7:00 in-company,
  // ajustável pelo usuário) — vira o horário inicial de cada linha de turma gerada;
  // em dias de "Teoria com Prática" usamos o horário da teoria, já que o dia começa
  // por ela. O operador ainda pode ajustar o horário de cada turma individualmente.
  const horarioTeoria = orcamento.horario_inicio_teoria ? orcamento.horario_inicio_teoria.slice(0, 5) : null;
  const horarioPratica = orcamento.horario_inicio_pratica ? orcamento.horario_inicio_pratica.slice(0, 5) : null;

  const turmasPayload = [];
  for (let i = 0; i < qtdTurmas; i++) {
    const letra = letraIndice(i);
    sequenciaDias.forEach((tipoDia, idx) => {
      const linha = {
        orcamento_id: orcamento.id,
        identificacao: `${letra}${idx + 1}`,
        tipo_dia: tipoDia,
        tipo_treinamento_id: orcamento.tipo_treinamento_id,
        centro_treinamento_id: orcamento.centro_treinamento_id,
        formato_teoria: orcamento.formato_teoria || null,
        formato_pratica: orcamento.formato_pratica || null,
        horario: tipoDia === "Prática" ? horarioPratica : horarioTeoria,
        vagas: orcamento.qtd_alunos_por_turma || null,
        dias_totais: diasTotais || null,
        status: "Planejada",
        agenda_ct: agendaCt,
        agenda_movel: agendaMovel,
        agenda_instrutor1: agendaInstrutor1,
        agenda_instrutor2: agendaInstrutor2,
      };
      linha.agenda_transporte = transporteAplicavel(linha) ? "A agendar" : "Não aplicável";
      turmasPayload.push(linha);
    });
  }

  return turmasPayload;
}

async function gerarTurmasParaOrcamento(orcamento, qtdTurmas) {
  const turmasPayload = montarTurmasOrcamento(orcamento, qtdTurmas);
  const { data: turmasCriadas } = await supabase.from("turmas").insert(turmasPayload).select("id");
  const empresaOrc = listaEmpresasAtivas.find((e) => e.id === orcamento.empresa_id);
  if (turmasCriadas && empresaOrc?.cnpj) {
    const localidadesPayload = turmasCriadas.map((t) => ({
      turma_id: t.id,
      nome: "Principal",
      cnpj_atestado: empresaOrc.cnpj,
      cnpj_faturamento: empresaOrc.cnpj,
    }));
    await supabase.from("turma_localidades").insert(localidadesPayload);
  }
}

// ===========================================================
// IMPORTAÇÃO DE ORÇAMENTOS (planilha .xlsx)
// ===========================================================
// Colunas esperadas (por posição): A número · B empresa (CNPJ/CPF) · C centro · D treinamento ·
// E formato teoria · F formato prática · G horário teoria · H horário prática · I qtde turmas ·
// J alunos por turma (fórmula, recalculada aqui) · K qtde alunos · L contato · M telefone · N e-mail ·
// O data de criação · P validade · Q status.
let importacaoOrcPendente = null;
let importacaoOrcRelatorio = null;
let importacaoOrcAtualizacoes = [];

function painelImportacaoOrc(html) {
  const el = $("orc-importacao-painel");
  el.innerHTML = html;
  el.classList.remove("hidden");
  return el;
}

// Normaliza nomes para comparar (sem acento, minúsculas, "hras" = "horas").
function normalizarNomeImportOrc(s) {
  return textoCelulaImport(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\bhras\b/g, "horas").replace(/\s+/g, " ").trim();
}
function horaCelulaImportOrc(v) {
  if (v == null || v === "") return null;
  const dois = (n) => String(n).padStart(2, "0");
  if (v instanceof Date) return `${dois(v.getUTCHours())}:${dois(v.getUTCMinutes())}`;
  if (typeof v === "number") {
    const min = Math.round((v % 1) * 1440);
    return `${dois(Math.floor(min / 60) % 24)}:${dois(min % 60)}`;
  }
  const m = String(v).match(/(\d{1,2})\s*[:h]\s*(\d{2})/);
  return m ? `${dois(Number(m[1]))}:${m[2]}` : null;
}
function formatoImportOrc(v, permitidos) {
  const t = normalizarNomeImportOrc(v).replace(/\s+/g, "");
  if (!t) return { valor: null };
  const achado = permitidos.find((f) => normalizarNomeImportOrc(f).replace(/\s+/g, "") === t);
  return achado ? { valor: achado } : { erro: `formato "${textoCelulaImport(v)}" desconhecido` };
}
// Data da planilha (Date do Excel, número de série ou texto dd/mm/aaaa) → "aaaa-mm-dd".
function dataCelulaImportOrc(v) {
  if (v == null || v === "") return null;
  const dois = (n) => String(n).padStart(2, "0");
  if (v instanceof Date && !isNaN(v)) return `${v.getUTCFullYear()}-${dois(v.getUTCMonth() + 1)}-${dois(v.getUTCDate())}`;
  if (typeof v === "number" && v > 20000) return dataCelulaImportOrc(new Date(Math.round((v - 25569) * 86400000)));
  const t = String(v).trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${dois(m[2])}-${dois(m[1])}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
// Status da planilha (ex.: "APROVADO E AGENDADO", "CONCLUIDO") → status do sistema.
function statusImportOrc(v) {
  const chave = (s) => normalizarNomeImportOrc(s).replace(/[-_]/g, " ").replace(/\s+/g, " ");
  const t = chave(v);
  return ORCAMENTO_STATUS.find((s) => chave(s) === t) || null;
}
function numeroCelulaImportOrc(v) {
  if (typeof v === "number") return v;
  const n = Number(String(v == null ? "" : v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

// Aplica as regras linha a linha. ctx = { empresasPorDoc, centros, tipos, numerosExistentes (Map número → id) }.
// Devolve { validos, atualizacoes, problemas, resumo }; atualizacoes = orçamentos já existentes com o
// status/data/validade da planilha; problemas = [{ linha, numero, motivo, tipo: "erro"|"existente"|"repetido" }].
function prepararOrcamentosPlanilha(linhas, ctx) {
  const resumo = { total: 0, vazias: 0, validos: 0, existentes: 0, repetidos: 0, erros: 0 };
  const validos = [];
  const atualizacoes = [];
  const problemas = [];
  const vistos = new Set();
  const centrosPorNome = new Map(ctx.centros.map((c) => [normalizarNomeImportOrc(c.nome), c]));
  const tiposPorNome = new Map(ctx.tipos.map((t) => [normalizarNomeImportOrc(t.nome), t]));
  linhas.slice(1).forEach((r, idx) => {
    const linha = idx + 2;
    const numero = textoCelulaImport(r[0]).replace(/\.0+$/, "");
    const algo = r.slice(0, 14).some((c) => textoCelulaImport(c) !== "");
    if (!algo) { resumo.vazias++; return; }
    resumo.total++;
    const erro = (motivo) => { resumo.erros++; problemas.push({ linha, numero, motivo, tipo: "erro" }); };
    if (!numero) return erro("sem número do orçamento");
    if (vistos.has(numero)) { resumo.repetidos++; problemas.push({ linha, numero, motivo: "número repetido na planilha", tipo: "repetido" }); return; }
    vistos.add(numero);
    const dataOrc = dataCelulaImportOrc(r[14]);
    const validade = dataCelulaImportOrc(r[15]);
    const status = statusImportOrc(r[16]);
    if (ctx.numerosExistentes.has(numero)) {
      resumo.existentes++;
      problemas.push({ linha, numero, motivo: "já existe no sistema", tipo: "existente" });
      if (dataOrc && status) atualizacoes.push({ id: ctx.numerosExistentes.get(numero), numero, data: dataOrc, validade, status });
      return;
    }
    if (!dataOrc) return erro(`data de criação inválida ("${textoCelulaImport(r[14])}")`);
    if (!status) return erro(`status "${textoCelulaImport(r[16])}" não reconhecido`);

    let doc = textoCelulaImport(r[1]).replace(/\D/g, "");
    if (!doc) return erro("sem empresa (CNPJ)");
    if (doc.length === 13 || doc.length === 12) doc = doc.padStart(14, "0");
    else if (doc.length === 10 || doc.length === 9) doc = doc.padStart(11, "0");
    const empresa = ctx.empresasPorDoc.get(doc);
    if (!empresa) return erro(`empresa com documento ${textoCelulaImport(r[1])} não cadastrada`);
    const centro = centrosPorNome.get(normalizarNomeImportOrc(r[2]));
    if (!centro) return erro(`centro "${textoCelulaImport(r[2])}" não encontrado`);
    const tipo = tiposPorNome.get(normalizarNomeImportOrc(r[3]));
    if (!tipo) return erro(`treinamento "${textoCelulaImport(r[3])}" não encontrado`);
    const ft = formatoImportOrc(r[4], FORMATOS_TEORIA);
    if (ft.erro) return erro(`teoria: ${ft.erro}`);
    const fp = formatoImportOrc(r[5], FORMATOS_PRATICA);
    if (fp.erro) return erro(`prática: ${fp.erro}`);
    const qtdTurmas = Math.round(numeroCelulaImportOrc(r[8]));
    if (!(qtdTurmas >= 1)) return erro("quantidade de turmas inválida");
    const qtdAlunos = Math.round(numeroCelulaImportOrc(r[10]));
    if (!(qtdAlunos >= 0)) return erro("quantidade de alunos inválida");
    const porTurma = qtdAlunos > 0 ? Math.ceil(qtdAlunos / qtdTurmas) : null;
    const capacidade = Number(tipo.alunos_por_instrutor) || 0;

    let horaTeo = horaCelulaImportOrc(r[6]);
    let horaPra = horaCelulaImportOrc(r[7]);
    const padrao = (f) => (f === "InCompany" ? "07:00" : "07:30");
    if (!horaTeo && ft.valor) horaTeo = padrao(ft.valor);
    if (!horaPra && fp.valor) horaPra = padrao(fp.valor);

    // Endereço in-company = endereço cadastrado da empresa (sem coordenadas; geocodifica ao editar/salvar).
    const vazio = { mesmo_empresa: false, cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null, latitude: null, longitude: null };
    const daEmpresa = { ...vazio, mesmo_empresa: true, logradouro: empresa.endereco || null };
    const endTeoria = ft.valor === "InCompany" ? daEmpresa : vazio;
    const ambos = ft.valor === "InCompany" && fp.valor === "InCompany";
    const endPratica = fp.valor === "InCompany" ? daEmpresa : vazio;
    const pref = (p, e) => ({
      [`endereco_${p}_mesmo_empresa`]: e.mesmo_empresa, [`endereco_${p}_cep`]: e.cep, [`endereco_${p}_logradouro`]: e.logradouro,
      [`endereco_${p}_numero`]: e.numero, [`endereco_${p}_complemento`]: e.complemento, [`endereco_${p}_bairro`]: e.bairro,
      [`endereco_${p}_cidade`]: e.cidade, [`endereco_${p}_uf`]: e.uf, [`endereco_${p}_latitude`]: e.latitude, [`endereco_${p}_longitude`]: e.longitude,
    });
    validos.push({
      linha,
      empresaNome: empresa.nome,
      tipoNome: tipo.nome,
      payload: {
        numero,
        empresa_id: empresa.id,
        centro_treinamento_id: centro.id,
        tipo_treinamento_id: tipo.id,
        formato_teoria: ft.valor,
        formato_pratica: fp.valor,
        qtd_turmas: qtdTurmas,
        qtd_alunos_por_turma: porTurma,
        qtd_alunos: qtdAlunos,
        necessita_dois_instrutores: capacidade > 0 && (porTurma || 0) > capacidade,
        data: dataOrc,
        validade,
        status,
        observacoes: "",
        contato_nome: textoCelulaImport(r[11]) || null,
        contato_telefone: textoCelulaImport(r[12]) || null,
        contato_email: textoCelulaImport(r[13]) || null,
        horario_inicio_teoria: horaTeo,
        horario_inicio_pratica: horaPra,
        ...pref("teoria", endTeoria),
        endereco_pratica_mesmo_teoria: ambos,
        ...pref("pratica", endPratica),
      },
    });
  });
  resumo.validos = validos.length;
  return { validos, atualizacoes, problemas, resumo };
}

async function lerPlanilhaOrcamentos(arquivo) {
  painelImportacaoOrc(`<p class="text-slate-600">Lendo a planilha…</p>`);
  try {
    if (typeof XlsxPopulate === "undefined") throw new Error("não foi possível carregar o leitor de planilhas (verifique a conexão).");
    const buffer = await arquivo.arrayBuffer();
    const wb = await XlsxPopulate.fromDataAsync(buffer);
    const linhas = wb.sheet(0).usedRange().value();
    const cab1 = normalizarNomeImportOrc(linhas[0]?.[0]);
    const cab2 = normalizarNomeImportOrc(linhas[0]?.[1]);
    if (!cab1.includes("numero") || !cab2.includes("empresa")) {
      throw new Error("a 1ª coluna deveria ser o NÚMERO DO ORÇAMENTO e a 2ª a EMPRESA. Confira se é a planilha de carga de orçamentos.");
    }
    painelImportacaoOrc(`<p class="text-slate-600">Comparando com empresas, centros, treinamentos e orçamentos já cadastrados…</p>`);
    const [{ data: empresas, error: e1 }, { data: orcsExistentes, error: e2 }, { data: centros }, { data: tipos }] = await Promise.all([
      buscarTodos(() => supabase.from("empresas").select("id, nome, cnpj, endereco").order("id")),
      buscarTodos(() => supabase.from("orcamentos").select("id, numero").order("id")),
      supabase.from("centros_treinamento").select("*").eq("status", "Ativo"),
      supabase.from("tipos_treinamento").select("*").eq("status", "Ativo"),
    ]);
    if (e1 || e2) throw new Error((e1 || e2).message);
    const empresasPorDoc = new Map();
    (empresas || []).forEach((e) => { const d = (e.cnpj || "").replace(/\D/g, ""); if (d) empresasPorDoc.set(d, e); });
    const numerosExistentes = new Map((orcsExistentes || []).map((o) => [String(o.numero), o.id]));
    const { validos, atualizacoes, problemas, resumo } = prepararOrcamentosPlanilha(linhas, { empresasPorDoc, centros: centros || [], tipos: tipos || [], numerosExistentes });
    importacaoOrcPendente = validos;
    importacaoOrcAtualizacoes = atualizacoes;
    importacaoOrcRelatorio = problemas;
    importacaoOrcArquivo = arquivo.name || "";
    importacaoOrcResumo = resumo;
    importacaoOrcCnpjPorEmpresa = new Map((empresas || []).map((e) => [e.id, e.cnpj]));
    importacaoOrcNumeros = new Set(linhas.slice(1).map((l) => textoCelulaImport(l[0]).replace(/\.0+$/, "")).filter(Boolean));
    // orçamentos da planilha que já estão no sistema mas ficaram sem turmas (ex.: importação anterior interrompida)
    importacaoOrcTurmasPendentes = [];
    try {
      const { data: semTurmas } = await buscarTodos(() => supabase.rpc("orcamentos_sem_turmas").order("id"));
      const ids = (semTurmas || []).filter((o) => importacaoOrcNumeros.has(String(o.numero))).map((o) => o.id);
      for (let i = 0; i < ids.length; i += 100) {
        const { data: rows, error: eP } = await supabase.from("orcamentos").select("*").in("id", ids.slice(i, i + 100));
        if (eP) throw eP;
        importacaoOrcTurmasPendentes.push(...(rows || []).filter((o) => o.empresa_id && o.tipo_treinamento_id && Number(o.qtd_turmas) > 0));
      }
    } catch (eP) { importacaoOrcTurmasPendentes = []; }
    listaTiposAtivos = tipos || listaTiposAtivos;

    const erros = problemas.filter((p) => p.tipo === "erro");
    const totalTurmas = validos.reduce((s, v) => s + v.payload.qtd_turmas, 0);
    const diasDoTipo = (id) => { const t = (tipos || []).find((x) => x.id === id); const d = t ? Math.max(0, Number(t.dias_teoria) || 0) + Math.max(0, Number(t.dias_pratica) || 0) + Math.max(0, Number(t.dias_teoria_pratica) || 0) : 0; return d > 0 ? d : 1; };
    const linhasDiaEstimadas = validos.reduce((s, v) => s + v.payload.qtd_turmas * diasDoTipo(v.payload.tipo_treinamento_id), 0);
    painelImportacaoOrc(`
      <p class="font-medium text-slate-800 mb-2">Conferência da planilha (${resumo.total} orçamentos${resumo.vazias ? `; ${resumo.vazias} linhas em branco ignoradas` : ""})</p>
      <ul class="text-xs text-slate-600 space-y-0.5 mb-3">
        <li>✅ Prontos para importar: <strong>${resumo.validos}</strong> (${totalTurmas.toLocaleString("pt-BR")} turmas no total, em ${linhasDiaEstimadas.toLocaleString("pt-BR")} linhas de turma/dia)</li>
        <li>⏭️ Já existem no sistema: <strong>${resumo.existentes}</strong> (não são recriados; veja a opção abaixo)</li>
        ${importacaoOrcTurmasPendentes.length ? `<li>🧩 Já existem, mas estão <strong>sem turmas</strong>: <strong>${importacaoOrcTurmasPendentes.length}</strong> (as turmas serão geradas, se a opção abaixo estiver marcada)</li>` : ""}
        <li>⛔ Com erro (não serão importados): <strong>${resumo.erros}</strong>${resumo.repetidos ? ` · repetidos na planilha: ${resumo.repetidos}` : ""}</li>
      </ul>
      ${erros.length ? `<div class="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 mb-3 max-h-40 overflow-y-auto">${erros.slice(0, 50).map((p) => `Linha ${p.linha}${p.numero ? ` (orç. ${p.numero})` : ""}: ${p.motivo}`).join("<br>")}${erros.length > 50 ? `<br>… e mais ${erros.length - 50} (veja o relatório)` : ""}</div>` : ""}
      <p class="text-xs text-slate-500 mb-3">Os orçamentos entram com a data de criação, a validade e o status da planilha, com o contato da planilha e o endereço in-company igual ao da empresa.</p>
      ${resumo.existentes ? `<label class="flex items-start gap-2 text-xs text-slate-700 mb-3">
        <input id="orc-imp-atualizar-existentes" type="checkbox" checked class="mt-0.5 rounded border-slate-300" />
        <span>Atualizar também a <strong>data, a validade e o status</strong> dos ${atualizacoes.length} orçamento(s) que já existem no sistema, com os valores da planilha (nenhum outro campo e nenhuma turma é alterado). Desmarque para deixá-los exatamente como estão.</span>
      </label>` : ""}
      <label class="flex items-start gap-2 text-xs text-slate-700 mb-3">
        <input id="orc-imp-gerar-turmas" type="checkbox" checked class="mt-0.5 rounded border-slate-300" />
        <span>Gerar também as turmas de cada orçamento (como no cadastro manual). Desmarque para importar só os orçamentos. Com as turmas, a importação leva alguns minutos — mantenha esta página aberta até terminar.</span>
      </label>

      <div class="flex flex-wrap gap-2">
        <button id="btn-orc-imp-confirmar" class="text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-md px-4 py-2" ${validos.length || atualizacoes.length || importacaoOrcTurmasPendentes.length ? "" : "disabled"}>${validos.length ? `Importar ${resumo.validos} orçamento(s)` : importacaoOrcTurmasPendentes.length ? "Gerar turmas pendentes" : "Aplicar atualizações"}</button>
        <button id="btn-orc-imp-relatorio" class="text-xs font-medium text-slate-600 border border-slate-300 rounded-md px-4 py-2" ${problemas.length ? "" : "disabled"}>Baixar relatório de pendências (.xlsx)</button>
        <button id="btn-orc-imp-cancelar" class="text-xs font-medium text-slate-600 border border-slate-300 rounded-md px-4 py-2">Cancelar</button>
      </div>`);
    $("btn-orc-imp-confirmar").addEventListener("click", () => {
      executarImportacaoOrcamentos().catch((e) => {
        console.error("Falha na importação de orçamentos:", e);
        painelImportacaoOrc(`<p class="text-rose-700 font-medium mb-1">A importação foi interrompida por um erro inesperado.</p><p class="text-xs text-slate-600">${e?.message || e}</p><p class="text-xs text-slate-500 mt-2">Recarregue a página e importe a mesma planilha de novo: o que já foi gravado é reconhecido.</p>`);
      });
    });
    $("btn-orc-imp-relatorio").addEventListener("click", baixarRelatorioImportacaoOrc);
    $("btn-orc-imp-cancelar").addEventListener("click", () => { importacaoOrcPendente = null; $("orc-importacao-painel").classList.add("hidden"); });
  } catch (e) {
    painelImportacaoOrc(`<p class="text-rose-700">Não foi possível ler a planilha: ${e.message || e}</p>`);
  }
}

async function baixarRelatorioImportacaoOrc() {
  const itens = importacaoOrcRelatorio || [];
  if (!itens.length || typeof XlsxPopulate === "undefined") return;
  const wb = await XlsxPopulate.fromBlankAsync();
  const sh = wb.sheet(0).name("Pendências");
  sh.cell("A1").value([["Linha", "Orçamento", "Situação", "Motivo"]]);
  const rot = { erro: "Erro", existente: "Já existe", repetido: "Repetido" };
  sh.cell("A2").value(itens.map((p) => [p.linha, p.numero, rot[p.tipo] || p.tipo, p.motivo]));
  sh.column("C").width(14); sh.column("D").width(70);
  const blob = await wb.outputAsync("blob");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pendencias-importacao-orcamentos.xlsx";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------------------------------------------------------------------------
// Execução da importação: progresso ao vivo + log gravado no banco + retomada.
// Fases: (1) gravar orçamentos novos · (2) atualizar os já existentes · (3) gerar turmas dos
// orçamentos da planilha que estejam sem turmas (inclui os que ficaram sem turmas numa execução
// anterior interrompida). Cada chamada ao servidor tem limite de tempo; nada fica "preso" em silêncio.
// ---------------------------------------------------------------------------
let impOrc = null; // estado da execução em andamento
let importacaoOrcNumeros = new Set(); // números presentes na planilha lida
let importacaoOrcTurmasPendentes = [];
let importacaoOrcCnpjPorEmpresa = new Map();
let importacaoOrcArquivo = "";
let importacaoOrcResumo = null; // orçamentos da planilha já no sistema, sem nenhuma turma

function comTimeout(promessa, ms, rotulo) {
  let t;
  const limite = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`sem resposta do servidor em ${Math.round(ms / 1000)}s (${rotulo})`)), ms); });
  return Promise.race([Promise.resolve(promessa), limite]).finally(() => clearTimeout(t));
}
function duracaoImpOrc(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}min` : m ? `${m}min ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}
function barraImpOrc(feito, total) {
  const pct = total > 0 ? Math.min(100, Math.round((feito / total) * 100)) : 100;
  return `<div class="h-2 bg-slate-100 rounded-full overflow-hidden mt-1"><div class="h-2 bg-teal-500" style="width:${pct}%"></div></div><span class="text-[11px] text-slate-400">${pct}%</span>`;
}

// Redesenha o painel de progresso (chamado a cada passo e a cada segundo).
function renderizarProgressoImpOrc() {
  const s = impOrc;
  if (!s || !s.rodando) return;
  const parado = Date.now() - s.ultimaAtividade;
  const alerta = parado > 90000;
  const n = (v) => Number(v || 0).toLocaleString("pt-BR");
  painelImportacaoOrc(`
    <p class="font-medium text-slate-800 mb-1"><span class="inline-block animate-pulse text-teal-600">●</span> Importação em andamento — ${s.cancelar ? "interrompendo ao fim do passo atual…" : "mantenha esta página aberta"}</p>
    <p class="text-xs text-slate-500 mb-3">Etapa: <strong>${s.etapa}</strong> · tempo decorrido: ${duracaoImpOrc(Date.now() - s.inicio)} · última atividade há ${duracaoImpOrc(parado)}</p>
    ${alerta ? `<div class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-3">Sem novidades há mais de ${duracaoImpOrc(parado)}. O servidor pode estar lento. Se continuar assim, recarregue a página e importe a mesma planilha de novo: o que já foi gravado é reconhecido e a importação continua de onde parou.</div>` : ""}
    <div class="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-xs text-slate-700 mb-3">
      <div>Orçamentos criados: <strong>${n(s.criados)}</strong> de ${n(s.totalNovos)}${barraImpOrc(s.criados, s.totalNovos)}</div>
      <div>Turmas criadas: <strong>${n(s.turmas)}</strong>${s.gerarTurmas ? ` de ~${n(s.totalTurmasEstimadas)}` : " (desativado)"}${s.gerarTurmas ? barraImpOrc(s.turmas, s.totalTurmasEstimadas) : ""}</div>
      ${s.totalAtualizar ? `<div>Orçamentos existentes atualizados: <strong>${n(s.atualizados)}</strong> de ${n(s.totalAtualizar)}${barraImpOrc(s.atualizados, s.totalAtualizar)}</div>` : ""}
      <div>Falhas: <strong class="${s.falhas ? "text-rose-600" : ""}">${n(s.falhas)}</strong>${s.falhas ? ` — veja o relatório ao final` : ""}</div>
    </div>
    ${s.avisoLog ? `<p class="text-[11px] text-amber-700 mb-2">Atenção: não foi possível gravar parte do log no banco (a importação segue normalmente).</p>` : ""}
    <button id="btn-orc-imp-parar" class="text-xs font-medium text-slate-600 border border-slate-300 rounded-md px-4 py-2" ${s.cancelar ? "disabled" : ""}>Interromper importação</button>`);
}

async function logRunImpOrc(campos) {
  if (!impOrc?.runId) return;
  try {
    const { error } = await comTimeout(supabase.from("importacoes_orcamentos").update({ ...campos, ultima_atividade: new Date().toISOString() }).eq("id", impOrc.runId), 30000, "log");
    if (error) throw error;
  } catch (e) { impOrc.avisoLog = true; }
}
async function logItensImpOrc(itens) {
  if (!impOrc?.runId || !itens.length) return;
  for (let i = 0; i < itens.length; i += 200) {
    try {
      const { error } = await comTimeout(supabase.from("importacoes_orcamentos_itens").insert(itens.slice(i, i + 200).map((x) => ({ importacao_id: impOrc.runId, ...x }))), 30000, "log");
      if (error) throw error;
    } catch (e) { impOrc.avisoLog = true; }
  }
}
function passoImpOrc(etapa) {
  impOrc.etapa = etapa;
  impOrc.ultimaAtividade = Date.now();
  renderizarProgressoImpOrc();
}
async function salvarProgressoImpOrc() {
  await logRunImpOrc({
    etapa: impOrc.etapa, orcamentos_criados: impOrc.criados, orcamentos_atualizados: impOrc.atualizados,
    turmas_criadas: impOrc.turmas, falhas: impOrc.falhas,
  });
}
function registrarFalhaImpOrc(itens, linha, numero, mensagem) {
  impOrc.falhas++;
  impOrc.relatorio.push({ linha, numero, motivo: mensagem, tipo: "erro" });
  itens.push({ linha: linha || null, numero, resultado: "erro", mensagem });
}

// Gera as turmas (e a localidade "Principal") de uma lista de orçamentos, em blocos de ~300 linhas.
async function gerarTurmasEmLoteImportOrc(orcamentos) {
  const cnpjPorEmpresa = importacaoOrcCnpjPorEmpresa.size ? importacaoOrcCnpjPorEmpresa : new Map((listaEmpresasAtivas || []).map((e) => [e.id, e.cnpj]));
  let bloco = []; // [{ o, linhas }]
  const gravarOrcamento = async (entradas) => {
    const payload = entradas.flatMap((x) => x.linhas);
    const dono = new Map(entradas.map((x) => [x.o.id, x.o]));
    const criadasPorOrc = new Map();
    for (let i = 0; i < payload.length; i += 500) {
      const { data, error } = await comTimeout(supabase.from("turmas").insert(payload.slice(i, i + 500)).select("id, orcamento_id"), 120000, "gravar turmas");
      if (error) throw error;
      const locs = [];
      (data || []).forEach((t) => {
        criadasPorOrc.set(t.orcamento_id, (criadasPorOrc.get(t.orcamento_id) || 0) + 1);
        const cnpj = cnpjPorEmpresa.get(dono.get(t.orcamento_id)?.empresa_id);
        if (cnpj) locs.push({ turma_id: t.id, nome: "Principal", cnpj_atestado: cnpj, cnpj_faturamento: cnpj });
      });
      for (let j = 0; j < locs.length; j += 500) {
        const { error: eLoc } = await comTimeout(supabase.from("turma_localidades").insert(locs.slice(j, j + 500)), 60000, "gravar localidades");
        if (eLoc) throw eLoc;
      }
    }
    return criadasPorOrc;
  };
  const descarregar = async () => {
    if (!bloco.length) return;
    const entradas = bloco;
    bloco = [];
    const itens = [];
    const confirmar = (criadas) => {
      entradas.forEach((x) => {
        const n = criadas.get(x.o.id) || 0;
        impOrc.turmas += n;
        itens.push({ numero: x.o.numero, resultado: "turmas", turmas_criadas: n });
      });
    };
    try {
      confirmar(await gravarOrcamento(entradas));
    } catch (e) {
      // isola o orçamento com problema
      for (const x of entradas) {
        try { confirmar(await gravarOrcamento([x])); }
        catch (e2) { registrarFalhaImpOrc(itens, null, x.o.numero, `turmas não criadas: ${e2.message || e2}`); }
      }
    }
    await logItensImpOrc(itens);
    await salvarProgressoImpOrc();
    passoImpOrc(impOrc.etapa);
  };
  for (const o of orcamentos) {
    if (impOrc.cancelar) break;
    let linhasTurma;
    try { linhasTurma = montarTurmasOrcamento(o, o.qtd_turmas); }
    catch (e) { const itens = []; registrarFalhaImpOrc(itens, null, o.numero, `não foi possível montar as turmas: ${e.message || e}`); await logItensImpOrc(itens); continue; }
    bloco.push({ o, linhas: linhasTurma });
    if (bloco.reduce((s, x) => s + x.linhas.length, 0) >= 300) {
      passoImpOrc("Gerando turmas…");
      await descarregar();
    }
  }
  if (!impOrc.cancelar) await descarregar();
  else bloco = [];
}

async function executarImportacaoOrcamentos() {
  if (impOrc?.rodando) return;
  const novos = importacaoOrcPendente || [];
  const atualizar = !!$("orc-imp-atualizar-existentes")?.checked;
  const atualizacoes = atualizar ? (importacaoOrcAtualizacoes || []) : [];
  const gerarTurmas = !!$("orc-imp-gerar-turmas")?.checked;
  const pendentesTurmas = gerarTurmas ? importacaoOrcTurmasPendentes : [];
  if (!novos.length && !atualizacoes.length && !pendentesTurmas.length) return;
  importacaoOrcPendente = null;
  // Mostra algo na tela imediatamente (antes de qualquer cálculo ou chamada ao servidor).
  painelImportacaoOrc(`<p class="font-medium text-slate-800"><span class="inline-block animate-pulse text-teal-600">●</span> Iniciando a importação… preparando ${novos.length.toLocaleString("pt-BR")} orçamento(s)</p><p class="text-xs text-slate-500 mt-1">Mantenha esta página aberta.</p>`);
  await new Promise((r) => setTimeout(r, 30)); // deixa o navegador desenhar o aviso

  impOrc = {
    rodando: true, cancelar: false, inicio: Date.now(), ultimaAtividade: Date.now(), etapa: "Preparando…",
    criados: 0, turmas: 0, atualizados: 0, falhas: 0, totalNovos: novos.length, totalAtualizar: atualizacoes.length,
    totalTurmasEstimadas: 0, gerarTurmas, avisoLog: false, runId: null, relatorio: (importacaoOrcRelatorio || []).slice(),
  };
  const contar = (o, q) => { try { return montarTurmasOrcamento(o, q).length; } catch (e) { return 0; } };
  if (gerarTurmas) impOrc.totalTurmasEstimadas = novos.reduce((s, v) => s + contar({ ...v.payload, id: "x" }, v.payload.qtd_turmas), 0) + pendentesTurmas.reduce((s, o) => s + contar(o, o.qtd_turmas), 0);

  // proteções: avisa ao fechar a aba e tenta impedir que o computador durma durante a importação
  const avisoSaida = (ev) => { ev.preventDefault(); ev.returnValue = ""; };
  window.addEventListener("beforeunload", avisoSaida);
  const relogio = setInterval(renderizarProgressoImpOrc, 1000);
  renderizarProgressoImpOrc();
  let wakeLock = null;
  // não espera a resposta do navegador (pode demorar ou nunca vir); é só uma proteção opcional
  try { if (navigator.wakeLock) navigator.wakeLock.request("screen").then((l) => { wakeLock = l; }).catch(() => {}); } catch (e) { /* opcional */ }

  try {
    let email = null;
    try { email = (await comTimeout(supabase.auth.getUser(), 8000, "usuário")).data?.user?.email || null; } catch (e) { /* opcional */ }
    try {
      const { data: run } = await comTimeout(supabase.from("importacoes_orcamentos").insert({
        arquivo: importacaoOrcArquivo, usuario_email: email, total_planilha: importacaoOrcResumo?.total || 0,
        total_para_importar: novos.length, total_atualizar: atualizacoes.length, total_turmas_pendentes: pendentesTurmas.length,
        gerar_turmas: gerarTurmas, etapa: "Iniciada",
      }).select("id").single(), 30000, "log");
      impOrc.runId = run?.id || null;
    } catch (e) { impOrc.avisoLog = true; }
    // problemas já conhecidos da leitura (erros, repetidos, existentes) entram no log
    await logItensImpOrc((importacaoOrcRelatorio || []).map((p) => ({ linha: p.linha || null, numero: p.numero, resultado: p.tipo === "erro" ? "erro" : p.tipo, mensagem: p.motivo })));
    impOrc.falhas = (importacaoOrcRelatorio || []).filter((p) => p.tipo === "erro").length;

    // ---- Fase 1: orçamentos novos (lotes de 25) ----
    const tam = 25;
    const orcamentosCriados = [];
    for (let i = 0; i < novos.length && !impOrc.cancelar; i += tam) {
      const lote = novos.slice(i, i + tam);
      passoImpOrc(`Gravando orçamentos ${i + 1}–${i + lote.length} de ${novos.length}`);
      const itens = [];
      let criados = [];
      try {
        const { data, error } = await comTimeout(supabase.from("orcamentos").insert(lote.map((v) => v.payload)).select("*"), 90000, "gravar orçamentos");
        if (error) throw error;
        criados = data || [];
      } catch (e) {
        // isola a linha com problema: grava uma a uma
        for (const v of lote) {
          try {
            const { data, error } = await comTimeout(supabase.from("orcamentos").insert(v.payload).select("*").single(), 60000, "gravar orçamento");
            if (error) {
              if (error.code === "23505") itens.push({ linha: v.linha, numero: v.payload.numero, resultado: "existente", mensagem: "já havia sido gravado antes" });
              else throw error;
            } else criados.push(data);
          } catch (e2) { registrarFalhaImpOrc(itens, v.linha, v.payload.numero, e2.message || String(e2)); }
          impOrc.ultimaAtividade = Date.now();
        }
      }
      const linhaPorNumero = new Map(lote.map((v) => [v.payload.numero, v.linha]));
      criados.forEach((o) => itens.push({ linha: linhaPorNumero.get(o.numero) || null, numero: o.numero, resultado: "criado" }));
      impOrc.criados += criados.length;
      orcamentosCriados.push(...criados);
      await logItensImpOrc(itens);
      await salvarProgressoImpOrc();
      passoImpOrc(impOrc.etapa);
    }

    // ---- Fase 2: atualizar os já existentes ----
    for (let i = 0; i < atualizacoes.length && !impOrc.cancelar; i++) {
      const u = atualizacoes[i];
      passoImpOrc(`Atualizando orçamentos já existentes (${i + 1} de ${atualizacoes.length})`);
      const itens = [];
      try {
        const { error } = await comTimeout(supabase.from("orcamentos").update({ data: u.data, validade: u.validade, status: u.status }).eq("id", u.id), 60000, "atualizar orçamento");
        if (error) throw error;
        impOrc.atualizados++;
        itens.push({ numero: u.numero, resultado: "atualizado", mensagem: `data ${u.data}, validade ${u.validade || "—"}, status ${u.status}` });
        const p = impOrc.relatorio.find((x) => x.tipo === "existente" && x.numero === u.numero);
        if (p) p.motivo = "já existia — data, validade e status atualizados";
      } catch (e) { registrarFalhaImpOrc(itens, null, u.numero, `não foi possível atualizar: ${e.message || e}`); }
      await logItensImpOrc(itens);
      if ((i + 1) % 10 === 0 || i === atualizacoes.length - 1) await salvarProgressoImpOrc();
    }

    // ---- Fase 3: turmas ----
    if (gerarTurmas && !impOrc.cancelar) {
      passoImpOrc("Gerando turmas…");
      await gerarTurmasEmLoteImportOrc([...orcamentosCriados, ...pendentesTurmas]);
    }
  } catch (e) {
    impOrc.relatorio.push({ linha: "", numero: "", motivo: `importação interrompida por erro: ${e.message || e}`, tipo: "erro" });
    impOrc.falhas++;
    impOrc.erroFatal = e.message || String(e);
  } finally {
    clearInterval(relogio);
    window.removeEventListener("beforeunload", avisoSaida);
    try { if (wakeLock) await wakeLock.release(); } catch (e) { /* ignora */ }
  }

  const s = impOrc;
  s.rodando = false;
  const statusFinal = s.cancelar || s.erroFatal ? "Interrompida" : s.falhas ? "Concluída com falhas" : "Concluída";
  await logRunImpOrc({ status: statusFinal, finalizada_em: new Date().toISOString(), etapa: "Finalizada", orcamentos_criados: s.criados, orcamentos_atualizados: s.atualizados, turmas_criadas: s.turmas, falhas: s.falhas });
  importacaoOrcRelatorio = s.relatorio;
  orcPagina = 1;
  await carregarPaginaOrcamentos();
  const n = (v) => Number(v || 0).toLocaleString("pt-BR");
  painelImportacaoOrc(`
    <p class="${statusFinal === "Concluída" ? "text-teal-700" : "text-amber-700"} font-medium mb-2">${statusFinal === "Concluída" ? "✅" : "⚠️"} Importação ${statusFinal.toLowerCase()} em ${duracaoImpOrc(Date.now() - s.inicio)}</p>
    <ul class="text-xs text-slate-700 space-y-0.5 mb-3">
      <li>Orçamentos criados: <strong>${n(s.criados)}</strong> de ${n(s.totalNovos)}</li>
      <li>Turmas criadas: <strong>${n(s.turmas)}</strong>${gerarTurmas ? "" : " (geração desativada)"}</li>
      ${s.totalAtualizar ? `<li>Orçamentos existentes atualizados: <strong>${n(s.atualizados)}</strong> de ${n(s.totalAtualizar)}</li>` : ""}
      <li>Falhas: <strong class="${s.falhas ? "text-rose-600" : ""}">${n(s.falhas)}</strong></li>
    </ul>
    ${s.erroFatal ? `<p class="text-xs text-rose-700 mb-2">Erro: ${s.erroFatal}</p>` : ""}
    ${statusFinal !== "Concluída" ? `<p class="text-xs text-slate-600 mb-2">Para continuar de onde parou, importe a mesma planilha de novo: o que já foi gravado é reconhecido e só o que falta é feito.</p>` : ""}
    ${s.avisoLog ? `<p class="text-[11px] text-amber-700 mb-2">Parte do log não pôde ser gravada no banco.</p>` : ""}
    <div class="flex flex-wrap gap-2">
      <button id="btn-orc-imp-relatorio2" class="text-xs font-medium text-slate-600 border border-slate-300 rounded-md px-4 py-2">Baixar relatório de pendências (.xlsx)</button>
      <button id="btn-orc-imp-historico2" class="text-xs font-medium text-slate-600 border border-slate-300 rounded-md px-4 py-2">Ver histórico / log das importações</button>
      <button id="btn-orc-imp-fechar" class="text-xs font-medium text-slate-600 border border-slate-300 rounded-md px-4 py-2">Fechar</button>
    </div>`);
  $("btn-orc-imp-relatorio2").addEventListener("click", baixarRelatorioImportacaoOrc);
  $("btn-orc-imp-historico2").addEventListener("click", abrirHistoricoImportacoesOrc);
  $("btn-orc-imp-fechar").addEventListener("click", () => $("orc-importacao-painel").classList.add("hidden"));
}
$("orc-importacao-painel").addEventListener("click", (ev) => {
  if (ev.target.closest("#btn-orc-imp-parar") && impOrc?.rodando) { impOrc.cancelar = true; renderizarProgressoImpOrc(); }
});

// ---------------------------------------------------------------------------
// Histórico / log das importações (gravado no banco, consultável depois)
// ---------------------------------------------------------------------------
const ROTULO_RESULTADO_IMP = { criado: "Criado", atualizado: "Atualizado", existente: "Já existia", repetido: "Repetido", erro: "Erro", turmas: "Turmas geradas" };

async function abrirHistoricoImportacoesOrc() {
  painelImportacaoOrc(`<p class="text-slate-600">Carregando histórico…</p>`);
  const { data, error } = await supabase.from("importacoes_orcamentos").select("*").order("iniciada_em", { ascending: false }).limit(50);
  if (error) return painelImportacaoOrc(`<p class="text-rose-700">Não foi possível carregar o histórico: ${error.message}</p>`);
  const dt = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—");
  const n = (v) => Number(v || 0).toLocaleString("pt-BR");
  const statusExibido = (r) => (r.status === "Em andamento" && Date.now() - new Date(r.ultima_atividade).getTime() > 180000 ? "Interrompida (sem atividade)" : r.status);
  painelImportacaoOrc(`
    <div class="flex items-center justify-between mb-2">
      <p class="font-medium text-slate-800">Histórico de importações de orçamentos</p>
      <button id="btn-orc-hist-fechar" class="text-xs text-slate-500 hover:text-slate-800">Fechar ✕</button>
    </div>
    ${(data || []).length === 0 ? `<p class="text-xs text-slate-500">Nenhuma importação registrada ainda.</p>` : `
    <div class="overflow-x-auto"><table class="w-full text-xs">
      <thead><tr class="text-left text-slate-500"><th class="py-1 pr-3">Início</th><th class="pr-3">Usuário</th><th class="pr-3">Arquivo</th><th class="pr-3">Situação</th><th class="pr-3">Orç. criados</th><th class="pr-3">Turmas</th><th class="pr-3">Atualizados</th><th class="pr-3">Falhas</th><th></th></tr></thead>
      <tbody class="divide-y divide-slate-100">${data.map((r) => `
        <tr><td class="py-1 pr-3 whitespace-nowrap">${dt(r.iniciada_em)}</td><td class="pr-3">${r.usuario_email || "—"}</td><td class="pr-3">${r.arquivo || "—"}</td>
        <td class="pr-3">${statusExibido(r)}</td><td class="pr-3">${n(r.orcamentos_criados)} / ${n(r.total_para_importar)}</td><td class="pr-3">${n(r.turmas_criadas)}</td>
        <td class="pr-3">${n(r.orcamentos_atualizados)}</td><td class="pr-3 ${r.falhas ? "text-rose-600 font-medium" : ""}">${n(r.falhas)}</td>
        <td><button data-imp-itens="${r.id}" class="text-teal-700 hover:underline">ver itens</button></td></tr>`).join("")}
      </tbody></table></div>`}
    <div id="orc-hist-itens" class="mt-3"></div>`);
  $("btn-orc-hist-fechar").addEventListener("click", () => $("orc-importacao-painel").classList.add("hidden"));
  $("orc-importacao-painel").querySelectorAll("[data-imp-itens]").forEach((b) => b.addEventListener("click", () => abrirItensImportacaoOrc(b.getAttribute("data-imp-itens"))));
}

async function abrirItensImportacaoOrc(runId) {
  const cont = $("orc-hist-itens");
  cont.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 mb-2">
      <input id="orc-hist-busca" placeholder="Buscar por número do orçamento" class="text-xs rounded-md border border-slate-300 px-2 py-1.5 w-56" />
      <select id="orc-hist-resultado" class="text-xs rounded-md border border-slate-300 px-2 py-1.5">
        <option value="">Todos os resultados</option>
        ${Object.entries(ROTULO_RESULTADO_IMP).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
      </select>
      <button id="btn-orc-hist-baixar" class="text-xs font-medium text-slate-600 border border-slate-300 rounded-md px-3 py-1.5">Baixar log (.xlsx)</button>
      <span id="orc-hist-contagem" class="text-[11px] text-slate-400"></span>
    </div>
    <div id="orc-hist-lista" class="max-h-80 overflow-y-auto border border-slate-200 rounded-md"></div>`;
  const montar = () => {
    let q = supabase.from("importacoes_orcamentos_itens").select("*", { count: "exact" }).eq("importacao_id", runId);
    const termo = $("orc-hist-busca").value.trim().replace(/[,()%*\\]/g, " ");
    if (termo) q = q.ilike("numero", `%${termo}%`);
    const res = $("orc-hist-resultado").value;
    if (res) q = q.eq("resultado", res);
    return q.order("id");
  };
  const carregar = async () => {
    const { data, error, count } = await montar().limit(300);
    $("orc-hist-contagem").textContent = error ? "" : `${Number(count || 0).toLocaleString("pt-BR")} item(ns)${(count || 0) > 300 ? " — mostrando os 300 primeiros; refine a busca ou baixe o log" : ""}`;
    $("orc-hist-lista").innerHTML = error ? `<p class="text-rose-700 text-xs p-2">${error.message}</p>` : (data || []).length === 0 ? `<p class="text-xs text-slate-500 p-2">Nenhum item.</p>` : `
      <table class="w-full text-xs"><thead class="bg-slate-50 text-slate-500 text-left"><tr><th class="px-2 py-1">Hora</th><th class="px-2">Linha</th><th class="px-2">Orçamento</th><th class="px-2">Resultado</th><th class="px-2">Turmas</th><th class="px-2">Detalhe</th></tr></thead>
      <tbody class="divide-y divide-slate-100">${data.map((i) => `<tr><td class="px-2 py-1 whitespace-nowrap">${new Date(i.criado_em).toLocaleTimeString("pt-BR")}</td><td class="px-2">${i.linha ?? ""}</td><td class="px-2 font-mono">${i.numero || ""}</td><td class="px-2 ${i.resultado === "erro" ? "text-rose-600 font-medium" : ""}">${ROTULO_RESULTADO_IMP[i.resultado] || i.resultado}</td><td class="px-2">${i.turmas_criadas ?? ""}</td><td class="px-2 text-slate-600">${i.mensagem || ""}</td></tr>`).join("")}</tbody></table>`;
  };
  let timer = null;
  $("orc-hist-busca").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(carregar, 300); });
  $("orc-hist-resultado").addEventListener("change", carregar);
  $("btn-orc-hist-baixar").addEventListener("click", async () => {
    if (typeof XlsxPopulate === "undefined") return;
    const { data } = await buscarTodos(() => supabase.from("importacoes_orcamentos_itens").select("*").eq("importacao_id", runId).order("id"));
    const wb = await XlsxPopulate.fromBlankAsync();
    const sh = wb.sheet(0).name("Log da importação");
    sh.cell("A1").value([["Hora", "Linha", "Orçamento", "Resultado", "Turmas criadas", "Detalhe"]]);
    if ((data || []).length) sh.cell("A2").value(data.map((i) => [new Date(i.criado_em).toLocaleString("pt-BR"), i.linha ?? "", i.numero || "", ROTULO_RESULTADO_IMP[i.resultado] || i.resultado, i.turmas_criadas ?? "", i.mensagem || ""]));
    sh.column("A").width(20); sh.column("F").width(70);
    const blob = await wb.outputAsync("blob");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "log-importacao-orcamentos.xlsx";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  carregar();
}


$("btn-orc-importar").addEventListener("click", () => $("orc-importar-arquivo").click());
$("btn-orc-historico").addEventListener("click", abrirHistoricoImportacoesOrc);
$("orc-importar-arquivo").addEventListener("change", (ev) => {
  const arquivo = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (arquivo) lerPlanilhaOrcamentos(arquivo);
});

// Exclusão de orçamento: somente administrador. O banco (RPC excluir_orcamento + gatilho) recusa a exclusão
// quando alguma turma tem agendamento confirmado; agendamentos ainda aguardando confirmação são cancelados
// (instrutores avisados, dias liberados) antes de apagar.

async function excluirOrcamento(id, numeroInformado) {
  if (!usuarioEhAdmin()) return alert("Somente o administrador pode excluir orçamentos.");
  const o = listaOrcamentos.find((x) => x.id === id);
  const numero = numeroInformado || o?.numero || "";
  if (!confirm(`Excluir o orçamento ${numero}?\n\nSerão apagados também o cálculo, as propostas e as turmas deste orçamento. Agendamentos que ainda aguardam confirmação serão cancelados (os instrutores são avisados). Se houver agendamento CONFIRMADO, a exclusão não é permitida.\n\nEsta ação não pode ser desfeita.`)) return false;
  const { data, error } = await supabase.rpc("excluir_orcamento", { p_orcamento_id: id });
  if (error) {
    alert(`Não foi possível excluir o orçamento ${numero}.\n\n${error.message}`);
    return false;
  }
  if (orcEditorAberto() && editandoOrcamentoId === id) fecharEditorOrcamento();
  await carregarPaginaOrcamentos();
  const cancelados = Number(data?.agendamentos_cancelados) || 0;
  if (cancelados > 0) alert(`Orçamento ${numero} excluído. ${cancelados} agendamento(s) aguardando confirmação foram cancelados e ${Number(data?.instrutores_avisados) || 0} instrutor(es) avisado(s).`);
  return true;
}

// ===========================================================
// OPERAÇÃO: TURMAS POR ORÇAMENTO
// ===========================================================
async function carregarTurmasInit() {
  $("admin-descricao-pagina").textContent = "Acompanhe e ajuste as turmas geradas automaticamente para cada orçamento.";
  const [{ data: orcs }, { data: centros }, { data: insts }, { data: tipos }, { data: empresasTodas }] = await Promise.all([
    // o servidor devolve no máximo 1000 linhas por consulta: busca em páginas para trazer TODOS os orçamentos
    buscarTodos(() => supabase.from("orcamentos").select("*, empresas(nome, cnpj, cnpj_grupo_economico), tipos_treinamento(nome)").order("created_at", { ascending: false }).order("id")),
    supabase.from("centros_treinamento").select("*").eq("status", "Ativo").order("nome"),
    supabase.from("instrutores").select("*").eq("status", "Ativo").order("nome"),
    supabase.from("tipos_treinamento").select("*").eq("status", "Ativo").order("nome"),
    buscarTodos(() => supabase.from("empresas").select("id, nome, cnpj, cnpj_grupo_economico").order("id")),
  ]);
  listaOrcamentosParaTurma = orcs || [];
  listaCentrosAtivos = centros || [];
  listaInstrutoresAtivos = insts || [];
  listaTiposAtivos = tipos || [];
  listaEmpresasParaValidacao = empresasTodas || [];

  $("turma-orcamento-busca").value = "";
  preencherSelectOrcamentosTurma();
  $("turma-orcamento-select").value = "";
  $("turma-orcamento-info").classList.add("hidden");
  $("turma-conteudo").classList.add("hidden");
  turmaOrcamentoSelecionadoId = null;
}

// Filtra os orçamentos pelo texto digitado (número do orçamento ou nome da empresa, sem diferenciar
// maiúsculas/acentos) e repopula o select, mantendo a seleção atual quando ela continua no resultado.
const textoBuscaTurma = (t) => String(t == null ? "" : t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function preencherSelectOrcamentosTurma() {
  const termo = textoBuscaTurma($("turma-orcamento-busca").value.trim());
  const filtrados = !termo ? listaOrcamentosParaTurma : listaOrcamentosParaTurma.filter((o) =>
    textoBuscaTurma(o.numero).includes(termo) || textoBuscaTurma(o.empresas?.nome).includes(termo)
  );
  const valorAtual = $("turma-orcamento-select").value;
  // o orçamento já aberto na tela continua na lista mesmo que o filtro novo não o inclua (evita a tela mostrar um e o select outro)
  const opcoes = valorAtual && !filtrados.some((o) => o.id === valorAtual)
    ? [listaOrcamentosParaTurma.find((o) => o.id === valorAtual), ...filtrados].filter(Boolean) : filtrados;
  preencherSelect("turma-orcamento-select", opcoes, "id", (o) => `${o.numero} — ${o.empresas?.nome || "—"}`, "— Selecione —");
  if (opcoes.some((o) => o.id === valorAtual)) $("turma-orcamento-select").value = valorAtual;
  $("turma-orcamento-busca-info").textContent = termo
    ? (filtrados.length ? `${filtrados.length} de ${listaOrcamentosParaTurma.length} orçamento(s) encontrado(s)` : "Nenhum orçamento encontrado para esse filtro.")
    : `${listaOrcamentosParaTurma.length} orçamento(s)`;
}
$("turma-orcamento-busca").addEventListener("input", preencherSelectOrcamentosTurma);

$("turma-orcamento-select").addEventListener("change", () => {
  turmaOrcamentoSelecionadoId = $("turma-orcamento-select").value || null;
  if (!turmaOrcamentoSelecionadoId) {
    $("turma-orcamento-info").classList.add("hidden");
    $("turma-conteudo").classList.add("hidden");
    return;
  }
  const o = listaOrcamentosParaTurma.find((x) => x.id === turmaOrcamentoSelecionadoId);
  const info = $("turma-orcamento-info");
  info.classList.remove("hidden");
  info.innerHTML = `
    <p><strong>Empresa:</strong> ${o.empresas?.nome || "—"}</p>
    <p><strong>Treinamento:</strong> ${o.tipos_treinamento?.nome || "—"}</p>
    <p><strong>Status do orçamento:</strong> ${o.status}</p>
    <p><strong>Previsto:</strong> ${o.qtd_turmas || 0} turma(s) · ${o.qtd_alunos || 0} aluno(s) · ${o.qtd_alunos_por_turma || 0} aluno(s)/turma · ${o.qtd_localidades || 1} localidade(s)</p>
  `;
  $("turma-conteudo").classList.remove("hidden");
  $("btn-turma-novo").classList.toggle("hidden", !podeFazer("turmas", "incluir"));
  carregarTurmasDoOrcamento();
});

async function carregarTurmasDoOrcamento() {
  const { data } = await supabase
    .from("turmas")
    .select("*, tipos_treinamento(nome), centros_treinamento(nome), instrutor1:instrutores!instrutor1_id(nome), instrutor2:instrutores!instrutor2_id(nome), empresas_transporte(nome)")
    .eq("orcamento_id", turmaOrcamentoSelecionadoId)
    .order("identificacao", { ascending: true });
  turmasDoOrcamento = (data || []).sort(compararIdentificacaoTurma);
  renderizarFiltroStatusTurma();
  renderizarListaTurmas();
}

$("turma-filtro-data-de").addEventListener("change", () => {
  turmaFiltroDataDe = $("turma-filtro-data-de").value;
  renderizarListaTurmas();
});
$("turma-filtro-data-ate").addEventListener("change", () => {
  turmaFiltroDataAte = $("turma-filtro-data-ate").value;
  renderizarListaTurmas();
});
$("btn-turma-filtro-data-limpar").addEventListener("click", () => {
  turmaFiltroDataDe = "";
  turmaFiltroDataAte = "";
  $("turma-filtro-data-de").value = "";
  $("turma-filtro-data-ate").value = "";
  renderizarListaTurmas();
});

function renderizarFiltroStatusTurma() {
  const cont = $("turma-filtro-status");
  cont.innerHTML = TURMA_STATUS.map((s) => `
    <label class="inline-flex items-center gap-1.5">
      <input type="checkbox" data-filtro-turma-status="${s}" ${turmaFiltroStatus.has(s) ? "checked" : ""} class="rounded border-slate-300" />
      ${s}
    </label>
  `).join("");
  cont.querySelectorAll("[data-filtro-turma-status]").forEach((el) => {
    el.addEventListener("change", (e) => {
      const s = e.target.getAttribute("data-filtro-turma-status");
      if (e.target.checked) turmaFiltroStatus.add(s);
      else turmaFiltroStatus.delete(s);
      renderizarListaTurmas();
    });
  });
}

function renderizarListaTurmas() {
  const podeAlterar = podeFazer("turmas", "alterar");
  const podeExcluir = podeFazer("turmas", "excluir");
  const cont = $("turma-lista");
  const lista = turmasDoOrcamento
    .filter((t) => turmaFiltroStatus.has(t.status))
    .filter((t) => !turmaFiltroDataDe || (t.data_inicio && t.data_inicio >= turmaFiltroDataDe))
    .filter((t) => !turmaFiltroDataAte || (t.data_inicio && t.data_inicio <= turmaFiltroDataAte));
  if (lista.length === 0) {
    cont.innerHTML = `<tr><td colspan="7" class="text-center text-slate-500 text-sm py-16">Nenhuma turma encontrada.</td></tr>`;
    return;
  }
  const corStatus = {
    Planejada: "bg-amber-50 text-amber-700",
    "A confirmar": "bg-orange-50 text-orange-700",
    Agendada: "bg-blue-50 text-blue-700",
    Confirmada: "bg-teal-50 text-teal-700",
    "Concluída": "bg-slate-100 text-slate-600",
    Cancelada: "bg-rose-50 text-rose-600",
  };
  cont.innerHTML = lista.map((t) => `
    <tr class="hover:bg-slate-50">
      <td class="px-3 py-2 font-mono text-slate-700">${t.identificacao || "—"}</td>
      <td class="px-3 py-2 text-slate-700">${t.tipos_treinamento?.nome || "—"}</td>
      <td class="px-3 py-2 text-slate-500">${t.tipo_dia || "—"}</td>
      <td class="px-3 py-2 text-slate-500">${t.centros_treinamento?.nome || "—"}</td>
      <td class="px-3 py-2 text-slate-500">${t.data_inicio || "—"}${t.data_fim && t.data_fim !== t.data_inicio ? ` a ${t.data_fim}` : ""}</td>
      <td class="px-3 py-2"><span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${corStatus[t.status] || ""}">${t.status}</span></td>
      <td class="px-3 py-2 text-right whitespace-nowrap">
        <button data-turma-alunos="${t.id}" class="text-xs font-medium text-slate-600 hover:text-slate-900 px-1.5 py-1">👥 Alunos</button>
        <button data-turma-exportar="${t.id}" class="text-xs font-medium text-slate-600 hover:text-slate-900 px-1.5 py-1" title="Exportar lista de presença dos alunos desta turma">📄 Lista de presença</button>
        <button data-turma-localidades="${t.id}" class="text-xs font-medium text-slate-600 hover:text-slate-900 px-1.5 py-1">📍 Localidades</button>
        <button data-turma-qrcode="${t.id}" class="text-xs font-medium text-slate-600 hover:text-slate-900 px-1.5 py-1">📱 QR Code Alunos</button>
        ${podeAlterar ? `<button data-turma-editar="${t.id}" class="text-xs font-medium text-slate-600 hover:text-slate-900 px-1.5 py-1">✏️ Editar</button>` : ""}
        ${podeExcluir ? `<button data-turma-excluir="${t.id}" class="text-xs font-medium text-rose-500 hover:text-rose-700 px-1.5 py-1">🗑️ Excluir</button>` : ""}
      </td>
    </tr>
  `).join("");
  cont.querySelectorAll("[data-turma-editar]").forEach((btn) => btn.addEventListener("click", () => abrirEdicaoTurma(btn.getAttribute("data-turma-editar"))));
  cont.querySelectorAll("[data-turma-excluir]").forEach((btn) => btn.addEventListener("click", () => excluirTurma(btn.getAttribute("data-turma-excluir"))));
  cont.querySelectorAll("[data-turma-alunos]").forEach((btn) => btn.addEventListener("click", () => abrirPainelAlunosTurma(btn.getAttribute("data-turma-alunos"))));
  cont.querySelectorAll("[data-turma-exportar]").forEach((btn) => btn.addEventListener("click", () => exportarListaPresencaTurma(btn.getAttribute("data-turma-exportar"))));
  cont.querySelectorAll("[data-turma-localidades]").forEach((btn) => btn.addEventListener("click", () => abrirPainelLocalidadesTurma(btn.getAttribute("data-turma-localidades"))));
  cont.querySelectorAll("[data-turma-qrcode]").forEach((btn) => btn.addEventListener("click", () => abrirQrCodeTurma(btn.getAttribute("data-turma-qrcode"))));
}

async function exportarListaPresencaTurma(turmaId) {
  const t = turmasDoOrcamento.find((x) => x.id === turmaId);
  const o = listaOrcamentosParaTurma.find((x) => x.id === turmaOrcamentoSelecionadoId);
  if (!t || !o) return;

  const confirmou = confirm(
    "Confirmar a exportação dos dados dos alunos para a lista de presença?\n\n" +
    `Orçamento: ${o.numero || "—"}\n` +
    `Turma: ${t.identificacao || "—"}\n` +
    `Empresa: ${o.empresas?.nome || "—"}`
  );
  if (!confirmou) return;

  if (typeof XlsxPopulate === "undefined") {
    alert("Não foi possível carregar o gerador de planilha. Verifique sua conexão e tente novamente.");
    return;
  }

  try {
    const [{ data: alunos, error: erroAlunos }, { data: locs }] = await Promise.all([
      supabase.from("turma_alunos").select("*").eq("turma_id", turmaId).order("nome", { ascending: true }),
      supabase.from("turma_localidades").select("id, nome").eq("turma_id", turmaId),
    ]);
    if (erroAlunos) throw erroAlunos;

    const lista = alunos || [];
    if (lista.length === 0) {
      alert("Esta turma não possui alunos cadastrados.");
      return;
    }

    const nomeLocalidade = {};
    (locs || []).forEach((l) => { nomeLocalidade[l.id] = l.nome; });

    const resp = await fetch(URL_TEMPLATE_LISTA_PRESENCA, { cache: "no-store" });
    if (!resp.ok) throw new Error("template HTTP " + resp.status);
    const buffer = await resp.arrayBuffer();

    const wb = await XlsxPopulate.fromDataAsync(buffer);
    const sheet = wb.sheet("Termo de Reserva") || wb.sheet(0);

    sheet.cell("AB4").value(o.numero || "");
    sheet.cell("D13").value(o.empresas?.cnpj ? MASCARAS.cnpj(String(o.empresas.cnpj)) : "");

    const LINHA_INICIAL = 19;
    lista.forEach((a, i) => {
      const r = LINHA_INICIAL + i;
      sheet.cell("B" + r).value(a.nome || "");
      sheet.cell("O" + r).value(a.cpf ? MASCARAS.cpf(String(a.cpf)) : "");
      sheet.cell("T" + r).value(nomeLocalidade[a.localidade_id] || "");
      sheet.cell("AB" + r).value(a.cnpj_atestado ? MASCARAS.cnpj(String(a.cnpj_atestado)) : "");
      sheet.cell("AE" + r).value(a.cnpj_faturamento ? MASCARAS.cnpj(String(a.cnpj_faturamento)) : "");
    });

    const blob = await wb.outputAsync();
    const slug = (s) => String(s || "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
    const nomeArquivo = `Lista_Presenca_${slug(o.numero) || "orcamento"}_Turma_${slug(t.identificacao) || "turma"}.xlsx`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    if (lista.length > 40) {
      alert(
        `A turma possui ${lista.length} alunos, mas o modelo tem apenas 40 linhas numeradas. ` +
        "Os alunos após o 40º foram incluídos nas linhas seguintes, sem numeração/formatação."
      );
    }
  } catch (e) {
    console.error("Falha ao exportar lista de presença:", e);
    alert("Não foi possível gerar a lista de presença. Tente novamente.");
  }
}

function abrirQrCodeTurma(turmaId) {
  const t = turmasDoOrcamento.find((x) => x.id === turmaId);
  const link = `${URL_APP_ALUNO}/?turma=${turmaId}`;
  $("painel-qrcode-turma-titulo").textContent = `QR Code — Turma ${t?.identificacao || ""}`;
  $("qrcode-turma-link").textContent = link;
  $("painel-qrcode-turma").classList.remove("hidden");
  if (typeof QRCode === "undefined") {
    $("qrcode-turma-link").textContent = "Não foi possível carregar o gerador de QR Code. Verifique sua conexão e tente novamente.";
    return;
  }
  QRCode.toCanvas($("qrcode-turma-canvas"), link, { width: 220, margin: 1 });
}

function preencherSelectAgenda(id, val) {
  preencherSelect(id, AGENDA_STATUS.map((s) => ({ id: s, nome: s })), "id", (i) => i.nome, null);
  $(id).value = val || "A agendar";
}

function abrirNovaTurma() {
  editandoTurmaId = null;
  esconderErro("turma-form-erro");
  const o = listaOrcamentosParaTurma.find((x) => x.id === turmaOrcamentoSelecionadoId);
  $("turma-identificacao").value = "";
  preencherSelect("turma-tipo", listaTiposAtivos, "id", (i) => i.nome, "— Selecione —");
  $("turma-tipo").value = (o && o.tipo_treinamento_id) || "";
  preencherSelect("turma-centro", listaCentrosAtivos, "id", (i) => i.nome, "— Selecione —");
  $("turma-centro").value = (o && o.centro_treinamento_id) || "";
  preencherSelect("turma-instrutor", listaInstrutoresAtivos, "id", (i) => i.nome, "— Selecione —");
  $("turma-data-inicio").value = "";
  $("turma-data-fim").value = "";
  $("turma-horario").value = "";
  $("turma-vagas").value = (o && o.qtd_alunos_por_turma) || "";
  preencherSelect("turma-status", TURMA_STATUS.map((s) => ({ id: s, nome: s })), "id", (i) => i.nome, null);
  $("turma-status").value = "Planejada";
  $("turma-observacoes").value = "";
  preencherSelectAgenda("turma-agenda-ct", "A agendar");
  preencherSelectAgenda("turma-agenda-instrutor1", "A agendar");
  preencherSelectAgenda("turma-agenda-instrutor2", "Não aplicável");
  preencherSelectAgenda("turma-agenda-transporte", "A agendar");
  preencherSelectAgenda("turma-agenda-movel", "Não aplicável");
  $("painel-turma-titulo").textContent = "Nova turma";
  $("btn-salvar-turma").textContent = "Salvar turma";
  $("painel-turma").classList.remove("hidden");
}

function abrirEdicaoTurma(id) {
  const t = turmasDoOrcamento.find((x) => x.id === id);
  if (!t) return;
  editandoTurmaId = id;
  esconderErro("turma-form-erro");
  $("turma-identificacao").value = t.identificacao || "";
  preencherSelect("turma-tipo", listaTiposAtivos, "id", (i) => i.nome, "— Selecione —");
  $("turma-tipo").value = t.tipo_treinamento_id || "";
  preencherSelect("turma-centro", listaCentrosAtivos, "id", (i) => i.nome, "— Selecione —");
  $("turma-centro").value = t.centro_treinamento_id || "";
  preencherSelect("turma-instrutor", listaInstrutoresAtivos, "id", (i) => i.nome, "— Selecione —");
  $("turma-instrutor").value = t.instrutor_id || "";
  $("turma-data-inicio").value = t.data_inicio || "";
  $("turma-data-fim").value = t.data_fim || "";
  $("turma-horario").value = t.horario || "";
  $("turma-vagas").value = t.vagas || "";
  preencherSelect("turma-status", TURMA_STATUS.map((s) => ({ id: s, nome: s })), "id", (i) => i.nome, null);
  $("turma-status").value = t.status;
  $("turma-observacoes").value = t.observacoes || "";
  preencherSelectAgenda("turma-agenda-ct", t.agenda_ct);
  preencherSelectAgenda("turma-agenda-instrutor1", t.agenda_instrutor1);
  preencherSelectAgenda("turma-agenda-instrutor2", t.agenda_instrutor2);
  preencherSelectAgenda("turma-agenda-transporte", t.agenda_transporte);
  preencherSelectAgenda("turma-agenda-movel", t.agenda_movel);
  $("painel-turma-titulo").textContent = "Editar turma";
  $("btn-salvar-turma").textContent = "Salvar alterações";
  $("painel-turma").classList.remove("hidden");
}

$("btn-turma-novo").addEventListener("click", abrirNovaTurma);
$("btn-fechar-painel-turma").addEventListener("click", () => $("painel-turma").classList.add("hidden"));
$("btn-cancelar-painel-turma").addEventListener("click", () => $("painel-turma").classList.add("hidden"));
$("painel-turma-overlay").addEventListener("click", () => $("painel-turma").classList.add("hidden"));

async function salvarTurma() {
  esconderErro("turma-form-erro");
  const identificacao = $("turma-identificacao").value.trim();
  const tipoId = $("turma-tipo").value;
  if (!identificacao) return mostrarErro("turma-form-erro", "Informe a identificação da turma.");
  if (!tipoId) return mostrarErro("turma-form-erro", "Selecione o treinamento.");
  const tipo = listaTiposAtivos.find((t) => t.id === tipoId);
  const diasTotais = tipo ? Math.max(0, Number(tipo.dias_teoria) || 0) + Math.max(0, Number(tipo.dias_pratica) || 0) + Math.max(0, Number(tipo.dias_teoria_pratica) || 0) : null;

  const payload = {
    orcamento_id: turmaOrcamentoSelecionadoId,
    identificacao,
    tipo_treinamento_id: tipoId,
    dias_totais: diasTotais,
    centro_treinamento_id: $("turma-centro").value || null,
    instrutor_id: $("turma-instrutor").value || null,
    data_inicio: $("turma-data-inicio").value || null,
    data_fim: $("turma-data-fim").value || null,
    horario: $("turma-horario").value.trim(),
    vagas: $("turma-vagas").value ? Number($("turma-vagas").value) : null,
    status: $("turma-status").value,
    observacoes: $("turma-observacoes").value.trim(),
    agenda_ct: $("turma-agenda-ct").value,
    agenda_instrutor1: $("turma-agenda-instrutor1").value,
    agenda_instrutor2: $("turma-agenda-instrutor2").value,
    agenda_transporte: $("turma-agenda-transporte").value,
    agenda_movel: $("turma-agenda-movel").value,
  };

  $("btn-salvar-turma").disabled = true;
  $("btn-salvar-turma").textContent = "Salvando…";

  let erro, novaTurma;
  if (editandoTurmaId) {
    ({ error: erro } = await supabase.from("turmas").update(payload).eq("id", editandoTurmaId));
  } else {
    ({ data: novaTurma, error: erro } = await supabase.from("turmas").insert(payload).select().single());
  }

  $("btn-salvar-turma").disabled = false;
  if (erro) {
    $("btn-salvar-turma").textContent = editandoTurmaId ? "Salvar alterações" : "Salvar turma";
    return mostrarErro("turma-form-erro", "Não foi possível salvar. Tente novamente.");
  }

  if (novaTurma) {
    const o = listaOrcamentosParaTurma.find((x) => x.id === turmaOrcamentoSelecionadoId);
    if (o?.empresas?.cnpj) {
      await supabase.from("turma_localidades").insert({
        turma_id: novaTurma.id,
        nome: "Principal",
        cnpj_atestado: o.empresas.cnpj,
        cnpj_faturamento: o.empresas.cnpj,
      });
    }
  }

  $("painel-turma").classList.add("hidden");
  await carregarTurmasDoOrcamento();
}

$("btn-salvar-turma").addEventListener("click", salvarTurma);

async function excluirTurma(id) {
  const t = turmasDoOrcamento.find((x) => x.id === id);
  if (!confirmarExclusao(`a turma ${t?.identificacao || ""}`.trim())) return;
  const { error } = await supabase.from("turmas").delete().eq("id", id);
  if (!error) await carregarTurmasDoOrcamento();
}

// ===========================================================
// OPERAÇÃO: AGENDAMENTO DE TURMAS
// ===========================================================

async function carregarAgendamentoTurmasInit() {
  $("admin-descricao-pagina").textContent = "Selecione o Centro de Treinamento e o orçamento para verificar disponibilidade e agendar as turmas.";
  const [{ data: centros }, { data: insts }] = await Promise.all([
    supabase.from("centros_treinamento").select("*").eq("status", "Ativo").order("nome"),
    supabase.from("instrutores").select("*").eq("status", "Ativo").order("nome"),
  ]);
  listaCentrosAtivos = centros || [];
  listaInstrutoresAtivos = insts || [];

  preencherSelect("agend-centro-select", listaCentrosAtivos, "id", (c) => c.nome, "— Selecione —");
  $("agend-centro-select").value = "";
  $("agend-orcamento-busca").value = "";
  $("agend-orcamento-busca").disabled = true;
  $("agend-orcamento-select").innerHTML = `<option value="">— Selecione —</option>`;
  $("agend-orcamento-select").disabled = true;
  $("agend-orcamento-info").classList.add("hidden");
  $("agend-turma-conteudo").classList.add("hidden");
  agendTurmaCentroId = null;
  agendTurmaOrcamentoId = null;
  agendTurmaListaOrcamentos = [];
  agendTurmasLista = [];
  agendTurmaSelecionadas.clear();
  agendTurmaCentroStatus.clear();
  agendTurmaInstrutores.clear();
  agendTurmaRankingInstrutores = [];
  $("agend-desmarcacoes-resultado").classList.add("hidden");
  await carregarDesmarcacoesPendentes();
}

// ===========================================================
// Solicitações de desmarcação feitas pelos instrutores
// (app Agenda de Instrutores → solicitar_desmarcacao_agendamento).
// O operador aprova ou rejeita aqui; aprovando, o dia é liberado na
// agenda do instrutor e a turma volta ao estado inicial ("A agendar",
// sem instrutor), pronta para nova seleção e nova solicitação.
// ===========================================================
let desmarcacoesPendentes = [];

async function carregarDesmarcacoesPendentes(forcar = true) {
  const { data, error } = await supabase.rpc("listar_desmarcacoes_pendentes");
  if (error) {
    console.warn("Não foi possível carregar as solicitações de desmarcação:", error.message);
    return;
  }
  if (!forcar && !dadosMudaram("desmarcacoes", data)) return;
  if (forcar) dadosMudaram("desmarcacoes", data);
  desmarcacoesPendentes = data || [];
  renderizarDesmarcacoesPendentes();
}

function renderizarDesmarcacoesPendentes() {
  const bloco = $("agend-desmarcacoes-bloco");
  if (desmarcacoesPendentes.length === 0) {
    bloco.classList.add("hidden");
    return;
  }
  bloco.classList.remove("hidden");
  $("agend-desmarcacoes-badge").textContent = String(desmarcacoesPendentes.length);
  const pode = podeFazer("agendamento_turmas", "alterar") || podeFazer("agendamentos", "alterar");
  $("agend-desmarcacoes-lista").innerHTML = desmarcacoesPendentes.map((d, i) => `
    <tr class="hover:bg-rose-50/40">
      <td class="px-3 py-2 whitespace-nowrap text-slate-700">${formatarDataBr(d.data)}</td>
      <td class="px-3 py-2"><div class="text-slate-700">${d.instrutor_nome || "—"}</div><div class="text-[11px] text-slate-500">${d.papel || ""}</div></td>
      <td class="px-3 py-2"><div class="font-mono text-slate-700">${d.turma_identificacao || "—"}</div><div class="text-[11px] text-slate-500">${d.tipo_treinamento || ""}</div></td>
      <td class="px-3 py-2"><div class="font-mono text-xs text-slate-500">${d.orcamento_numero || "—"}</div><div class="text-slate-700">${d.empresa_nome || "—"}</div></td>
      <td class="px-3 py-2 text-slate-600 max-w-xs">${d.justificativa || "—"}</td>
      <td class="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">${formatarDataHoraBr(d.solicitado_em)}</td>
      <td class="px-3 py-2 text-right whitespace-nowrap">
        ${pode ? `<button data-desm-aprovar="${i}" class="text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 px-2.5 py-1 rounded-md">Aprovar desmarcação</button>
        <button data-desm-rejeitar="${i}" class="ml-1 text-xs font-medium text-slate-600 hover:bg-slate-100 border border-slate-300 px-2.5 py-1 rounded-md">Rejeitar</button>`
        : `<span class="text-xs text-slate-400">sem permissão</span>`}
      </td>
    </tr>
  `).join("");
  $("agend-desmarcacoes-lista").querySelectorAll("[data-desm-aprovar]").forEach((el) =>
    el.addEventListener("click", () => responderDesmarcacao(Number(el.getAttribute("data-desm-aprovar")), true)));
  $("agend-desmarcacoes-lista").querySelectorAll("[data-desm-rejeitar]").forEach((el) =>
    el.addEventListener("click", () => responderDesmarcacao(Number(el.getAttribute("data-desm-rejeitar")), false)));
}

function formatarDataHoraBr(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function responderDesmarcacao(indice, aprovar) {
  const d = desmarcacoesPendentes[indice];
  if (!d) return;
  let observacao = null;
  if (aprovar) {
    if (!confirm(`Aprovar a desmarcação de ${d.instrutor_nome} em ${formatarDataBr(d.data)} (turma ${d.turma_identificacao || "—"})?\n\n• O dia será liberado na agenda do instrutor.\n• A turma volta para "Não agendado", sem instrutor, para nova seleção e nova solicitação de confirmação.`)) return;
  } else {
    observacao = prompt(`Rejeitar a desmarcação de ${d.instrutor_nome} em ${formatarDataBr(d.data)}?\n\nInforme o motivo (opcional) — a data continua confirmada:`, "");
    if (observacao === null) return;
  }

  const { error } = await supabase.rpc("responder_desmarcacao_agendamento", {
    p_agendamento_id: d.agendamento_id,
    p_data: d.data,
    p_aprovar: aprovar,
    p_observacao: observacao || null,
  });

  const el = $("agend-desmarcacoes-resultado");
  el.classList.remove("hidden");
  if (error) {
    el.className = "mb-3 text-sm rounded-md px-3 py-2 bg-rose-100 text-rose-800";
    el.textContent = `Não foi possível responder à solicitação: ${error.message}`;
    return;
  }
  el.className = "mb-3 text-sm rounded-md px-3 py-2 bg-teal-50 text-teal-800";
  el.textContent = aprovar
    ? `Desmarcação aprovada. O dia ${formatarDataBr(d.data)} foi liberado para ${d.instrutor_nome} e a turma ${d.turma_identificacao || ""} voltou para "Não agendado".`
    : `Solicitação rejeitada. A data ${formatarDataBr(d.data)} continua confirmada para ${d.instrutor_nome}.`;

  await carregarDesmarcacoesPendentes();
  if (agendTurmaOrcamentoId && d.orcamento_id === agendTurmaOrcamentoId) {
    if (aprovar) {
      agendTurmaInstrutores.delete(d.turma_id); // limpa a escolha em memória da turma liberada
      agendTurmaCentroStatus.delete(d.turma_id);
    }
    await recarregarTurmasAgendTurma();
    renderizarListaAgendTurmas();
  }
}

$("agend-centro-select").addEventListener("change", async () => {
  agendTurmaCentroId = $("agend-centro-select").value || null;
  agendTurmaOrcamentoId = null;
  agendTurmaSelecionadas.clear();
  agendTurmaCentroStatus.clear();
  agendTurmaInstrutores.clear();
  agendTurmaRankingInstrutores = [];
  $("agend-orcamento-info").classList.add("hidden");
  $("agend-turma-conteudo").classList.add("hidden");

  if (!agendTurmaCentroId) {
    $("agend-orcamento-busca").value = "";
    $("agend-orcamento-busca").disabled = true;
    $("agend-orcamento-select").innerHTML = `<option value="">— Selecione —</option>`;
    $("agend-orcamento-select").disabled = true;
    return;
  }

  const { data: orcs } = await buscarTodos(() => supabase
    .from("orcamentos")
    .select(SELECT_ORCAMENTO_AGEND_TURMA)
    .eq("centro_treinamento_id", agendTurmaCentroId)
    .order("created_at", { ascending: false })
    .order("id"));
  agendTurmaListaOrcamentos = orcs || [];
  agendTurmaCentroOrcamentosQtd = agendTurmaListaOrcamentos.length;
  $("agend-orcamento-busca").value = "";
  $("agend-orcamento-busca").disabled = false;
  preencherSelectOrcamentosAgendTurma();
  $("agend-orcamento-select").disabled = false;
});

// O Centro de Treinamento escolhido na tela é onde o treinamento será REALIZADO: a lista
// inicial traz os orçamentos cadastrados nesse CT, mas a busca (a partir de 3 letras) procura
// em TODOS os orçamentos — o cliente pode ser de uma unidade e a turma agendada em outra.
const SELECT_ORCAMENTO_AGEND_TURMA = "*, empresas(nome, nome_fantasia, cnpj, cnpj_grupo_economico), tipos_treinamento(nome)";
let agendTurmaCentroOrcamentosQtd = 0;
let agendOrcamentoBuscaTimer = null;

// Filtra agendTurmaListaOrcamentos pelo texto digitado em "agend-orcamento-busca"
// (número do orçamento, razão social ou nome fantasia, sem diferenciar maiúsculas/acentos)
// e repopula o select, preservando a seleção atual (mesmo que o filtro novo não a inclua).
function preencherSelectOrcamentosAgendTurma() {
  const termo = textoBuscaTurma(($("agend-orcamento-busca").value || "").trim());
  const filtrados = !termo ? agendTurmaListaOrcamentos : agendTurmaListaOrcamentos.filter((o) =>
    textoBuscaTurma(o.numero).includes(termo) ||
    textoBuscaTurma(o.empresas?.nome).includes(termo) ||
    textoBuscaTurma(o.empresas?.nome_fantasia).includes(termo)
  );
  const valorAtual = $("agend-orcamento-select").value;
  const opcoes = valorAtual && !filtrados.some((o) => o.id === valorAtual)
    ? [agendTurmaListaOrcamentos.find((o) => o.id === valorAtual), ...filtrados].filter(Boolean) : filtrados;
  preencherSelect("agend-orcamento-select", opcoes, "id", (o) => `${o.numero} — ${o.empresas?.nome || "—"}${o.empresas?.nome_fantasia ? ` (${o.empresas.nome_fantasia})` : ""}`, "— Selecione —");
  if (opcoes.some((o) => o.id === valorAtual)) $("agend-orcamento-select").value = valorAtual;
  const info = $("agend-orcamento-busca-info");
  if (info) {
    info.textContent = termo
      ? (filtrados.length ? `${filtrados.length} orçamento(s) encontrado(s)` : (termo.length < 3 ? "Digite ao menos 3 letras para procurar em todos os orçamentos." : "Nenhum orçamento encontrado."))
      : `${agendTurmaCentroOrcamentosQtd} orçamento(s) cadastrado(s) neste CT — digite para procurar em todos os orçamentos`;
  }
}

// Busca no servidor (todos os orçamentos, de qualquer CT) e junta o resultado à lista da tela.
function buscarOrcamentosAgendNoServidor() {
  clearTimeout(agendOrcamentoBuscaTimer);
  const termo = ($("agend-orcamento-busca").value || "").trim();
  const t = termo.replace(/[,()*%\\"]/g, " ").replace(/\s+/g, " ").trim();
  if (t.length < 3) return;
  agendOrcamentoBuscaTimer = setTimeout(async () => {
    const info = $("agend-orcamento-busca-info");
    if (info) info.textContent = "Procurando em todos os orçamentos…";
    const [{ data: porNumero, error: e1 }, { data: empresas, error: e2 }] = await Promise.all([
      supabase.from("orcamentos").select(SELECT_ORCAMENTO_AGEND_TURMA).ilike("numero", `%${t}%`).order("created_at", { ascending: false }).limit(100),
      supabase.from("empresas").select("id").or(`nome.ilike.%${t}%,nome_fantasia.ilike.%${t}%`).limit(300),
    ]);
    let porEmpresa = [];
    let e3 = null;
    const idsEmpresas = (empresas || []).map((e) => e.id);
    if (idsEmpresas.length) {
      ({ data: porEmpresa, error: e3 } = await supabase.from("orcamentos").select(SELECT_ORCAMENTO_AGEND_TURMA)
        .in("empresa_id", idsEmpresas).order("created_at", { ascending: false }).limit(300));
    }
    if (($("agend-orcamento-busca").value || "").trim() !== termo) return; // o texto já mudou
    if ((e1 || e2 || e3) && info) { info.textContent = "Não foi possível procurar em todos os orçamentos agora. Mostrando só a lista carregada."; }
    const ja = new Set(agendTurmaListaOrcamentos.map((o) => o.id));
    const novos = [...(porNumero || []), ...(porEmpresa || [])].filter((o, i, arr) => !ja.has(o.id) && arr.findIndex((x) => x.id === o.id) === i);
    if (novos.length) agendTurmaListaOrcamentos = [...agendTurmaListaOrcamentos, ...novos];
    const valorAtual = $("agend-orcamento-select").value;
    preencherSelectOrcamentosAgendTurma();
    if (valorAtual) $("agend-orcamento-select").value = valorAtual;
  }, 400);
}
$("agend-orcamento-busca").addEventListener("input", () => { preencherSelectOrcamentosAgendTurma(); buscarOrcamentosAgendNoServidor(); });

$("agend-orcamento-select").addEventListener("change", async () => {
  agendTurmaOrcamentoId = $("agend-orcamento-select").value || null;
  agendTurmaSelecionadas.clear();
  agendTurmaCentroStatus.clear();
  agendTurmaInstrutores.clear();
  agendTurmaRankingInstrutores = [];

  if (!agendTurmaOrcamentoId) {
    $("agend-orcamento-info").classList.add("hidden");
    $("agend-turma-conteudo").classList.add("hidden");
    return;
  }

  const o = agendTurmaListaOrcamentos.find((x) => x.id === agendTurmaOrcamentoId);
  const info = $("agend-orcamento-info");
  info.classList.remove("hidden");
  info.innerHTML = `
    <p><strong>Empresa:</strong> ${o?.empresas?.nome || "—"}</p>
    <p><strong>Treinamento:</strong> ${o?.tipos_treinamento?.nome || "—"}</p>
    <p><strong>Status do orçamento:</strong> ${o?.status || "—"}</p>
    ${o && o.centro_treinamento_id && o.centro_treinamento_id !== agendTurmaCentroId
      ? `<p class="text-amber-700"><strong>CT do cadastro:</strong> ${listaCentrosAtivos.find((c) => c.id === o.centro_treinamento_id)?.nome || "—"} — as turmas serão realizadas em ${listaCentrosAtivos.find((c) => c.id === agendTurmaCentroId)?.nome || "—"} (CT escolhido acima).</p>`
      : ""}
    ${blocoObservacoesOrcamento(o)}
  `;

  await recarregarTurmasAgendTurma();
  $("agend-turma-conteudo").classList.remove("hidden");
  renderizarListaAgendTurmas();
});

// Recarrega as turmas do orçamento selecionado e as solicitações já enviadas
// aos instrutores (tabela agendamentos), para mostrar quem já respondeu.
// Filtros de instrutores da tela (aptidão e centro principal).
function instrutorApto(instrutor, t) {
  const cat = t?.tipos_treinamento?.categoria_treinamento_id;
  if (!cat) return true; // treinamento sem tipo definido: não filtra
  return (aptidoesPorInstrutor[instrutor.id] || []).includes(cat);
}
function instrutorDoCentro(instrutor, t) {
  if (!t?.centro_treinamento_id) return true;
  return instrutor.centro_treinamento_principal_id === t.centro_treinamento_id;
}
function filtrosInstrutorAtivos() {
  return {
    aptos: !!$("agend-filtro-aptos")?.checked,
    centro: !!$("agend-filtro-centro")?.checked,
  };
}

async function recarregarTurmasAgendTurma() {
  await carregarAptidoesRefs();
  const { data } = await supabase
    .from("turmas")
    .select("*, tipos_treinamento(nome, categoria_treinamento_id, somente_locacao_espaco), centros_treinamento(nome)")
    .eq("orcamento_id", agendTurmaOrcamentoId)
    .order("identificacao", { ascending: true });
  agendTurmasLista = (data || []).sort(compararIdentificacaoTurma);
  // O CT escolhido na tela é onde o treinamento será realizado. Se a turma está cadastrada em
  // outro CT, ela passa a ser tratada no CT da tela (a gravação só acontece ao solicitar a
  // confirmação). Turmas com CT já aguardando/confirmado em outro centro não são trocadas.
  agendTurmasLista.forEach((t) => {
    t._centroMudara = false;
    t._centroBloqueado = false;
    if (!agendTurmaCentroId || t.centro_treinamento_id === agendTurmaCentroId) return;
    if (["Cancelada", "Concluída"].includes(t.status)) return;
    if (["Aguardando confirmação", "Agendado"].includes(t.agenda_ct)) { t._centroBloqueado = true; return; }
    t._centroMudara = true;
    t._centroOriginalId = t.centro_treinamento_id;
    t.centro_treinamento_id = agendTurmaCentroId;
  });
  agendTurmaAgendamentos.clear();
  const ids = agendTurmasLista.map((t) => t.id);
  if (ids.length) {
    const { data: ags } = await supabase.from("agendamentos").select("id, turma_id, instrutor_id, datas, datas_status").in("turma_id", ids).order("id");
    (ags || []).forEach((a) => agendTurmaAgendamentos.set(`${a.turma_id}|${a.instrutor_id}`, a));
  }
  // pré-carrega no estado da tela os instrutores já gravados na turma
  agendTurmasLista.forEach((t) => {
    if ((t.instrutor1_id || t.instrutor2_id) && !agendTurmaInstrutores.has(t.id)) {
      agendTurmaInstrutores.set(t.id, { instrutor1: t.instrutor1_id || "", instrutor2: t.instrutor2_id || "" });
    }
  });
}

// Ordem natural da identificação da turma: A1, A2, A3, B1... Z9, depois AA1, AB1...
// (letras primeiro pelo tamanho do prefixo, depois alfabética; número como número)
function partesIdentificacao(id) {
  const m = String(id || "").trim().toUpperCase().match(/^([A-Z]*)(\d*)$/);
  if (!m) return { prefixo: String(id || "").toUpperCase(), numero: 0, valido: false };
  return { prefixo: m[1], numero: m[2] ? parseInt(m[2], 10) : 0, valido: true };
}

function compararIdentificacaoTurma(a, b) {
  const pa = partesIdentificacao(a?.identificacao);
  const pb = partesIdentificacao(b?.identificacao);
  if (pa.valido !== pb.valido) return pa.valido ? -1 : 1;
  if (!pa.valido) return String(a?.identificacao || "").localeCompare(String(b?.identificacao || ""), "pt-BR");
  if (pa.prefixo.length !== pb.prefixo.length) return pa.prefixo.length - pb.prefixo.length;
  if (pa.prefixo !== pb.prefixo) return pa.prefixo < pb.prefixo ? -1 : 1;
  if (pa.numero !== pb.numero) return pa.numero - pb.numero;
  return String(a?.data_inicio || "").localeCompare(String(b?.data_inicio || ""));
}

// Observações do orçamento: a geral e a dirigida ao Centro de Treinamento.
function blocoObservacoesOrcamento(o, compacto = false) {
  if (!o) return "";
  const tamanho = compacto ? "text-[11px]" : "text-xs";
  const partes = [];
  if (o.observacoes) {
    partes.push(`<div class="${tamanho} text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5 whitespace-pre-line">
      <span class="font-medium">Observações do orçamento:</span> ${o.observacoes}</div>`);
  }
  if (o.observacao_ct) {
    partes.push(`<div class="${tamanho} text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 whitespace-pre-line">
      📌 <span class="font-medium">Observação para o Centro de Treinamento:</span> ${o.observacao_ct}</div>`);
  }
  return partes.length ? `<div class="mt-2 space-y-1.5">${partes.join("")}</div>` : "";
}

const AGEND_STATUS_COR = {
  "Não agendado": "bg-slate-100 text-slate-600",
  "Aguardando confirmação": "bg-amber-50 text-amber-700",
  Agendado: "bg-teal-50 text-teal-700",
  "Pré-agendado": "bg-sky-50 text-sky-700",
};
const AGENDA_ITEM_COR = {
  "A agendar": "text-slate-400",
  "Aguardando confirmação": "text-amber-600",
  Agendado: "text-teal-700",
  "Não aplicável": "text-slate-300",
};
// `preAgendamento` só tem efeito quando o status consolidado é "Agendado":
// mostra "Pré-agendado" (azul clarinho) em vez de "Agendado" (teal). Os
// demais status (Não agendado / Aguardando confirmação) não são afetados.
function badgeStatusAgendamento(st, preAgendamento) {
  let v = st || "Não agendado";
  if (v === "Agendado" && preAgendamento) v = "Pré-agendado";
  return `<span class="text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${AGEND_STATUS_COR[v] || ""}">${v}</span>`;
}
function textoAgendaItem(v) {
  return `<span class="text-[11px] ${AGENDA_ITEM_COR[v] || "text-slate-400"}">${v || "A agendar"}</span>`;
}
// Resposta do instrutor para a data da turma: "confirmado" / "negado" / "pendente" / null (nunca solicitado)
function respostaInstrutorAgendTurma(t, instrutorId) {
  if (!instrutorId) return null;
  const a = agendTurmaAgendamentos.get(`${t.id}|${instrutorId}`);
  if (!a || !(a.datas || []).includes(t.data_inicio)) return null;
  const r = (a.datas_status || {})[t.data_inicio];
  return r ? montarRespostaInstrutor(r) : { status: "pendente" };
}

// Normaliza a entrada de datas_status, incluindo o pedido de desmarcação
// que o instrutor faz no app Agenda de Instrutores.
function montarRespostaInstrutor(r) {
  const sc = r.solicitacao_cancelamento || null;
  return {
    status: r.status,
    justificativa: r.justificativa,
    desmarcacaoPendente: !!(sc && sc.pendente),
    desmarcacaoMotivo: sc ? sc.justificativa : null,
  };
}

function iconeRespostaInstrutor(resp) {
  if (!resp) return "";
  if (resp.desmarcacaoPendente) {
    return `<span title="Motivo: ${(resp.desmarcacaoMotivo || "não informado").replace(/"/g, "&quot;")}" class="text-rose-700 text-xs font-medium">⏳ aguardando confirmação de desmarcação</span>`;
  }
  if (resp.status === "confirmado") return `<span title="Instrutor confirmou" class="text-teal-700 text-xs">✔ confirmou</span>`;
  if (resp.status === "negado") return `<span title="${(resp.justificativa || "").replace(/"/g, "&quot;")}" class="text-rose-600 text-xs">✖ negou</span>`;
  return `<span class="text-amber-600 text-xs">⏳ aguardando</span>`;
}

// A turma tem algum instrutor com desmarcação pendente?
function turmaComDesmarcacaoPendente(t) {
  return [t.instrutor1_id, t.instrutor2_id].some((id) => respostaInstrutorAgendTurma(t, id)?.desmarcacaoPendente);
}

// A turma já tem algum instrutor que confirmou a data? É a partir daqui que o
// horário de deslocamento passa a fazer sentido (e que mudar o horário da aula
// dispara o aviso ao instrutor — ver trigger notificar_alteracao_horario_turma).
function algumInstrutorConfirmouAgendTurma(t) {
  return [t.instrutor1_id, t.instrutor2_id].some((id) => respostaInstrutorAgendTurma(t, id)?.status === "confirmado");
}

function celulaCentroAgendTurma(t) {
  const agenda = `<div class="mt-0.5">${textoAgendaItem(t.agenda_ct)}</div>`;
  if (!agendTurmaSelecionadas.has(t.id)) return `<span class="text-slate-300">—</span>${agenda}`;
  const info = agendTurmaCentroStatus.get(t.id);
  if (!info) return `<span class="text-slate-400">A verificar</span>${agenda}`;
  return (info.disponivel
    ? `<span class="text-teal-700 font-medium">Disponível</span>`
    : `<span class="text-rose-600 font-medium">Indisponível</span>`) + agenda;
}

// Treinamento "somente locação de espaço": a turma não tem instrutor e só o
// Centro de Treinamento confirma (o banco já força agenda_instrutor1/2 =
// "Não aplicável" e ignora o pedido de confirmação a instrutores).
function turmaSomenteLocacao(t) {
  return !!t?.tipos_treinamento?.somente_locacao_espaco;
}
function celulaLocacaoEspaco(campo) {
  if (campo === "instrutor2") return `<span class="text-slate-300 text-xs">—</span>`;
  return `<span class="text-[11px] text-slate-500" title="Treinamento somente de locação de espaço: não há instrutor nem confirmação de instrutor, só do Centro de Treinamento.">🏢 Locação de espaço — sem instrutor</span>`;
}

// Janela de 30 dias usada para mostrar, ao lado do nome de cada instrutor no
// seletor, quantos dias ele tem disponíveis/agendados perto da data da turma:
// 15 dias antes da data (exclusive) + 15 dias a partir da data (inclusive).
function janelaDisponibilidadeAgendTurma(dataInicio) {
  if (!dataInicio) return [];
  const [ano, mes, dia] = dataInicio.split("-").map(Number);
  const base = new Date(ano, mes - 1, dia);
  const dias = [];
  for (let i = -15; i <= 14; i++) {
    dias.push(formatarData(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)));
  }
  return dias;
}
function contarDisponibilidadeJanela(instrutor, dias) {
  let disponiveis = 0, agendados = 0;
  dias.forEach((d) => {
    const status = obterStatusDia(instrutor.dias_status, d);
    if (status === "disponivel") disponiveis++;
    else if (status === "agendado") agendados++;
  });
  return { disponiveis, agendados };
}

function celulaInstrutorAgendTurma(t, campo) {
  if (turmaSomenteLocacao(t)) return celulaLocacaoEspaco(campo);
  if (!agendTurmaSelecionadas.has(t.id)) return celulaInstrutorSomenteLeitura(t, campo);
  const escolha = agendTurmaInstrutores.get(t.id) || { instrutor1: "", instrutor2: "" };
  const outroCampo = campo === "instrutor1" ? "instrutor2" : "instrutor1";
  const idOutro = escolha[outroCampo];

  if (agendTurmaCentroStatus.size === 0) {
    return `<span class="text-slate-400 text-xs">A verificar</span>`;
  }

  const valorAtual = escolha[campo] || "";
  const filtros = filtrosInstrutorAtivos();
  const candidatos = agendTurmaRankingInstrutores.filter((r) => {
    if (r.instrutor.id === idOutro) return false;
    if (r.instrutor.id === valorAtual) return true; // já atribuído à turma (pode estar "aguardando" nesse dia)
    if (filtros.aptos && !instrutorApto(r.instrutor, t)) return false;
    if (filtros.centro && !instrutorDoCentro(r.instrutor, t)) return false;
    const diasStatus = r.instrutor.dias_status || {};
    return obterStatusDia(diasStatus, t.data_inicio) === "disponivel";
  });
  if (valorAtual && !candidatos.some((r) => r.instrutor.id === valorAtual)) {
    const inst = listaInstrutoresAtivos.find((i) => i.id === valorAtual);
    if (inst) candidatos.unshift({ instrutor: inst, fullyAvailable: true });
  }

  const janela = janelaDisponibilidadeAgendTurma(t.data_inicio);
  const opcoes = candidatos
    .map((r) => {
      const { disponiveis, agendados } = contarDisponibilidadeJanela(r.instrutor, janela);
      return `<option value="${r.instrutor.id}" ${r.instrutor.id === valorAtual ? "selected" : ""} ${!r.fullyAvailable ? 'style="background-color:#fed7aa;"' : ""}>${r.instrutor.nome} (${disponiveis} disp. / ${agendados} agend.)</option>`;
    })
    .join("");
  const resp = respostaInstrutorAgendTurma(t, valorAtual);
  const vazio = candidatos.length === 0
    ? `<div class="text-[10px] text-rose-600 mt-0.5">Nenhum instrutor atende aos filtros nesta data.</div>` : "";
  const alerta = valorAtual && filtros.aptos && !instrutorApto(listaInstrutoresAtivos.find((i) => i.id === valorAtual) || {}, t)
    ? `<div class="text-[10px] text-amber-600 mt-0.5">⚠️ não é apto a este tipo de treinamento</div>` : "";
  return `<select data-agend-turma-instrutor="${t.id}" data-campo="${campo}" class="text-[10px] rounded-md border border-slate-300 px-1.5 py-1 w-full max-w-[230px]">
    <option value="">— Selecione —</option>
    ${opcoes}
  </select>${vazio}${alerta}
  <div class="mt-0.5">${iconeRespostaInstrutor(resp) || textoAgendaItem(t[campo === "instrutor1" ? "agenda_instrutor1" : "agenda_instrutor2"])}</div>`;
}

// Quando a turma ainda não foi verificada nesta sessão, mostra o instrutor
// já gravado e a situação da confirmação em vez do "—".
function celulaInstrutorSomenteLeitura(t, campo) {
  if (turmaSomenteLocacao(t)) return celulaLocacaoEspaco(campo);
  const id = t[campo + "_id"];
  if (!id) return `<span class="text-slate-300 text-xs">—</span>`;
  const inst = listaInstrutoresAtivos.find((i) => i.id === id);
  const resp = respostaInstrutorAgendTurma(t, id);
  return `<div class="text-xs text-slate-700">${inst?.nome || "—"}</div>
    <div class="mt-0.5">${iconeRespostaInstrutor(resp) || textoAgendaItem(t[campo === "instrutor1" ? "agenda_instrutor1" : "agenda_instrutor2"])}</div>`;
}

// Aviso por turma quando o CT onde ela será realizada difere do CT do cadastro.
function rotuloCentroAgendTurma(t) {
  const nomeCentro = (id) => listaCentrosAtivos.find((c) => c.id === id)?.nome || "—";
  if (t._centroMudara) {
    return `<span class="text-[11px] text-amber-700" title="O CT da turma será gravado como ${nomeCentro(t.centro_treinamento_id)} ao solicitar a confirmação.">🏢 Realizada em ${nomeCentro(t.centro_treinamento_id)} (cadastro: ${t.centros_treinamento?.nome || nomeCentro(t._centroOriginalId)}) — será gravado ao solicitar confirmação</span>`;
  }
  if (t._centroBloqueado) {
    return `<span class="text-[11px] text-rose-700" title="Desfaça a confirmação do CT atual antes de mudar de unidade.">⚠ CT em ${t.centros_treinamento?.nome || nomeCentro(t.centro_treinamento_id)} já aguardando/confirmado — não será trocado</span>`;
  }
  return "";
}

function renderizarListaAgendTurmas() {
  const cont = $("agend-turma-lista");
  if (agendTurmasLista.length === 0) {
    cont.innerHTML = `<tr><td colspan="10" class="text-center text-slate-500 text-sm py-16">Nenhuma turma cadastrada para este orçamento.</td></tr>`;
    return;
  }
  const corStatus = {
    Planejada: "bg-amber-50 text-amber-700",
    "A confirmar": "bg-orange-50 text-orange-700",
    Agendada: "bg-blue-50 text-blue-700",
    Confirmada: "bg-teal-50 text-teal-700",
    "Concluída": "bg-slate-100 text-slate-600",
    Cancelada: "bg-rose-50 text-rose-600",
  };
  cont.innerHTML = agendTurmasLista.map((t) => `
    <tr class="hover:bg-slate-50">
      <td class="px-3 pt-2 pb-1"><input type="checkbox" data-agend-turma-check="${t.id}" ${agendTurmaSelecionadas.has(t.id) ? "checked" : ""} class="rounded border-slate-300" /></td>
      <td class="px-3 pt-2 pb-1 font-mono text-slate-700">${t.identificacao || "—"}</td>
      <td class="px-3 pt-2 pb-1 text-slate-500">${t.tipo_dia || "—"}</td>
      <td class="px-3 pt-2 pb-1 text-slate-500">
        <input type="date" data-agend-turma-data="${t.id}" value="${t.data_inicio || ""}" class="w-full min-w-[140px] text-xs rounded-md border border-slate-300 px-2 py-1.5" />
      </td>
      <td class="px-3 pt-2 pb-1"><span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${corStatus[t.status] || ""}">${t.status}</span></td>
      <td class="px-3 pt-2 pb-1">${badgeStatusAgendamento(t.status_agendamento, t.eh_pre_agendamento)}${turmaComDesmarcacaoPendente(t) ? `<div class="mt-0.5 text-[11px] text-rose-700 font-medium">desmarcação solicitada</div>` : ""}</td>
      <td class="px-3 pt-2 pb-1 text-center">
        <input type="checkbox" data-agend-turma-pre="${t.id}" ${t.eh_pre_agendamento ? "checked" : ""}
          title="Marcar esta turma como pré-agendamento (dia aparece em azul clarinho na agenda do CT e do instrutor até virar agendamento definitivo)"
          class="rounded border-slate-300" />
      </td>
      <td class="px-3 pt-2 pb-1 text-xs">${celulaCentroAgendTurma(t)}</td>
      <td class="px-3 pt-2 pb-1">${celulaInstrutorAgendTurma(t, "instrutor1")}</td>
      <td class="px-3 pt-2 pb-1">${celulaInstrutorAgendTurma(t, "instrutor2")}</td>
    </tr>
    <tr class="border-b border-slate-100 hover:bg-slate-50">
      <td colspan="10" class="px-3 pt-0 pb-2">
        <div class="flex flex-wrap items-center gap-x-5 gap-y-1 pl-0.5">
          <label class="flex items-center gap-1.5 text-[11px] text-slate-500">
            Horário aula
            <input type="time" data-agend-turma-horario="${t.id}" value="${t.horario || ""}" title="Horário de início da aula — alterar aqui não afeta as demais turmas. Se algum instrutor já confirmou, ele recebe um aviso do novo horário." class="text-xs rounded-md border border-slate-300 px-2 py-1 w-[6.5rem]" />
          </label>
          ${rotuloCentroAgendTurma(t)}
          ${turmaSomenteLocacao(t) ? "" : `<label class="flex items-center gap-1.5 text-[11px] text-slate-500">
            Horário deslocamento
            ${algumInstrutorConfirmouAgendTurma(t)
              ? `<input type="time" data-agend-turma-deslocamento="${t.id}" value="${t.horario_deslocamento || ""}" title="Horário em que o instrutor deve iniciar o deslocamento até esta turma" class="text-xs rounded-md border border-slate-300 px-2 py-1 w-[6.5rem]" />`
              : `<span class="text-[11px] text-slate-300" title="Só é possível definir depois que algum instrutor confirmar a data">— (aguardando confirmação)</span>`}
          </label>`}
        </div>
      </td>
    </tr>
  `).join("");
  cont.querySelectorAll("[data-agend-turma-check]").forEach((el) => {
    el.addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-agend-turma-check");
      if (e.target.checked) agendTurmaSelecionadas.add(id);
      else agendTurmaSelecionadas.delete(id);
    });
  });
  cont.querySelectorAll("[data-agend-turma-instrutor]").forEach((el) => {
    el.addEventListener("change", (e) => {
      const turmaId = e.target.getAttribute("data-agend-turma-instrutor");
      const campo = e.target.getAttribute("data-campo");
      const atual = agendTurmaInstrutores.get(turmaId) || { instrutor1: "", instrutor2: "" };
      atual[campo] = e.target.value;
      agendTurmaInstrutores.set(turmaId, atual);
      renderizarListaAgendTurmas();
    });
  });
  cont.querySelectorAll("[data-agend-turma-data]").forEach((el) => {
    el.addEventListener("change", (e) =>
      definirDataAgendTurma(e.target.getAttribute("data-agend-turma-data"), e.target.value)
    );
  });
  cont.querySelectorAll("[data-agend-turma-horario]").forEach((el) => {
    el.addEventListener("change", (e) =>
      definirHorarioAgendTurma(e.target.getAttribute("data-agend-turma-horario"), e.target.value)
    );
  });
  cont.querySelectorAll("[data-agend-turma-deslocamento]").forEach((el) => {
    el.addEventListener("change", (e) =>
      definirHorarioDeslocamentoAgendTurma(e.target.getAttribute("data-agend-turma-deslocamento"), e.target.value)
    );
  });
  cont.querySelectorAll("[data-agend-turma-pre]").forEach((el) => {
    el.addEventListener("change", (e) =>
      definirPreAgendamentoTurma(e.target.getAttribute("data-agend-turma-pre"), e.target.checked)
    );
  });
}

// Liga/desliga a flag de pré-agendamento da turma. Não muda nada no fluxo de
// confirmação (CT/instrutores) — dias_status do instrutor continua só
// "agendado" (esse campo é compartilhado com o app agenda-instrutores, que
// não conhece "pré-agendamento"). A cor azul clarinho é calculada na hora,
// aqui no front, cruzando o dia "agendado" com eh_pre_agendamento da turma.
// Ao desmarcar (virar agendamento definitivo), um trigger no banco avisa os
// instrutores da turma pelo mesmo push usado quando uma aula é agendada.
async function definirPreAgendamentoTurma(turmaId, marcado) {
  const t = agendTurmasLista.find((x) => x.id === turmaId);
  if (!t) return;
  const anterior = t.eh_pre_agendamento;
  t.eh_pre_agendamento = marcado;
  renderizarListaAgendTurmas();

  const { error } = await supabase.from("turmas").update({ eh_pre_agendamento: marcado }).eq("id", turmaId);
  if (error) {
    t.eh_pre_agendamento = anterior;
    renderizarListaAgendTurmas();
    alert("Não foi possível salvar o pré-agendamento. Tente novamente.");
  }
}

// Grava a data do treinamento de uma turma direto na lista de Agendamento de Turmas.
// Alterar a data invalida a verificação de disponibilidade e a escolha de instrutores
// da turma, que passam a depender da nova data.
async function definirDataAgendTurma(turmaId, novaData) {
  const t = agendTurmasLista.find((x) => x.id === turmaId);
  if (!t) return;
  const payload = { data_inicio: novaData || null };
  if (novaData && (!t.data_fim || t.data_fim < novaData)) payload.data_fim = novaData;

  const { error } = await supabase.from("turmas").update(payload).eq("id", turmaId);
  if (error) {
    alert("Não foi possível salvar a data da turma. Tente novamente.");
    return;
  }
  Object.assign(t, payload);
  agendTurmaCentroStatus.delete(turmaId);
  agendTurmaInstrutores.delete(turmaId);
  renderizarListaAgendTurmas();
}

// Grava o horário de início da aula de uma turma específica, sem afetar as
// demais. Se algum instrutor já tiver confirmado essa data, um trigger no
// banco (notificar_alteracao_horario_turma) avisa automaticamente o(s)
// instrutor(es) confirmado(s), com os dados do orçamento, da turma e o novo
// horário — não é preciso fazer nada além de salvar aqui.
async function definirHorarioAgendTurma(turmaId, novoHorario) {
  const t = agendTurmasLista.find((x) => x.id === turmaId);
  if (!t) return;
  const anterior = t.horario;
  const jaConfirmado = algumInstrutorConfirmouAgendTurma(t);
  t.horario = novoHorario || null;

  const { error } = await supabase.from("turmas").update({ horario: t.horario }).eq("id", turmaId);
  if (error) {
    t.horario = anterior;
    renderizarListaAgendTurmas();
    alert("Não foi possível salvar o horário de início da aula. Tente novamente.");
    return;
  }
  if (jaConfirmado && anterior !== t.horario) {
    console.info(`Turma ${t.identificacao || turmaId}: instrutor já confirmado, aviso de novo horário disparado automaticamente.`);
  }
  renderizarListaAgendTurmas();
}

// Grava o horário em que o instrutor deve iniciar o deslocamento até a turma.
// Só é editável depois que algum instrutor confirmou a data (ver
// algumInstrutorConfirmouAgendTurma), já que antes disso ainda não há
// deslocamento a organizar.
async function definirHorarioDeslocamentoAgendTurma(turmaId, novoHorario) {
  const t = agendTurmasLista.find((x) => x.id === turmaId);
  if (!t) return;
  const anterior = t.horario_deslocamento;
  t.horario_deslocamento = novoHorario || null;

  const { error } = await supabase.from("turmas").update({ horario_deslocamento: t.horario_deslocamento }).eq("id", turmaId);
  if (error) {
    t.horario_deslocamento = anterior;
    renderizarListaAgendTurmas();
    alert("Não foi possível salvar o horário de deslocamento. Tente novamente.");
  }
}

$("btn-agend-marcar-todas").addEventListener("click", () => {
  agendTurmasLista.forEach((t) => agendTurmaSelecionadas.add(t.id));
  renderizarListaAgendTurmas();
});
$("btn-agend-desmarcar-todas").addEventListener("click", () => {
  agendTurmaSelecionadas.clear();
  renderizarListaAgendTurmas();
});

async function verificarDisponibilidadeAgendTurma() {
  const selecionadas = agendTurmasLista.filter((t) => agendTurmaSelecionadas.has(t.id));
  if (selecionadas.length === 0) return alert("Selecione ao menos uma turma para verificar.");

  const btn = $("btn-agend-verificar-disponibilidade");
  btn.disabled = true;
  btn.textContent = "Verificando…";

  // --- Disponibilidade do Centro de Treinamento ---
  const centrosIds = [...new Set(selecionadas.map((t) => t.centro_treinamento_id).filter(Boolean))];
  const datas = [...new Set(selecionadas.map((t) => t.data_inicio).filter(Boolean))];
  const [{ data: turmasNoPeriodo }, { data: instrutoresAtualizados }] = await Promise.all([
    supabase
      .from("turmas")
      .select("id, centro_treinamento_id, data_inicio, tipo_dia, status")
      .in("centro_treinamento_id", centrosIds)
      .in("data_inicio", datas)
      .neq("status", "Cancelada"),
    supabase.from("instrutores").select("*").eq("status", "Ativo").order("nome"),
  ]);
  listaInstrutoresAtivos = instrutoresAtualizados || [];

  const REQUER_SALA = ["Teoria", "Teoria com Prática"];
  const REQUER_PISTA = ["Prática", "Teoria com Prática"];

  agendTurmaCentroStatus.clear();
  selecionadas.forEach((t) => {
    const centro = listaCentrosAtivos.find((c) => c.id === t.centro_treinamento_id);
    const outrasNoMesmoSlot = (turmasNoPeriodo || []).filter(
      (o) => o.id !== t.id && o.centro_treinamento_id === t.centro_treinamento_id && o.data_inicio === t.data_inicio
    );
    let salaOk = true, pistaOk = true;
    if (REQUER_SALA.includes(t.tipo_dia)) {
      const usadas = outrasNoMesmoSlot.filter((o) => REQUER_SALA.includes(o.tipo_dia)).length;
      salaOk = (Number(centro?.qtd_salas_aula) || 0) - usadas >= 1;
    }
    if (REQUER_PISTA.includes(t.tipo_dia)) {
      const usadas = outrasNoMesmoSlot.filter((o) => REQUER_PISTA.includes(o.tipo_dia)).length;
      pistaOk = (Number(centro?.qtd_pistas_treinamento) || 0) - usadas >= 1;
    }
    agendTurmaCentroStatus.set(t.id, { disponivel: salaOk && pistaOk, salaOk, pistaOk });
  });

  // --- Ranking de instrutores por disponibilidade nos dias selecionados ---
  const totalDias = datas.length;
  agendTurmaRankingInstrutores = listaInstrutoresAtivos
    .map((instrutor) => {
      const diasStatus = instrutor.dias_status || {};
      const diasDisponiveis = datas.filter((d) => obterStatusDia(diasStatus, d) === "disponivel").length;
      return { instrutor, diasDisponiveis, totalDias, fullyAvailable: diasDisponiveis === totalDias };
    })
    .filter((r) => r.diasDisponiveis > 0)
    .sort((a, b) => b.diasDisponiveis - a.diasDisponiveis || a.instrutor.nome.localeCompare(b.instrutor.nome));

  btn.disabled = false;
  btn.textContent = "Verificar disponibilidade";
  renderizarListaAgendTurmas();
}
$("btn-agend-verificar-disponibilidade").addEventListener("click", verificarDisponibilidadeAgendTurma);
["agend-filtro-aptos", "agend-filtro-centro"].forEach((id) => {
  const el = $(id);
  if (el) el.addEventListener("change", () => renderizarListaAgendTurmas());
});

// -----------------------------------------------------------
// Solicitar confirmação do agendamento das turmas selecionadas:
//  1) grava instrutor1/instrutor2 escolhidos na turma;
//  2) RPC solicitar_confirmacao_turma_completa → cria/atualiza o agendamento de
//     cada instrutor (o app agenda-instrutores recebe a notificação e o dia
//     fica "aguardando" no calendário dele), marca agenda_instrutor1/2 e
//     agenda_ct como "Aguardando confirmação";
//  3) o status consolidado da turma (Não agendado / Aguardando confirmação /
//     Agendado) é recalculado automaticamente no banco.
// -----------------------------------------------------------
function mostrarResultadoSolicitacao(html, ok) {
  const el = $("agend-solicitacao-resultado");
  el.className = `mb-3 text-sm rounded-md px-3 py-2 ${ok ? "bg-teal-50 text-teal-800" : "bg-rose-50 text-rose-700"}`;
  el.innerHTML = html;
  el.classList.remove("hidden");
}

async function solicitarConfirmacaoAgendTurma() {
  const selecionadas = agendTurmasLista.filter((t) => agendTurmaSelecionadas.has(t.id));
  if (selecionadas.length === 0) return alert("Selecione ao menos uma turma para solicitar confirmação.");

  const problemas = [];
  const prontas = [];
  selecionadas.forEach((t) => {
    if (t._centroBloqueado) {
      problemas.push(`Turma ${t.identificacao}: o CT ${t.centros_treinamento?.nome || ""} já está aguardando/confirmado e difere do CT escolhido na tela. Desfaça a confirmação do CT antes de mudar de unidade.`);
      return;
    }
    // Somente locação de espaço: não precisa de instrutor; só o CT confirma.
    if (turmaSomenteLocacao(t)) {
      if (!t.data_inicio) problemas.push(`Turma ${t.identificacao}: sem data definida.`);
      else prontas.push({ t, inst1: null, inst2: null, locacao: true });
      return;
    }
    const escolha = agendTurmaInstrutores.get(t.id) || { instrutor1: t.instrutor1_id || "", instrutor2: t.instrutor2_id || "" };
    const inst1 = escolha.instrutor1 || t.instrutor1_id || null;
    const inst2 = escolha.instrutor2 || t.instrutor2_id || null;
    if (!t.data_inicio) problemas.push(`Turma ${t.identificacao}: sem data definida.`);
    else if (!inst1 && !inst2) problemas.push(`Turma ${t.identificacao}: selecione ao menos o Instrutor 1.`);
    else if (inst1 && inst2 && inst1 === inst2) problemas.push(`Turma ${t.identificacao}: Instrutor 1 e 2 não podem ser a mesma pessoa.`);
    else prontas.push({ t, inst1, inst2 });
  });
  if (prontas.length === 0) return mostrarResultadoSolicitacao(problemas.join("<br>"), false);

  const nomes = (id) => listaInstrutoresAtivos.find((i) => i.id === id)?.nome || "—";
  const rotulo = (t, id) => {
    if (!id) return "";
    const r = respostaInstrutorAgendTurma(t, id);
    return `${nomes(id)}${r?.status === "confirmado" ? " (já confirmado — não será notificado)" : ""}`;
  };
  const resumo = prontas.map(({ t, inst1, inst2, locacao }) =>
    `• Turma ${t.identificacao} (${formatarDataBr(t.data_inicio)}): ${locacao ? "locação de espaço — só confirmação do Centro de Treinamento" : [rotulo(t, inst1), rotulo(t, inst2)].filter(Boolean).join(" e ")}`).join("\n");
  const mudancasCt = prontas.filter((p) => p.t._centroMudara).map((p) => p.t.identificacao);
  const nomeCtTela = listaCentrosAtivos.find((c) => c.id === agendTurmaCentroId)?.nome || "";
  const avisoCt = mudancasCt.length
    ? `\n\nAtenção: o Centro de Treinamento da(s) turma(s) ${mudancasCt.join(", ")} será alterado para ${nomeCtTela} (o cadastro do orçamento é de outra unidade).`
    : "";
  if (!confirm(`Enviar solicitação de confirmação para ${prontas.length} turma(s)?\n\n${resumo}${avisoCt}\n\nO Centro de Treinamento também ficará "Aguardando confirmação".`)) return;

  const btn = $("btn-agend-solicitar-confirmacao");
  btn.disabled = true;
  btn.textContent = "Enviando…";

  let enviados = 0;
  let enviadosSoCt = 0; // turmas de locação de espaço: só o Centro de Treinamento confirma
  const erros = [...problemas];
  const avisos = [];
  for (const { t, inst1, inst2, locacao } of prontas) {
    if (t._centroMudara) {
      const { error: eCt } = await supabase.from("turmas").update({ centro_treinamento_id: t.centro_treinamento_id }).eq("id", t.id);
      if (eCt) { erros.push(`Turma ${t.identificacao}: não foi possível gravar o Centro de Treinamento (${eCt.message}).`); continue; }
      t._centroMudara = false;
    }
    if (!locacao) {
      const payload = {
        instrutor1_id: inst1,
        instrutor2_id: inst2,
        agenda_instrutor2: inst2 ? (t.agenda_instrutor2 === "Não aplicável" ? "A agendar" : t.agenda_instrutor2) : "Não aplicável",
      };
      const { error: e1 } = await supabase.from("turmas").update(payload).eq("id", t.id);
      if (e1) { erros.push(`Turma ${t.identificacao}: não foi possível gravar os instrutores (${e1.message}).`); continue; }
    }

    const solicitarCt = (locacao || t.agenda_ct !== "Não aplicável") && t.agenda_ct !== "Agendado";
    const { data: solicitados, error: e2 } = await supabase.rpc("solicitar_confirmacao_turma_completa", {
      p_turma_id: t.id, p_datas: [t.data_inicio], p_solicitar_ct: solicitarCt,
    });
    if (e2) { erros.push(`Turma ${t.identificacao}: ${e2.message}`); continue; }

    // Instrutores que já tinham confirmado não são notificados de novo:
    // a RPC só devolve os que realmente receberam a solicitação.
    const notificados = (solicitados || []).map((r) => r.id_instrutor);
    const atribuidos = [inst1, inst2].filter(Boolean);
    const preservados = atribuidos.filter((id) => !notificados.includes(id));
    if (notificados.length > 0) enviados++;
    if (locacao && solicitarCt) enviadosSoCt++;
    if (preservados.length > 0) {
      avisos.push(`Turma ${t.identificacao}: ${preservados.map(nomes).join(" e ")} já havia(m) confirmado — confirmação mantida, sem nova mensagem.`);
    }
    if (notificados.length === 0 && !solicitarCt) {
      avisos.push(`Turma ${t.identificacao}: nada a solicitar, já está tudo confirmado.`);
    }
  }

  btn.disabled = false;
  btn.textContent = "✉️ Solicitar confirmação";
  await recarregarTurmasAgendTurma();
  const { data: insts } = await supabase.from("instrutores").select("*").eq("status", "Ativo").order("nome");
  listaInstrutoresAtivos = insts || listaInstrutoresAtivos;
  renderizarListaAgendTurmas();

  mostrarResultadoSolicitacao(
    `<strong>${enviados}</strong> turma(s) com solicitação enviada aos instrutores pelo app Agenda de Instrutores.` +
    (enviadosSoCt ? `<br><strong>${enviadosSoCt}</strong> turma(s) de locação de espaço enviada(s) apenas para confirmação do Centro de Treinamento (sem instrutor).` : "") +
    (avisos.length ? `<br><span class="text-slate-600">${avisos.join("<br>")}</span>` : "") +
    (erros.length ? `<br><span class="text-rose-700">${erros.join("<br>")}</span>` : ""),
    erros.length === 0
  );
}
$("btn-agend-solicitar-confirmacao").addEventListener("click", solicitarConfirmacaoAgendTurma);

// -----------------------------------------------------------
// Cancelar agendamento das turmas selecionadas (RPC cancelar_agendamento_turmas):
// mantém data/horário, volta a "Não agendado", remove os instrutores (que recebem
// push), libera os dias e deixa um aviso para o Centro de Treinamento.
// -----------------------------------------------------------
function turmaTemAgendamentoParaCancelar(t) {
  return ["Aguardando confirmação", "Agendado"].includes(t.agenda_ct) || !!t.instrutor1_id || !!t.instrutor2_id ||
    (t.status_agendamento && t.status_agendamento !== "Não agendado");
}

function abrirModalCancelarAgend() {
  const selecionadas = agendTurmasLista.filter((t) => agendTurmaSelecionadas.has(t.id));
  if (selecionadas.length === 0) return alert("Selecione ao menos uma turma para cancelar o agendamento.");
  const comAgend = selecionadas.filter(turmaTemAgendamentoParaCancelar);
  if (comAgend.length === 0) return mostrarResultadoSolicitacao("As turmas selecionadas não têm agendamento a cancelar.", false);
  const nomeInst = (id) => listaInstrutoresAtivos.find((i) => i.id === id)?.nome || "";
  $("cancagend-resumo").innerHTML = comAgend.map((t) => {
    const insts = [t.instrutor1_id, t.instrutor2_id].filter(Boolean).map(nomeInst).filter(Boolean);
    return `<div><span class="font-mono">${t.identificacao || "—"}</span>${t.data_inicio ? ` · ${formatarDataBr(t.data_inicio)}` : ""} · CT: ${t.agenda_ct || "—"}${insts.length ? ` · Instrutor(es): ${insts.join(", ")}` : ""}</div>`;
  }).join("");
  $("cancagend-motivo").value = "";
  $("cancagend-erro").classList.add("hidden");
  $("modal-cancelar-agend").dataset.turmas = JSON.stringify(comAgend.map((t) => t.id));
  $("modal-cancelar-agend").classList.remove("hidden");
  setTimeout(() => $("cancagend-motivo").focus(), 30);
}
function fecharModalCancelarAgend() { $("modal-cancelar-agend").classList.add("hidden"); }

async function confirmarCancelarAgend() {
  const erro = $("cancagend-erro");
  erro.classList.add("hidden");
  const motivo = $("cancagend-motivo").value.trim();
  if (motivo.length < 3) { erro.textContent = "Informe o motivo do cancelamento."; erro.classList.remove("hidden"); return; }
  let ids = [];
  try { ids = JSON.parse($("modal-cancelar-agend").dataset.turmas || "[]"); } catch (_) { ids = []; }
  if (ids.length === 0) return fecharModalCancelarAgend();
  const btn = $("btn-cancagend-confirmar");
  btn.disabled = true;
  btn.textContent = "Cancelando…";
  try {
    const { data, error } = await supabase.rpc("cancelar_agendamento_turmas", { p_turma_ids: ids, p_motivo: motivo });
    if (error) throw error;
    const r = data || {};
    fecharModalCancelarAgend();
    ids.forEach((id) => { agendTurmaInstrutores.delete(id); agendTurmaCentroStatus.delete(id); });
    await recarregarTurmasAgendTurma();
    const { data: insts } = await supabase.from("instrutores").select("*").eq("status", "Ativo").order("nome");
    listaInstrutoresAtivos = insts || listaInstrutoresAtivos;
    renderizarListaAgendTurmas();
    const ign = (r.ignoradas || []).map((i) => `Turma ${i.identificacao || i.turma_id}: ${i.motivo}`);
    mostrarResultadoSolicitacao(
      `<strong>${r.canceladas || 0}</strong> turma(s) com agendamento cancelado; o Centro de Treinamento foi informado na tela de Confirmação do CT.` +
      `<br><strong>${r.instrutores_avisados || 0}</strong> instrutor(es) avisado(s) pelo app Agenda de Instrutores.` +
      (ign.length ? `<br><span class="text-slate-600">${ign.join("<br>")}</span>` : ""),
      (r.canceladas || 0) > 0
    );
  } catch (e) {
    erro.textContent = "Não foi possível cancelar: " + (e?.message || "erro desconhecido");
    erro.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Cancelar agendamento";
  }
}
$("btn-agend-cancelar").addEventListener("click", abrirModalCancelarAgend);
$("btn-cancagend-voltar").addEventListener("click", fecharModalCancelarAgend);
$("btn-cancagend-confirmar").addEventListener("click", confirmarCancelarAgend);

function formatarDataBr(iso) {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

// ===========================================================
// OPERAÇÃO: CONFIRMAÇÃO DO CENTRO DE TREINAMENTO
// Um usuário do CT confirma (ou recusa) as turmas cujo agendamento foi
// solicitado — agenda_ct passa a "Agendado" (ou volta a "A agendar").
// ===========================================================
let cctLista = [];
let cctAgendamentos = new Map();

// Calendário mensal (mesma navegação da Agenda por Centro de Treinamento):
// o usuário escolhe o dia e confirma/recusa as turmas daquele dia.
let cctMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let cctDiaSelecionado = null;
let cctAutoSelecionarDia = true; // na 1ª carga, abre o dia de hoje (ou o 1º dia com pendência)
let cctPendentesTotal = 0;

async function carregarConfirmacaoCtInit() {
  $("admin-descricao-pagina").textContent = "Confirme, pelo Centro de Treinamento, as turmas cujo agendamento foi solicitado. A turma só fica \"Agendada\" quando o CT e os instrutores confirmam.";
  const { data: centros } = await supabase.from("centros_treinamento").select("*").eq("status", "Ativo").order("nome");
  listaCentrosAtivos = centros || [];
  preencherSelect("cct-centro-select", listaCentrosAtivos, "id", (c) => c.nome, "— Selecione —");
  $("cct-centro-select").value = listaCentrosAtivos.length === 1 ? listaCentrosAtivos[0].id : "";
  $("cct-filtro-status").value = "";
  $("cct-resultado").classList.add("hidden");
  cctMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  cctDiaSelecionado = null;
  cctAutoSelecionarDia = true;
  await carregarTurmasPreAgendamentoDefinitivo();
  await carregarAgendamentosCancelados();
  await carregarListaConfirmacaoCt();
}

// -----------------------------------------------------------
// Aviso para o usuário da Confirmação do CT: turmas que saíram de
// pré-agendamento e viraram agendamento definitivo (mesmo "processo" que já
// avisa aqui — badge na tela, visto no próximo carregamento/auto-refresh —
// usado para as solicitações de desmarcação).
// -----------------------------------------------------------
let turmasPreAgendamentoDefinitivo = [];

async function carregarTurmasPreAgendamentoDefinitivo(forcar = true) {
  const { data, error } = await supabase
    .from("turmas")
    .select("id, identificacao, data_inicio, pre_agendamento_confirmado_em, centros_treinamento(nome), orcamentos(numero, empresas(nome))")
    .eq("pre_agendamento_confirmado_visto", false)
    .order("pre_agendamento_confirmado_em", { ascending: false });
  if (error) {
    console.warn("Não foi possível carregar os avisos de agendamento definitivo:", error.message);
    return;
  }
  if (!forcar && !dadosMudaram("preAgendamentoDefinitivo", data)) return;
  if (forcar) dadosMudaram("preAgendamentoDefinitivo", data);
  turmasPreAgendamentoDefinitivo = data || [];
  renderizarTurmasPreAgendamentoDefinitivo();
}

function renderizarTurmasPreAgendamentoDefinitivo() {
  const bloco = $("cct-definitivos-bloco");
  if (turmasPreAgendamentoDefinitivo.length === 0) {
    bloco.classList.add("hidden");
    return;
  }
  bloco.classList.remove("hidden");
  $("cct-definitivos-badge").textContent = String(turmasPreAgendamentoDefinitivo.length);
  $("cct-definitivos-lista").innerHTML = turmasPreAgendamentoDefinitivo.map((t) => `
    <div class="flex items-center justify-between gap-3 text-xs bg-white border border-sky-100 rounded-md px-3 py-2">
      <span>
        <span class="font-mono text-slate-700">${t.identificacao || "—"}</span>
        — ${t.orcamentos?.empresas?.nome || "—"} · ${t.centros_treinamento?.nome || "—"}${t.data_inicio ? ` · ${formatarDataBr(t.data_inicio)}` : ""}
      </span>
      <button data-cct-definitivo-visto="${t.id}" class="text-sky-700 hover:underline whitespace-nowrap">marcar como visto</button>
    </div>
  `).join("");
  $("cct-definitivos-lista").querySelectorAll("[data-cct-definitivo-visto]").forEach((el) =>
    el.addEventListener("click", () => marcarPreAgendamentoDefinitivoVisto([el.getAttribute("data-cct-definitivo-visto")])));
}

async function marcarPreAgendamentoDefinitivoVisto(ids) {
  if (!ids.length) return;
  await supabase.from("turmas").update({ pre_agendamento_confirmado_visto: true }).in("id", ids);
  await carregarTurmasPreAgendamentoDefinitivo();
}

$("btn-cct-definitivos-limpar").addEventListener("click", () =>
  marcarPreAgendamentoDefinitivoVisto(turmasPreAgendamentoDefinitivo.map((t) => t.id)));

// -----------------------------------------------------------
// Aviso para o Centro de Treinamento: agendamentos de turmas cancelados
// (botão "Cancelar agendamento" da tela Agendamento de Turmas). Fica na tela até
// ser marcado como visto; se um CT estiver escolhido, mostra só os dele.
// -----------------------------------------------------------
let agendamentosCancelados = [];

async function carregarAgendamentosCancelados(forcar = true) {
  const { data, error } = await supabase
    .from("turma_agendamento_cancelamentos")
    .select("id, turma_id, centro_treinamento_id, data_inicio, motivo, instrutores, criado_em, turma_identificacao, orcamento_numero, empresa_nome")
    .eq("visto_ct", false)
    .order("criado_em", { ascending: false });
  if (error) {
    console.warn("Não foi possível carregar os agendamentos cancelados:", error.message);
    return;
  }
  const lista = data || [];
  if (!forcar && !dadosMudaram("agendamentosCancelados", lista)) return;
  if (forcar) dadosMudaram("agendamentosCancelados", lista);
  // Nomes de turma/empresa/CT em consultas separadas (a tabela não tem FKs).
  const turmaIds = [...new Set(lista.map((c) => c.turma_id).filter(Boolean))];
  const turmas = new Map();
  if (turmaIds.length) {
    const { data: ts } = await supabase.from("turmas").select("id, identificacao, orcamentos(numero, empresas(nome))").in("id", turmaIds);
    (ts || []).forEach((t) => turmas.set(t.id, t));
  }
  agendamentosCancelados = lista.map((c) => ({
    ...c,
    turma: turmas.get(c.turma_id) || null,
    centro_nome: listaCentrosAtivos.find((x) => x.id === c.centro_treinamento_id)?.nome || "",
  }));
  renderizarAgendamentosCancelados();
}

function renderizarAgendamentosCancelados() {
  const bloco = $("cct-cancelados-bloco");
  const centroId = $("cct-centro-select").value;
  const visiveis = agendamentosCancelados.filter((c) => !centroId || c.centro_treinamento_id === centroId);
  if (visiveis.length === 0) {
    bloco.classList.add("hidden");
    return;
  }
  bloco.classList.remove("hidden");
  $("cct-cancelados-badge").textContent = String(visiveis.length);
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  $("cct-cancelados-lista").innerHTML = visiveis.map((c) => `
    <div class="flex items-start justify-between gap-3 text-xs bg-white border border-rose-100 rounded-md px-3 py-2">
      <span>
        <span class="font-mono text-slate-700">${esc(c.turma?.identificacao || c.turma_identificacao) || "—"}</span>${c.orcamento_numero ? ` <span class="text-slate-400">(orç. ${esc(c.orcamento_numero)})</span>` : ""}
        — ${esc(c.turma?.orcamentos?.empresas?.nome || c.empresa_nome) || "—"} · ${esc(c.centro_nome) || "—"}${c.data_inicio ? ` · ${formatarDataBr(c.data_inicio)}` : ""}
        <span class="block text-slate-600">Motivo: ${esc(c.motivo)}</span>
        ${(c.instrutores || []).length ? `<span class="block text-slate-500">Instrutor(es) avisado(s): ${esc((c.instrutores || []).join(", "))}</span>` : ""}
      </span>
      <button data-cct-cancelado-visto="${c.id}" class="text-rose-700 hover:underline whitespace-nowrap">marcar como visto</button>
    </div>
  `).join("");
  $("cct-cancelados-lista").querySelectorAll("[data-cct-cancelado-visto]").forEach((el) =>
    el.addEventListener("click", () => marcarAgendamentosCanceladosVisto([el.getAttribute("data-cct-cancelado-visto")])));
}

async function marcarAgendamentosCanceladosVisto(ids) {
  if (!ids.length) return;
  await supabase.from("turma_agendamento_cancelamentos").update({ visto_ct: true, visto_em: new Date().toISOString() }).in("id", ids);
  await carregarAgendamentosCancelados();
}

$("btn-cct-cancelados-limpar").addEventListener("click", () => {
  const centroId = $("cct-centro-select").value;
  marcarAgendamentosCanceladosVisto(agendamentosCancelados.filter((c) => !centroId || c.centro_treinamento_id === centroId).map((c) => c.id));
});
$("cct-centro-select").addEventListener("change", renderizarAgendamentosCancelados);

async function carregarListaConfirmacaoCt(forcar = true) {
  const centroId = $("cct-centro-select").value;
  if (!centroId) {
    cctLista = [];
    cctPendentesTotal = 0;
    $("cct-resumo").textContent = "";
    renderizarCalendarioCt();
    return;
  }
  const [ini, fim] = limitesDoMes(cctMes);
  const { data, error } = await supabase
    .from("turmas")
    .select("*, tipos_treinamento(nome), orcamentos(numero, observacoes, observacao_ct, empresas(nome)), inst1:instrutores!turmas_instrutor1_id_fkey(nome), inst2:instrutores!turmas_instrutor2_id_fkey(nome)")
    .eq("centro_treinamento_id", centroId)
    .neq("status", "Cancelada")
    .neq("agenda_ct", "Não aplicável")
    .gte("data_inicio", ini)
    .lte("data_inicio", fim)
    .order("data_inicio", { ascending: true });
  if (error) {
    $("cct-resumo").textContent = `Não foi possível carregar as turmas: ${error.message}`;
    return;
  }
  const ids = (data || []).map((t) => t.id);
  let ags = [];
  for (let n = 0; n < ids.length; n += 100) {
    const r = await supabase.from("agendamentos").select("turma_id, instrutor_id, datas, datas_status").in("turma_id", ids.slice(n, n + 100)).order("turma_id");
    ags = ags.concat(r.data || []);
  }
  const { count: pendentesTotal } = await supabase
    .from("turmas").select("id", { count: "exact", head: true })
    .eq("centro_treinamento_id", centroId).neq("status", "Cancelada").eq("agenda_ct", "Aguardando confirmação");

  // na atualização automática, só re-renderiza se algo mudou
  const chave = `cct:${centroId}:${ini}`;
  if (!forcar && !dadosMudaram(chave, { data, ags, pendentesTotal })) return;
  if (forcar) dadosMudaram(chave, { data, ags, pendentesTotal });

  cctLista = (data || []).sort(compararIdentificacaoTurma);
  cctPendentesTotal = pendentesTotal || 0;
  cctAgendamentos.clear();
  ags.forEach((a) => cctAgendamentos.set(`${a.turma_id}|${a.instrutor_id}`, a));

  if (cctAutoSelecionarDia && !cctDiaSelecionado) {
    const hoje = formatarData(new Date());
    const diasComTurma = new Set(cctLista.map((t) => t.data_inicio));
    if (diasComTurma.has(hoje)) cctDiaSelecionado = hoje;
    else {
      const primeiraPend = cctLista.find((t) => t.agenda_ct === "Aguardando confirmação");
      if (primeiraPend) cctDiaSelecionado = primeiraPend.data_inicio;
    }
    cctAutoSelecionarDia = false;
  }
  renderizarCalendarioCt();
}

function respostaInstrutorCct(t, instrutorId) {
  if (!instrutorId) return null;
  const a = cctAgendamentos.get(`${t.id}|${instrutorId}`);
  if (!a || !(a.datas || []).includes(t.data_inicio)) return null;
  const r = (a.datas_status || {})[t.data_inicio];
  return r ? montarRespostaInstrutor(r) : { status: "pendente" };
}

function agruparTurmasCtPorDia() {
  const mapa = new Map();
  cctLista.forEach((t) => {
    if (!t.data_inicio) return;
    if (!mapa.has(t.data_inicio)) mapa.set(t.data_inicio, []);
    mapa.get(t.data_inicio).push(t);
  });
  return mapa;
}

function renderizarCalendarioCt() {
  const porDia = agruparTurmasCtPorDia();
  $("cct-mes-label").textContent = `${nomesMeses[cctMes.getMonth()]} ${cctMes.getFullYear()}`;
  $("cct-dias-semana").innerHTML = diasSemana
    .map((d) => `<div class="text-center text-[11px] font-medium text-slate-400 py-1">${d}</div>`).join("");

  const elGrade = $("cct-grade-dias");
  elGrade.innerHTML = "";
  const hoje = formatarData(new Date());
  gerarGradeMes(cctMes.getFullYear(), cctMes.getMonth()).forEach((dia) => {
    if (!dia) { elGrade.appendChild(document.createElement("div")); return; }
    const dataStr = formatarData(dia);
    const turmas = porDia.get(dataStr) || [];
    const total = turmas.length;
    const aguardando = turmas.filter((t) => t.agenda_ct === "Aguardando confirmação").length;
    const confirmadas = turmas.filter((t) => t.agenda_ct === "Agendado").length;

    let cor = "bg-white border-slate-200 text-slate-400";
    if (total > 0) {
      if (aguardando > 0) cor = "bg-amber-50 border-amber-300 text-amber-900";
      else if (confirmadas === total) cor = "bg-teal-50 border-teal-300 text-teal-900";
      else cor = "bg-slate-50 border-slate-300 text-slate-700";
    }
    const selecionado = cctDiaSelecionado === dataStr ? "ring-2 ring-amber-500" : "";
    const marcaHoje = dataStr === hoje ? "font-bold underline" : "";
    const comObservacao = turmas.some((t) => t.orcamentos?.observacao_ct);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `min-h-[74px] w-full rounded-lg border p-1.5 text-left transition-colors hover:border-amber-400 ${cor} ${selecionado}`;
    btn.title = total === 0 ? "Sem turmas"
      : `${total} turma(s) · ${confirmadas} confirmada(s) pelo CT · ${aguardando} aguardando confirmação${comObservacao ? " · há observação para o CT" : ""}`;
    btn.innerHTML = `
      <div class="text-[11px] ${marcaHoje} flex items-center justify-between"><span>${dia.getDate()}</span>${comObservacao ? `<span title="Há observação para o Centro de Treinamento">📌</span>` : ""}</div>
      ${total > 0 ? `<div class="mt-1 text-lg leading-none font-semibold">${total}</div>
        <div class="text-[10px] leading-tight mt-0.5">turma${total > 1 ? "s" : ""}</div>
        ${aguardando > 0 ? `<div class="text-[10px] leading-tight font-medium">${aguardando} aguard.</div>` : ""}` : ""}
    `;
    btn.addEventListener("click", () => {
      cctDiaSelecionado = cctDiaSelecionado === dataStr ? null : dataStr;
      renderizarCalendarioCt();
    });
    elGrade.appendChild(btn);
  });

  const centroSel = $("cct-centro-select");
  if (!centroSel.value) {
    $("cct-resumo").textContent = "";
  } else {
    const aguardMes = cctLista.filter((t) => t.agenda_ct === "Aguardando confirmação").length;
    $("cct-resumo").textContent = `${cctLista.length} turma(s) no mês · ${aguardMes} aguardando confirmação no mês · ${cctPendentesTotal} no total`;
  }
  renderizarDetalheDiaCt(porDia);
}

function renderizarDetalheDiaCt(porDia) {
  const titulo = $("cct-detalhe-titulo");
  const lista = $("cct-detalhe-lista");
  if (!$("cct-centro-select").value) {
    titulo.textContent = "Selecione um Centro de Treinamento";
    lista.innerHTML = `<p class="text-xs text-slate-400">Escolha o centro acima para ver o calendário de confirmações.</p>`;
    return;
  }
  if (!cctDiaSelecionado) {
    titulo.textContent = "Selecione um dia no calendário";
    lista.innerHTML = `<p class="text-xs text-slate-400">Clique em um dia para ver as turmas e confirmar ou recusar.</p>`;
    return;
  }
  const filtro = $("cct-filtro-status").value;
  const todas = porDia.get(cctDiaSelecionado) || [];
  const turmas = filtro ? todas.filter((t) => t.agenda_ct === filtro) : todas;
  titulo.textContent = `${formatarDataBr(cctDiaSelecionado)} — ${turmas.length} turma(s)${filtro && todas.length !== turmas.length ? ` (de ${todas.length} no dia)` : ""}`;
  if (turmas.length === 0) {
    lista.innerHTML = `<p class="text-xs text-slate-400">${todas.length ? "Nenhuma turma neste dia com o filtro escolhido." : "Nenhuma turma neste dia."}</p>`;
    return;
  }
  const podeConfirmar = podeFazer("confirmacao_ct", "alterar");
  const linhaInst = (nome, resp, agenda) => nome
    ? `<div class="text-xs text-slate-700">${nome} ${iconeRespostaInstrutor(resp) || textoAgendaItem(agenda)}</div>`
    : "";
  lista.innerHTML = turmas.map((t) => {
    const obs = blocoObservacoesOrcamento(t.orcamentos, true);
    const locacao = t.agenda_instrutor1 === "Não aplicável" && !t.inst1 && !t.inst2;
    return `
    <div class="border border-slate-200 rounded-lg p-2.5">
      <div class="flex items-start justify-between gap-2">
        <span class="font-mono text-xs text-slate-700">${t.identificacao || "—"}</span>
        <span class="flex items-center gap-1.5">${textoAgendaItem(t.agenda_ct)} ${badgeStatusAgendamento(t.status_agendamento, t.eh_pre_agendamento)}</span>
      </div>
      <div class="text-sm text-slate-800 mt-1">${t.tipos_treinamento?.nome || "—"}</div>
      <div class="text-xs text-slate-500">${t.orcamentos?.empresas?.nome || "—"} · orç. ${t.orcamentos?.numero || "—"}</div>
      <div class="text-[11px] text-slate-500 mt-1">${t.horario ? `🕒 ${t.horario}` : ""}${t.tipo_dia ? `${t.horario ? " · " : ""}${t.tipo_dia}` : ""}</div>
      <div class="mt-1">${linhaInst(t.inst1?.nome, respostaInstrutorCct(t, t.instrutor1_id), t.agenda_instrutor1)}${linhaInst(t.inst2?.nome, respostaInstrutorCct(t, t.instrutor2_id), t.agenda_instrutor2)}${!t.inst1 && !t.inst2 ? `<span class="text-[11px] text-slate-400">${locacao ? "🏢 locação de espaço — sem instrutor" : "sem instrutor"}</span>` : ""}</div>
      ${obs ? `<div class="mt-2">${obs}</div>` : ""}
      ${podeConfirmar ? `<div class="flex items-center gap-1.5 mt-2 pt-2 border-t border-slate-100">
        ${t.agenda_ct !== "Agendado" ? `<button data-cct-confirmar="${t.id}" class="text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 px-3 py-1.5 rounded-md">Confirmar</button>` : ""}
        ${t.agenda_ct === "Aguardando confirmação" ? `<button data-cct-recusar="${t.id}" class="text-xs font-medium text-rose-600 hover:bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-md">Recusar</button>` : ""}
        ${t.agenda_ct === "Agendado" ? `<button data-cct-recusar="${t.id}" class="text-xs font-medium text-slate-500 hover:text-slate-800 border border-slate-200 px-3 py-1.5 rounded-md">Desfazer confirmação</button>` : ""}
      </div>` : ""}
    </div>`;
  }).join("");
  lista.querySelectorAll("[data-cct-confirmar]").forEach((el) =>
    el.addEventListener("click", () => responderConfirmacaoCt(el.getAttribute("data-cct-confirmar"), true)));
  lista.querySelectorAll("[data-cct-recusar]").forEach((el) =>
    el.addEventListener("click", () => responderConfirmacaoCt(el.getAttribute("data-cct-recusar"), false)));
}

async function responderConfirmacaoCt(turmaId, confirmar) {
  const t = cctLista.find((x) => x.id === turmaId);
  if (!t) return;
  if (!confirmar && !confirm(`Recusar/desfazer a confirmação do CT para a turma ${t.identificacao} em ${formatarDataBr(t.data_inicio)}? Ela voltará para "A agendar".`)) return;
  const { error } = await supabase.from("turmas").update({ agenda_ct: confirmar ? "Agendado" : "A agendar" }).eq("id", turmaId);
  const el = $("cct-resultado");
  el.classList.remove("hidden");
  if (error) {
    el.className = "mb-3 text-sm rounded-md px-3 py-2 bg-rose-50 text-rose-700";
    el.textContent = `Não foi possível atualizar a turma: ${error.message}`;
    return;
  }
  el.className = "mb-3 text-sm rounded-md px-3 py-2 bg-teal-50 text-teal-800";
  el.textContent = confirmar
    ? `Turma ${t.identificacao} (${formatarDataBr(t.data_inicio)}) confirmada pelo Centro de Treinamento.`
    : `Confirmação do CT removida para a turma ${t.identificacao} (${formatarDataBr(t.data_inicio)}).`;
  await carregarListaConfirmacaoCt();
}
$("cct-centro-select").addEventListener("change", () => {
  cctDiaSelecionado = null;
  cctAutoSelecionarDia = true;
  carregarListaConfirmacaoCt();
});
$("cct-filtro-status").addEventListener("change", () => renderizarCalendarioCt());
$("cct-mes-anterior").addEventListener("click", () => {
  cctMes = new Date(cctMes.getFullYear(), cctMes.getMonth() - 1, 1);
  cctDiaSelecionado = null;
  cctAutoSelecionarDia = false;
  carregarListaConfirmacaoCt();
});
$("cct-mes-proximo").addEventListener("click", () => {
  cctMes = new Date(cctMes.getFullYear(), cctMes.getMonth() + 1, 1);
  cctDiaSelecionado = null;
  cctAutoSelecionarDia = false;
  carregarListaConfirmacaoCt();
});
// Vai direto ao dia da próxima turma aguardando confirmação do CT (a partir de
// hoje; se não houver, a mais antiga pendente).
$("btn-cct-proxima-pendencia").addEventListener("click", async () => {
  const centroId = $("cct-centro-select").value;
  if (!centroId) return alert("Selecione um Centro de Treinamento.");
  const base = () => supabase.from("turmas").select("data_inicio")
    .eq("centro_treinamento_id", centroId).eq("agenda_ct", "Aguardando confirmação").neq("status", "Cancelada")
    .not("data_inicio", "is", null).order("data_inicio", { ascending: true }).limit(1);
  let { data } = await base().gte("data_inicio", formatarData(new Date()));
  if (!data || data.length === 0) ({ data } = await base());
  if (!data || data.length === 0) return alert("Nenhuma turma aguardando confirmação deste Centro de Treinamento.");
  const [a, m] = data[0].data_inicio.split("-").map(Number);
  cctMes = new Date(a, m - 1, 1);
  cctDiaSelecionado = data[0].data_inicio;
  cctAutoSelecionarDia = false;
  await carregarListaConfirmacaoCt();
});

// ===========================================================
// Alunos por Turma
// ===========================================================

function grupoDeEmpresa(emp) {
  const g = (emp.cnpj_grupo_economico || emp.cnpj || "").replace(/\D/g, "");
  return g || null;
}

function validarCnpjMesmoGrupoOrcamento(cnpjDigitado, grupoOrcamento) {
  const alvo = (cnpjDigitado || "").replace(/\D/g, "");
  if (alvo.length !== 14) return "Informe um CNPJ válido (14 dígitos).";
  const empresa = listaEmpresasParaValidacao.find((e) => e.cnpj && e.cnpj.replace(/\D/g, "") === alvo);
  if (!empresa) return "Esse CNPJ não corresponde a nenhuma empresa cadastrada.";
  const grupo = grupoDeEmpresa(empresa);
  if (!grupoOrcamento || grupo !== grupoOrcamento) return "Esse CNPJ não pertence ao mesmo grupo econômico da empresa do orçamento.";
  return null;
}

async function abrirPainelAlunosTurma(turmaId) {
  turmaAlunosAbertaId = turmaId;
  const t = turmasDoOrcamento.find((x) => x.id === turmaId);
  const o = listaOrcamentosParaTurma.find((x) => x.id === turmaOrcamentoSelecionadoId);
  $("painel-alunos-turma-titulo").textContent = `Alunos — Turma ${t?.identificacao || ""}`;
  $("painel-alunos-turma-empresa").textContent = `Empresa do orçamento: ${o?.empresas?.nome || "—"} (${o?.empresas?.cnpj || "sem CNPJ cadastrado"})`;
  esconderErro("aluno-turma-form-erro");
  const { data: localidades } = await supabase.from("turma_localidades").select("*").eq("turma_id", turmaId).order("nome");
  localidadesParaAlunosTurma = localidades || [];
  limparFormAlunoTurma();
  $("bloco-novo-aluno-turma").classList.toggle("hidden", !podeFazer("turmas", "incluir"));
  $("btn-repetir-alunos-turma").classList.toggle("hidden", !podeFazer("turmas", "incluir"));
  fecharBlocoRepetirAlunos();
  $("painel-alunos-turma").classList.remove("hidden");
  await carregarAlunosDaTurma();
}

// --- Repetir alunos para outras turmas do mesmo orçamento ---
function abrirBlocoRepetirAlunos() {
  if (alunosDaTurmaAtual.length === 0) return alert("Não há alunos nesta turma para repetir.");
  const outras = turmasDoOrcamento.filter((t) => t.id !== turmaAlunosAbertaId);
  if (outras.length === 0) return alert("Este é o único turma deste orçamento.");
  $("repetir-alunos-turmas-lista").innerHTML = outras.map((t) => `
    <label class="flex items-center gap-2 text-xs text-slate-700">
      <input type="checkbox" data-repetir-aluno-turma="${t.id}" class="rounded border-slate-300" />
      <span class="font-mono">${t.identificacao || "—"}</span>
      <span class="text-slate-400">${t.tipo_dia || t.tipos_treinamento?.nome || ""}${t.data_inicio ? " · " + formatarDataAbrev(t.data_inicio) : ""}</span>
    </label>
  `).join("");
  $("bloco-repetir-alunos-turma").classList.remove("hidden");
  $("bloco-repetir-alunos-turma").scrollIntoView({ behavior: "smooth", block: "center" });
}

function fecharBlocoRepetirAlunos() {
  $("bloco-repetir-alunos-turma").classList.add("hidden");
}

async function transferirAlunosParaTurmas() {
  const idsDestino = [...document.querySelectorAll("[data-repetir-aluno-turma]:checked")].map((el) => el.getAttribute("data-repetir-aluno-turma"));
  if (idsDestino.length === 0) return alert("Selecione ao menos uma turma de destino.");
  if (alunosDaTurmaAtual.length === 0) return alert("Não há alunos nesta turma para repetir.");
  if (!confirm(`Replicar ${alunosDaTurmaAtual.length} aluno(s) para ${idsDestino.length} turma(s)?`)) return;

  mostrarProcessando("Transferindo alunos…", "⏳");

  const [{ data: locaisDestino }, { data: alunosDestino }] = await Promise.all([
    supabase.from("turma_localidades").select("id, turma_id, nome, cnpj_atestado, cnpj_faturamento").in("turma_id", idsDestino),
    supabase.from("turma_alunos").select("turma_id, cpf").in("turma_id", idsDestino),
  ]);

  const soDigitos = (s) => (s || "").replace(/\D/g, "");
  const chaveNome = (s) => (s || "").trim().toLowerCase();
  const cpfsPorTurma = {};
  (alunosDestino || []).forEach((a) => {
    (cpfsPorTurma[a.turma_id] = cpfsPorTurma[a.turma_id] || new Set()).add(soDigitos(a.cpf));
  });

  const payload = [];
  let ignorados = 0;
  idsDestino.forEach((turmaId) => {
    const jaExiste = cpfsPorTurma[turmaId] || new Set();
    const locais = (locaisDestino || []).filter((l) => l.turma_id === turmaId);
    alunosDaTurmaAtual.forEach((a) => {
      if (jaExiste.has(soDigitos(a.cpf))) { ignorados++; return; }
      const origem = localidadesParaAlunosTurma.find((l) => l.id === a.localidade_id);
      let destino = null;
      if (origem) {
        destino = locais.find((l) => chaveNome(l.nome) === chaveNome(origem.nome))
          || locais.find((l) => soDigitos(l.cnpj_atestado) === soDigitos(a.cnpj_atestado) && soDigitos(l.cnpj_faturamento) === soDigitos(a.cnpj_faturamento));
      }
      payload.push({
        turma_id: turmaId,
        cpf: a.cpf,
        nome: a.nome,
        data_nascimento: a.data_nascimento,
        localidade_id: destino ? destino.id : null,
        cnpj_atestado: a.cnpj_atestado,
        cnpj_faturamento: a.cnpj_faturamento,
      });
    });
  });

  if (payload.length === 0) {
    esconderProcessando();
    return alert("Nada a transferir: todos os alunos já existem nas turmas selecionadas.");
  }

  const { error } = await supabase.from("turma_alunos").insert(payload);
  if (error) {
    esconderProcessando();
    return alert("Não foi possível transferir os alunos. Tente novamente.");
  }
  mostrarProcessando(`Concluído — ${payload.length} aluno(s) incluído(s)${ignorados ? ` · ${ignorados} ignorado(s) por CPF repetido` : ""}`, "✅");
  setTimeout(esconderProcessando, 7000);
  fecharBlocoRepetirAlunos();
  await carregarAlunosDaTurma();
}

function preencherSelectLocalidadesAluno() {
  preencherSelect("aluno-turma-localidade", localidadesParaAlunosTurma, "id", (l) => l.nome, "— Selecione —");
  if (localidadesParaAlunosTurma.length === 1) $("aluno-turma-localidade").value = localidadesParaAlunosTurma[0].id;
  aoTrocarLocalidadeAluno();
}

function aoTrocarLocalidadeAluno() {
  const l = localidadesParaAlunosTurma.find((x) => x.id === $("aluno-turma-localidade").value);
  $("aluno-turma-cnpj-atestado").value = l?.cnpj_atestado ? MASCARAS.cnpj(l.cnpj_atestado) : "";
  $("aluno-turma-cnpj-faturamento").value = l?.cnpj_faturamento ? MASCARAS.cnpj(l.cnpj_faturamento) : "";
}

function definirModoFormAlunoTurma(editando) {
  $("bloco-aluno-localidade").classList.toggle("hidden", editando);
  $("aluno-turma-cnpj-atestado").disabled = !editando;
  $("aluno-turma-cnpj-faturamento").disabled = !editando;
  $("btn-salvar-aluno-turma").textContent = editando ? "Salvar alterações" : "+ Adicionar aluno";
  $("btn-cancelar-edicao-aluno-turma").classList.toggle("hidden", !editando);
}

function limparFormAlunoTurma() {
  editandoAlunoId = null;
  $("aluno-turma-cpf").value = "";
  $("aluno-turma-nome").value = "";
  $("aluno-turma-nascimento").value = "";
  definirModoFormAlunoTurma(false);
  preencherSelectLocalidadesAluno();
}

function abrirEdicaoAlunoTurma(id) {
  const a = alunosDaTurmaAtual.find((x) => x.id === id);
  if (!a) return;
  editandoAlunoId = id;
  esconderErro("aluno-turma-form-erro");
  $("aluno-turma-cpf").value = a.cpf || "";
  $("aluno-turma-nome").value = a.nome || "";
  $("aluno-turma-nascimento").value = a.data_nascimento || "";
  $("aluno-turma-cnpj-atestado").value = a.cnpj_atestado ? MASCARAS.cnpj(a.cnpj_atestado) : "";
  $("aluno-turma-cnpj-faturamento").value = a.cnpj_faturamento ? MASCARAS.cnpj(a.cnpj_faturamento) : "";
  definirModoFormAlunoTurma(true);
  $("aluno-turma-nome").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function carregarAlunosDaTurma() {
  const { data } = await supabase.from("turma_alunos").select("*").eq("turma_id", turmaAlunosAbertaId).order("nome");
  alunosDaTurmaAtual = data || [];
  renderizarListaAlunosTurma();
}

function renderizarListaAlunosTurma() {
  const podeAlterar = podeFazer("turmas", "alterar");
  const podeExcluir = podeFazer("turmas", "excluir");
  const corpo = $("aluno-turma-lista");
  if (alunosDaTurmaAtual.length === 0) {
    corpo.innerHTML = `<tr><td colspan="7" class="text-center text-slate-400 text-xs py-6">Nenhum aluno cadastrado para esta turma.</td></tr>`;
    return;
  }
  corpo.innerHTML = alunosDaTurmaAtual.map((a) => {
    const localidade = localidadesParaAlunosTurma.find((l) => l.id === a.localidade_id);
    return `
    <tr class="border-t border-slate-100">
      <td class="py-1.5 pr-2">${a.cpf || "—"}</td>
      <td class="py-1.5 pr-2">${a.nome}</td>
      <td class="py-1.5 pr-2">${a.data_nascimento || "—"}</td>
      <td class="py-1.5 pr-2">${localidade?.nome || "—"}</td>
      <td class="py-1.5 pr-2">${a.cnpj_atestado ? MASCARAS.cnpj(a.cnpj_atestado) : "—"}</td>
      <td class="py-1.5 pr-2">${a.cnpj_faturamento ? MASCARAS.cnpj(a.cnpj_faturamento) : "—"}</td>
      <td class="py-1.5 text-right whitespace-nowrap">
        ${podeAlterar ? `<button data-aluno-turma-editar="${a.id}" class="text-slate-500 hover:text-slate-800 text-xs mr-2">✏️</button>` : ""}
        ${podeExcluir ? `<button data-aluno-turma-excluir="${a.id}" class="text-rose-500 hover:text-rose-700 text-xs">🗑️</button>` : ""}
      </td>
    </tr>
  `;
  }).join("");
  corpo.querySelectorAll("[data-aluno-turma-editar]").forEach((btn) => btn.addEventListener("click", () => abrirEdicaoAlunoTurma(btn.getAttribute("data-aluno-turma-editar"))));
  corpo.querySelectorAll("[data-aluno-turma-excluir]").forEach((btn) => btn.addEventListener("click", () => excluirAlunoTurma(btn.getAttribute("data-aluno-turma-excluir"))));
}

async function excluirAlunoTurma(id) {
  const a = alunosDaTurmaAtual.find((x) => x.id === id);
  if (!confirmarExclusao(`o aluno "${a?.nome || ""}"`.trim())) return;
  const { error } = await supabase.from("turma_alunos").delete().eq("id", id);
  if (!error) await carregarAlunosDaTurma();
}

async function salvarAlunoTurma() {
  esconderErro("aluno-turma-form-erro");
  const cpf = $("aluno-turma-cpf").value.trim();
  const nome = $("aluno-turma-nome").value.trim();
  const dataNascimento = $("aluno-turma-nascimento").value || null;

  if (!nome) return mostrarErro("aluno-turma-form-erro", "Informe o nome do aluno.");
  if (!cpfValido(cpf)) return mostrarErro("aluno-turma-form-erro", "CPF inválido. Confira os dígitos informados.");

  let dados;
  if (editandoAlunoId) {
    const cnpjAtestado = $("aluno-turma-cnpj-atestado").value.trim();
    const cnpjFaturamento = $("aluno-turma-cnpj-faturamento").value.trim();

    const o = listaOrcamentosParaTurma.find((x) => x.id === turmaOrcamentoSelecionadoId);
    const grupoOrcamento = o?.empresas ? grupoDeEmpresa(o.empresas) : null;
    if (!grupoOrcamento) return mostrarErro("aluno-turma-form-erro", "A empresa do orçamento não possui CNPJ cadastrado para validação.");

    const erroAtestado = validarCnpjMesmoGrupoOrcamento(cnpjAtestado, grupoOrcamento);
    if (erroAtestado) return mostrarErro("aluno-turma-form-erro", `CNPJ do atestado: ${erroAtestado}`);
    const erroFaturamento = validarCnpjMesmoGrupoOrcamento(cnpjFaturamento, grupoOrcamento);
    if (erroFaturamento) return mostrarErro("aluno-turma-form-erro", `CNPJ do faturamento: ${erroFaturamento}`);

    const cnpjAtestadoDigits = cnpjAtestado.replace(/\D/g, "");
    const cnpjFaturamentoDigits = cnpjFaturamento.replace(/\D/g, "");
    const localidadeCorrespondente = localidadesParaAlunosTurma.find(
      (l) => (l.cnpj_atestado || "").replace(/\D/g, "") === cnpjAtestadoDigits && (l.cnpj_faturamento || "").replace(/\D/g, "") === cnpjFaturamentoDigits
    );
    dados = { cpf, nome, data_nascimento: dataNascimento, cnpj_atestado: cnpjAtestado, cnpj_faturamento: cnpjFaturamento, localidade_id: localidadeCorrespondente?.id || null };
  } else {
    const localidadeId = $("aluno-turma-localidade").value;
    if (!localidadeId) return mostrarErro("aluno-turma-form-erro", "Selecione a localidade do aluno.");
    const l = localidadesParaAlunosTurma.find((x) => x.id === localidadeId);
    dados = { cpf, nome, data_nascimento: dataNascimento, cnpj_atestado: l.cnpj_atestado, cnpj_faturamento: l.cnpj_faturamento, localidade_id: localidadeId };
  }

  const btn = $("btn-salvar-aluno-turma");
  const textoOriginal = editandoAlunoId ? "Salvar alterações" : "+ Adicionar aluno";
  btn.disabled = true;
  btn.textContent = "Salvando…";

  let error;
  if (editandoAlunoId) {
    ({ error } = await supabase.from("turma_alunos").update(dados).eq("id", editandoAlunoId));
  } else {
    ({ error } = await supabase.from("turma_alunos").insert({ turma_id: turmaAlunosAbertaId, ...dados }));
  }

  btn.disabled = false;
  btn.textContent = textoOriginal;

  if (error) return mostrarErro("aluno-turma-form-erro", "Não foi possível salvar o aluno. Tente novamente.");
  limparFormAlunoTurma();
  await carregarAlunosDaTurma();
}

function ligarMascaraCampo(id, tipo) {
  const el = $(id);
  if (!el) return;
  el.addEventListener("input", () => {
    const pos = el.selectionStart;
    const antes = el.value.length;
    el.value = MASCARAS[tipo](el.value);
    const depois = el.value.length;
    el.setSelectionRange(pos + (depois - antes), pos + (depois - antes));
  });
}
ligarMascaraCampo("aluno-turma-cpf", "cpf");
ligarMascaraCampo("aluno-turma-cnpj-atestado", "cnpj");
ligarMascaraCampo("aluno-turma-cnpj-faturamento", "cnpj");

$("btn-salvar-aluno-turma").addEventListener("click", salvarAlunoTurma);
$("btn-repetir-alunos-turma").addEventListener("click", abrirBlocoRepetirAlunos);
$("btn-cancelar-repetir-alunos-turma").addEventListener("click", fecharBlocoRepetirAlunos);
$("btn-transferir-alunos-turma").addEventListener("click", transferirAlunosParaTurmas);
$("btn-repetir-alunos-marcar-todas").addEventListener("click", () => document.querySelectorAll("[data-repetir-aluno-turma]").forEach((el) => (el.checked = true)));
$("btn-repetir-alunos-desmarcar-todas").addEventListener("click", () => document.querySelectorAll("[data-repetir-aluno-turma]").forEach((el) => (el.checked = false)));
$("aluno-turma-localidade").addEventListener("change", aoTrocarLocalidadeAluno);
$("btn-cancelar-edicao-aluno-turma").addEventListener("click", () => {
  esconderErro("aluno-turma-form-erro");
  limparFormAlunoTurma();
});
$("btn-fechar-painel-alunos-turma").addEventListener("click", () => $("painel-alunos-turma").classList.add("hidden"));
$("btn-fechar-painel-qrcode-turma").addEventListener("click", () => $("painel-qrcode-turma").classList.add("hidden"));
$("painel-qrcode-turma-overlay").addEventListener("click", () => $("painel-qrcode-turma").classList.add("hidden"));
$("painel-alunos-turma-overlay").addEventListener("click", () => $("painel-alunos-turma").classList.add("hidden"));

// ===========================================================
// Localidades por Turma
// ===========================================================

async function abrirPainelLocalidadesTurma(turmaId) {
  turmaLocalidadesAbertaId = turmaId;
  const t = turmasDoOrcamento.find((x) => x.id === turmaId);
  const o = listaOrcamentosParaTurma.find((x) => x.id === turmaOrcamentoSelecionadoId);
  $("painel-localidades-turma-titulo").textContent = `Localidades — Turma ${t?.identificacao || ""}`;
  $("painel-localidades-turma-empresa").textContent = `Empresa do orçamento: ${o?.empresas?.nome || "—"} (${o?.empresas?.cnpj || "sem CNPJ cadastrado"})`;
  esconderErro("localidade-turma-form-erro");
  editandoLocalidadeId = null;
  limparFormLocalidadeTurma();
  $("bloco-nova-localidade-turma").classList.toggle("hidden", !podeFazer("turmas", "incluir"));
  $("btn-repetir-localidades-turma").classList.toggle("hidden", !podeFazer("turmas", "incluir"));
  $("btn-excluir-localidades-turma").classList.toggle("hidden", !podeFazer("turmas", "excluir"));
  $("btn-excluir-localidades-todas-turmas").classList.toggle("hidden", !podeFazer("turmas", "excluir"));
  $("painel-localidades-turma").classList.remove("hidden");
  await carregarLocalidadesDaTurma();
}

function limparFormLocalidadeTurma() {
  editandoLocalidadeId = null;
  $("localidade-turma-nome").value = "";
  $("localidade-turma-cnpj-atestado").value = "";
  $("localidade-turma-cnpj-faturamento").value = "";
  $("btn-salvar-localidade-turma").textContent = "+ Adicionar localidade";
  $("btn-cancelar-edicao-localidade-turma").classList.add("hidden");
}

function abrirEdicaoLocalidadeTurma(id) {
  const l = localidadesDaTurmaAtual.find((x) => x.id === id);
  if (!l) return;
  editandoLocalidadeId = id;
  esconderErro("localidade-turma-form-erro");
  $("localidade-turma-nome").value = l.nome || "";
  $("localidade-turma-cnpj-atestado").value = l.cnpj_atestado || "";
  $("localidade-turma-cnpj-faturamento").value = l.cnpj_faturamento || "";
  $("btn-salvar-localidade-turma").textContent = "Salvar alterações";
  $("btn-cancelar-edicao-localidade-turma").classList.remove("hidden");
  $("localidade-turma-nome").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function carregarLocalidadesDaTurma() {
  const { data } = await supabase.from("turma_localidades").select("*").eq("turma_id", turmaLocalidadesAbertaId).order("nome");
  localidadesDaTurmaAtual = data || [];
  renderizarListaLocalidadesTurma();
}

function renderizarListaLocalidadesTurma() {
  const podeAlterar = podeFazer("turmas", "alterar");
  const podeExcluir = podeFazer("turmas", "excluir");
  const corpo = $("localidade-turma-lista");
  if (localidadesDaTurmaAtual.length === 0) {
    corpo.innerHTML = `<tr><td colspan="4" class="text-center text-slate-400 text-xs py-6">Nenhuma localidade cadastrada para esta turma.</td></tr>`;
    return;
  }
  corpo.innerHTML = localidadesDaTurmaAtual.map((l) => `
    <tr class="border-t border-slate-100">
      <td class="py-1.5 pr-2">${l.nome}</td>
      <td class="py-1.5 pr-2">${l.cnpj_atestado ? MASCARAS.cnpj(l.cnpj_atestado) : "—"}</td>
      <td class="py-1.5 pr-2">${l.cnpj_faturamento ? MASCARAS.cnpj(l.cnpj_faturamento) : "—"}</td>
      <td class="py-1.5 text-right whitespace-nowrap">
        ${podeAlterar ? `<button data-localidade-turma-editar="${l.id}" class="text-slate-500 hover:text-slate-800 text-xs mr-2">✏️</button>` : ""}
        ${podeExcluir ? `<button data-localidade-turma-excluir="${l.id}" class="text-rose-500 hover:text-rose-700 text-xs">🗑️</button>` : ""}
      </td>
    </tr>
  `).join("");
  corpo.querySelectorAll("[data-localidade-turma-editar]").forEach((btn) => btn.addEventListener("click", () => abrirEdicaoLocalidadeTurma(btn.getAttribute("data-localidade-turma-editar"))));
  corpo.querySelectorAll("[data-localidade-turma-excluir]").forEach((btn) => btn.addEventListener("click", () => excluirLocalidadeTurma(btn.getAttribute("data-localidade-turma-excluir"))));
}

async function excluirLocalidadeTurma(id) {
  const l = localidadesDaTurmaAtual.find((x) => x.id === id);
  if (!confirmarExclusao(`a localidade "${l?.nome || ""}"`.trim())) return;
  const { error } = await supabase.from("turma_localidades").delete().eq("id", id);
  if (!error) await carregarLocalidadesDaTurma();
}

// Overlay de progresso genérico (reaproveita o markup de "repetir localidades").
function mostrarProcessando(texto, icone) {
  $("localidade-repetir-icone").textContent = icone;
  $("localidade-repetir-texto").textContent = texto;
  $("localidade-repetir-overlay").classList.remove("hidden");
}
function esconderProcessando() {
  $("localidade-repetir-overlay").classList.add("hidden");
}
function mostrarStatusRepetirLocalidades(texto, icone) { mostrarProcessando(texto, icone); }
function esconderStatusRepetirLocalidades() { esconderProcessando(); }

async function repetirLocalidadesTurma() {
  if (localidadesDaTurmaAtual.length === 0) return alert("Não há localidades cadastradas nesta turma para repetir.");
  const outrasTurmasIds = turmasDoOrcamento.filter((t) => t.id !== turmaLocalidadesAbertaId).map((t) => t.id);
  if (outrasTurmasIds.length === 0) return alert("Esta é a única turma deste orçamento.");
  if (!confirm("Deseja repetir estas localidades para as outras turmas?")) return;

  mostrarStatusRepetirLocalidades("Processando…", "⏳");

  await supabase.from("turma_localidades").delete().in("turma_id", outrasTurmasIds);
  const payload = [];
  outrasTurmasIds.forEach((turmaId) => {
    localidadesDaTurmaAtual.forEach((l) => {
      payload.push({ turma_id: turmaId, nome: l.nome, cnpj_atestado: l.cnpj_atestado, cnpj_faturamento: l.cnpj_faturamento });
    });
  });
  await supabase.from("turma_localidades").insert(payload);

  mostrarStatusRepetirLocalidades("Concluído", "✅");
  setTimeout(esconderStatusRepetirLocalidades, 7000);
}

async function excluirLocalidadesTurmaAtual() {
  if (!confirm("Deseja excluir todas as localidades desta turma, exceto a Principal?")) return;
  await supabase.from("turma_localidades").delete().eq("turma_id", turmaLocalidadesAbertaId).neq("nome", "Principal");
  await carregarLocalidadesDaTurma();
}

async function excluirLocalidadesTodasTurmas() {
  if (!confirm("Deseja excluir todas as localidades de todas as turmas deste orçamento, exceto as Principal?")) return;
  const todasTurmasIds = turmasDoOrcamento.map((t) => t.id);
  if (todasTurmasIds.length === 0) return;
  await supabase.from("turma_localidades").delete().in("turma_id", todasTurmasIds).neq("nome", "Principal");
  await carregarLocalidadesDaTurma();
}

async function salvarLocalidadeTurma() {
  esconderErro("localidade-turma-form-erro");
  const nome = $("localidade-turma-nome").value.trim();
  const cnpjAtestado = $("localidade-turma-cnpj-atestado").value.trim();
  const cnpjFaturamento = $("localidade-turma-cnpj-faturamento").value.trim();

  if (!nome) return mostrarErro("localidade-turma-form-erro", "Informe o nome da localidade.");

  const o = listaOrcamentosParaTurma.find((x) => x.id === turmaOrcamentoSelecionadoId);
  const grupoOrcamento = o?.empresas ? grupoDeEmpresa(o.empresas) : null;
  if (!grupoOrcamento) return mostrarErro("localidade-turma-form-erro", "A empresa do orçamento não possui CNPJ cadastrado para validação.");

  const erroAtestado = validarCnpjMesmoGrupoOrcamento(cnpjAtestado, grupoOrcamento);
  if (erroAtestado) return mostrarErro("localidade-turma-form-erro", `CNPJ do atestado: ${erroAtestado}`);
  const erroFaturamento = validarCnpjMesmoGrupoOrcamento(cnpjFaturamento, grupoOrcamento);
  if (erroFaturamento) return mostrarErro("localidade-turma-form-erro", `CNPJ do faturamento: ${erroFaturamento}`);

  const btn = $("btn-salvar-localidade-turma");
  const textoOriginal = editandoLocalidadeId ? "Salvar alterações" : "+ Adicionar localidade";
  btn.disabled = true;
  btn.textContent = "Salvando…";

  const dados = { nome, cnpj_atestado: cnpjAtestado, cnpj_faturamento: cnpjFaturamento };
  let error;
  if (editandoLocalidadeId) {
    ({ error } = await supabase.from("turma_localidades").update(dados).eq("id", editandoLocalidadeId));
  } else {
    ({ error } = await supabase.from("turma_localidades").insert({ turma_id: turmaLocalidadesAbertaId, ...dados }));
  }

  btn.disabled = false;
  btn.textContent = textoOriginal;

  if (error) return mostrarErro("localidade-turma-form-erro", "Não foi possível salvar a localidade. Tente novamente.");
  limparFormLocalidadeTurma();
  await carregarLocalidadesDaTurma();
}

ligarMascaraCampo("localidade-turma-cnpj-atestado", "cnpj");
ligarMascaraCampo("localidade-turma-cnpj-faturamento", "cnpj");

$("btn-salvar-localidade-turma").addEventListener("click", salvarLocalidadeTurma);
$("btn-cancelar-edicao-localidade-turma").addEventListener("click", () => {
  esconderErro("localidade-turma-form-erro");
  limparFormLocalidadeTurma();
});
$("btn-fechar-painel-localidades-turma").addEventListener("click", () => $("painel-localidades-turma").classList.add("hidden"));
$("painel-localidades-turma-overlay").addEventListener("click", () => $("painel-localidades-turma").classList.add("hidden"));
$("btn-repetir-localidades-turma").addEventListener("click", repetirLocalidadesTurma);
$("btn-excluir-localidades-turma").addEventListener("click", excluirLocalidadesTurmaAtual);
$("btn-excluir-localidades-todas-turmas").addEventListener("click", excluirLocalidadesTodasTurmas);

iniciar();



// ===========================================================
// ATUALIZAÇÃO AUTOMÁTICA (polling a cada 5 s)
// Verifica se os dados da tela ativa mudaram no banco e re-renderiza.
// Não atualiza enquanto: a aba está em segundo plano, um painel lateral
// está aberto, o usuário está com um campo em edição, ou uma atualização
// anterior ainda não terminou.
// ===========================================================
const AUTO_REFRESH_MS = 5000;
let autoRefreshEmAndamento = false;
const autoRefreshAssinaturas = new Map(); // chave → JSON da última carga (para só re-renderizar quando mudou)

function dadosMudaram(chave, dados) {
  const atual = JSON.stringify(dados);
  if (autoRefreshAssinaturas.get(chave) === atual) return false;
  autoRefreshAssinaturas.set(chave, atual);
  return true;
}

function algumPainelAberto() {
  return [...document.querySelectorAll("div.fixed.inset-0")].some((el) => !el.classList.contains("hidden"));
}

// Só bloqueia a atualização quando o campo em foco está DENTRO de uma lista
// que o refresh reconstrói (um select de instrutor aberto, por exemplo).
// Campos fixos de busca, filtro e seleção de CT/orçamento não são recriados,
// então manter o foco neles não impede a atualização automática.
const CONTAINERS_DINAMICOS = [
  "#agend-turma-lista", "#agend-desmarcacoes-lista", "#cct-detalhe-lista", "#crud-lista",
  "#ag-lista", "#ag-negativas-lista", "#ag-desmarcacoes-lista", "#orc-lista",
  "#turma-lista", "#admin-lista", "#req-itens-lista",
].join(", ");

function usuarioEditandoCampo() {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") return false;
  return !!el.closest(CONTAINERS_DINAMICOS);
}

// --- refreshers por módulo (silenciosos: só re-renderizam se algo mudou) ---
async function refreshInstrutoresAdmin() {
  const [{ data, error }, { data: vinc }] = await Promise.all([
    supabase.from("instrutores").select("*").order("nome"),
    supabase.from("instrutor_categorias").select("instrutor_id, categoria_treinamento_id").order("instrutor_id"),
  ]);
  if (error || !dadosMudaram("instrutores", { data, vinc })) return;
  listaInstrutoresAdmin = data.filter((i) => i.role !== "admin");
  aptidoesPorInstrutor = {};
  (vinc || []).forEach((v) => {
    (aptidoesPorInstrutor[v.instrutor_id] = aptidoesPorInstrutor[v.instrutor_id] || []).push(v.categoria_treinamento_id);
  });
  renderizarListaAdmin();
}

async function refreshCrud() {
  const cfg = CRUD_CONFIG[crudModuloId];
  if (!cfg) return;
  const { data, error } = await supabase.from(cfg.tabela).select("*").order(cfg.ordenarPor, { ascending: cfg.ordenarAsc !== false });
  if (error || !dadosMudaram("crud:" + crudModuloId, data)) return;
  crudLista = data;
  renderizarListaCrud();
}

async function refreshAgendamentos() {
  const { data, error } = await supabase
    .from("agendamentos")
    .select("*, instrutores(nome, email), tipos_treinamento(nome), centros_treinamento(nome), empresas(nome)")
    .order("created_at", { ascending: false });
  if (error || !dadosMudaram("agendamentos", data)) return;
  listaAgendamentos = data || [];
  computarListaNegativas();
  renderizarAbasAgendamentos();
  renderizarListaAgendamentos();
  renderizarListaNegativas();
}

async function refreshOrcamentos() {
  const { data, error, count } = await consultarPaginaOrcamentos();
  if (error || !dadosMudaram("orcamentos", { data, count })) return;
  listaOrcamentos = data || [];
  orcTotal = count || 0;
  renderizarListaOrcamentos();
}

async function refreshTurmas() {
  if (!turmaOrcamentoSelecionadoId) return;
  const { data, error } = await supabase
    .from("turmas")
    .select("*, tipos_treinamento(nome), centros_treinamento(nome), instrutor1:instrutores!instrutor1_id(nome), instrutor2:instrutores!instrutor2_id(nome), empresas_transporte(nome)")
    .eq("orcamento_id", turmaOrcamentoSelecionadoId)
    .order("identificacao", { ascending: true });
  if (error || !dadosMudaram("turmas:" + turmaOrcamentoSelecionadoId, data)) return;
  turmasDoOrcamento = (data || []).sort(compararIdentificacaoTurma); // a atualização automática também mantém A1…Z1, AA1, AB1…
  renderizarListaTurmas();
}

async function refreshAgendamentoTurmas() {
  await carregarDesmarcacoesPendentes(false);
  if (!agendTurmaOrcamentoId) return;
  const [{ data: turmas, error: e1 }, { data: insts, error: e2 }] = await Promise.all([
    supabase.from("turmas").select("*, tipos_treinamento(nome, categoria_treinamento_id, somente_locacao_espaco), centros_treinamento(nome)").eq("orcamento_id", agendTurmaOrcamentoId).order("identificacao", { ascending: true }),
    supabase.from("instrutores").select("*").eq("status", "Ativo").order("nome"),
  ]);
  if (e1 || e2) return;
  const ids = (turmas || []).map((t) => t.id);
  const { data: ags } = ids.length
    ? await supabase.from("agendamentos").select("id, turma_id, instrutor_id, datas, datas_status").in("turma_id", ids).order("id")
    : { data: [] };
  if (!dadosMudaram("agendTurmas:" + agendTurmaOrcamentoId, { turmas, insts, ags })) return;
  agendTurmasLista = (turmas || []).sort(compararIdentificacaoTurma);
  listaInstrutoresAtivos = insts || [];
  agendTurmaAgendamentos.clear();
  (ags || []).forEach((a) => agendTurmaAgendamentos.set(`${a.turma_id}|${a.instrutor_id}`, a));
  agendTurmasLista.forEach((t) => {
    if ((t.instrutor1_id || t.instrutor2_id) && !agendTurmaInstrutores.has(t.id)) {
      agendTurmaInstrutores.set(t.id, { instrutor1: t.instrutor1_id || "", instrutor2: t.instrutor2_id || "" });
    }
  });
  renderizarListaAgendTurmas();
}

async function refreshConfirmacaoCt() {
  await carregarTurmasPreAgendamentoDefinitivo(false);
  await carregarAgendamentosCancelados(false);
  if (!$("cct-centro-select").value) return;
  await carregarListaConfirmacaoCt(false);
}

async function refreshAgendaInstrutor() {
  if (!perfilAtual?.id) return;
  const { data, error } = await supabase.from("instrutores").select("*").eq("id", perfilAtual.id).maybeSingle();
  if (error || !data || !dadosMudaram("perfil:" + perfilAtual.id, data)) return;
  perfilAtual = data;
  renderizarDadosInstrutor();
  renderizarCalendarioInstrutor();
}

async function refreshAgendaCentros() {
  await carregarAgendaCentros(false);
}

const AUTO_REFRESH_POR_MODULO = {
  instrutores: refreshInstrutoresAdmin,
  agendamentos: refreshAgendamentos,
  orcamentos: refreshOrcamentos,
  turmas: refreshTurmas,
  agendamento_turmas: refreshAgendamentoTurmas,
  confirmacao_ct: refreshConfirmacaoCt,
  agenda_centros: refreshAgendaCentros,
};

function marcarAutoRefresh(texto) {
  const el = $("auto-refresh-indicador");
  if (el) el.textContent = texto;
}

async function executarAutoRefresh() {
  if (autoRefreshEmAndamento) return;
  if (document.hidden) return;
  if (algumPainelAberto() || usuarioEditandoCampo()) {
    marcarAutoRefresh("atualização automática pausada (edição em andamento)");
    return;
  }
  autoRefreshEmAndamento = true;
  try {
    if (!$("tela-instrutor").classList.contains("hidden")) {
      await refreshAgendaInstrutor();
    } else if (!$("tela-admin").classList.contains("hidden") && moduloAtivo) {
      const fn = AUTO_REFRESH_POR_MODULO[moduloAtivo] || (CRUD_CONFIG[moduloAtivo] ? refreshCrud : null);
      if (fn) await fn();
    }
    marcarAutoRefresh(`atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`);
  } catch (e) {
    console.warn("Atualização automática falhou:", e);
    marcarAutoRefresh("falha na atualização automática — veja o console");
  } finally {
    autoRefreshEmAndamento = false;
  }
}

setInterval(executarAutoRefresh, AUTO_REFRESH_MS);
// Ao voltar para a aba, atualiza na hora em vez de esperar o próximo ciclo.
document.addEventListener("visibilitychange", () => { if (!document.hidden) executarAutoRefresh(); });


// ===========================================================
// OPERAÇÃO: AGENDA POR CENTRO DE TREINAMENTO
// Calendário mensal com a quantidade de turmas por dia. O usuário escolhe
// um centro de treinamento ou "Todos os centros" (soma de todos eles).
// ===========================================================
let accMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let accTurmasDoMes = [];
let accDiaSelecionado = null;

async function carregarAgendaCentrosInit() {
  $("admin-descricao-pagina").textContent = "Consulte a ocupação dos centros de treinamento: cada dia mostra quantas turmas estão agendadas.";
  const { data: centros } = await supabase.from("centros_treinamento").select("*").eq("status", "Ativo").order("nome");
  listaCentrosAtivos = centros || [];
  const sel = $("acc-centro-select");
  const anterior = sel.value || "TODOS";
  sel.innerHTML = `<option value="TODOS">Todos os centros de treinamento</option>` +
    listaCentrosAtivos.map((c) => `<option value="${c.id}">${c.nome}</option>`).join("");
  sel.value = listaCentrosAtivos.some((c) => c.id === anterior) ? anterior : "TODOS";
  accMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  accDiaSelecionado = null;
  await carregarAgendaCentros();
}

function limitesDoMes(mes) {
  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const ultimo = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
  return [formatarData(primeiro), formatarData(ultimo)];
}

async function carregarAgendaCentros(forcar = true) {
  const centroId = $("acc-centro-select").value || "TODOS";
  const filtro = $("acc-filtro-status").value;
  const [ini, fim] = limitesDoMes(accMes);

  let q = supabase
    .from("turmas")
    .select("id, identificacao, data_inicio, horario, tipo_dia, status, status_agendamento, eh_pre_agendamento, agenda_ct, agenda_instrutor1, agenda_instrutor2, centro_treinamento_id, centros_treinamento(nome), tipos_treinamento(nome), orcamentos(numero, observacao_ct, empresas(nome)), inst1:instrutores!turmas_instrutor1_id_fkey(nome), inst2:instrutores!turmas_instrutor2_id_fkey(nome)")
    .gte("data_inicio", ini)
    .lte("data_inicio", fim)
    .neq("status", "Cancelada")
    .order("data_inicio", { ascending: true });
  if (centroId !== "TODOS") q = q.eq("centro_treinamento_id", centroId);
  if (filtro) q = q.eq("status_agendamento", filtro);

  const { data, error } = await q;
  if (error) {
    $("acc-resumo").textContent = `Não foi possível carregar a agenda: ${error.message}`;
    return;
  }
  if (!forcar && !dadosMudaram(`agendaCentros:${centroId}:${filtro}:${ini}`, data)) return;
  if (forcar) dadosMudaram(`agendaCentros:${centroId}:${filtro}:${ini}`, data);

  accTurmasDoMes = (data || []).sort(compararIdentificacaoTurma);
  renderizarAgendaCentros();
}

// Agrupa as turmas do mês por data (chave "AAAA-MM-DD").
function agruparTurmasPorDia() {
  const mapa = new Map();
  accTurmasDoMes.forEach((t) => {
    if (!t.data_inicio) return;
    if (!mapa.has(t.data_inicio)) mapa.set(t.data_inicio, []);
    mapa.get(t.data_inicio).push(t);
  });
  return mapa;
}

function renderizarAgendaCentros() {
  const porDia = agruparTurmasPorDia();
  $("acc-mes-label").textContent = `${nomesMeses[accMes.getMonth()]} ${accMes.getFullYear()}`;
  $("acc-dias-semana").innerHTML = diasSemana
    .map((d) => `<div class="text-center text-[11px] font-medium text-slate-400 py-1">${d}</div>`).join("");

  const grade = gerarGradeMes(accMes.getFullYear(), accMes.getMonth());
  const elGrade = $("acc-grade-dias");
  elGrade.innerHTML = "";
  const hoje = formatarData(new Date());

  grade.forEach((dia) => {
    if (!dia) { elGrade.innerHTML += `<div></div>`; return; }
    const dataStr = formatarData(dia);
    const turmas = porDia.get(dataStr) || [];
    const total = turmas.length;
    const aguardando = turmas.filter((t) => t.status_agendamento === "Aguardando confirmação").length;
    const agendadas = turmas.filter((t) => t.status_agendamento === "Agendado").length;
    const preAgendadas = turmas.filter((t) => t.status_agendamento === "Agendado" && t.eh_pre_agendamento).length;

    let cor = "bg-white border-slate-200 text-slate-400";
    if (total > 0) {
      if (aguardando > 0) cor = "bg-amber-50 border-amber-300 text-amber-900";
      else if (agendadas === total) cor = preAgendadas > 0 ? "bg-sky-50 border-sky-300 text-sky-900" : "bg-teal-50 border-teal-300 text-teal-900";
      else cor = "bg-slate-50 border-slate-300 text-slate-700";
    }
    const selecionado = accDiaSelecionado === dataStr ? "ring-2 ring-amber-500" : "";
    const marcaHoje = dataStr === hoje ? "font-bold underline" : "";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `min-h-[74px] w-full rounded-lg border p-1.5 text-left transition-colors hover:border-amber-400 ${cor} ${selecionado}`;
    const comObservacao = turmas.some((t) => t.orcamentos?.observacao_ct);
    btn.title = total === 0 ? "Sem turmas"
      : `${total} turma(s) · ${agendadas} agendada(s)${preAgendadas > 0 ? ` (${preAgendadas} pré-agendada(s))` : ""} · ${aguardando} aguardando confirmação${comObservacao ? " · há observação para o CT" : ""}`;
    btn.innerHTML = `
      <div class="text-[11px] ${marcaHoje} flex items-center justify-between"><span>${dia.getDate()}</span>${comObservacao ? `<span title="Há observação para o Centro de Treinamento">📌</span>` : ""}</div>
      ${total > 0 ? `<div class="mt-1 text-lg leading-none font-semibold">${total}</div>
        <div class="text-[10px] leading-tight mt-0.5">turma${total > 1 ? "s" : ""}</div>
        ${aguardando > 0 ? `<div class="text-[10px] leading-tight">${aguardando} aguard.</div>` : ""}` : ""}
    `;
    btn.addEventListener("click", () => {
      accDiaSelecionado = accDiaSelecionado === dataStr ? null : dataStr;
      renderizarAgendaCentros();
    });
    elGrade.appendChild(btn);
  });

  const totalMes = accTurmasDoMes.length;
  const aguardMes = accTurmasDoMes.filter((t) => t.status_agendamento === "Aguardando confirmação").length;
  const agendMes = accTurmasDoMes.filter((t) => t.status_agendamento === "Agendado").length;
  const preAgendMes = accTurmasDoMes.filter((t) => t.status_agendamento === "Agendado" && t.eh_pre_agendamento).length;
  const centroTexto = $("acc-centro-select").value === "TODOS"
    ? `${listaCentrosAtivos.length} centro(s)` : $("acc-centro-select").selectedOptions[0].textContent;
  $("acc-resumo").textContent = `${centroTexto} · ${totalMes} turma(s) no mês · ${agendMes} agendada(s)` +
    (preAgendMes > 0 ? ` (${preAgendMes} pré-agendada(s))` : "") +
    ` · ${aguardMes} aguardando confirmação`;

  renderizarDetalheDiaAgendaCentros(porDia);
}

function renderizarDetalheDiaAgendaCentros(porDia) {
  const titulo = $("acc-detalhe-titulo");
  const lista = $("acc-detalhe-lista");
  if (!accDiaSelecionado) {
    titulo.textContent = "Selecione um dia no calendário";
    lista.innerHTML = `<p class="text-xs text-slate-400">Clique em um dia para ver as turmas daquele dia.</p>`;
    return;
  }
  const turmas = porDia.get(accDiaSelecionado) || [];
  titulo.textContent = `${formatarDataBr(accDiaSelecionado)} — ${turmas.length} turma(s)`;
  if (turmas.length === 0) {
    lista.innerHTML = `<p class="text-xs text-slate-400">Nenhuma turma neste dia.</p>`;
    return;
  }
  lista.innerHTML = turmas.map((t) => `
    <div class="border border-slate-200 rounded-lg p-2.5">
      <div class="flex items-start justify-between gap-2">
        <span class="font-mono text-xs text-slate-700">${t.identificacao || "—"}</span>
        ${badgeStatusAgendamento(t.status_agendamento, t.eh_pre_agendamento)}
      </div>
      <div class="text-sm text-slate-800 mt-1">${t.tipos_treinamento?.nome || "—"}</div>
      <div class="text-xs text-slate-500">${t.orcamentos?.empresas?.nome || "—"} · orç. ${t.orcamentos?.numero || "—"}</div>
      <div class="text-[11px] text-slate-500 mt-1">🏫 ${t.centros_treinamento?.nome || "—"}${t.horario ? ` · ${t.horario}` : ""}${t.tipo_dia ? ` · ${t.tipo_dia}` : ""}</div>
      <div class="text-[11px] text-slate-500">👤 ${[t.inst1?.nome, t.inst2?.nome].filter(Boolean).join(" e ") || "sem instrutor"}</div>
      ${t.orcamentos?.observacao_ct ? `<div class="mt-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 whitespace-pre-line">📌 ${t.orcamentos.observacao_ct}</div>` : ""}
    </div>
  `).join("");
}

$("acc-centro-select").addEventListener("change", () => carregarAgendaCentros());
$("acc-filtro-status").addEventListener("change", () => carregarAgendaCentros());
$("acc-mes-anterior").addEventListener("click", () => {
  accMes = new Date(accMes.getFullYear(), accMes.getMonth() - 1, 1);
  accDiaSelecionado = null;
  carregarAgendaCentros();
});
$("acc-mes-proximo").addEventListener("click", () => {
  accMes = new Date(accMes.getFullYear(), accMes.getMonth() + 1, 1);
  accDiaSelecionado = null;
  carregarAgendaCentros();
});

// ===========================================================
// Disponibilidade dos Instrutores (consulta mensal, somente leitura)
// Cruza instrutores.dias_status (disponivel/bloqueado/agendado/aguardando)
// com os pedidos de cancelamento pendentes em agendamentos.datas_status
// (mesmo conceito de "desmarcação pendente" do Agendamento de Turmas) para
// destacar, em vermelho, um dia "agendado" com pedido de cancelamento aberto.
// ===========================================================
let dispoMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let dispoCentrosRef = [];
let dispoInstrutoresRef = [];
let dispoDesmarcacaoPendenteSet = new Set(); // "instrutorId|AAAA-MM-DD"

const ESTILO_DISPO = {
  disponivel: "bg-teal-600",
  bloqueado: "bg-slate-200",
  agendado: "bg-blue-600",
  aguardando: "bg-amber-400",
  cancelando: "bg-rose-600",
};
const ROTULO_DISPO = {
  disponivel: "Disponível",
  bloqueado: "Sem registro / bloqueado",
  agendado: "Agendado",
  aguardando: "Aguardando confirmação",
  cancelando: "Agendado — pedido de cancelamento pendente",
};

// Siglas dos Centros de Treinamento (economiza espaço na tabela de
// disponibilidade). Centros ainda não cadastrados aqui caem no fallback
// (3 primeiras letras do nome, sem o prefixo "Work Fire").
const DISPO_SIGLA_CT = {
  "8632e1df-c873-4349-835e-ba32d14f64eb": "GRU", // Work Fire Guarulhos
  "a431cbd2-fe04-4c68-a539-6a1ad6fd1b12": "SAN", // Work Fire Santos
  "6c5270dd-4b6b-48e0-a221-ef55dc7a452e": "SJC", // Work Fire São José dos Campos
};
function siglaCentroDispo(centro) {
  if (!centro) return "—";
  if (DISPO_SIGLA_CT[centro.id]) return DISPO_SIGLA_CT[centro.id];
  const semPrefixo = centro.nome.replace(/^work ?fire\s*/i, "").trim();
  return (semPrefixo || centro.nome).slice(0, 3).toUpperCase();
}

function statusDispoDia(instrutor, dataStr) {
  const base = obterStatusDia(instrutor.dias_status, dataStr);
  if (base === "agendado" && dispoDesmarcacaoPendenteSet.has(`${instrutor.id}|${dataStr}`)) return "cancelando";
  return base;
}

function diasDoMesLista(ano, mes) {
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  const lista = [];
  for (let d = 1; d <= ultimoDia; d++) lista.push(new Date(ano, mes, d));
  return lista;
}

function corSubtotalDisponiveisDispo(qtd) {
  if (qtd < 2) return "bg-rose-100 text-rose-700";
  if (qtd <= 4) return "bg-amber-100 text-amber-700";
  return "bg-emerald-100 text-emerald-700";
}

function montarDesmarcacaoPendenteDispo(agendamentos) {
  dispoDesmarcacaoPendenteSet = new Set();
  (agendamentos || []).forEach((a) => {
    Object.entries(a.datas_status || {}).forEach(([data, info]) => {
      if (info && info.solicitacao_cancelamento && info.solicitacao_cancelamento.pendente) {
        dispoDesmarcacaoPendenteSet.add(`${a.instrutor_id}|${data}`);
      }
    });
  });
}

function preencherSelectsMesDispo() {
  const selMes = $("dispo-mes-select");
  selMes.innerHTML = nomesMeses.map((m, i) => `<option value="${i}">${m}</option>`).join("");
  selMes.value = String(dispoMes.getMonth());

  const anoAtual = new Date().getFullYear();
  const anos = new Set();
  for (let a = anoAtual - 2; a <= anoAtual + 3; a++) anos.add(a);
  anos.add(dispoMes.getFullYear());
  const selAno = $("dispo-ano-select");
  selAno.innerHTML = [...anos].sort((a, b) => a - b).map((a) => `<option value="${a}">${a}</option>`).join("");
  selAno.value = String(dispoMes.getFullYear());
}

function preencherFiltroCentroDispo() {
  const sel = $("dispo-centro-select");
  const atual = sel.value;
  sel.innerHTML = `<option value="">Todos os centros</option>` +
    dispoCentrosRef.map((c) => `<option value="${c.id}">${c.nome}${c.status !== "Ativo" ? " (inativo)" : ""}</option>`).join("");
  sel.value = atual || "";
}

function instrutoresFiltradosDispo() {
  const centro = $("dispo-centro-select").value;
  const statusFiltro = $("dispo-status-select").value; // "Ativo" | "Todos"
  return dispoInstrutoresRef
    .filter((i) => i.role !== "admin")
    .filter((i) => statusFiltro !== "Ativo" || i.status === "Ativo")
    .filter((i) => !centro || i.centro_treinamento_principal_id === centro)
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

async function carregarDisponibilidadeInstrutoresInit() {
  preencherSelectsMesDispo();
  const [{ data: centros }, { data: instrutores }, { data: agendamentos }] = await Promise.all([
    supabase.from("centros_treinamento").select("id, nome, status").order("nome"),
    supabase.from("instrutores").select("id, nome, status, role, centro_treinamento_principal_id, dias_status").order("nome"),
    supabase.from("agendamentos").select("instrutor_id, datas_status"),
  ]);
  dispoCentrosRef = centros || [];
  dispoInstrutoresRef = instrutores || [];
  montarDesmarcacaoPendenteDispo(agendamentos);
  preencherFiltroCentroDispo();
  renderizarDisponibilidadeInstrutores();
}

const DISPO_LARG = { nome: 104, ct: 28, agend: 42, disp: 42, dia: 25 };
const DISPO_LEFT = {
  nome: 0,
  ct: DISPO_LARG.nome,
  agend: DISPO_LARG.nome + DISPO_LARG.ct,
  disp: DISPO_LARG.nome + DISPO_LARG.ct + DISPO_LARG.agend,
};
const DISPO_LARG_STICKY_TOTAL = DISPO_LARG.nome + DISPO_LARG.ct + DISPO_LARG.agend + DISPO_LARG.disp;

function renderizarDisponibilidadeInstrutores() {
  const ano = dispoMes.getFullYear();
  const mes = dispoMes.getMonth();
  const dias = diasDoMesLista(ano, mes);
  const instrutores = instrutoresFiltradosDispo();

  $("dispo-resumo").textContent = `${instrutores.length} instrutor(es) · ${nomesMeses[mes]} ${ano}`;
  const vazio = instrutores.length === 0;
  $("dispo-vazio").classList.toggle("hidden", !vazio);
  $("dispo-tabela-wrap").classList.toggle("hidden", vazio);
  if (vazio) {
    $("dispo-thead").innerHTML = "";
    $("dispo-tbody").innerHTML = "";
    $("dispo-tfoot").innerHTML = "";
    return;
  }

  $("dispo-thead").innerHTML = `
    <tr>
      <th class="sticky top-0 left-0 z-30 bg-slate-50 px-3 py-2 font-medium text-left border-b border-slate-200" style="width:${DISPO_LARG.nome}px;min-width:${DISPO_LARG.nome}px">Instrutor</th>
      <th title="Centro de Treinamento principal" class="sticky top-0 z-30 bg-slate-50 px-0.5 py-2 text-[10px] font-medium text-center border-b border-slate-200" style="left:${DISPO_LEFT.ct}px;width:${DISPO_LARG.ct}px;min-width:${DISPO_LARG.ct}px">CT</th>
      <th title="Dias agendados no mês" class="sticky top-0 z-30 bg-slate-50 px-0.5 py-2 text-[10px] font-medium text-center border-b border-slate-200" style="left:${DISPO_LEFT.agend}px;width:${DISPO_LARG.agend}px;min-width:${DISPO_LARG.agend}px">Agend.</th>
      <th title="Dias disponíveis no mês" class="sticky top-0 z-30 bg-slate-50 px-0.5 py-2 text-[10px] font-medium text-center border-b border-slate-200" style="left:${DISPO_LEFT.disp}px;width:${DISPO_LARG.disp}px;min-width:${DISPO_LARG.disp}px">Dispon.</th>
      ${dias.map((d) => `<th class="sticky top-0 z-20 bg-slate-50 px-0.5 py-2 font-medium text-center border-b border-slate-200" style="width:${DISPO_LARG.dia}px;min-width:${DISPO_LARG.dia}px">${d.getDate()}<div class="text-[8px] font-normal text-slate-400">${diasSemana[d.getDay()]}</div></th>`).join("")}
    </tr>`;

  const subtotaisDisp = {};
  const subtotaisAgend = {};
  dias.forEach((d) => { subtotaisDisp[formatarData(d)] = 0; subtotaisAgend[formatarData(d)] = 0; });

  $("dispo-tbody").innerHTML = instrutores.map((inst) => {
    const ct = dispoCentrosRef.find((c) => c.id === inst.centro_treinamento_principal_id);
    let totalAgendados = 0, totalDisponiveis = 0;
    const celulas = dias.map((d) => {
      const dataStr = formatarData(d);
      const status = statusDispoDia(inst, dataStr);
      if (status === "agendado" || status === "cancelando") { totalAgendados++; subtotaisAgend[dataStr]++; }
      if (status === "disponivel") { totalDisponiveis++; subtotaisDisp[dataStr]++; }
      return `<td class="p-0.5 text-center" style="width:${DISPO_LARG.dia}px;min-width:${DISPO_LARG.dia}px"><span title="${ROTULO_DISPO[status]} — ${formatarDataAbrev(dataStr)}" class="inline-flex w-full h-6 rounded ${ESTILO_DISPO[status]}"></span></td>`;
    }).join("");
    return `
    <tr>
      <td title="${inst.nome}" class="sticky left-0 z-10 bg-white px-2 py-1.5 text-xs text-slate-800 whitespace-nowrap overflow-hidden text-ellipsis" style="width:${DISPO_LARG.nome}px;min-width:${DISPO_LARG.nome}px">${inst.nome}${inst.status !== "Ativo" ? ` <span class="text-[9px] text-rose-500">(inat.)</span>` : ""}</td>
      <td title="${ct?.nome || ""}" class="sticky z-10 bg-white px-0.5 py-1.5 text-[10px] text-slate-500 text-center whitespace-nowrap overflow-hidden text-ellipsis" style="left:${DISPO_LEFT.ct}px;width:${DISPO_LARG.ct}px;min-width:${DISPO_LARG.ct}px">${siglaCentroDispo(ct)}</td>
      <td class="sticky z-10 bg-white px-0.5 py-1.5 text-center text-[10px] font-medium text-blue-700" style="left:${DISPO_LEFT.agend}px;width:${DISPO_LARG.agend}px;min-width:${DISPO_LARG.agend}px">${totalAgendados}</td>
      <td class="sticky z-10 bg-white px-0.5 py-1.5 text-center text-[10px] font-medium text-teal-700" style="left:${DISPO_LEFT.disp}px;width:${DISPO_LARG.disp}px;min-width:${DISPO_LARG.disp}px">${totalDisponiveis}</td>
      ${celulas}
    </tr>`;
  }).join("");

  $("dispo-tfoot").innerHTML = `
    <tr class="border-t-2 border-slate-200">
      <td colspan="4" title="Quantidade de instrutores disponíveis em cada dia" class="sticky left-0 z-10 bg-slate-50 px-2 py-1.5 font-medium text-slate-600 text-xs whitespace-nowrap overflow-hidden text-ellipsis" style="width:${DISPO_LARG_STICKY_TOTAL}px;min-width:${DISPO_LARG_STICKY_TOTAL}px">📌 Disponíveis/dia</td>
      ${dias.map((d) => { const qtd = subtotaisDisp[formatarData(d)]; return `<td class="p-0.5 text-center" style="width:${DISPO_LARG.dia}px;min-width:${DISPO_LARG.dia}px"><span class="inline-flex items-center justify-center w-full h-6 rounded text-[11px] font-semibold ${corSubtotalDisponiveisDispo(qtd)}">${qtd}</span></td>`; }).join("")}
    </tr>
    <tr>
      <td colspan="4" title="Quantidade de instrutores agendados em cada dia" class="sticky left-0 z-10 bg-slate-50 px-2 py-1.5 font-medium text-slate-600 text-xs whitespace-nowrap overflow-hidden text-ellipsis" style="width:${DISPO_LARG_STICKY_TOTAL}px;min-width:${DISPO_LARG_STICKY_TOTAL}px">📘 Agendados/dia</td>
      ${dias.map((d) => { const qtd = subtotaisAgend[formatarData(d)]; return `<td class="p-0.5 text-center"><span class="inline-flex items-center justify-center w-full h-6 rounded text-[11px] font-semibold bg-blue-50 text-blue-700">${qtd}</span></td>`; }).join("")}
    </tr>`;
}

$("dispo-mes-select").addEventListener("change", (e) => {
  dispoMes = new Date(dispoMes.getFullYear(), Number(e.target.value), 1);
  renderizarDisponibilidadeInstrutores();
});
$("dispo-ano-select").addEventListener("change", (e) => {
  dispoMes = new Date(Number(e.target.value), dispoMes.getMonth(), 1);
  preencherSelectsMesDispo();
  renderizarDisponibilidadeInstrutores();
});
$("dispo-mes-anterior").addEventListener("click", () => {
  dispoMes = new Date(dispoMes.getFullYear(), dispoMes.getMonth() - 1, 1);
  preencherSelectsMesDispo();
  renderizarDisponibilidadeInstrutores();
});
$("dispo-mes-proximo").addEventListener("click", () => {
  dispoMes = new Date(dispoMes.getFullYear(), dispoMes.getMonth() + 1, 1);
  preencherSelectsMesDispo();
  renderizarDisponibilidadeInstrutores();
});
$("dispo-centro-select").addEventListener("change", renderizarDisponibilidadeInstrutores);
$("dispo-status-select").addEventListener("change", renderizarDisponibilidadeInstrutores);
$("dispo-atualizar").addEventListener("click", carregarDisponibilidadeInstrutoresInit);

// ===========================================================
// Documentos de Turmas (fotos e lista de presença enviadas pelo
// app agenda-instrutores — tabela turma_midias / bucket turma-midias)
// Tela SOMENTE LEITURA: o upload continua sendo feito pelo instrutor,
// no app agenda-instrutores. Aqui apenas consultamos e visualizamos.
// ===========================================================
let dtTurmasLista = [];
let dtEmpresasLista = [];

async function carregarDocumentosTurmasInit() {
  $("admin-descricao-pagina").textContent = "Consulte as fotos da turma e da lista de presença enviadas pelos instrutores.";
  const { data: empresas } = await buscarTodos(() => supabase.from("empresas").select("id, nome, cnpj, cnpj_grupo_economico").eq("status", "Ativo").order("nome").order("id"));
  dtEmpresasLista = empresas || [];
  const sel = $("dt-empresa-select");
  const anterior = sel.value || "";
  sel.innerHTML = `<option value="">Todas as empresas</option>` +
    dtEmpresasLista.map((e) => `<option value="${e.id}">${e.nome}</option>`).join("");
  sel.value = dtEmpresasLista.some((e) => e.id === anterior) ? anterior : "";
  $("dt-grupo-economico-bloco").classList.toggle("hidden", !sel.value);
  await carregarDocumentosTurmas();
}

let dtCarregando = 0;
async function carregarDocumentosTurmas() {
  const empresaId = $("dt-empresa-select").value;
  const grupoEconomico = $("dt-grupo-economico").checked;
  const dataDe = $("dt-filtro-data-de").value;
  const dataAte = $("dt-filtro-data-ate").value;
  const soComDocumento = $("dt-so-com-documento").checked;
  const meuToken = ++dtCarregando; // descarta respostas antigas se o filtro mudar durante a carga

  const falha = (msg) => {
    $("dt-conteudo").classList.add("hidden");
    $("dt-vazio").classList.remove("hidden");
    $("dt-vazio").textContent = `Não foi possível carregar as turmas: ${msg}`;
  };

  // Documentos: alunos e fotos são buscados por inteiro (em páginas) — são poucos em relação ao total de turmas.
  const [{ data: da, error: eA }, { data: dm, error: eM }] = await Promise.all([
    buscarTodos(() => supabase.from("turma_alunos").select("turma_id").order("id")),
    buscarTodos(() => supabase.from("turma_midias").select("turma_id, tipo").order("id")),
  ]);
  if (eA || eM) return falha((eA || eM).message);
  const alunos = da || [];
  const midias = dm || [];

  const consulta = () => {
    let q = supabase
      .from("turmas")
      .select("*, tipos_treinamento(nome), instrutor1:instrutores!instrutor1_id(nome), instrutor2:instrutores!instrutor2_id(nome), orcamentos!inner(numero, empresa_id, empresas(nome))")
      .neq("status", "Cancelada");
    if (dataDe) q = q.gte("data_inicio", dataDe);
    if (dataAte) q = q.lte("data_inicio", dataAte);
    if (empresaId) {
      if (grupoEconomico) {
        const empresaSel = dtEmpresasLista.find((e) => e.id === empresaId);
        const alvo = grupoDeEmpresa(empresaSel || {});
        const ids = alvo ? dtEmpresasLista.filter((e) => grupoDeEmpresa(e) === alvo).map((e) => e.id) : [empresaId];
        q = q.in("orcamentos.empresa_id", ids);
      } else {
        q = q.eq("orcamentos.empresa_id", empresaId);
      }
    }
    return q;
  };

  let turmas = [], erro = null;
  if (soComDocumento) {
    // só as turmas que têm aluno, foto da turma ou foto da lista de presença
    const comDoc = [...new Set([...alunos.map((a) => a.turma_id), ...midias.filter((m) => m.tipo === "foto_turma" || m.tipo === "foto_presenca").map((m) => m.turma_id)])];
    for (let i = 0; i < comDoc.length && !erro; i += 100) {
      const { data, error } = await consulta().in("id", comDoc.slice(i, i + 100)).order("id");
      if (error) erro = error; else turmas = turmas.concat(data || []);
    }
  } else {
    const r = await buscarTodos(() => consulta().order("identificacao", { ascending: true }).order("id"));
    turmas = r.data || [];
    erro = r.error;
  }
  if (meuToken !== dtCarregando) return;
  if (erro) return falha(erro.message);

  const contAlunos = new Map(), contFotosTurma = new Map(), contFotosPresenca = new Map();
  alunos.forEach((a) => contAlunos.set(a.turma_id, (contAlunos.get(a.turma_id) || 0) + 1));
  midias.forEach((m) => {
    if (m.tipo === "foto_turma") contFotosTurma.set(m.turma_id, (contFotosTurma.get(m.turma_id) || 0) + 1);
    else if (m.tipo === "foto_presenca") contFotosPresenca.set(m.turma_id, (contFotosPresenca.get(m.turma_id) || 0) + 1);
  });

  dtTurmasLista = turmas.sort(compararIdentificacaoTurma).map((t) => ({
    ...t,
    qtdAlunos: contAlunos.get(t.id) || 0,
    qtdFotosTurma: contFotosTurma.get(t.id) || 0,
    qtdFotosPresenca: contFotosPresenca.get(t.id) || 0,
  }));

  renderizarDocumentosTurmas();
}

function renderizarDocumentosTurmas() {
  const soComDocumento = $("dt-so-com-documento").checked;
  const lista = soComDocumento
    ? dtTurmasLista.filter((t) => t.qtdAlunos > 0 || t.qtdFotosTurma > 0 || t.qtdFotosPresenca > 0)
    : dtTurmasLista;

  $("dt-vazio").classList.toggle("hidden", lista.length > 0);
  $("dt-vazio").textContent = soComDocumento
    ? "Nenhuma turma com alunos, fotos ou lista de presença para esta seleção. Desmarque “Turmas com documento” para ver todas."
    : "Nenhuma turma encontrada para esta seleção.";
  $("dt-conteudo").classList.toggle("hidden", lista.length === 0);

  const cont = $("dt-lista");
  cont.innerHTML = lista.map((t) => `
    <tr class="hover:bg-slate-50">
      <td class="px-3 py-2 font-mono text-slate-700">${t.identificacao || "—"}</td>
      <td class="px-3 py-2 text-slate-500">${t.orcamentos?.numero || "—"}</td>
      <td class="px-3 py-2 text-slate-700">${t.orcamentos?.empresas?.nome || "—"}</td>
      <td class="px-3 py-2 text-slate-500">${formatarDataBr(t.data_inicio)}${t.data_fim && t.data_fim !== t.data_inicio ? ` a ${formatarDataBr(t.data_fim)}` : ""}</td>
      <td class="px-3 py-2 text-slate-700">${t.instrutor1?.nome || "—"}</td>
      <td class="px-3 py-2 text-slate-700">${t.instrutor2?.nome || "—"}</td>
      <td class="px-3 py-2">
        <button data-dt-alunos="${t.id}" class="font-medium underline ${t.qtdAlunos ? "text-sm text-teal-700 hover:text-teal-900 font-semibold" : "text-xs text-slate-400 hover:text-slate-600"}">${t.qtdAlunos} 👥</button>
      </td>
      <td class="px-3 py-2">
        <button data-dt-fotos="${t.id}" class="font-medium underline ${t.qtdFotosTurma ? "text-sm text-teal-700 hover:text-teal-900 font-semibold" : "text-xs text-slate-400 hover:text-slate-600"}">${t.qtdFotosTurma} 📷</button>
      </td>
      <td class="px-3 py-2">
        <button data-dt-fotos="${t.id}" class="font-medium underline ${t.qtdFotosPresenca ? "text-sm text-teal-700 hover:text-teal-900 font-semibold" : "text-xs text-slate-400 hover:text-slate-600"}">${t.qtdFotosPresenca} 📝</button>
      </td>
    </tr>
  `).join("");
  cont.querySelectorAll("[data-dt-alunos]").forEach((btn) => btn.addEventListener("click", () => abrirPainelAlunosTurma(btn.getAttribute("data-dt-alunos"))));
  cont.querySelectorAll("[data-dt-fotos]").forEach((btn) => btn.addEventListener("click", () => abrirPainelDocumentosTurma(btn.getAttribute("data-dt-fotos"))));
}

async function urlArquivoTurmaMidia(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("turma-midias").createSignedUrl(path, 60 * 60);
  return error ? null : data.signedUrl;
}

async function abrirPainelDocumentosTurma(turmaId) {
  const t = dtTurmasLista.find((x) => x.id === turmaId);
  $("painel-documentos-turma-titulo").textContent = `Documentos — Turma ${t?.identificacao || ""}`;
  $("painel-documentos-turma-info").textContent = [t?.data_inicio && formatarDataBr(t.data_inicio), [t?.instrutor1?.nome, t?.instrutor2?.nome].filter(Boolean).join(" e ")].filter(Boolean).join(" · ");
  $("dt-painel-fotos-turma-grade").innerHTML = `<p class="col-span-full text-xs text-slate-400">Carregando…</p>`;
  $("dt-painel-fotos-presenca-grade").innerHTML = "";
  $("dt-painel-fotos-turma-contagem").textContent = "";
  $("dt-painel-fotos-presenca-contagem").textContent = "";
  $("painel-documentos-turma").classList.remove("hidden");

  const { data, error } = await supabase
    .from("turma_midias")
    .select("*")
    .eq("turma_id", turmaId)
    .order("criado_em", { ascending: true });

  if (error) {
    $("dt-painel-fotos-turma-grade").innerHTML = `<p class="col-span-full text-xs text-rose-500">Não foi possível carregar as fotos: ${error.message}</p>`;
    return;
  }

  const fotosTurma = (data || []).filter((m) => m.tipo === "foto_turma");
  const fotosPresenca = (data || []).filter((m) => m.tipo === "foto_presenca");
  $("dt-painel-fotos-turma-contagem").textContent = `(${fotosTurma.length})`;
  $("dt-painel-fotos-presenca-contagem").textContent = `(${fotosPresenca.length})`;

  await renderizarGradeMidiasTurma("dt-painel-fotos-turma-grade", fotosTurma, "Nenhuma foto da turma enviada.");
  await renderizarGradeMidiasTurma("dt-painel-fotos-presenca-grade", fotosPresenca, "Nenhuma foto da lista de presença enviada.");
}

async function renderizarGradeMidiasTurma(elId, midias, textoVazio) {
  const el = $(elId);
  if (midias.length === 0) {
    el.innerHTML = `<p class="col-span-full text-xs text-slate-400">${textoVazio}</p>`;
    return;
  }
  const urls = await Promise.all(midias.map((m) => urlArquivoTurmaMidia(m.caminho_arquivo)));
  el.innerHTML = midias.map((m, i) => urls[i] ? `
    <a href="${urls[i]}" target="_blank" rel="noopener" class="block aspect-square rounded-md overflow-hidden border border-slate-200 bg-slate-50 hover:opacity-80">
      <img src="${urls[i]}" loading="lazy" class="w-full h-full object-cover" />
    </a>
  ` : `
    <div class="aspect-square rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center text-[10px] text-slate-400">indisponível</div>
  `).join("");
}

$("dt-empresa-select").addEventListener("change", () => {
  $("dt-grupo-economico-bloco").classList.toggle("hidden", !$("dt-empresa-select").value);
  if (!$("dt-empresa-select").value) $("dt-grupo-economico").checked = false;
  carregarDocumentosTurmas();
});
$("dt-grupo-economico").addEventListener("change", () => carregarDocumentosTurmas());
$("dt-so-com-documento").addEventListener("change", () => carregarDocumentosTurmas());
$("dt-filtro-data-de").addEventListener("change", () => carregarDocumentosTurmas());
$("dt-filtro-data-ate").addEventListener("change", () => carregarDocumentosTurmas());
$("btn-fechar-painel-documentos-turma").addEventListener("click", () => $("painel-documentos-turma").classList.add("hidden"));
$("painel-documentos-turma-overlay").addEventListener("click", () => $("painel-documentos-turma").classList.add("hidden"));

// ===========================================================
// Treinamentos de Capacitação (cadastro + visualização)
// Materiais de treinamento (PDF, vídeo, etc.) para os usuários dos
// apps workfire-mais-perto e (futuramente) agenda-instrutores.
// ===========================================================
let tcLista = [];
let tcEditandoId = null;
let tcBusca = "";

const TC_APLICATIVO_LABEL = {
  "workfire-mais-perto": "workfire-mais-perto.netlify.app",
  "agenda-instrutores": "agenda-instrutores.netlify.app",
  "ambos": "Ambos os aplicativos",
};

function iconeArquivoTreinamento(nomeOuTipo) {
  const s = (nomeOuTipo || "").toLowerCase();
  if (s.includes("pdf")) return "📄";
  if (s.includes("mp4") || s.includes("video") || s.includes("mov") || s.includes("avi")) return "🎬";
  if (s.includes("image") || s.includes("png") || s.includes("jpg") || s.includes("jpeg")) return "🖼️";
  return "📎";
}

async function carregarTreinamentosCapacitacaoInit() {
  $("admin-descricao-pagina").textContent = "Cadastre os materiais de treinamento (PDF, vídeo, etc.) disponíveis para os usuários dos aplicativos.";
  esconderErro("tc-form-erro");
  $("tc-form-bloco").classList.add("hidden");
  tcEditandoId = null;
  tcBusca = "";
  $("tc-busca").value = "";
  await carregarTreinamentosCapacitacao();
}

async function carregarTreinamentosCapacitacao() {
  const { data, error } = await supabase
    .from("treinamentos_capacitacao")
    .select("*")
    .order("data_disponibilizacao", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    $("tc-lista").innerHTML = `<tr><td colspan="6" class="text-center text-rose-500 text-sm py-8">Não foi possível carregar: ${error.message}</td></tr>`;
    return;
  }
  tcLista = data || [];
  renderizarListaTreinamentosCapacitacao();
}

function renderizarListaTreinamentosCapacitacao() {
  const podeAlterar = podeFazer("treinamentos_capacitacao", "alterar");
  const podeExcluir = podeFazer("treinamentos_capacitacao", "excluir");
  const busca = tcBusca.toLowerCase();
  const lista = tcLista.filter((t) => !busca || (t.descricao || "").toLowerCase().includes(busca));
  const cont = $("tc-lista");
  if (lista.length === 0) {
    cont.innerHTML = `<tr><td colspan="6" class="text-center text-slate-400 text-sm py-10">Nenhum treinamento cadastrado.</td></tr>`;
    return;
  }
  const badgeStatus = (s) => `<span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${s === "Inativo" ? "bg-rose-50 text-rose-600" : "bg-teal-50 text-teal-700"}">${s}</span>`;
  cont.innerHTML = lista.map((t) => `
    <tr class="hover:bg-slate-50">
      <td class="px-3 py-2 text-slate-800 max-w-xs">${t.descricao || "—"}</td>
      <td class="px-3 py-2 text-slate-500 whitespace-nowrap">${formatarDataBr(t.data_disponibilizacao)}</td>
      <td class="px-3 py-2 text-slate-500 whitespace-nowrap">${TC_APLICATIVO_LABEL[t.aplicativo] || t.aplicativo}</td>
      <td class="px-3 py-2 whitespace-nowrap">
        <button data-tc-abrir-arquivo="${t.id}" class="text-slate-600 hover:text-slate-900 underline">${iconeArquivoTreinamento(t.arquivo_tipo || t.arquivo_nome)} ${t.arquivo_nome || "arquivo"}</button>
      </td>
      <td class="px-3 py-2 whitespace-nowrap">${badgeStatus(t.status)}</td>
      <td class="px-3 py-2 text-right whitespace-nowrap">
        ${podeAlterar ? `<button data-tc-editar="${t.id}" class="text-slate-500 hover:text-slate-800 mr-2">✏️</button>` : ""}
        ${podeExcluir ? `<button data-tc-excluir="${t.id}" class="text-rose-500 hover:text-rose-700">🗑️</button>` : ""}
      </td>
    </tr>
  `).join("");
  cont.querySelectorAll("[data-tc-abrir-arquivo]").forEach((btn) => btn.addEventListener("click", () => abrirArquivoTreinamento(btn.getAttribute("data-tc-abrir-arquivo"))));
  cont.querySelectorAll("[data-tc-editar]").forEach((btn) => btn.addEventListener("click", () => abrirEdicaoTreinamento(btn.getAttribute("data-tc-editar"))));
  cont.querySelectorAll("[data-tc-excluir]").forEach((btn) => btn.addEventListener("click", () => excluirTreinamento(btn.getAttribute("data-tc-excluir"))));
}

async function urlArquivoTreinamento(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("treinamentos-capacitacao").createSignedUrl(path, 60 * 60);
  return error ? null : data.signedUrl;
}

async function abrirArquivoTreinamento(id) {
  const t = tcLista.find((x) => x.id === id) || tcTreinamentosDisponiveis.find((x) => x.id === id);
  const u = await urlArquivoTreinamento(t?.arquivo_path);
  if (u) window.open(u, "_blank");
}

$("tc-busca").addEventListener("input", () => {
  tcBusca = $("tc-busca").value;
  renderizarListaTreinamentosCapacitacao();
});

function limparFormularioTreinamento() {
  tcEditandoId = null;
  esconderErro("tc-form-erro");
  $("tc-descricao").value = "";
  $("tc-data").value = new Date().toISOString().slice(0, 10);
  $("tc-aplicativo").value = "workfire-mais-perto";
  $("tc-status").value = "Ativo";
  $("tc-arquivo-input").value = "";
  $("tc-arquivo-atual").textContent = "";
}

$("btn-tc-novo").addEventListener("click", () => {
  limparFormularioTreinamento();
  $("tc-form-bloco").classList.remove("hidden");
});

$("btn-tc-cancelar").addEventListener("click", () => {
  $("tc-form-bloco").classList.add("hidden");
});

function abrirEdicaoTreinamento(id) {
  const t = tcLista.find((x) => x.id === id);
  if (!t) return;
  tcEditandoId = id;
  esconderErro("tc-form-erro");
  $("tc-descricao").value = t.descricao || "";
  $("tc-data").value = t.data_disponibilizacao || "";
  $("tc-aplicativo").value = t.aplicativo || "workfire-mais-perto";
  $("tc-status").value = t.status || "Ativo";
  $("tc-arquivo-input").value = "";
  $("tc-arquivo-atual").textContent = t.arquivo_nome ? `Arquivo atual: ${t.arquivo_nome} (selecione um novo arquivo apenas se quiser substituí-lo)` : "";
  $("tc-form-bloco").classList.remove("hidden");
}

async function salvarTreinamento() {
  esconderErro("tc-form-erro");
  const descricao = $("tc-descricao").value.trim();
  const data = $("tc-data").value;
  const aplicativo = $("tc-aplicativo").value;
  const status = $("tc-status").value;
  const file = $("tc-arquivo-input").files[0];

  if (!descricao) return mostrarErro("tc-form-erro", "Informe a descrição do treinamento.");
  if (!data) return mostrarErro("tc-form-erro", "Informe a data de disponibilização.");
  if (!tcEditandoId && !file) return mostrarErro("tc-form-erro", "Selecione o arquivo do treinamento.");

  const btn = $("btn-tc-salvar");
  btn.disabled = true; btn.textContent = "Salvando…";

  let arquivoPath = null, arquivoNome = null, arquivoTipo = null;
  if (file) {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    arquivoPath = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: erroUp } = await supabase.storage.from("treinamentos-capacitacao").upload(arquivoPath, file, { upsert: true });
    if (erroUp) {
      btn.disabled = false; btn.textContent = "Salvar";
      return mostrarErro("tc-form-erro", "Não foi possível enviar o arquivo. Tente novamente.");
    }
    arquivoNome = file.name;
    arquivoTipo = file.type || null;
  }

  const registro = { descricao, data_disponibilizacao: data, aplicativo, status };
  if (arquivoPath) { registro.arquivo_path = arquivoPath; registro.arquivo_nome = arquivoNome; registro.arquivo_tipo = arquivoTipo; }

  let error;
  if (tcEditandoId) {
    ({ error } = await supabase.from("treinamentos_capacitacao").update(registro).eq("id", tcEditandoId));
  } else {
    ({ error } = await supabase.from("treinamentos_capacitacao").insert(registro));
  }

  btn.disabled = false; btn.textContent = "Salvar";
  if (error) return mostrarErro("tc-form-erro", "Não foi possível salvar. Tente novamente.");

  $("tc-form-bloco").classList.add("hidden");
  await carregarTreinamentosCapacitacao();
}

$("btn-tc-salvar").addEventListener("click", salvarTreinamento);

async function excluirTreinamento(id) {
  const t = tcLista.find((x) => x.id === id);
  if (!t || !confirmarExclusao(`o treinamento "${t.descricao || ""}"`.trim())) return;
  if (t.arquivo_path) await supabase.storage.from("treinamentos-capacitacao").remove([t.arquivo_path]);
  const { error } = await supabase.from("treinamentos_capacitacao").delete().eq("id", id);
  if (!error) await carregarTreinamentosCapacitacao();
}

// ---------------------------------------------------------
// Painel de visualização (qualquer usuário logado) — acessível pelo
// topo do app, em qualquer tela.
// ---------------------------------------------------------
let tcTreinamentosDisponiveis = [];

async function abrirPainelTreinamentos() {
  $("painel-treinamentos-lista").innerHTML = `<p class="text-xs text-slate-400">Carregando…</p>`;
  $("painel-treinamentos").classList.remove("hidden");

  const { data, error } = await supabase
    .from("treinamentos_capacitacao")
    .select("*")
    .order("data_disponibilizacao", { ascending: false });

  if (error) {
    $("painel-treinamentos-lista").innerHTML = `<p class="text-xs text-rose-500">Não foi possível carregar os treinamentos.</p>`;
    return;
  }
  tcTreinamentosDisponiveis = data || [];
  if (tcTreinamentosDisponiveis.length === 0) {
    $("painel-treinamentos-lista").innerHTML = `<p class="text-xs text-slate-400">Nenhum treinamento disponível no momento.</p>`;
    return;
  }
  $("painel-treinamentos-lista").innerHTML = tcTreinamentosDisponiveis.map((t) => `
    <div class="border border-slate-200 rounded-lg p-3">
      <p class="text-sm text-slate-800">${t.descricao || "—"}</p>
      <p class="text-[11px] text-slate-400 mt-0.5">Disponível desde ${formatarDataBr(t.data_disponibilizacao)}</p>
      <button data-tc-abrir-arquivo="${t.id}" class="mt-2 inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900 underline">${iconeArquivoTreinamento(t.arquivo_tipo || t.arquivo_nome)} Abrir ${t.arquivo_nome || "arquivo"}</button>
    </div>
  `).join("");
  $("painel-treinamentos-lista").querySelectorAll("[data-tc-abrir-arquivo]").forEach((btn) =>
    btn.addEventListener("click", () => abrirArquivoTreinamento(btn.getAttribute("data-tc-abrir-arquivo")))
  );
}

$("btn-treinamentos-mobile").addEventListener("click", abrirPainelTreinamentos);
$("btn-fechar-painel-treinamentos").addEventListener("click", () => $("painel-treinamentos").classList.add("hidden"));
$("painel-treinamentos-overlay").addEventListener("click", () => $("painel-treinamentos").classList.add("hidden"));

// ===========================================================
// SOLICITAÇÃO DE REEMBOLSO
// Autosserviço para usuários do sistema E instrutores (cada um só
// vê e edita os próprios reembolsos). Toda gravação passa pela RPC
// salvar_reembolso, que já cuida da regra de "só edita enquanto
// Não solicitado" e grava as datas de registro/solicitação.
// ===========================================================
let rbLista = [];
let rbTiposDespesa = [];
let rbEditandoId = null;
let rbPendingFile = null;

const RB_STATUS_COR = {
  "Não solicitado": "bg-slate-100 text-slate-600",
  "Aguardando aprovação": "bg-amber-50 text-amber-700",
  "Aguardando aprovação financeira": "bg-amber-50 text-amber-700",
  "Aprovado": "bg-teal-50 text-teal-700",
  "Aprovado parcial": "bg-teal-50 text-teal-700",
  "Pago": "bg-emerald-50 text-emerald-700",
  "Recusado": "bg-rose-50 text-rose-600",
  "Recusado parcial": "bg-orange-50 text-orange-700",
  "Cancelado": "bg-slate-100 text-slate-400",
};

// Gestor direto de quem está logado (usuário do sistema ou instrutor).
function gestorDiretoDoUsuarioAtual() {
  return (usuarioSistemaAtual && usuarioSistemaAtual.gestor_direto_id) ||
    (perfilAtual && perfilAtual.gestor_direto_id) || null;
}

// Sem gestor direto cadastrado, o reembolso não teria quem faça a 1ª
// aprovação — mostra aviso e trava apenas o botão de solicitar (o rascunho
// "Gravar" continua permitido).
function atualizarAvisoSemGestorReembolso() {
  const semGestor = !gestorDiretoDoUsuarioAtual();
  const aviso = $("rb-sem-gestor-aviso");
  if (aviso) aviso.classList.toggle("hidden", !semGestor);
  const btnSolicitar = $("btn-rb-gravar-solicitar");
  if (btnSolicitar) {
    btnSolicitar.disabled = semGestor;
    btnSolicitar.classList.toggle("opacity-50", semGestor);
    btnSolicitar.classList.toggle("cursor-not-allowed", semGestor);
  }
}

async function abrirPainelReembolsos() {
  $("rb-view-form").classList.add("hidden");
  $("rb-view-lista").classList.remove("hidden");
  $("painel-reembolsos").classList.remove("hidden");
  $("rb-lista").innerHTML = `<p class="text-xs text-slate-400">Carregando…</p>`;
  atualizarAvisoSemGestorReembolso();
  await carregarTiposDespesaParaReembolso();
  await carregarMeusReembolsos();
}

async function carregarTiposDespesaParaReembolso() {
  const { data } = await supabase.from("tipos_despesas").select("id, nome, status").eq("status", "Ativo").order("nome");
  rbTiposDespesa = data || [];
  $("rb-tipo-despesa").innerHTML = `<option value="">— Selecione —</option>` +
    rbTiposDespesa.map((t) => `<option value="${t.id}">${t.nome}</option>`).join("");
}

async function carregarMeusReembolsos() {
  let query = supabase.from("reembolsos").select("*, tipos_despesas(nome)").order("data_registro", { ascending: false });
  if (usuarioSistemaAtual) query = query.eq("usuario_sistema_id", usuarioSistemaAtual.id);
  else if (perfilAtual) query = query.eq("instrutor_id", perfilAtual.id);
  const { data, error } = await query;
  if (error) {
    $("rb-lista").innerHTML = `<p class="text-xs text-rose-500">Não foi possível carregar seus reembolsos.</p>`;
    return;
  }
  rbLista = data || [];
  renderizarListaReembolsos();
}

// Valor original sempre é mantido; o valor aprovado (gestor e/ou
// financeiro) aparece destacado quando existir, sem apagar o solicitado.
function detalhesValorReembolsoHtml(r) {
  const linhas = [];
  if (r.valor_aprovado_financeiro != null) {
    linhas.push(`<p class="text-xs mt-1"><span class="text-slate-400">Valor solicitado: ${fmtBRL(r.valor)}</span></p>`);
    linhas.push(`<p class="text-xs font-semibold text-teal-700">Valor aprovado: ${fmtBRL(r.valor_aprovado_financeiro)}</p>`);
  } else if (r.valor_aprovado_gestor != null && r.status === "Aguardando aprovação financeira") {
    linhas.push(`<p class="text-xs mt-1"><span class="text-slate-400">Valor solicitado: ${fmtBRL(r.valor)}</span></p>`);
    linhas.push(`<p class="text-xs font-semibold text-amber-700">Valor liberado pelo gestor: ${fmtBRL(r.valor_aprovado_gestor)} <span class="font-normal text-slate-400">(aguardando aprovação financeira)</span></p>`);
  }
  if (r.status === "Recusado") {
    const porFinanceiro = !!r.data_aprovacao_financeira;
    const motivo = porFinanceiro ? r.justificativa_financeiro : r.justificativa_gestor;
    linhas.push(`<p class="text-xs text-rose-600 mt-1">Recusado pelo ${porFinanceiro ? "financeiro" : "gestor direto"}${motivo ? `: "${motivo}"` : "."}</p>`);
  } else if (r.status === "Aprovado parcial" && r.justificativa_financeiro) {
    linhas.push(`<p class="text-xs text-slate-500 mt-1">Motivo da aprovação parcial: "${r.justificativa_financeiro}"</p>`);
  }
  return linhas.join("");
}

function renderizarListaReembolsos() {
  const cont = $("rb-lista");
  if (!rbLista.length) {
    cont.innerHTML = `<p class="text-sm text-slate-400 text-center py-10">Nenhum reembolso solicitado ainda.</p>`;
    return;
  }
  cont.innerHTML = rbLista.map((r) => {
    const corStatus = RB_STATUS_COR[r.status] || "bg-slate-100 text-slate-600";
    const podeEditar = r.status === "Não solicitado";
    return `
    <div class="border border-slate-200 rounded-lg p-3">
      <div class="flex items-start justify-between gap-2">
        <div>
          <p class="text-sm font-medium text-slate-800">${(r.tipos_despesas && r.tipos_despesas.nome) || "—"}</p>
          <p class="text-xs text-slate-500 mt-0.5">${formatarDataBr(r.data_despesa)} · ${fmtBRL(r.valor)}</p>
        </div>
        <span class="text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${corStatus}">${r.status}</span>
      </div>
      ${detalhesValorReembolsoHtml(r)}
      ${r.descricao ? `<p class="text-xs text-slate-500 mt-2">${r.descricao}</p>` : ""}
      ${r.treinamento ? `<p class="text-xs text-slate-400 mt-1">Treinamento: ${r.treinamento}</p>` : ""}
      <div class="flex items-center gap-3 mt-2 pt-2 border-t border-slate-100">
        ${r.anexo_path ? `<button data-rb-ver-anexo="${r.id}" class="text-xs font-medium text-teal-700 hover:text-teal-900">📎 Ver comprovante</button>` : `<span class="text-xs text-slate-300">Sem comprovante</span>`}
        ${podeEditar ? `<button data-rb-editar="${r.id}" class="text-xs font-medium text-slate-500 hover:text-slate-800 ml-auto">✏️ Editar</button>` : ""}
      </div>
    </div>`;
  }).join("");

  cont.querySelectorAll("[data-rb-editar]").forEach((btn) =>
    btn.addEventListener("click", () => abrirEdicaoReembolso(btn.getAttribute("data-rb-editar")))
  );
  cont.querySelectorAll("[data-rb-ver-anexo]").forEach((btn) =>
    btn.addEventListener("click", () => abrirAnexoReembolso(btn.getAttribute("data-rb-ver-anexo")))
  );
}

function limparFormularioReembolso() {
  rbEditandoId = null;
  rbPendingFile = null;
  esconderErro("rb-form-erro");
  $("rb-data").value = "";
  $("rb-tipo-despesa").value = "";
  $("rb-descricao").value = "";
  $("rb-treinamento").value = "";
  $("rb-valor").value = "";
  $("rb-anexo-input").value = "";
  $("rb-anexo-atual").classList.add("hidden");
  $("rb-anexo-atual").textContent = "";
  $("rb-anexo-selecionado").classList.add("hidden");
  $("rb-anexo-selecionado").textContent = "";
}

function abrirNovoReembolso() {
  limparFormularioReembolso();
  $("rb-form-titulo").textContent = "Novo reembolso";
  $("rb-view-lista").classList.add("hidden");
  $("rb-view-form").classList.remove("hidden");
  atualizarAvisoSemGestorReembolso();
}

function abrirEdicaoReembolso(id) {
  const r = rbLista.find((x) => x.id === id);
  if (!r || r.status !== "Não solicitado") return;
  limparFormularioReembolso();
  rbEditandoId = id;
  $("rb-data").value = r.data_despesa || "";
  $("rb-tipo-despesa").value = r.tipo_despesa_id || "";
  $("rb-descricao").value = r.descricao || "";
  $("rb-treinamento").value = r.treinamento || "";
  $("rb-valor").value = r.valor != null ? r.valor : "";
  if (r.anexo_nome) {
    $("rb-anexo-atual").textContent = `Comprovante atual: ${r.anexo_nome} (selecione um novo arquivo apenas se quiser substituí-lo)`;
    $("rb-anexo-atual").classList.remove("hidden");
  }
  $("rb-form-titulo").textContent = "Editar reembolso";
  $("rb-view-lista").classList.add("hidden");
  $("rb-view-form").classList.remove("hidden");
  atualizarAvisoSemGestorReembolso();
}

function fecharFormReembolso() {
  $("rb-view-form").classList.add("hidden");
  $("rb-view-lista").classList.remove("hidden");
}

async function salvarReembolso(solicitar) {
  esconderErro("rb-form-erro");
  const dataDespesa = $("rb-data").value;
  const tipoDespesaId = $("rb-tipo-despesa").value;
  const descricao = $("rb-descricao").value.trim();
  const treinamento = $("rb-treinamento").value.trim();
  const valor = parseFloat($("rb-valor").value);

  if (!dataDespesa) return mostrarErro("rb-form-erro", "Informe a data da despesa.");
  if (!tipoDespesaId) return mostrarErro("rb-form-erro", "Selecione o tipo de despesa.");
  if (!valor || valor <= 0) return mostrarErro("rb-form-erro", "Informe o valor do reembolso.");

  const btnGravar = $("btn-rb-gravar");
  const btnSolicitar = $("btn-rb-gravar-solicitar");
  const textoGravar = btnGravar.textContent;
  const textoSolicitar = btnSolicitar.textContent;
  btnGravar.disabled = true;
  btnSolicitar.disabled = true;
  btnGravar.textContent = "Salvando…";
  btnSolicitar.textContent = "Salvando…";

  let anexoPath = null, anexoNome = null, anexoTipo = null;
  if (rbPendingFile) {
    const ext = (rbPendingFile.name.split(".").pop() || "bin").toLowerCase();
    const caminho = `${sessaoAtual.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: erroUp } = await supabase.storage.from("reembolsos-comprovantes").upload(caminho, rbPendingFile);
    if (erroUp) {
      btnGravar.disabled = false;
      btnSolicitar.disabled = false;
      btnGravar.textContent = textoGravar;
      btnSolicitar.textContent = textoSolicitar;
      return mostrarErro("rb-form-erro", "Não foi possível enviar o comprovante. Tente novamente.");
    }
    anexoPath = caminho;
    anexoNome = rbPendingFile.name;
    anexoTipo = rbPendingFile.type || null;
  }

  const { error } = await supabase.rpc("salvar_reembolso", {
    p_id: rbEditandoId,
    p_data_despesa: dataDespesa,
    p_tipo_despesa_id: tipoDespesaId,
    p_descricao: descricao || null,
    p_treinamento: treinamento || null,
    p_valor: valor,
    p_anexo_path: anexoPath,
    p_anexo_nome: anexoNome,
    p_anexo_tipo: anexoTipo,
    p_solicitar: solicitar,
  });

  btnGravar.disabled = false;
  btnSolicitar.disabled = false;
  btnGravar.textContent = textoGravar;
  btnSolicitar.textContent = textoSolicitar;

  if (error) return mostrarErro("rb-form-erro", error.message || "Não foi possível salvar o reembolso. Tente novamente.");

  fecharFormReembolso();
  await carregarMeusReembolsos();
}

async function urlAnexoReembolso(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("reembolsos-comprovantes").createSignedUrl(path, 60 * 60);
  return error ? null : data.signedUrl;
}

async function abrirAnexoReembolso(id) {
  const r = rbLista.find((x) => x.id === id);
  const u = await urlAnexoReembolso(r && r.anexo_path);
  if (u) window.open(u, "_blank");
}

$("rb-anexo-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  rbPendingFile = file;
  $("rb-anexo-selecionado").textContent = `Selecionado: ${file.name}`;
  $("rb-anexo-selecionado").classList.remove("hidden");
});

$("btn-rb-novo").addEventListener("click", abrirNovoReembolso);
$("btn-rb-fechar-form").addEventListener("click", fecharFormReembolso);
$("btn-rb-cancelar-form").addEventListener("click", fecharFormReembolso);
$("btn-rb-gravar").addEventListener("click", () => salvarReembolso(false));
$("btn-rb-gravar-solicitar").addEventListener("click", () => salvarReembolso(true));

$("btn-reembolso-mobile").addEventListener("click", abrirPainelReembolsos);
$("btn-reembolso-instrutor").addEventListener("click", abrirPainelReembolsos);
$("btn-fechar-painel-reembolsos").addEventListener("click", () => $("painel-reembolsos").classList.add("hidden"));
$("painel-reembolsos-overlay").addEventListener("click", () => $("painel-reembolsos").classList.add("hidden"));

// ===========================================================
// APROVAÇÕES DE REEMBOLSO (duas fases)
// Fase 1 — gestor direto do solicitante: aprova total, aprova parcial
// (informando o valor liberado) ou recusa, sempre com justificativa.
// Fase 2 — gestor financeiro: mesma dinâmica, a partir do valor que o
// gestor direto liberou. Depois de aprovado (total ou parcial), o
// financeiro marca o pagamento. Toda decisão passa pelas RPCs
// decidir_reembolso_gestor / decidir_reembolso_financeiro /
// marcar_reembolso_pago, que já validam quem pode agir em cada fase.
// Quando a mesma pessoa acumula os dois papéis, a tela usa abas
// separadas (Gestor direto / Financeiro) em vez de mostrar as duas
// listas empilhadas. Dentro da aba financeira, o financeiro também
// pode puxar reembolsos que ainda nem passaram pelo gestor direto
// (dentro de um período) e decidir direto — nesse caso a RPC
// decidir_reembolso_financeiro_direto registra as duas aprovações
// (gestor direto + financeira) em nome do próprio financeiro.
// ===========================================================
let aprovAbaAtiva = "gestor"; // 'gestor' | 'financeiro' — só importa quando os dois papéis existem
let aprovListaGestor = [];
let aprovListaFinanceiro = [];
let aprovListaPagamento = [];
let aprovListaSemGestor = [];
let aprovSemGestorVisivel = false;
let aprovDetalheAtual = null; // { fase: 'gestor' | 'financeiro' | 'financeiro_direto', row }
let aprovAcaoSelecionada = null; // 'aprovado' | 'parcial' | 'recusado'

function iconeSolicitanteReembolso(tipo) {
  return tipo === "instrutor" ? "🧑‍🏫" : "🧑‍💼";
}

function aprovTemPapelGestor() {
  // A aprovação do gestor direto é escopada por subordinado (quem o
  // usuário de fato gerencia) — ser admin não deve, por si só, mostrar essa
  // aba/lista, já que a RPC só devolve os reembolsos de quem é realmente
  // gestor direto de alguém.
  return !!aprovSituacao.eh_gestor;
}
function aprovTemPapelFinanceiro() {
  return !!aprovSituacao.eh_financeiro;
}

async function carregarAprovacoesReembolsoInit() {
  $("aprov-view-detalhe").classList.add("hidden");
  $("aprov-view-lista").classList.remove("hidden");
  await carregarSituacaoEPendenciasAprovacao();
}

async function carregarSituacaoEPendenciasAprovacao() {
  const { data, error } = await supabase.rpc("reembolso_minha_situacao_aprovacao");
  aprovSituacao = error ? { eh_gestor: false, eh_financeiro: false, eh_admin: false } : (data || {});
  const ambos = aprovTemPapelGestor() && aprovTemPapelFinanceiro();
  $("aprov-tabs").classList.toggle("hidden", !ambos);
  if (!ambos) aprovAbaAtiva = aprovTemPapelGestor() ? "gestor" : "financeiro";
  atualizarAbaAtivaAprovacao();
  await carregarPendenciasAprovacao();
}

function atualizarAbaAtivaAprovacao() {
  const temGestor = aprovTemPapelGestor();
  const temFinanceiro = aprovTemPapelFinanceiro();
  const ambos = temGestor && temFinanceiro;
  $("aprov-secao-gestor").classList.toggle("hidden", !temGestor || (ambos && aprovAbaAtiva !== "gestor"));
  $("aprov-secao-financeiro").classList.toggle("hidden", !temFinanceiro || (ambos && aprovAbaAtiva !== "financeiro"));
  if (!ambos) return;
  const ativo = "bg-slate-900 text-white";
  const inativo = "bg-white text-slate-600 border border-slate-300";
  $("aprov-tab-gestor").className = `flex-1 text-xs font-medium py-2 rounded-md ${aprovAbaAtiva === "gestor" ? ativo : inativo}`;
  $("aprov-tab-financeiro").className = `flex-1 text-xs font-medium py-2 rounded-md ${aprovAbaAtiva === "financeiro" ? ativo : inativo}`;
}

$("aprov-tab-gestor").addEventListener("click", () => { aprovAbaAtiva = "gestor"; atualizarAbaAtivaAprovacao(); });
$("aprov-tab-financeiro").addEventListener("click", () => { aprovAbaAtiva = "financeiro"; atualizarAbaAtivaAprovacao(); });

async function carregarPendenciasAprovacao() {
  if (aprovTemPapelGestor()) {
    $("aprov-lista-gestor").innerHTML = `<p class="text-xs text-slate-400">Carregando…</p>`;
    const { data, error } = await supabase.rpc("listar_reembolsos_pendentes_gestor");
    aprovListaGestor = error ? [] : (data || []);
    renderizarListaAprovGestor();
  }
  if (aprovTemPapelFinanceiro()) {
    $("aprov-lista-financeiro").innerHTML = `<p class="text-xs text-slate-400">Carregando…</p>`;
    $("aprov-lista-pagamento").innerHTML = `<p class="text-xs text-slate-400">Carregando…</p>`;
    const [{ data: pend, error: e1 }, { data: pag, error: e2 }] = await Promise.all([
      supabase.rpc("listar_reembolsos_pendentes_financeiro"),
      supabase.rpc("listar_reembolsos_aguardando_pagamento"),
    ]);
    aprovListaFinanceiro = e1 ? [] : (pend || []);
    aprovListaPagamento = e2 ? [] : (pag || []);
    renderizarListaAprovFinanceiro();
    renderizarListaAprovPagamento();
    if (aprovSemGestorVisivel) await buscarReembolsosSemGestorDireto();
  }
}

// Financeiro pode optar por ver (dentro de um período) reembolsos que
// ainda não foram vistos pelo gestor direto, e decidir direto sobre eles.
$("aprov-sem-gestor-toggle").addEventListener("change", (e) => {
  aprovSemGestorVisivel = e.target.checked;
  $("aprov-sem-gestor-bloco").classList.toggle("hidden", !aprovSemGestorVisivel);
  if (aprovSemGestorVisivel) {
    if (!$("aprov-sem-gestor-data-inicio").value) {
      const hoje = new Date();
      const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 30);
      $("aprov-sem-gestor-data-inicio").value = inicio.toISOString().slice(0, 10);
      $("aprov-sem-gestor-data-fim").value = hoje.toISOString().slice(0, 10);
    }
    buscarReembolsosSemGestorDireto();
  }
});
$("btn-aprov-sem-gestor-buscar").addEventListener("click", buscarReembolsosSemGestorDireto);

async function buscarReembolsosSemGestorDireto() {
  $("aprov-lista-sem-gestor").innerHTML = `<p class="text-xs text-slate-400">Carregando…</p>`;
  const dataInicio = $("aprov-sem-gestor-data-inicio").value || null;
  const dataFim = $("aprov-sem-gestor-data-fim").value || null;
  const { data, error } = await supabase.rpc("listar_reembolsos_sem_gestor_direto", {
    p_data_inicio: dataInicio,
    p_data_fim: dataFim,
  });
  aprovListaSemGestor = error ? [] : (data || []);
  renderizarListaAprovSemGestor();
}

function renderizarListaAprovSemGestor() {
  const cont = $("aprov-lista-sem-gestor");
  if (!aprovListaSemGestor.length) {
    cont.innerHTML = `<p class="text-xs text-slate-400 py-4 text-center">Nenhum reembolso pendente do gestor direto nesse período.</p>`;
    return;
  }
  cont.innerHTML = aprovListaSemGestor.map((r) => `
    <button data-aprov-item="${r.id}" class="w-full text-left border border-amber-200 bg-amber-50 rounded-lg p-3 hover:border-amber-400">
      <div class="flex items-start justify-between gap-2">
        <div>
          <p class="text-sm font-medium text-slate-800">${iconeSolicitanteReembolso(r.solicitante_tipo)} ${r.solicitante_nome}</p>
          <p class="text-xs text-slate-500 mt-0.5">${r.tipo_despesa_nome || "—"} · ${formatarDataBr(r.data_despesa)}</p>
          <p class="text-xs text-amber-700 mt-0.5">Solicitado em ${fmtDataHoraBR(r.data_solicitacao)} · ainda sem aprovação do gestor direto</p>
        </div>
        <span class="text-sm font-semibold text-slate-800 whitespace-nowrap">${fmtBRL(r.valor)}</span>
      </div>
      ${r.descricao ? `<p class="text-xs text-slate-500 mt-2">${r.descricao}</p>` : ""}
    </button>`).join("");
  cont.querySelectorAll("[data-aprov-item]").forEach((btn) =>
    btn.addEventListener("click", () => abrirDetalheAprovacao("financeiro_direto", btn.getAttribute("data-aprov-item")))
  );
}

function renderizarListaAprovGestor() {
  const cont = $("aprov-lista-gestor");
  if (!aprovListaGestor.length) {
    cont.innerHTML = `<p class="text-xs text-slate-400 py-4 text-center">Nenhum reembolso aguardando sua aprovação.</p>`;
    return;
  }
  cont.innerHTML = aprovListaGestor.map((r) => `
    <button data-aprov-item="${r.id}" class="w-full text-left border border-slate-200 rounded-lg p-3 hover:border-amber-400">
      <div class="flex items-start justify-between gap-2">
        <div>
          <p class="text-sm font-medium text-slate-800">${iconeSolicitanteReembolso(r.solicitante_tipo)} ${r.solicitante_nome}</p>
          <p class="text-xs text-slate-500 mt-0.5">${r.tipo_despesa_nome || "—"} · ${formatarDataBr(r.data_despesa)}</p>
        </div>
        <span class="text-sm font-semibold text-slate-800 whitespace-nowrap">${fmtBRL(r.valor)}</span>
      </div>
      ${r.descricao ? `<p class="text-xs text-slate-500 mt-2">${r.descricao}</p>` : ""}
    </button>`).join("");
  cont.querySelectorAll("[data-aprov-item]").forEach((btn) =>
    btn.addEventListener("click", () => abrirDetalheAprovacao("gestor", btn.getAttribute("data-aprov-item")))
  );
}

function renderizarListaAprovFinanceiro() {
  const cont = $("aprov-lista-financeiro");
  if (!aprovListaFinanceiro.length) {
    cont.innerHTML = `<p class="text-xs text-slate-400 py-4 text-center">Nenhum reembolso aguardando aprovação financeira.</p>`;
    return;
  }
  cont.innerHTML = aprovListaFinanceiro.map((r) => `
    <button data-aprov-item="${r.id}" class="w-full text-left border border-slate-200 rounded-lg p-3 hover:border-amber-400">
      <div class="flex items-start justify-between gap-2">
        <div>
          <p class="text-sm font-medium text-slate-800">${iconeSolicitanteReembolso(r.solicitante_tipo)} ${r.solicitante_nome}</p>
          <p class="text-xs text-slate-500 mt-0.5">${r.tipo_despesa_nome || "—"} · ${formatarDataBr(r.data_despesa)}</p>
          <p class="text-xs text-slate-400 mt-0.5">Liberado pelo gestor${r.gestor_nome ? ` (${r.gestor_nome})` : ""}</p>
        </div>
        <div class="text-right whitespace-nowrap">
          ${r.valor_aprovado_gestor != null && Number(r.valor_aprovado_gestor) !== Number(r.valor) ? `<p class="text-[11px] text-slate-400 line-through">${fmtBRL(r.valor)}</p>` : ""}
          <span class="text-sm font-semibold text-teal-700">${fmtBRL(r.valor_aprovado_gestor != null ? r.valor_aprovado_gestor : r.valor)}</span>
        </div>
      </div>
      ${r.justificativa_gestor ? `<p class="text-xs text-slate-500 mt-2 italic">"${r.justificativa_gestor}"</p>` : ""}
    </button>`).join("");
  cont.querySelectorAll("[data-aprov-item]").forEach((btn) =>
    btn.addEventListener("click", () => abrirDetalheAprovacao("financeiro", btn.getAttribute("data-aprov-item")))
  );
}

function renderizarListaAprovPagamento() {
  const cont = $("aprov-lista-pagamento");
  if (!aprovListaPagamento.length) {
    cont.innerHTML = `<p class="text-xs text-slate-400 py-4 text-center">Nenhum reembolso aprovado aguardando pagamento.</p>`;
    return;
  }
  cont.innerHTML = aprovListaPagamento.map((r) => `
    <div class="border border-slate-200 rounded-lg p-3">
      <div class="flex items-start justify-between gap-2">
        <div>
          <p class="text-sm font-medium text-slate-800">${iconeSolicitanteReembolso(r.solicitante_tipo)} ${r.solicitante_nome}</p>
          <p class="text-xs text-slate-500 mt-0.5">${r.tipo_despesa_nome || "—"} · ${formatarDataBr(r.data_despesa)}</p>
          <span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${RB_STATUS_COR[r.status] || "bg-slate-100 text-slate-600"}">${r.status}</span>
        </div>
        <span class="text-sm font-semibold text-teal-700 whitespace-nowrap">${fmtBRL(r.valor_aprovado_financeiro)}</span>
      </div>
      <div class="mt-2 pt-2 border-t border-slate-100 text-right">
        <button data-aprov-pagar="${r.id}" class="text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md px-3 py-1.5">💰 Marcar como pago</button>
      </div>
    </div>`).join("");
  cont.querySelectorAll("[data-aprov-pagar]").forEach((btn) =>
    btn.addEventListener("click", () => marcarReembolsoComoPago(btn.getAttribute("data-aprov-pagar")))
  );
}

async function marcarReembolsoComoPago(id) {
  const btn = document.querySelector(`[data-aprov-pagar="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "Confirmando…"; }
  const { error } = await supabase.rpc("marcar_reembolso_pago", { p_id: id });
  if (error) alert(error.message || "Não foi possível marcar como pago. Tente novamente.");
  await carregarPendenciasAprovacao();
}

function abrirDetalheAprovacao(fase, id) {
  const lista = fase === "gestor" ? aprovListaGestor : fase === "financeiro" ? aprovListaFinanceiro : aprovListaSemGestor;
  const row = lista.find((r) => r.id === id);
  if (!row) return;
  aprovDetalheAtual = { fase, row };
  aprovAcaoSelecionada = null;
  renderizarDetalheAprovacao();
  $("aprov-view-lista").classList.add("hidden");
  $("aprov-view-detalhe").classList.remove("hidden");
}

function renderizarDetalheAprovacao() {
  if (!aprovDetalheAtual) return;
  const { fase, row } = aprovDetalheAtual;
  $("aprov-detalhe-erro").classList.add("hidden");
  $("aprov-detalhe-titulo").textContent = fase === "gestor"
    ? "Aprovação do gestor direto"
    : fase === "financeiro_direto"
      ? "Aprovação financeira (direto, sem gestor)"
      : "Aprovação financeira";
  const baseValor = fase === "financeiro" ? (row.valor_aprovado_gestor != null ? row.valor_aprovado_gestor : row.valor) : row.valor;

  $("aprov-detalhe-corpo").innerHTML = `
    <p class="text-sm font-medium text-slate-800">${iconeSolicitanteReembolso(row.solicitante_tipo)} ${row.solicitante_nome}</p>
    <p class="text-xs text-slate-500 mt-1">${row.tipo_despesa_nome || "—"} · ${formatarDataBr(row.data_despesa)}</p>
    ${row.descricao ? `<p class="text-xs text-slate-600 mt-2">${row.descricao}</p>` : ""}
    ${row.treinamento ? `<p class="text-xs text-slate-400 mt-1">Treinamento: ${row.treinamento}</p>` : ""}
    <p class="text-sm font-semibold text-slate-800 mt-2">Valor solicitado: ${fmtBRL(row.valor)}</p>
    ${fase === "financeiro" && row.valor_aprovado_gestor != null ? `<p class="text-sm font-semibold text-amber-700">Valor liberado pelo gestor: ${fmtBRL(row.valor_aprovado_gestor)}</p>` : ""}
    ${fase === "financeiro" && row.justificativa_gestor ? `<p class="text-xs text-slate-500 mt-1 italic">Nota do gestor: "${row.justificativa_gestor}"</p>` : ""}
    ${fase === "financeiro_direto" ? `<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2 mt-2">⚠️ Este reembolso ainda não passou pela aprovação do gestor direto. Ao decidir aqui, sua decisão registra as duas aprovações (gestor direto e financeira) em seu nome.</p>` : ""}
    ${row.anexo_path ? `<button type="button" id="aprov-ver-anexo" class="text-xs font-medium text-teal-700 hover:text-teal-900 mt-2">📎 Ver comprovante</button>` : `<p class="text-xs text-slate-300 mt-2">Sem comprovante</p>`}
  `;
  const btnAnexo = $("aprov-ver-anexo");
  if (btnAnexo) btnAnexo.addEventListener("click", async () => {
    const u = await urlAnexoReembolso(row.anexo_path);
    if (u) window.open(u, "_blank");
  });

  $("aprov-acoes").innerHTML = `
    <button type="button" data-aprov-acao="aprovado" class="flex-1 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium py-2 rounded-md">✅ Aprovar total</button>
    <button type="button" data-aprov-acao="parcial" class="flex-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium py-2 rounded-md">➗ Aprovar parcial</button>
    <button type="button" data-aprov-acao="recusado" class="flex-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium py-2 rounded-md">❌ Recusar</button>
  `;
  $("aprov-acoes").querySelectorAll("[data-aprov-acao]").forEach((btn) =>
    btn.addEventListener("click", () => selecionarAcaoAprovacao(btn.getAttribute("data-aprov-acao"), baseValor))
  );

  $("aprov-valor-parcial-bloco").classList.add("hidden");
  $("aprov-justificativa-bloco").classList.add("hidden");
  $("aprov-confirmar-bloco").classList.add("hidden");
  $("aprov-valor-parcial").value = "";
  $("aprov-justificativa").value = "";
  $("aprov-valor-parcial-label").textContent = `Valor aprovado (menor que ${fmtBRL(baseValor)})`;
}

function selecionarAcaoAprovacao(tipo, baseValor) {
  aprovAcaoSelecionada = tipo;
  $("aprov-valor-parcial-bloco").classList.toggle("hidden", tipo !== "parcial");
  $("aprov-justificativa-bloco").classList.remove("hidden");
  $("aprov-justificativa-obrigatoria").classList.toggle("hidden", tipo === "aprovado");
  $("aprov-confirmar-bloco").classList.remove("hidden");
  $("aprov-confirmar-titulo").textContent = tipo === "aprovado"
    ? "Confirmar aprovação total"
    : tipo === "parcial"
      ? `Confirmar aprovação parcial (menor que ${fmtBRL(baseValor)})`
      : "Confirmar recusa";
}

async function confirmarAcaoAprovacao() {
  if (!aprovDetalheAtual || !aprovAcaoSelecionada) return;
  $("aprov-detalhe-erro").classList.add("hidden");
  const { fase, row } = aprovDetalheAtual;
  const justificativa = $("aprov-justificativa").value.trim();
  let valorParcial = null;
  if (aprovAcaoSelecionada === "parcial") {
    valorParcial = parseFloat($("aprov-valor-parcial").value);
    if (!valorParcial || valorParcial <= 0) {
      $("aprov-detalhe-erro").textContent = "Informe o valor aprovado.";
      $("aprov-detalhe-erro").classList.remove("hidden");
      return;
    }
  }
  if (aprovAcaoSelecionada !== "aprovado" && !justificativa) {
    $("aprov-detalhe-erro").textContent = "Informe a justificativa.";
    $("aprov-detalhe-erro").classList.remove("hidden");
    return;
  }
  const btn = $("btn-aprov-confirmar");
  btn.disabled = true;
  btn.textContent = "Enviando…";
  const rpc = fase === "gestor"
    ? "decidir_reembolso_gestor"
    : fase === "financeiro_direto"
      ? "decidir_reembolso_financeiro_direto"
      : "decidir_reembolso_financeiro";
  const { error } = await supabase.rpc(rpc, {
    p_id: row.id,
    p_decisao: aprovAcaoSelecionada,
    p_valor_aprovado: valorParcial,
    p_justificativa: justificativa || null,
  });
  btn.disabled = false;
  btn.textContent = "Confirmar";
  if (error) {
    $("aprov-detalhe-erro").textContent = error.message || "Não foi possível registrar a decisão. Tente novamente.";
    $("aprov-detalhe-erro").classList.remove("hidden");
    return;
  }
  fecharDetalheAprovacao();
  await carregarPendenciasAprovacao();
}

function fecharDetalheAprovacao() {
  aprovDetalheAtual = null;
  aprovAcaoSelecionada = null;
  $("aprov-view-detalhe").classList.add("hidden");
  $("aprov-view-lista").classList.remove("hidden");
}

$("btn-aprov-confirmar").addEventListener("click", confirmarAcaoAprovacao);
$("btn-aprov-fechar-detalhe").addEventListener("click", fecharDetalheAprovacao);

// ===========================================================
// CONSULTA DE REEMBOLSOS (relatório — Financeiro)
// Lista todos os reembolsos dentro de um período, com filtros opcionais
// por solicitante, gestor direto e status. É uma consulta global (não
// escopada por subordinado) — só quem participa do fluxo financeiro
// (gestor financeiro ou admin) tem acesso, igual às Aprovações de
// Reembolso.
// ===========================================================
let crLista = [];
let crSolicitantesRef = [];
let crGestoresRef = [];
let crRefsCarregadas = false;

async function carregarConsultaReembolsosInit() {
  $("cr-view-detalhe").classList.add("hidden");
  $("cr-view-lista").classList.remove("hidden");
  if (!crRefsCarregadas) {
    const [{ data: solicitantes }, { data: gestores }] = await Promise.all([
      supabase.rpc("listar_solicitantes_reembolso"),
      supabase.rpc("listar_usuarios_sistema_para_gestor"),
    ]);
    crSolicitantesRef = solicitantes || [];
    crGestoresRef = gestores || [];
    preencherFiltrosConsultaReembolsos();
    crRefsCarregadas = true;
  }
  if (!$("cr-data-inicio").value) {
    const hoje = new Date();
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    $("cr-data-inicio").value = inicioMes.toISOString().slice(0, 10);
    $("cr-data-fim").value = hoje.toISOString().slice(0, 10);
  }
  await buscarConsultaReembolsos();
}

function preencherFiltrosConsultaReembolsos() {
  $("cr-solicitante").innerHTML = `<option value="">— Todos —</option>` +
    crSolicitantesRef.map((s) =>
      `<option value="${s.solicitante_tipo}:${s.solicitante_id}">${s.solicitante_nome}${s.solicitante_tipo === "instrutor" ? " (instrutor)" : ""}</option>`
    ).join("");
  $("cr-gestor-direto").innerHTML = `<option value="">— Todos —</option>` +
    crGestoresRef.map((g) => `<option value="${g.id}">${g.nome}</option>`).join("");
}

async function buscarConsultaReembolsos() {
  $("cr-lista").innerHTML = `<tr><td colspan="8" class="px-3 py-6 text-center text-xs text-slate-400">Carregando…</td></tr>`;
  $("cr-resumo").textContent = "";
  const dataInicio = $("cr-data-inicio").value || null;
  const dataFim = $("cr-data-fim").value || null;
  const solicitanteVal = $("cr-solicitante").value;
  const [solicitanteTipo, solicitanteId] = solicitanteVal ? solicitanteVal.split(":") : [null, null];
  const gestorDiretoId = $("cr-gestor-direto").value || null;
  const status = $("cr-status").value || null;

  const { data, error } = await supabase.rpc("consultar_reembolsos", {
    p_data_inicio: dataInicio,
    p_data_fim: dataFim,
    p_solicitante_tipo: solicitanteTipo,
    p_solicitante_id: solicitanteId,
    p_gestor_direto_id: gestorDiretoId,
    p_status: status,
  });
  if (error) {
    crLista = [];
    $("cr-lista").innerHTML = `<tr><td colspan="8" class="px-3 py-6 text-center text-xs text-rose-500">${error.message || "Não foi possível carregar a consulta."}</td></tr>`;
    return;
  }
  crLista = data || [];
  renderizarListaConsultaReembolsos();
}

function renderizarListaConsultaReembolsos() {
  const cont = $("cr-lista");
  if (!crLista.length) {
    cont.innerHTML = `<tr><td colspan="9" class="px-3 py-6 text-center text-xs text-slate-400">Nenhum reembolso encontrado para os filtros selecionados.</td></tr>`;
    $("cr-resumo").textContent = "0 reembolso(s)";
    return;
  }
  cont.innerHTML = crLista.map((r) => {
    const corStatus = RB_STATUS_COR[r.status] || "bg-slate-100 text-slate-600";
    const valorAprovado = r.valor_aprovado_financeiro != null ? r.valor_aprovado_financeiro
      : r.valor_aprovado_gestor != null ? r.valor_aprovado_gestor : null;
    return `
    <tr class="border-b border-slate-100 last:border-0 align-top">
      <td class="px-3 py-2">
        <p class="text-slate-800">${iconeSolicitanteReembolso(r.solicitante_tipo)} ${r.solicitante_nome}</p>
        <p class="text-[11px] text-slate-400">${r.gestor_direto_nome || "— sem gestor direto —"}</p>
      </td>
      <td class="px-3 py-2 whitespace-nowrap">${formatarDataBr(r.data_despesa)}</td>
      <td class="px-3 py-2">${r.tipo_despesa_nome || "—"}</td>
      <td class="px-3 py-2 text-right whitespace-nowrap">${fmtBRL(r.valor)}</td>
      <td class="px-3 py-2 text-right whitespace-nowrap">${valorAprovado != null ? fmtBRL(valorAprovado) : "—"}</td>
      <td class="px-3 py-2 whitespace-nowrap"><span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${corStatus}">${r.status}</span></td>
      <td class="px-3 py-2 whitespace-nowrap">${r.data_pagamento ? fmtDataHoraBR(r.data_pagamento) : "—"}</td>
      <td class="px-3 py-2 text-right">${r.anexo_path ? `<button type="button" data-cr-anexo="${r.id}" class="text-xs font-medium text-teal-700 hover:text-teal-900">📎 Ver</button>` : ""}</td>
      <td class="px-3 py-2 text-right"><button type="button" data-cr-detalhe="${r.id}" class="text-xs font-medium text-slate-600 border border-slate-300 rounded-md px-2 py-1 hover:bg-slate-50">Detalhe</button></td>
    </tr>`;
  }).join("");
  cont.querySelectorAll("[data-cr-anexo]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const r = crLista.find((x) => x.id === btn.getAttribute("data-cr-anexo"));
      const u = await urlAnexoReembolso(r && r.anexo_path);
      if (u) window.open(u, "_blank");
    })
  );
  cont.querySelectorAll("[data-cr-detalhe]").forEach((btn) =>
    btn.addEventListener("click", () => abrirDetalheConsultaReembolso(btn.getAttribute("data-cr-detalhe")))
  );
  const total = crLista.reduce((s, r) => s + Number(r.valor || 0), 0);
  $("cr-resumo").textContent = `${crLista.length} reembolso(s) · total solicitado: ${fmtBRL(total)}`;
}

let crDetalheAtual = null;

function abrirDetalheConsultaReembolso(id) {
  const r = crLista.find((x) => x.id === id);
  if (!r) return;
  crDetalheAtual = r;
  renderizarDetalheConsultaReembolso();
  $("cr-view-lista").classList.add("hidden");
  $("cr-view-detalhe").classList.remove("hidden");
}

function renderizarDetalheConsultaReembolso() {
  const r = crDetalheAtual;
  if (!r) return;
  const corStatus = RB_STATUS_COR[r.status] || "bg-slate-100 text-slate-600";
  const linha = (label, valor) => valor ? `
    <div>
      <p class="text-[11px] font-medium text-slate-400 uppercase tracking-wide">${label}</p>
      <p class="text-sm text-slate-800">${valor}</p>
    </div>` : "";

  $("cr-detalhe-corpo").innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <p class="text-sm font-medium text-slate-800">${iconeSolicitanteReembolso(r.solicitante_tipo)} ${r.solicitante_nome}</p>
      <span class="text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${corStatus}">${r.status}</span>
    </div>
    <div class="grid grid-cols-2 gap-3">
      ${linha("Gestor direto", r.gestor_direto_nome || "— sem gestor direto —")}
      ${linha("Tipo de despesa", r.tipo_despesa_nome)}
      ${linha("Data da despesa", formatarDataBr(r.data_despesa))}
      ${linha("Solicitado em", r.data_solicitacao ? fmtDataHoraBR(r.data_solicitacao) : null)}
      ${linha("Valor solicitado", fmtBRL(r.valor))}
      ${linha("Valor aprovado (gestor)", r.valor_aprovado_gestor != null ? fmtBRL(r.valor_aprovado_gestor) : null)}
      ${linha("Valor aprovado (financeiro)", r.valor_aprovado_financeiro != null ? fmtBRL(r.valor_aprovado_financeiro) : null)}
      ${linha("Pago em", r.data_pagamento ? fmtDataHoraBR(r.data_pagamento) : null)}
    </div>
    ${r.treinamento ? `<div><p class="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Treinamento</p><p class="text-sm text-slate-700">${r.treinamento}</p></div>` : ""}
    ${r.descricao ? `<div><p class="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Descrição</p><p class="text-sm text-slate-700">${r.descricao}</p></div>` : ""}
    ${r.justificativa_gestor ? `<div><p class="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Nota do gestor direto</p><p class="text-sm text-slate-700 italic">"${r.justificativa_gestor}"</p></div>` : ""}
    ${r.justificativa_financeiro ? `<div><p class="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Nota do financeiro</p><p class="text-sm text-slate-700 italic">"${r.justificativa_financeiro}"</p></div>` : ""}
    ${r.motivo_cancelamento ? `<div><p class="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Motivo do cancelamento</p><p class="text-sm text-slate-700 italic">"${r.motivo_cancelamento}"</p></div>` : ""}
    ${r.anexo_path ? `<button type="button" id="cr-detalhe-ver-anexo" class="text-xs font-medium text-teal-700 hover:text-teal-900">📎 Ver comprovante</button>` : `<p class="text-xs text-slate-300">Sem comprovante</p>`}
  `;
  const btnAnexo = $("cr-detalhe-ver-anexo");
  if (btnAnexo) btnAnexo.addEventListener("click", async () => {
    const u = await urlAnexoReembolso(r.anexo_path);
    if (u) window.open(u, "_blank");
  });
}

function fecharDetalheConsultaReembolso() {
  crDetalheAtual = null;
  $("cr-view-detalhe").classList.add("hidden");
  $("cr-view-lista").classList.remove("hidden");
}

$("btn-cr-fechar-detalhe").addEventListener("click", fecharDetalheConsultaReembolso);

$("btn-cr-buscar").addEventListener("click", buscarConsultaReembolsos);
$("btn-cr-limpar-filtros").addEventListener("click", () => {
  $("cr-solicitante").value = "";
  $("cr-gestor-direto").value = "";
  $("cr-status").value = "";
  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  $("cr-data-inicio").value = inicioMes.toISOString().slice(0, 10);
  $("cr-data-fim").value = hoje.toISOString().slice(0, 10);
  buscarConsultaReembolsos();
});

})();