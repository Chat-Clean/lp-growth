(function () {
  var CC = window.CC, C = CC.cfg, track = CC.track;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var WHATS = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.8 14.1c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.1-1.9-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5-4.5-.2-.2-1.2-1.6-1.2-3 0-1.4.8-2.1 1-2.4.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .7.5l.9 2.2c.1.2.1.4 0 .6l-.3.6-.5.5c-.2.2-.3.4-.1.7.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.5 1.5.3.1.5.1.7-.1l.8-1c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.6.3.1.1.1.7-.1 1.4Z"/></svg>';
  var FORM_ID = 'quiz_qualificacao';

  $('#year').textContent = new Date().getFullYear();
  $('#privacyLink').href = C.privacyUrl;

  /* ---------------- Debug (?debug=1) ---------------- */
  if (CC.debug) {
    var panel = document.createElement('div');
    panel.className = 'dbg';
    panel.innerHTML = '<b>dataLayer (debug)</b>';
    document.body.appendChild(panel);
    CC.log = function (p) {
      var d = document.createElement('div');
      var rest = Object.assign({}, p); delete rest.event; delete rest.funnel; delete rest.lead_id;
      d.innerHTML = '<b>' + p.event + '</b> ' + JSON.stringify(rest).replace(/</g, '&lt;');
      panel.insertBefore(d, panel.children[1] || null);
    };
  }

  /* ---------------- Etapas ----------------
     Ordem: contato primeiro (WhatsApp, nome, e-mail, todos obrigatórios) e depois qualificação (tamanho, volume, segmento, dor).
     Assim que o WhatsApp é informado o lead já existe como "parcial" e pode ser repescado pela automação.
     O id de cada etapa é também o nome do campo no lead enviado ao webhook. */
  var STEPS = [
    { id: 'whatsapp', type: 'input',
      title: 'Qual é o seu WhatsApp?',
      hint: 'É por ele que o especialista completa o seu diagnóstico.',
      input: { type: 'tel', ac: 'tel-national', mode: 'numeric', ph: '(00) 00000-0000' },
      err: 'Informe um WhatsApp válido com DDD.', consent: true,
      ok: function (v) { var d = v.replace(/\D/g, ''); return (d.length === 10 || d.length === 11) && d[0] !== '0'; } },
    { id: 'nome', type: 'input',
      title: 'Qual é o seu nome?',
      input: { type: 'text', ac: 'name', ph: 'Seu nome' },
      err: 'Informe o seu nome.',
      ok: function (v) { return v.length >= 2; } },
    { id: 'email', type: 'input',
      title: 'Qual é o seu melhor e-mail?',
      input: { type: 'email', ac: 'email', mode: 'email', ph: 'voce@empresa.com.br' },
      err: 'Informe um e-mail válido.',
      ok: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); } },
    { id: 'atendentes', type: 'single',
      title: 'Quantas pessoas atendem clientes na sua empresa hoje?',
      options: [['1', 'Só eu'], ['2-5', '2 a 5'], ['6-10', '6 a 10'], ['11-20', '11 a 20'], ['21+', 'Mais de 20']] },
    { id: 'volume_atendimentos', type: 'single',
      title: 'Em média, quantos atendimentos sua empresa recebe por dia?',
      options: [['ate_50', 'Até 50'], ['50_100', 'De 50 a 100'], ['mais_100', 'Mais de 100'], ['nao_sei', 'Não consigo contar']] },
    { id: 'segmento', type: 'single',
      title: 'Qual é o segmento da sua empresa?',
      options: [['advocacia', 'Escritório de advocacia'], ['industria', 'Indústria'], ['varejo', 'Varejo / loja'],
                ['mercado', 'Mercado / supermercado'], ['saude', 'Clínica / saúde'], ['servicos', 'Serviços'], ['outro', 'Outro']] },
    { id: 'principal_dor', type: 'single',
      title: 'Hoje, qual é a sua principal dor no atendimento?',
      options: [['nao_sei_conversao', 'Não sei quantos leads viram vendas'],
                ['demora_resposta', 'Minha equipe demora para responder'],
                ['sem_acompanhamento', 'Não consigo acompanhar todos os atendimentos'],
                ['falta_organizacao', 'Perco clientes por falta de organização'],
                ['quero_automatizar', 'Quero automatizar parte do atendimento']] }
  ];

  var state = { i: -1, resume: 0, started: false, submitted: false, partialSent: false, leadEventId: '',
                answers: {}, stepStart: 0, formStart: 0, origin: '' };
  var quiz = $('#quiz'), body = $('#quizBody');

  function maskPhone(v) {
    var d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length < 3) return d.length ? '(' + d : '';
    if (d.length < 7) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length < 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  function phoneE164() { return '+55' + (state.answers.whatsapp || '').replace(/\D/g, ''); }
  // Formato do Google (Enhanced Conversions); o mesmo objeto alimenta a Correspondência Avançada do Meta.
  // O hash é feito pelas tags no GTM.
  function userData() {
    var a = state.answers, names = (a.nome || '').split(/\s+/);
    var u = { phone_number: phoneE164(), address: { country: 'BR' } };
    if (a.email) u.email = a.email.toLowerCase();
    if (a.nome) { u.address.first_name = names[0]; if (names.length > 1) u.address.last_name = names.slice(1).join(' '); }
    return u;
  }

  /* ---------------- CTAs ---------------- */
  document.querySelectorAll('[data-cta]').forEach(function (b) {
    b.addEventListener('click', function () {
      track('cta_click', { cta_location: b.dataset.cta, cta_text: b.textContent.trim() });
      openQuiz(b.dataset.cta);
    });
  });

  function openQuiz(origin) {
    quiz.classList.add('open');
    document.body.classList.add('locked');
    pushHist();
    if (!state.started) {
      state.started = true; state.origin = origin; state.formStart = Date.now();
      track('form_start', { form_id: FORM_ID, cta_location: origin, form_resumed: state.resume > 0 });
    }
    go(state.i < 0 ? state.resume : state.i);
  }

  /* ---------------- Navegação ---------------- */
  function go(i, dir) {
    state.i = i; state.stepStart = Date.now();
    var step = STEPS[i];
    $('#stepCount').textContent = i === STEPS.length - 1 ? 'Última pergunta' : 'Etapa ' + (i + 1) + ' de ' + STEPS.length;
    $('#barFill').style.width = ((i + .5) / STEPS.length * 100) + '%';
    $('#backLabel').textContent = i === 0 ? 'Fechar' : 'Voltar';
    body.innerHTML = '';
    body.appendChild(step.type === 'input' ? renderInput(step) : renderQuestion(step));
    quiz.scrollTop = 0;
    track('form_step_view', { form_id: FORM_ID, step_number: i + 1, step_name: step.id, step_direction: dir || 'forward' });
  }

  function stepBack(method) {
    track('form_step_back', { from_step_number: state.i + 1, from_step_name: STEPS[state.i].id, back_method: method });
    go(state.i - 1, 'back');
  }
  function closeQuiz(method) {
    track('form_close', { step_number: 1, step_name: STEPS[0].id, close_method: method });
    quiz.classList.remove('open'); document.body.classList.remove('locked');
  }
  $('#backBtn').addEventListener('click', function () {
    if (state.i > 0) return stepBack('button');
    closeQuiz('button');
    try { history.back(); } catch (e) {} // consome a entrada de histórico criada ao abrir
  });

  // Botão/gesto "voltar" do celular: volta uma etapa em vez de sair da página e perder o lead
  function pushHist() { try { history.pushState({ ccQuiz: true }, ''); } catch (e) {} }
  window.addEventListener('popstate', function () {
    if (!quiz.classList.contains('open') || state.submitted) return;
    if (state.i > 0) { pushHist(); stepBack('browser'); } else closeQuiz('browser');
  });

  function complete(step, value, valueLabel) {
    state.answers[step.id] = value;
    var last = state.i === STEPS.length - 1;
    var p = { form_id: FORM_ID, step_number: state.i + 1, step_name: step.id,
              step_time_seconds: Math.round((Date.now() - state.stepStart) / 1000) };
    // Etapas de digitação não levam o valor neste evento (o WhatsApp é dado pessoal)
    if (step.type !== 'input') { p.step_answer = value; p.step_answer_label = valueLabel; }
    if (step.optional) p.step_skipped = !value;
    track('form_step_complete', p);

    // Lead parcial: dispara uma única vez, no momento em que o WhatsApp é capturado
    if (step.id === 'whatsapp' && !state.partialSent) {
      state.partialSent = true;
      var meta = CC.metaIds();
      track('lead_partial', { form_id: FORM_ID, event_id: CC.uid('partial'), fbp: meta.fbp, fbc: meta.fbc, user_data: userData() });
    }
    if (last) state.leadEventId = CC.uid('lead'); // mesmo ID no Pixel e na API de Conversões para deduplicar

    var lead = saveLead(last ? 'complete' : 'partial', step.id);
    if (last) finish(lead); else go(state.i + 1);
  }

  /* ---------------- Lead: persistência e webhook ----------------
     A cada etapa concluída o lead é reenviado com o mesmo lead_id (o destino deve fazer upsert por lead_id).
     stage = 'partial' enquanto o formulário não terminou, 'complete' na última etapa. */
  function saveLead(stage, lastStep) {
    var a = state.answers, meta = CC.metaIds();
    var lead = {
      lead_id: CC.leadId, stage: stage, last_step: lastStep, steps_total: STEPS.length,
      event_id: state.leadEventId, visitor_id: CC.visitorId, updated_at: new Date().toISOString(),
      whatsapp: phoneE164(), nome: a.nome || '', email: (a.email || '').toLowerCase(), atendentes: a.atendentes || '',
      volume_atendimentos: a.volume_atendimentos || '', segmento: a.segmento || '', principal_dor: a.principal_dor || '',
      attribution: CC.attr.session, first_touch: CC.attr.first,
      fbp: meta.fbp, fbc: meta.fbc, page_url: location.href, user_agent: navigator.userAgent
    };
    CC.sset('sessionStorage', 'cc_lead', JSON.stringify(lead));
    // Supabase: upsert por lead_id. keepalive garante o envio mesmo se a pessoa fechar a página logo em seguida.
    if (C.supabaseUrl && C.supabaseAnonKey) {
      fetch(C.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/lp_forms_salvar_lead', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey },
        body: JSON.stringify({ p_lead: lead })
      })
        .then(function (r) { track('lead_delivery', { delivery_target: 'supabase', lead_stage: stage, last_step: lastStep, delivery_status: r.ok ? 'success' : 'http_' + r.status }); })
        .catch(function () { track('lead_delivery', { delivery_target: 'supabase', lead_stage: stage, last_step: lastStep, delivery_status: 'network_error' }); });
    }
    if (C.webhookUrl) {
      fetch(C.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lead), keepalive: true })
        .then(function (r) { track('lead_delivery', { lead_stage: stage, last_step: lastStep, delivery_status: r.ok ? 'success' : 'http_' + r.status }); })
        .catch(function () { track('lead_delivery', { lead_stage: stage, last_step: lastStep, delivery_status: 'network_error' }); });
    }
    return lead;
  }

  function finish(lead) {
    state.submitted = true;
    // Conversão principal: lead completo
    track('generate_lead', {
      form_id: FORM_ID,
      event_id: lead.event_id,
      lead_stage: 'complete',
      lead_has_email: !!lead.email,
      lead_atendentes: lead.atendentes,
      lead_volume_atendimentos: lead.volume_atendimentos,
      lead_segmento: lead.segmento,
      lead_principal_dor: lead.principal_dor,
      form_time_seconds: Math.round((Date.now() - state.formStart) / 1000),
      cta_location: state.origin,
      fbp: lead.fbp, fbc: lead.fbc,
      user_data: userData()
    });
    // Transição curta antes da tela final (a conversão já foi registrada acima)
    quiz.classList.add('is-done');
    $('#barFill').style.width = '100%';
    body.innerHTML = '<div class="step analyzing"><div class="spinner" aria-hidden="true"></div>' +
      '<h2>Montando o seu diagnóstico</h2><ul>' +
      ['Tamanho da equipe e volume de atendimento', 'Perfil do seu segmento', 'Principal dor da operação']
        .map(function (t) { return '<li>' + CHECK + '<span>' + t + '</span></li>'; }).join('') + '</ul></div>';
    quiz.scrollTop = 0;
    setTimeout(function () { showDone(lead, false); }, 2000);
  }

  /* ---------------- Render: etapa de digitação ---------------- */
  function renderInput(step) {
    var el = document.createElement('form');
    el.className = 'step step-input'; el.noValidate = true;
    var f = step.input;
    el.innerHTML = '<h2><label for="f_' + step.id + '">' + step.title + '</label></h2><p class="hint">' + (step.hint || '') + '</p>' +
      '<div class="field"><input id="f_' + step.id + '" name="' + step.id + '" type="' + f.type + '" autocomplete="' + f.ac + '" placeholder="' + f.ph + '"' +
      (f.mode ? ' inputmode="' + f.mode + '"' : '') + '><div class="err">' + step.err + '</div></div>' +
      '<button class="btn btn-block" type="submit">' + (step.cta || 'Continuar') + ' ' + ARROW + '</button>' +
      (step.optional ? '<button class="link-btn skip" type="button">Pular esta etapa</button>' : '') +
      (step.consent ? '<p class="privacy">Ao continuar, você concorda em receber o contato da ChatClean pelo WhatsApp. <a href="' + C.privacyUrl + '" target="_blank" rel="noopener">Política de Privacidade</a>.</p>' : '');

    var input = el.elements[step.id], wrap = $('.field', el), typed = false;
    if (state.answers[step.id]) { input.value = state.answers[step.id]; wrap.classList.add('valid'); }
    input.addEventListener('input', function () {
      if (step.id === 'whatsapp') input.value = maskPhone(input.value);
      wrap.classList.remove('invalid');
      wrap.classList.toggle('valid', step.ok(input.value.trim()));
      if (!typed) { typed = true; track('form_field_start', { form_id: FORM_ID, field_name: step.id }); }
    });
    if (step.optional) $('.skip', el).addEventListener('click', function () { complete(step, ''); });
    el.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value.trim();
      if (!(step.optional && !v) && !step.ok(v)) {
        wrap.classList.add('invalid');
        track('form_field_error', { form_id: FORM_ID, field_name: step.id, step_number: state.i + 1 });
        input.focus();
        return;
      }
      complete(step, v);
    });
    setTimeout(function () { input.focus(); }, 80);
    return el;
  }

  /* ---------------- Render: etapa de escolha ---------------- */
  function renderQuestion(step) {
    var el = document.createElement('div');
    el.className = 'step';
    var saved = state.answers[step.id];
    el.innerHTML = '<h2>' + step.title + '</h2><p class="hint">' + (step.hint || '') + '</p><div class="opts" role="radiogroup"></div>';
    var box = $('.opts', el);
    step.options.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'opt';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(saved === o[0]));
      b.innerHTML = '<span class="mark">' + CHECK + '</span><span>' + o[1] + '</span>';
      b.addEventListener('click', function () {
        box.querySelectorAll('.opt').forEach(function (x) { x.setAttribute('aria-checked', 'false'); });
        b.setAttribute('aria-checked', 'true');
        if (box.dataset.locked) return; // evita toque duplo durante a transição
        box.dataset.locked = '1';
        setTimeout(function () { complete(step, o[0], o[1]); }, 260);
      });
      box.appendChild(b);
    });
    return el;
  }

  /* ---------------- Análise concluída ---------------- */
  function showDone(lead, restored) {
    quiz.classList.add('open'); document.body.classList.add('locked');
    quiz.classList.add('is-done');
    $('#barFill').style.width = '100%';
    $('#sticky').style.display = 'none';
    var first = lead.nome.split(/\s+/)[0];
    first = first.charAt(0).toUpperCase() + first.slice(1);
    var msg = 'Olá! Acabei de preencher o diagnóstico de atendimento no site da ChatClean.\n\n' +
      'Nome: ' + lead.nome;
    var wa = (C.whatsappLink || 'https://wa.me/' + C.whatsappNumber) + '?text=' + encodeURIComponent(msg);

    body.innerHTML = '<div class="step done">' +
      '<div class="check">' + CHECK + '</div>' +
      '<h2>Recebemos suas respostas, ' + escapeHtml(first) + '</h2>' +
      '<p>Nosso time vai entrar em contato com o seu diagnóstico completo.</p>' +
      '<div class="wa-box"><p>Se preferir, você já pode falar com a gente agora pelo WhatsApp.</p>' +
      '<a class="btn btn-block" id="waBtn" href="' + wa + '" target="_blank" rel="noopener">' + WHATS + 'Falar agora no WhatsApp</a></div>' +
      '<p class="protocol">Protocolo ' + escapeHtml(lead.lead_id) + '</p></div>';
    quiz.scrollTop = 0;

    try { history.replaceState(null, '', '#analise-concluida'); } catch (e) {}
    // Pageview virtual: usar como gatilho de page_view da "página de obrigado" no GA4
    track('virtual_page_view', {
      page_path: location.pathname.replace(/(index\.html)?$/, '').replace(/\/?$/, '/') + 'analise-concluida', page_title: 'Análise concluída',
      page_type: 'thank_you', page_restored: restored
    });

    var shownAt = Date.now(), clicks = 0;
    $('#waBtn').addEventListener('click', function () {
      clicks++;
      track('whatsapp_click', {
        event_id: CC.uid('wa'), click_location: 'thank_you', click_count: clicks,
        lead_segmento: lead.segmento, lead_atendentes: lead.atendentes, lead_principal_dor: lead.principal_dor,
        time_to_click_seconds: Math.round((Date.now() - shownAt) / 1000)
      });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /* ---------------- Retomada na mesma sessão ----------------
     Completo: volta para a tela final sem disparar generate_lead de novo.
     Parcial: reabre o formulário na primeira etapa ainda sem resposta, sem repetir lead_partial. */
  var savedLead = JSON.parse(CC.sget('sessionStorage', 'cc_lead') || 'null');
  if (savedLead && savedLead.stage === 'complete') {
    state.submitted = true; state.started = true; showDone(savedLead, true);
  } else if (savedLead) {
    state.partialSent = true;
    STEPS.forEach(function (s) {
      if (savedLead[s.id]) state.answers[s.id] = s.id === 'whatsapp' ? maskPhone(savedLead.whatsapp.replace(/^\+55/, '')) : savedLead[s.id];
    });
    while (state.resume < STEPS.length - 1 && state.answers[STEPS[state.resume].id]) state.resume++;
  }

  /* ---------------- Abandono ---------------- */
  // Ao sair da página (ou mandar a aba para segundo plano) no meio de uma etapa de digitação, grava o que
  // já foi digitado e é válido. Só vale depois do WhatsApp, que é quando a pessoa já concordou com o contato.
  function flushTyping() {
    if (!quiz.classList.contains('open') || state.submitted || !state.answers.whatsapp) return;
    var step = STEPS[state.i], input = $('.step-input input', body);
    if (!step || step.type !== 'input' || step.id === 'whatsapp' || !input) return;
    var v = input.value.trim();
    if (!v || v === state.answers[step.id] || !step.ok(v)) return;
    state.answers[step.id] = v;
    saveLead('partial', step.id + '_digitando');
  }
  window.addEventListener('pagehide', flushTyping);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushTyping(); });

  var abandonSent = false;
  window.addEventListener('pagehide', function () {
    if (!state.started || state.submitted || abandonSent) return;
    abandonSent = true;
    track('form_abandon', {
      form_id: FORM_ID, step_number: state.i + 1, step_name: STEPS[state.i].id,
      lead_stage: state.partialSent ? 'partial' : 'none',
      form_time_seconds: Math.round((Date.now() - state.formStart) / 1000)
    });
  });

  /* ---------------- Scroll ---------------- */
  var marks = [25, 50, 75, 90], fired = {};
  window.addEventListener('scroll', function () {
    var h = document.documentElement.scrollHeight - window.innerHeight;
    var pct = h > 0 ? window.scrollY / h * 100 : 100;
    marks.forEach(function (m) {
      if (pct >= m && !fired[m]) { fired[m] = true; track('scroll_depth', { scroll_percent: m }); }
    });
    if (!state.submitted) $('#sticky').classList.toggle('show', window.scrollY > 420);
  }, { passive: true });

  /* ---------------- Cards: entrada, brilho do cursor e carrossel (mobile) ---------------- */
  (function () {
    var rail = $('#cards'), nav = $('#cardsNav'), dotsBox = $('#cardsDots');
    var cards = [].slice.call(rail.children), dots = [], active = 0;
    var prev = $('[data-dir="-1"]', nav), next = $('[data-dir="1"]', nav);
    var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Entrada: os cards (e as mini-cenas) só começam quando a seção aparece
    rail.classList.add('js-reveal');
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        if (es[0].isIntersecting) { rail.classList.add('is-in'); io.disconnect(); }
      }, { threshold: .2 });
      io.observe(rail);
    } else rail.classList.add('is-in');

    cards.forEach(function (c, i) {
      c.style.setProperty('--i', i);
      c.addEventListener('pointermove', function (e) {
        var r = c.getBoundingClientRect();
        c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        c.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
      var d = document.createElement('button');
      d.type = 'button'; d.className = 'dot';
      d.setAttribute('aria-label', 'Ir para o card ' + (i + 1) + ' de ' + cards.length);
      d.innerHTML = '<span></span>';
      d.addEventListener('click', function () { goTo(i, 'dot'); });
      dotsBox.appendChild(d); dots.push(d);
    });

    function isCarousel() { return rail.scrollWidth > rail.clientWidth + 4; }
    function goTo(i, method) {
      i = Math.max(0, Math.min(cards.length - 1, i));
      var c = cards[i];
      rail.scrollTo({ left: c.offsetLeft - (rail.clientWidth - c.offsetWidth) / 2, behavior: calm ? 'auto' : 'smooth' });
      if (method) track('cards_carousel', { card_index: i + 1, nav_method: method });
    }
    function sync() {
      var mid = rail.scrollLeft + rail.clientWidth / 2, best = 0, dist = Infinity;
      cards.forEach(function (c, i) {
        var d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
        if (d < dist) { dist = d; best = i; }
      });
      active = best;
      dots.forEach(function (d, i) { d.setAttribute('aria-current', String(i === best)); });
      prev.disabled = best === 0; next.disabled = best === cards.length - 1;
    }
    var ticking = false;
    rail.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; sync(); });
    }, { passive: true });
    window.addEventListener('resize', sync);
    prev.addEventListener('click', function () { goTo(active - 1, 'arrow'); });
    next.addEventListener('click', function () { goTo(active + 1, 'arrow'); });
    sync();

    // Arraste com o mouse (no toque o próprio navegador já arrasta)
    var drag = null;
    rail.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0 || !isCarousel()) return;
      drag = { x: e.clientX, left: rail.scrollLeft };
      rail.classList.add('dragging');
      rail.setPointerCapture(e.pointerId);
    });
    rail.addEventListener('pointermove', function (e) {
      if (drag) rail.scrollLeft = drag.left - (e.clientX - drag.x);
    });
    function endDrag() {
      if (!drag) return;
      drag = null; sync(); goTo(active);
      setTimeout(function () { rail.classList.remove('dragging'); }, 350); // religa o snap depois de assentar
    }
    rail.addEventListener('pointerup', endDrag);
    rail.addEventListener('pointercancel', endDrag);
  })();

  /* ---------------- Vídeo ---------------- */
  var vBox = $('#video'), facade = $('#videoFacade'), vFired = {};
  if (C.video.type === 'youtube' && C.video.id) {
    facade.style.setProperty('--thumb', 'url(https://i.ytimg.com/vi/' + C.video.id + '/hqdefault.jpg)');
  }
  function vTrack(name, extra) {
    track(name, Object.assign({ video_provider: C.video.id ? C.video.type : 'placeholder', video_id: C.video.id || '' }, extra || {}));
  }
  function vProgress(cur, dur) {
    if (!dur) return;
    [25, 50, 75].forEach(function (m) {
      if (cur / dur * 100 >= m && !vFired[m]) { vFired[m] = true; vTrack('video_progress', { video_percent: m, video_current_time: Math.round(cur), video_duration: Math.round(dur) }); }
    });
  }
  facade.addEventListener('click', function () {
    if (!C.video.id) { vTrack('video_start'); return; }
    facade.remove();
    if (C.video.type === 'mp4') {
      var v = document.createElement('video');
      v.src = C.video.id; v.controls = true; v.playsInline = true; v.autoplay = true;
      vBox.appendChild(v);
      v.addEventListener('play', function () { if (!vFired.start) { vFired.start = true; vTrack('video_start', { video_duration: Math.round(v.duration || 0) }); } });
      v.addEventListener('timeupdate', function () { vProgress(v.currentTime, v.duration); });
      v.addEventListener('pause', function () { if (!v.ended) vTrack('video_pause', { video_current_time: Math.round(v.currentTime) }); });
      v.addEventListener('ended', function () { vTrack('video_complete', { video_duration: Math.round(v.duration) }); });
      return;
    }
    var holder = document.createElement('div'); holder.id = 'ytPlayer'; vBox.appendChild(holder);
    var start = function () {
      var timer;
      new YT.Player('ytPlayer', {
        videoId: C.video.id, host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1 },
        events: { onStateChange: function (e) {
          var p = e.target;
          if (e.data === 1) {
            if (!vFired.start) { vFired.start = true; vTrack('video_start', { video_duration: Math.round(p.getDuration()) }); }
            clearInterval(timer);
            timer = setInterval(function () { vProgress(p.getCurrentTime(), p.getDuration()); }, 1000);
          } else { clearInterval(timer); }
          if (e.data === 2) vTrack('video_pause', { video_current_time: Math.round(p.getCurrentTime()) });
          if (e.data === 0) vTrack('video_complete', { video_duration: Math.round(p.getDuration()) });
        } }
      });
    };
    if (window.YT && YT.Player) return start();
    window.onYouTubeIframeAPIReady = start;
    var s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  });
})();
