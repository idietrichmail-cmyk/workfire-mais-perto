// =========================================================
// Agenda de Instrutores — lógica do app (Supabase)
// =========================================================
(function () {
  // Proteção contra o script ser incluído/executado mais de uma vez na página
  if (window.__agendaInstrutoresAppIniciado) return;
  window.__agendaInstrutoresAppIniciado = true;

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

const diasSemana = ["D", "S", "T", "Q", "Q", "S", "S"];
const nomesMeses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
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

function obterStatusDia(diasStatus, dataStr) {
  return (diasStatus && diasStatus[dataStr]) || STATUS_PADRAO;
}

// Renderiza uma grade de calendário genérica (usada tanto na agenda do instrutor
// quanto no formulário do administrador). `aoClicarDia` recebe (dataStr, statusAtual)
// e só é chamado para dias que não estão em um status protegido.
function renderizarGradeCalendario({ mes, diasStatus, elLabel, elSemana, elGrade, aoClicarDia }) {
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
    const protegido = STATUS_PROTEGIDOS.includes(status);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = dia.getDate();
    btn.title =
      status === "agendado" ? "Agendado — não pode ser alterado aqui"
      : status === "aguardando" ? "Aguardando confirmação — não pode ser alterado aqui"
      : "";
    btn.className = `aspect-square rounded-md text-xs font-medium transition-colors ${ESTILO_STATUS[status]} ${
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

// ---------------------------------------------------------
// Estado geral
// ---------------------------------------------------------
let sessaoAtual = null;
let perfilAtual = null; // linha da tabela instrutores do usuário logado
let listaInstrutoresAdmin = [];
let mesCalendarioInstrutor = new Date();
let mesCalendarioForm = new Date();
let diasStatusForm = {};
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

let crudModuloId = null;
let crudLista = [];
let crudEditandoId = null;

let listaInstrutoresAtivos = [];
let listaTiposAtivos = [];
let listaCentrosAtivos = [];
let listaEmpresasAtivas = [];

let listaAgendamentos = [];
let editandoAgendamentoId = null;
let agInstrutorSelecionado = null;
let agMesCalendario = new Date();
let agDatasSelecionadas = new Set();
let agendamentoOriginalDatas = [];
let agendamentoInstrutorOriginalId = null;

let listaOrcamentos = [];
let editandoOrcamentoId = null;

let listaOrcamentosParaTurma = [];
let turmaOrcamentoSelecionadoId = null;
let turmasDoOrcamento = [];
let editandoTurmaId = null;

const FORMATOS_TEORIA = ["CT", "InCompany", "EAD", "EAD Síncrono", "Móvel"];
const FORMATOS_PRATICA = ["CT", "InCompany", "Móvel"];

const MODULOS = [
  { id: "instrutores", label: "Instrutores", icone: "👥", grupo: "Cadastros" },
  { id: "empresas", label: "Empresas", icone: "🏢", grupo: "Cadastros" },
  { id: "centros_treinamento", label: "Centros de Treinamento", icone: "🏫", grupo: "Cadastros" },
  { id: "tipos_treinamento", label: "Treinamentos", icone: "🏷️", grupo: "Cadastros" },
  { id: "usuarios_sistema", label: "Usuários do Sistema", icone: "🔑", grupo: "Cadastros" },
  { id: "agendamentos", label: "Agendar Treinamento", icone: "🗓️", grupo: "Operações" },
  { id: "orcamentos", label: "Orçamentos", icone: "💰", grupo: "Operações" },
  { id: "turmas", label: "Turmas por Orçamento", icone: "🎓", grupo: "Operações" },
];

function podeFazer(modulo, acao) {
  if (usuarioSistemaAtual && usuarioSistemaAtual.role === "admin") return true;
  const p = permissoesAtual[modulo];
  return !!(p && p["pode_" + acao]);
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
  const { error: vinculoErro } = await supabase.rpc("vincular_instrutor", { p_email: email });
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

function traduzirErroAuth(error) {
  const msg = (error && error.message) || "";
  if (msg.includes("already registered")) return "Este e-mail já tem uma senha criada. Faça login normalmente.";
  if (msg.includes("Password")) return "Senha inválida (mínimo 6 caracteres).";
  return "Não foi possível concluir. Tente novamente.";
}

// ===========================================================
// APP DO INSTRUTOR
// ===========================================================
function entrarNaAgendaInstrutor() {
  mesCalendarioInstrutor = new Date();
  $("inst-nome").textContent = perfilAtual.nome.split(" ")[0];
  $("inst-especialidade").textContent = perfilAtual.especialidade || "";
  renderizarDadosInstrutor();
  renderizarCalendarioInstrutor();
  mostrarTela("tela-instrutor");
}

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
    aoClicarDia: (dataStr, statusAtual) => {
      const novoStatus = statusAtual === "disponivel" ? "bloqueado" : "disponivel";
      salvarDiasStatusInstrutor({ ...perfilAtual.dias_status, [dataStr]: novoStatus });
    },
  });

  const contagem = contarStatus(perfilAtual.dias_status);
  $("inst-contagem-dias").textContent = `${contagem.disponivel} dia(s) disponíveis · ${contagem.agendado} agendado(s)`;

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
  renderizarNavAdmin();
  mostrarMenuInicio();
}

function mostrarMenuInicio() {
  moduloAtivo = null;
  document.querySelectorAll("#tela-admin main > section").forEach((s) => s.classList.add("hidden"));
  renderizarNavAdmin();
  $("admin-nav-mobile").value = "";

  const acessiveis = MODULOS.filter((m) => podeFazer(m.id, "consultar"));
  $("admin-eyebrow").textContent = "Work Fire mais perto de você";
  $("admin-titulo-pagina").textContent = "Menu";
  $("admin-descricao-pagina").textContent = acessiveis.length
    ? "Escolha um cadastro ou operação para começar."
    : "Seu usuário ainda não tem acesso a nenhum cadastro ou operação. Fale com o administrador.";

  $("secao-inicio").classList.remove("hidden");
  const grade = $("inicio-grade");
  if (acessiveis.length === 0) {
    grade.innerHTML = `<div class="col-span-full bg-white border border-dashed border-slate-300 rounded-lg py-16 text-center text-slate-500 text-sm">Nenhum item disponível.</div>`;
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
  MODULOS.forEach((m) => {
    if (!podeFazer(m.id, "consultar")) return;
    (grupos[m.grupo] = grupos[m.grupo] || []).push(m);
  });

  const botaoInicio = `
    <button data-nav-inicio class="flex items-center gap-2 rounded-md px-3 py-2 text-left w-full mb-3 ${
      moduloAtivo === null ? "bg-slate-800 text-white border-l-2 border-amber-500" : "hover:bg-slate-800 hover:text-white"
    }">🏠 Início</button>
  `;

  nav.innerHTML = botaoInicio + Object.entries(grupos).map(([grupo, itens]) => `
    <p class="text-[10px] uppercase tracking-wider text-slate-500 px-3 mt-4 mb-1 first:mt-0">${grupo}</p>
    ${itens.map((m) => `
      <button data-nav-modulo="${m.id}" class="flex items-center gap-2 rounded-md px-3 py-2 text-left w-full ${
        m.id === moduloAtivo ? "bg-slate-800 text-white border-l-2 border-amber-500" : "hover:bg-slate-800 hover:text-white"
      }">${m.icone} ${m.label}</button>
    `).join("")}
  `).join("");

  nav.querySelector("[data-nav-inicio]").addEventListener("click", mostrarMenuInicio);
  nav.querySelectorAll("[data-nav-modulo]").forEach((btn) =>
    btn.addEventListener("click", () => irParaModulo(btn.getAttribute("data-nav-modulo")))
  );

  const navMobile = $("admin-nav-mobile");
  navMobile.innerHTML = `<option value="" ${moduloAtivo === null ? "selected" : ""}>🏠 Início</option>` +
    Object.entries(grupos).map(([grupo, itens]) => `
      <optgroup label="${grupo}">
        ${itens.map((m) => `<option value="${m.id}" ${m.id === moduloAtivo ? "selected" : ""}>${m.icone} ${m.label}</option>`).join("")}
      </optgroup>
    `).join("");
}

$("admin-nav-mobile").addEventListener("change", (e) => {
  if (e.target.value) irParaModulo(e.target.value);
  else mostrarMenuInicio();
});

function irParaModulo(id) {
  moduloAtivo = id;
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
  }
}

async function carregarListaAdmin() {
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
      </div>
      <div class="flex gap-2 mt-2 pt-2 border-t border-slate-100">
        ${podeAlterarInst ? `<button data-editar="${inst.id}" class="flex-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md py-1.5">✏️ Editar</button>` : ""}
        ${podeExcluirInst ? `<button data-excluir="${inst.id}" class="flex-1 text-xs font-medium text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-md py-1.5">🗑️ Excluir</button>` : ""}
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
  await supabase.auth.signOut();
  usuarioSistemaAtual = null;
  permissoesAtual = {};
  moduloAtivo = null;
  mostrarTela("tela-acesso-admin");
}

["btn-ver-instrutor", "btn-ver-instrutor-desktop"].forEach((id) => $(id).addEventListener("click", verTelaInstrutor));
["btn-admin-trocar-senha", "btn-admin-trocar-senha-desktop"].forEach((id) => $(id).addEventListener("click", trocarSenhaAdmin));
["btn-admin-sair", "btn-admin-sair-desktop", "btn-admin-sair-mobile"].forEach((id) => $(id).addEventListener("click", sairAdmin));

// --- Formulário de cadastro/edição ---
function limparFormulario() {
  ["f-nome","f-cpf","f-email","f-telefone","f-especialidade","f-carga","f-observacoes"].forEach((id) => ($(id).value = ""));
  $("f-status").value = "Ativo";
  diasStatusForm = {};
  pendingDocFile = null;
  pendingDocPreviewUrl = null;
  docUrlAtualForm = null;
  $("f-doc-preview").classList.add("hidden");
  $("f-doc-upload-label").classList.remove("hidden");
  $("f-doc-input").value = "";
  mesCalendarioForm = new Date();
  esconderErro("form-erro");
}

$("btn-novo-instrutor").addEventListener("click", () => {
  editandoId = null;
  limparFormulario();
  $("painel-titulo").textContent = "Novo instrutor";
  $("btn-salvar-instrutor").textContent = "Cadastrar instrutor";
  renderizarCalendarioForm();
  $("painel-form").classList.remove("hidden");
});

function abrirEdicao(id) {
  const inst = listaInstrutoresAdmin.find((i) => i.id === id);
  if (!inst) return;
  editandoId = id;
  limparFormulario();
  $("f-nome").value = inst.nome || "";
  $("f-cpf").value = inst.cpf || "";
  $("f-email").value = inst.email || "";
  $("f-telefone").value = inst.telefone || "";
  $("f-especialidade").value = inst.especialidade || "";
  $("f-carga").value = inst.carga_horaria || "";
  $("f-observacoes").value = inst.observacoes || "";
  $("f-status").value = inst.status || "Ativo";
  diasStatusForm = { ...(inst.dias_status || {}) };
  docUrlAtualForm = inst.documento_url || null;

  if (docUrlAtualForm) {
    $("f-doc-preview").classList.remove("hidden");
    $("f-doc-upload-label").classList.add("hidden");
    obterUrlDocumento(docUrlAtualForm).then((url) => { if (url) $("f-doc-img").src = url; });
  }

  $("painel-titulo").textContent = "Editar instrutor";
  $("btn-salvar-instrutor").textContent = "Salvar alterações";
  renderizarCalendarioForm();
  $("painel-form").classList.remove("hidden");
}

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
    aoClicarDia: (dataStr, statusAtual) => {
      const novoStatus = statusAtual === "disponivel" ? "bloqueado" : "disponivel";
      diasStatusForm = { ...diasStatusForm, [dataStr]: novoStatus };
      renderizarCalendarioForm();
    },
  });
  const contagem = contarStatus(diasStatusForm);
  $("f-dias-contagem").textContent = `${contagem.disponivel} disponíveis · ${contagem.agendado} agendados · ${contagem.aguardando} aguardando`;
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
  if (!nome) return mostrarErro("form-erro", "Informe o nome do instrutor.");
  if (!especialidade) return mostrarErro("form-erro", "Informe a especialidade do instrutor.");
  if (!email) return mostrarErro("form-erro", "Informe o e-mail do instrutor.");

  const payload = {
    nome,
    cpf: $("f-cpf").value.trim(),
    email,
    telefone: $("f-telefone").value.trim(),
    especialidade,
    carga_horaria: $("f-carga").value.trim(),
    status: $("f-status").value,
    observacoes: $("f-observacoes").value.trim(),
    dias_status: diasStatusForm,
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

  $("btn-salvar-instrutor").disabled = false;
  $("painel-form").classList.add("hidden");
  await carregarListaAdmin();
}

async function excluirInstrutor(id) {
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
    buscaPlaceholder: "Buscar por nome ou CNPJ",
    ordenarPor: "nome",
    campos: [
      { id: "nome", label: "Nome da empresa", obrigatorio: true },
      { id: "cnpj", label: "CNPJ", botaoAcao: { id: "btn-buscar-cnpj", label: "🔎 Pesquisar Receita Federal", onClick: buscarCnpjReceitaFederal } },
      { id: "contato_nome", label: "Nome do contato" },
      { id: "contato_email", label: "E-mail do contato", tipo: "email" },
      { id: "contato_telefone", label: "Telefone do contato" },
      { id: "endereco", label: "Endereço" },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
    ],
    campoBusca: (i) => `${i.nome} ${i.cnpj || ""}`,
    cardTitulo: (i) => i.nome,
    cardLinhas: (i) => [i.cnpj && `CNPJ: ${i.cnpj}`, i.contato_nome, i.contato_email, i.contato_telefone].filter(Boolean),
  },
  centros_treinamento: {
    tabela: "centros_treinamento",
    titulo: "Centro de Treinamento",
    descricao: "Locais onde os treinamentos acontecem, com sua estrutura disponível.",
    buscaPlaceholder: "Buscar por nome",
    ordenarPor: "nome",
    campos: [
      { id: "nome", label: "Nome do centro", obrigatorio: true },
      { id: "endereco", label: "Endereço" },
      { id: "capacidade_diaria", label: "Capacidade diária (pessoas/dia)", tipo: "number" },
      { id: "qtd_salas_aula", label: "Qtd. Salas de Aula", tipo: "number" },
      { id: "qtd_pistas_treinamento", label: "Qtd. Pistas de Treinamento", tipo: "number" },
      { id: "qtd_torres_altura", label: "Qtd. Torres de Altura", tipo: "number" },
      { id: "qtd_espaco_confinado", label: "Qtd. Espaço Confinado", tipo: "number" },
      { id: "qtd_petrolifera", label: "Qtd. Petrolífera", tipo: "number" },
      { id: "qtd_uti", label: "Qtd. UTI", tipo: "number" },
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
    ].filter(Boolean),
  },
  tipos_treinamento: {
    tabela: "tipos_treinamento",
    titulo: "Treinamento",
    descricao: "Treinamentos oferecidos e o consumo de dias na operação (teoria, prática ou ambos).",
    buscaPlaceholder: "Buscar por nome",
    ordenarPor: "nome",
    campos: [
      { id: "nome", label: "Nome do treinamento", obrigatorio: true },
      { id: "carga_horaria", label: "Carga horária" },
      { id: "categoria", label: "Categoria" },
      { id: "dias_teoria", label: "Dias de Teoria", tipo: "number" },
      { id: "dias_pratica", label: "Dias de Prática", tipo: "number" },
      { id: "dias_teoria_pratica", label: "Dias de Teoria com Prática", tipo: "number" },
      { id: "descricao", label: "Descrição", tipo: "textarea" },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
    ],
    campoBusca: (i) => `${i.nome} ${i.categoria || ""}`,
    cardTitulo: (i) => i.nome,
    cardLinhas: (i) => [
      i.categoria,
      i.carga_horaria && `Carga horária: ${i.carga_horaria}`,
      i.dias_teoria && `📘 ${i.dias_teoria} dia(s) de teoria`,
      i.dias_pratica && `🛠️ ${i.dias_pratica} dia(s) de prática`,
      i.dias_teoria_pratica && `📘🛠️ ${i.dias_teoria_pratica} dia(s) de teoria com prática`,
    ].filter(Boolean),
  },
  usuarios_sistema: {
    tabela: "usuarios_sistema",
    titulo: "Usuário do Sistema",
    permissoes: true,
    descricao: "Pessoas com acesso à área de trabalho e suas permissões.",
    buscaPlaceholder: "Buscar por nome ou e-mail",
    ordenarPor: "nome",
    campos: [
      { id: "nome", label: "Nome completo", obrigatorio: true },
      { id: "email", label: "E-mail (login)", tipo: "email", obrigatorio: true },
      { id: "role", label: "Perfil", tipo: "select", opcoes: [{ value: "usuario", label: "Usuário" }, { value: "admin", label: "Administrador" }], padrao: "usuario" },
      { id: "status", label: "Status", tipo: "select", opcoes: ["Ativo", "Inativo"], padrao: "Ativo" },
    ],
    campoBusca: (i) => `${i.nome} ${i.email}`,
    cardTitulo: (i) => i.nome,
    cardLinhas: (i) => [i.email, i.role === "admin" ? "👑 Administrador" : "Usuário", i.user_id ? "✅ Já criou senha no app" : "⏳ Aguardando primeiro acesso"],
  },
};

function renderCampoHtml(campo, valor) {
  const val = valor == null ? "" : valor;
  if (campo.tipo === "select") {
    const opcoes = campo.opcoes.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
    return `<div>
      <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">${campo.label}</label>
      <select id="crud-campo-${campo.id}" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
        ${opcoes.map((o) => `<option value="${o.value}" ${o.value === val ? "selected" : ""}>${o.label}</option>`).join("")}
      </select>
    </div>`;
  }
  if (campo.tipo === "textarea") {
    return `<div>
      <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">${campo.label}</label>
      <textarea id="crud-campo-${campo.id}" rows="3" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">${val}</textarea>
    </div>`;
  }
  if (campo.botaoAcao) {
    return `<div>
      <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">${campo.label}</label>
      <div class="mt-1 flex gap-2">
        <input id="crud-campo-${campo.id}" type="${campo.tipo || "text"}" value="${String(val).replace(/"/g, "&quot;")}" class="flex-1 min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
        <button type="button" id="${campo.botaoAcao.id}" class="shrink-0 whitespace-nowrap text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md px-3">${campo.botaoAcao.label}</button>
      </div>
      <p id="${campo.botaoAcao.id}-status" class="text-[11px] mt-1"></p>
    </div>`;
  }
  return `<div>
    <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">${campo.label}</label>
    <input id="crud-campo-${campo.id}" type="${campo.tipo || "text"}" value="${String(val).replace(/"/g, "&quot;")}" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
  </div>`;
}

async function carregarModuloCrud(id) {
  crudModuloId = id;
  const cfg = CRUD_CONFIG[id];
  $("admin-descricao-pagina").textContent = cfg.descricao;
  const { data, error } = await supabase.from(cfg.tabela).select("*").order(cfg.ordenarPor);
  crudLista = error ? [] : data;
  $("crud-busca").value = "";
  $("crud-busca").placeholder = cfg.buscaPlaceholder;
  $("btn-crud-novo").classList.toggle("hidden", !podeFazer(id, "incluir"));
  renderizarListaCrud();
}

function renderizarListaCrud() {
  const cfg = CRUD_CONFIG[crudModuloId];
  const busca = $("crud-busca").value.toLowerCase();
  const lista = crudLista.filter((item) => cfg.campoBusca(item).toLowerCase().includes(busca));
  const podeAlterar = podeFazer(crudModuloId, "alterar");
  const podeExcluir = podeFazer(crudModuloId, "excluir");
  const cont = $("crud-lista");

  if (lista.length === 0) {
    cont.innerHTML = `<div class="col-span-full bg-white border border-dashed border-slate-300 rounded-lg py-16 text-center text-slate-500 text-sm">Nenhum registro encontrado.</div>`;
    return;
  }

  cont.innerHTML = lista.map((item) => `
    <div class="bg-white rounded-lg border border-slate-200 border-t-4 ${item.status === "Inativo" ? "border-t-rose-400" : "border-t-teal-600"} p-4 flex flex-col gap-2 shadow-sm">
      <div class="flex items-start justify-between">
        <p class="font-serif text-lg text-slate-900 leading-tight">${cfg.cardTitulo(item)}</p>
        ${item.status ? `<span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${item.status === "Ativo" ? "bg-teal-50 text-teal-700" : "bg-rose-50 text-rose-600"}">${item.status}</span>` : ""}
      </div>
      <div class="text-xs text-slate-500 space-y-1">${cfg.cardLinhas(item).map((l) => `<p>${l}</p>`).join("")}</div>
      <div class="flex gap-2 mt-2 pt-2 border-t border-slate-100">
        ${podeAlterar ? `<button data-crud-editar="${item.id}" class="flex-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md py-1.5">✏️ Editar</button>` : ""}
        ${podeExcluir ? `<button data-crud-excluir="${item.id}" class="flex-1 text-xs font-medium text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-md py-1.5">🗑️ Excluir</button>` : ""}
      </div>
    </div>
  `).join("");

  cont.querySelectorAll("[data-crud-editar]").forEach((btn) =>
    btn.addEventListener("click", () => abrirEdicaoCrud(btn.getAttribute("data-crud-editar")))
  );
  cont.querySelectorAll("[data-crud-excluir]").forEach((btn) =>
    btn.addEventListener("click", () => excluirCrud(btn.getAttribute("data-crud-excluir")))
  );
}

$("crud-busca").addEventListener("input", renderizarListaCrud);

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
    ${MODULOS.map((m) => {
      const p = existentes[m.id] || {};
      return `<div class="grid grid-cols-[1fr,repeat(4,32px)] gap-1 px-3 py-2 items-center">
        <span class="text-slate-700">${m.icone} ${m.label}</span>
        <input type="checkbox" data-perm-modulo="${m.id}" data-perm-acao="consultar" ${p.pode_consultar ? "checked" : ""} />
        <input type="checkbox" data-perm-modulo="${m.id}" data-perm-acao="incluir" ${p.pode_incluir ? "checked" : ""} />
        <input type="checkbox" data-perm-modulo="${m.id}" data-perm-acao="alterar" ${p.pode_alterar ? "checked" : ""} />
        <input type="checkbox" data-perm-modulo="${m.id}" data-perm-acao="excluir" ${p.pode_excluir ? "checked" : ""} />
      </div>`;
    }).join("")}
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

function abrirNovoCrud() {
  crudEditandoId = null;
  const cfg = CRUD_CONFIG[crudModuloId];
  esconderErro("crud-form-erro");
  $("painel-crud-titulo").textContent = "Novo " + cfg.titulo.toLowerCase();
  $("btn-salvar-crud").textContent = "Cadastrar";
  $("crud-campos").innerHTML = cfg.campos.map((c) => renderCampoHtml(c, c.padrao)).join("");
  ligarBotoesAcaoCampos(cfg);
  montarBlocoPermissoes(cfg, null);
  $("painel-crud").classList.remove("hidden");
}

function abrirEdicaoCrud(id) {
  crudEditandoId = id;
  const cfg = CRUD_CONFIG[crudModuloId];
  const item = crudLista.find((i) => i.id === id);
  if (!item) return;
  esconderErro("crud-form-erro");
  $("painel-crud-titulo").textContent = "Editar " + cfg.titulo.toLowerCase();
  $("btn-salvar-crud").textContent = "Salvar alterações";
  $("crud-campos").innerHTML = cfg.campos.map((c) => renderCampoHtml(c, item[c.id])).join("");
  ligarBotoesAcaoCampos(cfg);
  montarBlocoPermissoes(cfg, item);
  $("painel-crud").classList.remove("hidden");
}

function ligarBotoesAcaoCampos(cfg) {
  cfg.campos.forEach((c) => {
    if (c.botaoAcao) $(c.botaoAcao.id).addEventListener("click", c.botaoAcao.onClick);
  });
}

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

$("btn-crud-novo").addEventListener("click", abrirNovoCrud);
$("btn-fechar-painel-crud").addEventListener("click", () => $("painel-crud").classList.add("hidden"));
$("btn-cancelar-painel-crud").addEventListener("click", () => $("painel-crud").classList.add("hidden"));
$("painel-crud-overlay").addEventListener("click", () => $("painel-crud").classList.add("hidden"));

async function salvarPermissoesForm(usuarioId) {
  const linhas = MODULOS.map((m) => ({
    usuario_id: usuarioId,
    modulo: m.id,
    pode_consultar: !!qs(`[data-perm-modulo="${m.id}"][data-perm-acao="consultar"]`)?.checked,
    pode_incluir: !!qs(`[data-perm-modulo="${m.id}"][data-perm-acao="incluir"]`)?.checked,
    pode_alterar: !!qs(`[data-perm-modulo="${m.id}"][data-perm-acao="alterar"]`)?.checked,
    pode_excluir: !!qs(`[data-perm-modulo="${m.id}"][data-perm-acao="excluir"]`)?.checked,
  }));
  await supabase.from("permissoes").upsert(linhas, { onConflict: "usuario_id,modulo" });
}

async function salvarCrud() {
  esconderErro("crud-form-erro");
  const cfg = CRUD_CONFIG[crudModuloId];
  const payload = {};
  for (const campo of cfg.campos) {
    const el = $("crud-campo-" + campo.id);
    let valor = typeof el.value === "string" ? el.value.trim() : el.value;
    if (campo.obrigatorio && !valor) return mostrarErro("crud-form-erro", `Informe: ${campo.label}.`);
    if (campo.tipo === "number") valor = valor === "" ? null : Number(valor);
    payload[campo.id] = valor;
  }

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
      return mostrarErro("crud-form-erro", "Já existe um registro com esse valor único (ex: e-mail).");
    }
    return mostrarErro("crud-form-erro", "Não foi possível salvar. Tente novamente.");
  }

  if (crudModuloId === "usuarios_sistema" && payload.role !== "admin") {
    await salvarPermissoesForm(linha.id);
  }

  $("btn-salvar-crud").disabled = false;
  $("painel-crud").classList.add("hidden");
  await carregarModuloCrud(crudModuloId);
}

$("btn-salvar-crud").addEventListener("click", salvarCrud);

async function excluirCrud(id) {
  const cfg = CRUD_CONFIG[crudModuloId];
  const { error } = await supabase.from(cfg.tabela).delete().eq("id", id);
  if (!error) await carregarModuloCrud(crudModuloId);
}

// ===========================================================
// Auxiliares compartilhados por Agendamentos / Orçamentos / Turmas
// ===========================================================
function preencherSelect(id, itens, valueKey, labelFn, opcaoVazia) {
  const el = $(id);
  el.innerHTML = (opcaoVazia ? `<option value="">${opcaoVazia}</option>` : "") +
    itens.map((i) => `<option value="${i[valueKey]}">${labelFn(i)}</option>`).join("");
}

// ===========================================================
// OPERAÇÃO: AGENDAR TREINAMENTO
// ===========================================================
async function carregarAgendamentos() {
  $("admin-descricao-pagina").textContent = "Agende treinamentos vinculando instrutor, tipo, centro e datas.";
  const [{ data: ags }, { data: insts }, { data: tipos }, { data: centros }, { data: empresas }] = await Promise.all([
    supabase.from("agendamentos").select("*, instrutores(nome), tipos_treinamento(nome), centros_treinamento(nome), empresas(nome)").order("created_at", { ascending: false }),
    supabase.from("instrutores").select("*").eq("status", "Ativo").order("nome"),
    supabase.from("tipos_treinamento").select("*").eq("status", "Ativo").order("nome"),
    supabase.from("centros_treinamento").select("*").eq("status", "Ativo").order("nome"),
    supabase.from("empresas").select("*").eq("status", "Ativo").order("nome"),
  ]);
  listaAgendamentos = ags || [];
  listaInstrutoresAtivos = insts || [];
  listaTiposAtivos = tipos || [];
  listaCentrosAtivos = centros || [];
  listaEmpresasAtivas = empresas || [];
  $("btn-ag-novo").classList.toggle("hidden", !podeFazer("agendamentos", "incluir"));
  renderizarListaAgendamentos();
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
    const selecionavel = statusOriginal === "disponivel" || pertenceEdicao || selecionado;

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

function abrirNovoAgendamento() {
  editandoAgendamentoId = null;
  agendamentoOriginalDatas = [];
  agendamentoInstrutorOriginalId = null;
  esconderErro("ag-form-erro");
  preencherSelect("ag-instrutor", listaInstrutoresAtivos, "id", (i) => i.nome, "— Selecione —");
  preencherSelect("ag-tipo", listaTiposAtivos, "id", (i) => i.nome, "— Selecione —");
  preencherSelect("ag-centro", listaCentrosAtivos, "id", (i) => i.nome, "— Selecione —");
  preencherSelect("ag-empresa", listaEmpresasAtivas, "id", (i) => i.nome, "— Nenhuma —");
  $("ag-horario").value = "";
  $("ag-status").value = "Aguardando";
  $("ag-observacoes").value = "";
  agInstrutorSelecionado = null;
  agDatasSelecionadas = new Set();
  agMesCalendario = new Date();
  $("ag-sem-instrutor").classList.remove("hidden");
  $("ag-calendario").classList.add("hidden");
  atualizarContagemAgDatas();
  $("painel-agendamento-titulo").textContent = "Agendar treinamento";
  $("btn-salvar-agendamento").textContent = "Salvar agendamento";
  $("painel-agendamento").classList.remove("hidden");
}

function abrirEdicaoAgendamento(id) {
  const a = listaAgendamentos.find((x) => x.id === id);
  if (!a) return;
  editandoAgendamentoId = id;
  agendamentoOriginalDatas = a.datas || [];
  agendamentoInstrutorOriginalId = a.instrutor_id;
  esconderErro("ag-form-erro");
  preencherSelect("ag-instrutor", listaInstrutoresAtivos, "id", (i) => i.nome, "— Selecione —");
  preencherSelect("ag-tipo", listaTiposAtivos, "id", (i) => i.nome, "— Selecione —");
  preencherSelect("ag-centro", listaCentrosAtivos, "id", (i) => i.nome, "— Selecione —");
  preencherSelect("ag-empresa", listaEmpresasAtivas, "id", (i) => i.nome, "— Nenhuma —");
  $("ag-instrutor").value = a.instrutor_id || "";
  $("ag-tipo").value = a.tipo_treinamento_id || "";
  $("ag-centro").value = a.centro_treinamento_id || "";
  $("ag-empresa").value = a.empresa_id || "";
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

  let erro;
  if (editandoAgendamentoId) {
    ({ error: erro } = await supabase.from("agendamentos").update(payload).eq("id", editandoAgendamentoId));
  } else {
    ({ error: erro } = await supabase.from("agendamentos").insert(payload));
  }

  if (erro) {
    $("btn-salvar-agendamento").disabled = false;
    $("btn-salvar-agendamento").textContent = editandoAgendamentoId ? "Salvar alterações" : "Salvar agendamento";
    return mostrarErro("ag-form-erro", "Não foi possível salvar. Tente novamente.");
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

async function carregarOrcamentos() {
  $("admin-descricao-pagina").textContent = "Registre orçamentos de treinamento por empresa. Ao criar um novo orçamento, as turmas já são geradas automaticamente.";
  const [{ data: orcs }, { data: empresas }, { data: tipos }, { data: centros }] = await Promise.all([
    supabase.from("orcamentos").select("*, empresas(nome), centros_treinamento(nome), tipos_treinamento(nome)").order("created_at", { ascending: false }),
    supabase.from("empresas").select("*").eq("status", "Ativo").order("nome"),
    supabase.from("tipos_treinamento").select("*").eq("status", "Ativo").order("nome"),
    supabase.from("centros_treinamento").select("*").eq("status", "Ativo").order("nome"),
  ]);
  listaOrcamentos = orcs || [];
  listaEmpresasAtivas = empresas || [];
  listaTiposAtivos = tipos || [];
  listaCentrosAtivos = centros || [];
  $("btn-orc-novo").classList.toggle("hidden", !podeFazer("orcamentos", "incluir"));
  renderizarListaOrcamentos();
}

function renderizarListaOrcamentos() {
  const busca = $("orc-busca").value.toLowerCase();
  const podeAlterar = podeFazer("orcamentos", "alterar");
  const podeExcluir = podeFazer("orcamentos", "excluir");
  const lista = listaOrcamentos.filter((o) => `${o.numero} ${o.empresas?.nome || ""}`.toLowerCase().includes(busca));
  const cont = $("orc-lista");
  if (lista.length === 0) {
    cont.innerHTML = `<div class="col-span-full bg-white border border-dashed border-slate-300 rounded-lg py-16 text-center text-slate-500 text-sm">Nenhum orçamento encontrado.</div>`;
    return;
  }
  const corStatus = { Aberto: "bg-amber-50 text-amber-700", Aprovado: "bg-teal-50 text-teal-700", Recusado: "bg-rose-50 text-rose-600", Cancelado: "bg-slate-100 text-slate-500" };
  cont.innerHTML = lista.map((o) => `
    <div class="bg-white rounded-lg border border-slate-200 p-4 flex flex-col gap-2 shadow-sm">
      <div class="flex items-start justify-between">
        <div>
          <p class="font-mono text-[11px] text-slate-400">${o.numero}</p>
          <p class="font-serif text-lg text-slate-900 leading-tight">${o.empresas?.nome || "—"}</p>
        </div>
        <span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${corStatus[o.status] || ""}">${o.status}</span>
      </div>
      <p class="text-sm text-amber-700 font-medium">🏷️ ${o.tipos_treinamento?.nome || "—"}</p>
      <div class="text-xs text-slate-500 space-y-1">
        ${o.centros_treinamento?.nome ? `<p>🏫 ${o.centros_treinamento.nome}</p>` : ""}
        <p>📅 ${o.data || ""}${o.validade ? ` · válido até ${o.validade}` : ""}</p>
        <p>🎓 ${o.qtd_turmas || 0} turma(s) · 👥 ${o.qtd_alunos || 0} aluno(s) · ${o.qtd_alunos_por_turma || 0} aluno(s)/turma</p>
      </div>
      <div class="flex gap-2 mt-2 pt-2 border-t border-slate-100">
        ${podeAlterar ? `<button data-orc-editar="${o.id}" class="flex-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md py-1.5">✏️ Editar</button>` : ""}
        ${podeExcluir ? `<button data-orc-excluir="${o.id}" class="flex-1 text-xs font-medium text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-md py-1.5">🗑️ Excluir</button>` : ""}
      </div>
    </div>
  `).join("");
  cont.querySelectorAll("[data-orc-editar]").forEach((btn) => btn.addEventListener("click", () => abrirEdicaoOrcamento(btn.getAttribute("data-orc-editar"))));
  cont.querySelectorAll("[data-orc-excluir]").forEach((btn) => btn.addEventListener("click", () => excluirOrcamento(btn.getAttribute("data-orc-excluir"))));
}

$("orc-busca").addEventListener("input", renderizarListaOrcamentos);

function abrirNovoOrcamento() {
  editandoOrcamentoId = null;
  esconderErro("orc-form-erro");
  $("orc-numero").value = "";
  $("orc-numero").disabled = false;
  preencherSelect("orc-empresa", listaEmpresasAtivas, "id", (i) => i.nome, "— Selecione —");
  preencherSelect("orc-centro", listaCentrosAtivos, "id", (i) => i.nome, "— Selecione —");
  preencherSelect("orc-tipo", listaTiposAtivos, "id", (i) => i.nome, "— Selecione —");
  $("orc-qtd-turmas").value = "1";
  $("orc-qtd-alunos").value = "";
  $("orc-qtd-alunos-turma").value = "";
  $("orc-data").value = formatarData(new Date());
  $("orc-validade").value = "";
  $("orc-status").value = "Aberto";
  $("orc-observacoes").value = "";
  $("orc-turmas-bloco").classList.add("hidden");
  $("orc-turmas-tbody").innerHTML = "";
  $("painel-orcamento-titulo").textContent = "Novo orçamento";
  $("btn-salvar-orcamento").textContent = "Salvar orçamento";
  $("painel-orcamento").classList.remove("hidden");
}

async function abrirEdicaoOrcamento(id) {
  const o = listaOrcamentos.find((x) => x.id === id);
  if (!o) return;
  editandoOrcamentoId = id;
  esconderErro("orc-form-erro");
  $("orc-numero").value = o.numero || "";
  $("orc-numero").disabled = true; // número já definido não muda mais, evita conflito de unicidade
  preencherSelect("orc-empresa", listaEmpresasAtivas, "id", (i) => i.nome, "— Selecione —");
  $("orc-empresa").value = o.empresa_id || "";
  preencherSelect("orc-centro", listaCentrosAtivos, "id", (i) => i.nome, "— Selecione —");
  $("orc-centro").value = o.centro_treinamento_id || "";
  preencherSelect("orc-tipo", listaTiposAtivos, "id", (i) => i.nome, "— Selecione —");
  $("orc-tipo").value = o.tipo_treinamento_id || "";
  $("orc-qtd-turmas").value = o.qtd_turmas || "";
  $("orc-qtd-alunos").value = o.qtd_alunos || "";
  $("orc-qtd-alunos-turma").value = o.qtd_alunos_por_turma || "";
  $("orc-data").value = o.data || "";
  $("orc-validade").value = o.validade || "";
  $("orc-status").value = o.status;
  $("orc-observacoes").value = o.observacoes || "";
  $("painel-orcamento-titulo").textContent = "Editar orçamento";
  $("btn-salvar-orcamento").textContent = "Salvar alterações";
  $("painel-orcamento").classList.remove("hidden");
  await carregarTabelaTurmasOrcamento(id);
}

// Carrega e renderiza, dentro do painel do orçamento, a tabela editável
// das turmas já geradas (Data, Formato Teoria, Formato Prática).
async function carregarTabelaTurmasOrcamento(orcamentoId) {
  const { data } = await supabase.from("turmas").select("*").eq("orcamento_id", orcamentoId).order("identificacao");
  const turmas = data || [];
  const bloco = $("orc-turmas-bloco");
  const corpo = $("orc-turmas-tbody");
  if (turmas.length === 0) {
    bloco.classList.add("hidden");
    corpo.innerHTML = "";
    return;
  }
  bloco.classList.remove("hidden");
  const opcoesTeoria = (val) => FORMATOS_TEORIA.map((f) => `<option value="${f}" ${f === val ? "selected" : ""}>${f}</option>`).join("");
  const opcoesPratica = (val) => FORMATOS_PRATICA.map((f) => `<option value="${f}" ${f === val ? "selected" : ""}>${f}</option>`).join("");
  corpo.innerHTML = turmas.map((t) => `
    <tr data-turma-linha="${t.id}">
      <td class="px-2 py-1.5 font-mono text-slate-500">${t.identificacao || "—"}</td>
      <td class="px-2 py-1.5">
        <input type="date" data-turma-campo="data_inicio" value="${t.data_inicio || ""}" class="w-full text-xs rounded-md border border-slate-300 px-2 py-1.5" />
      </td>
      <td class="px-2 py-1.5">
        <select data-turma-campo="formato_teoria" class="w-full text-xs rounded-md border border-slate-300 px-2 py-1.5">
          <option value="">—</option>
          ${opcoesTeoria(t.formato_teoria)}
        </select>
      </td>
      <td class="px-2 py-1.5">
        <select data-turma-campo="formato_pratica" class="w-full text-xs rounded-md border border-slate-300 px-2 py-1.5">
          <option value="">—</option>
          ${opcoesPratica(t.formato_pratica)}
        </select>
      </td>
    </tr>
  `).join("");

  corpo.querySelectorAll("[data-turma-campo]").forEach((el) => {
    el.addEventListener("change", async (e) => {
      const linha = e.target.closest("[data-turma-linha]");
      const turmaId = linha.getAttribute("data-turma-linha");
      const campo = e.target.getAttribute("data-turma-campo");
      const valor = e.target.value || null;
      await supabase.from("turmas").update({ [campo]: valor }).eq("id", turmaId);
    });
  });
}

$("btn-orc-novo").addEventListener("click", abrirNovoOrcamento);
$("btn-fechar-painel-orcamento").addEventListener("click", () => $("painel-orcamento").classList.add("hidden"));
$("btn-cancelar-painel-orcamento").addEventListener("click", () => $("painel-orcamento").classList.add("hidden"));
$("painel-orcamento-overlay").addEventListener("click", () => $("painel-orcamento").classList.add("hidden"));

async function salvarOrcamento() {
  esconderErro("orc-form-erro");
  const numero = $("orc-numero").value.trim();
  const empresaId = $("orc-empresa").value;
  const centroId = $("orc-centro").value;
  const tipoId = $("orc-tipo").value;
  const qtdTurmas = Number($("orc-qtd-turmas").value) || 0;
  if (!numero) return mostrarErro("orc-form-erro", "Informe o número do orçamento.");
  if (!empresaId) return mostrarErro("orc-form-erro", "Selecione a empresa.");
  if (!centroId) return mostrarErro("orc-form-erro", "Selecione o centro de treinamento.");
  if (!tipoId) return mostrarErro("orc-form-erro", "Selecione o treinamento.");
  if (qtdTurmas < 1) return mostrarErro("orc-form-erro", "Informe a quantidade de turmas (mínimo 1).");

  const payload = {
    empresa_id: empresaId,
    centro_treinamento_id: centroId,
    tipo_treinamento_id: tipoId,
    qtd_turmas: qtdTurmas,
    qtd_alunos: $("orc-qtd-alunos").value ? Number($("orc-qtd-alunos").value) : null,
    qtd_alunos_por_turma: $("orc-qtd-alunos-turma").value ? Number($("orc-qtd-alunos-turma").value) : null,
    data: $("orc-data").value || null,
    validade: $("orc-validade").value || null,
    status: $("orc-status").value,
    observacoes: $("orc-observacoes").value.trim(),
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
      return mostrarErro("orc-form-erro", "Já existe um orçamento com esse número.");
    }
    return mostrarErro("orc-form-erro", "Não foi possível salvar. Tente novamente.");
  }

  $("btn-salvar-orcamento").disabled = false;

  if (!editandoOrcamentoId) {
    await gerarTurmasParaOrcamento(linha, qtdTurmas);
    // Mantém o painel aberto, já em modo edição, para preencher a tabela de turmas geradas.
    editandoOrcamentoId = linha.id;
    $("orc-numero").disabled = true;
    $("painel-orcamento-titulo").textContent = "Editar orçamento";
    $("btn-salvar-orcamento").textContent = "Salvar alterações";
    await carregarTabelaTurmasOrcamento(linha.id);
    await carregarOrcamentos();
    return;
  }

  $("painel-orcamento").classList.add("hidden");
  await carregarOrcamentos();
}

$("btn-salvar-orcamento").addEventListener("click", salvarOrcamento);

// Cria automaticamente as linhas de turma do orçamento, com identificação
// alfabética (A, B, C…) e a soma de dias teóricos/práticos do treinamento
// selecionado como referência de duração de cada turma.
async function gerarTurmasParaOrcamento(orcamento, qtdTurmas) {
  const tipo = listaTiposAtivos.find((t) => t.id === orcamento.tipo_treinamento_id);
  const diasTotais = tipo ? (Number(tipo.dias_teoria) || 0) + (Number(tipo.dias_pratica) || 0) + (Number(tipo.dias_teoria_pratica) || 0) : null;

  const turmasPayload = Array.from({ length: qtdTurmas }, (_, i) => ({
    orcamento_id: orcamento.id,
    identificacao: letraIndice(i),
    tipo_treinamento_id: orcamento.tipo_treinamento_id,
    centro_treinamento_id: orcamento.centro_treinamento_id,
    vagas: orcamento.qtd_alunos_por_turma || null,
    dias_totais: diasTotais,
    status: "Planejada",
  }));

  await supabase.from("turmas").insert(turmasPayload);
}

async function excluirOrcamento(id) {
  const { error } = await supabase.from("orcamentos").delete().eq("id", id);
  if (!error) await carregarOrcamentos();
}

// ===========================================================
// OPERAÇÃO: TURMAS POR ORÇAMENTO
// ===========================================================
async function carregarTurmasInit() {
  $("admin-descricao-pagina").textContent = "Acompanhe e ajuste as turmas geradas automaticamente para cada orçamento.";
  const [{ data: orcs }, { data: centros }, { data: insts }, { data: tipos }] = await Promise.all([
    supabase.from("orcamentos").select("*, empresas(nome), tipos_treinamento(nome)").order("created_at", { ascending: false }),
    supabase.from("centros_treinamento").select("*").eq("status", "Ativo").order("nome"),
    supabase.from("instrutores").select("*").eq("status", "Ativo").order("nome"),
    supabase.from("tipos_treinamento").select("*").eq("status", "Ativo").order("nome"),
  ]);
  listaOrcamentosParaTurma = orcs || [];
  listaCentrosAtivos = centros || [];
  listaInstrutoresAtivos = insts || [];
  listaTiposAtivos = tipos || [];

  preencherSelect("turma-orcamento-select", listaOrcamentosParaTurma, "id", (o) => `${o.numero} — ${o.empresas?.nome || "—"}`, "— Selecione —");
  $("turma-orcamento-select").value = "";
  $("turma-orcamento-info").classList.add("hidden");
  $("turma-conteudo").classList.add("hidden");
  turmaOrcamentoSelecionadoId = null;
}

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
    <p><strong>Previsto:</strong> ${o.qtd_turmas || 0} turma(s) · ${o.qtd_alunos || 0} aluno(s) · ${o.qtd_alunos_por_turma || 0} aluno(s)/turma</p>
  `;
  $("turma-conteudo").classList.remove("hidden");
  $("btn-turma-novo").classList.toggle("hidden", !podeFazer("turmas", "incluir"));
  carregarTurmasDoOrcamento();
});

