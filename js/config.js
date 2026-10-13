/* =====================================================================
   CONFIGURAÇÃO (editar aqui antes de publicar)
   ===================================================================== */
window.CC_CONFIG = {
  gtmId: 'GTM-XXXXXXX',            // ID do container GTM. Enquanto tiver XXXX, o GTM não carrega.
  whatsappNumber: '5584998900718', // DDI + DDD + número, só dígitos
  // Supabase: cada etapa concluída é gravada na tabela lp_forms_leads (via função lp_forms_salvar_lead).
  // Usar a URL do projeto e a chave PÚBLICA (anon / publishable). Nunca colocar a service_role aqui. Vazio = não grava.
  supabaseUrl: 'https://wvuaztlzifukmybtdbfh.supabase.co',
  supabaseAnonKey: 'sb_publishable_NHZVtS8N-M0Dc6OTw0H4PA_eBgGuQyp',
  webhookUrl: '',                 // Endpoint que recebe o lead em JSON a cada etapa (stage: 'partial' ou 'complete', upsert por lead_id). Vazio = não envia.
  video: { type: 'youtube', id: 'Odu25S1tcZc' }, // type: 'youtube' (id do vídeo) ou 'mp4' (id = URL do arquivo)
  funnel: 'chatclean_lp_quiz',
  privacyUrl: 'https://www.chatclean.com.br/politica-de-privacidade'
};
