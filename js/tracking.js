/* =====================================================================
   DATA LAYER: contexto inicial (precisa rodar ANTES do GTM)
   ===================================================================== */
window.dataLayer = window.dataLayer || [];
(function () {
  var C = window.CC_CONFIG;
  var qs = new URLSearchParams(location.search);

  function store(kind) { try { return window[kind]; } catch (e) { return null; } }
  function sget(kind, k) { try { return store(kind).getItem(k); } catch (e) { return null; } }
  function sset(kind, k, v) { try { store(kind).setItem(k, v); } catch (e) {} }
  function cookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Parâmetros de campanha: guarda o primeiro toque (localStorage) e o toque da sessão (sessionStorage)
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
              'fbclid', 'gclid', 'gbraid', 'wbraid', 'ad_id', 'adset_id', 'campaign_id', 'placement'];
  var current = {};
  KEYS.forEach(function (k) { if (qs.get(k)) current[k] = qs.get(k); });

  var session = JSON.parse(sget('sessionStorage', 'cc_attr_session') || 'null');
  if (Object.keys(current).length || !session) {
    session = Object.assign({ landing_page: location.href.split('#')[0], referrer: document.referrer || '' }, current);
    sset('sessionStorage', 'cc_attr_session', JSON.stringify(session));
  }
  var first = JSON.parse(sget('localStorage', 'cc_attr_first') || 'null');
  if (!first) {
    first = Object.assign({ ts: new Date().toISOString() }, session);
    sset('localStorage', 'cc_attr_first', JSON.stringify(first));
  }

  // ID do visitante (persistente) e ID do lead (um por sessão de preenchimento)
  var visitorId = sget('localStorage', 'cc_visitor_id');
  if (!visitorId) { visitorId = uid('v'); sset('localStorage', 'cc_visitor_id', visitorId); }
  var leadId = sget('sessionStorage', 'cc_lead_id');
  if (!leadId) {
    leadId = 'CC-' + Date.now().toString(36).toUpperCase().slice(-5) + Math.random().toString(36).slice(2, 5).toUpperCase();
    sset('sessionStorage', 'cc_lead_id', leadId);
  }

  // Cookies do Meta. Se o _fbc ainda não existe mas veio fbclid, monta no formato oficial.
  function metaIds() {
    var fbp = cookie('_fbp');
    var fbc = cookie('_fbc');
    if (!fbc && session.fbclid) fbc = 'fb.1.' + Date.now() + '.' + session.fbclid;
    return { fbp: fbp, fbc: fbc };
  }

  window.CC = {
    cfg: C, attr: { session: session, first: first }, visitorId: visitorId, leadId: leadId,
    uid: uid, metaIds: metaIds, sget: sget, sset: sset,
    debug: qs.get('debug') === '1',
    // Único ponto de saída para o dataLayer
    track: function (event, params) {
      var payload = Object.assign({ event: event, funnel: C.funnel, lead_id: leadId }, params || {});
      window.dataLayer.push(payload);
      if (window.CC.debug && window.CC.log) window.CC.log(payload);
      return payload;
    }
  };

  window.dataLayer.push({
    event: 'page_context',
    funnel: C.funnel,
    page_type: 'landing_page_quiz',
    lead_id: leadId,
    visitor_id: visitorId,
    utm_source: session.utm_source || '', utm_medium: session.utm_medium || '',
    utm_campaign: session.utm_campaign || '', utm_content: session.utm_content || '',
    utm_term: session.utm_term || '', utm_id: session.utm_id || '',
    fbclid: session.fbclid || '', gclid: session.gclid || '',
    ad_id: session.ad_id || '', adset_id: session.adset_id || '', campaign_id: session.campaign_id || '',
    placement: session.placement || '',
    first_utm_source: first.utm_source || '', first_utm_medium: first.utm_medium || '',
    first_utm_campaign: first.utm_campaign || '',
    referrer: session.referrer || '',
    device_category: window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop'
  });
})();

/* Google Tag Manager */
(function (w, d, s, l, i) {
  if (!i || i.indexOf('XXXX') > -1) return;
  w[l] = w[l] || []; w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
  var f = d.getElementsByTagName(s)[0], j = d.createElement(s);
  j.async = true; j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i;
  f.parentNode.insertBefore(j, f);
})(window, document, 'script', 'dataLayer', window.CC_CONFIG.gtmId);