async function carregarTurmasDoOrcamento() {
  const { data } = await supabase
    .from("turmas")
    .select("*, tipos_treinamento(nome), centros_treinamento(nome), instrutores(nome)")
    .eq("orcamento_id", turmaOrcamentoSelecionadoId)
    .order("identificacao", { ascending: true });
  turmasDoOrcamento = data || [];
  renderizarListaTurmas();
}

function renderizarListaTurmas() {
  const podeAlterar = podeFazer("turmas", "alterar");
  const podeExcluir = podeFazer("turmas", "excluir");
  const cont = $("turma-lista");
  if (turmasDoOrcamento.length === 0) {
    cont.innerHTML = `<div class="col-span-full bg-white border border-dashed border-slate-300 rounded-lg py-10 text-center text-slate-500 text-sm">Nenhuma turma cadastrada para este orçamento.</div>`;
    return;
  }
  const corStatus = { Planejada: "bg-amber-50 text-amber-700", Confirmada: "bg-teal-50 text-teal-700", Concluida: "bg-slate-100 text-slate-600", Cancelada: "bg-rose-50 text-rose-600" };
  cont.innerHTML = turmasDoOrcamento.map((t) => `
    <div class="bg-white rounded-lg border border-slate-200 p-4 flex flex-col gap-2 shadow-sm">
      <div class="flex items-start justify-between">
        <div>
          <p class="font-mono text-[11px] text-slate-400">Turma ${t.identificacao || "—"}</p>
          <p class="font-serif text-lg text-slate-900 leading-tight">${t.tipos_treinamento?.nome || "—"}</p>
        </div>
        <span class="text-[11px] font-medium px-2 py-0.5 rounded-full ${corStatus[t.status] || ""}">${t.status}</span>
      </div>
      <div class="text-xs text-slate-500 space-y-1">
        ${t.instrutores?.nome ? `<p>👤 ${t.instrutores.nome}</p>` : ""}
        ${t.centros_treinamento?.nome ? `<p>🏫 ${t.centros_treinamento.nome}</p>` : ""}
        <p>🗓️ ${t.data_inicio || "—"}${t.data_fim && t.data_fim !== t.data_inicio ? ` a ${t.data_fim}` : ""}</p>
        ${t.dias_totais ? `<p>📆 ${t.dias_totais} dia(s) de treinamento</p>` : ""}
        ${t.horario ? `<p>⏰ ${t.horario}</p>` : ""}
        ${t.vagas ? `<p>🎟️ ${t.vagas} vaga(s)</p>` : ""}
      </div>
      <div class="flex gap-2 mt-2 pt-2 border-t border-slate-100">
        ${podeAlterar ? `<button data-turma-editar="${t.id}" class="flex-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md py-1.5">✏️ Editar</button>` : ""}
        ${podeExcluir ? `<button data-turma-excluir="${t.id}" class="flex-1 text-xs font-medium text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-md py-1.5">🗑️ Excluir</button>` : ""}
      </div>
    </div>
  `).join("");
  cont.querySelectorAll("[data-turma-editar]").forEach((btn) => btn.addEventListener("click", () => abrirEdicaoTurma(btn.getAttribute("data-turma-editar"))));
  cont.querySelectorAll("[data-turma-excluir]").forEach((btn) => btn.addEventListener("click", () => excluirTurma(btn.getAttribute("data-turma-excluir"))));
}

function abrirNovaTurma() {
  editandoTurmaId = null;
  esconderErro("turma-form-erro");
  const o = listaOrcamentosParaTurma.find((x) => x.id === turmaOrcamentoSelecionadoId);
  $("turma-identificacao").value = letraIndice(turmasDoOrcamento.length);
  preencherSelect("turma-tipo", listaTiposAtivos, "id", (i) => i.nome, "— Selecione —");
  $("turma-tipo").value = (o && o.tipo_treinamento_id) || "";
  preencherSelect("turma-centro", listaCentrosAtivos, "id", (i) => i.nome, "— Selecione —");
  $("turma-centro").value = (o && o.centro_treinamento_id) || "";
  preencherSelect("turma-instrutor", listaInstrutoresAtivos, "id", (i) => i.nome, "— Selecione —");
  $("turma-data-inicio").value = "";
  $("turma-data-fim").value = "";
  $("turma-horario").value = "";
  $("turma-vagas").value = (o && o.qtd_alunos_por_turma) || "";
  $("turma-status").value = "Planejada";
  $("turma-observacoes").value = "";
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
  $("turma-status").value = t.status;
  $("turma-observacoes").value = t.observacoes || "";
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
  const diasTotais = tipo ? (Number(tipo.dias_teoria) || 0) + (Number(tipo.dias_pratica) || 0) + (Number(tipo.dias_teoria_pratica) || 0) : null;

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
  };

  $("btn-salvar-turma").disabled = true;
  $("btn-salvar-turma").textContent = "Salvando…";

  let erro;
  if (editandoTurmaId) {
    ({ error: erro } = await supabase.from("turmas").update(payload).eq("id", editandoTurmaId));
  } else {
    ({ error: erro } = await supabase.from("turmas").insert(payload));
  }

  $("btn-salvar-turma").disabled = false;
  if (erro) {
    $("btn-salvar-turma").textContent = editandoTurmaId ? "Salvar alterações" : "Salvar turma";
    return mostrarErro("turma-form-erro", "Não foi possível salvar. Tente novamente.");
  }

  $("painel-turma").classList.add("hidden");
  await carregarTurmasDoOrcamento();
}

$("btn-salvar-turma").addEventListener("click", salvarTurma);

async function excluirTurma(id) {
  const { error } = await supabase.from("turmas").delete().eq("id", id);
  if (!error) await carregarTurmasDoOrcamento();
}

iniciar();

})();
