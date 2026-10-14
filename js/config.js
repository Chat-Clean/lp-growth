/* =====================================================================
   CONFIGURAÇÃO (editar aqui antes de publicar)
   ===================================================================== */
window.CC_CONFIG = {
  gtmId: 'GTM-MWJX4GJ2',           // ID do container GTM. Enquanto tiver XXXX, o GTM não carrega.
  whatsappNumber: '5584998900718', // DDI + DDD + número, só dígitos
  // Link rastreado do Tintim usado no botão "Continuar no WhatsApp". Vazio = usa wa.me com o whatsappNumber.
  whatsappLink: 'https://tintim.link/whatsapp/1d5367b1-6da3-45a2-b951-2e6c5379dc1e/0576e35a-c8c4-405c-9afb-70cbeede7902',
  // Supabase: cada etapa concluída é gravada na tabela lp_forms_leads (via função lp_forms_salvar_lead).
  // Usar a URL do projeto e a chave PÚBLICA (anon / publishable). Nunca colocar a service_role aqui. Vazio = não grava.
  supabaseUrl: 'https://wvuaztlzifukmybtdbfh.supabase.co',
  supabaseAnonKey: 'sb_publishable_NHZVtS8N-M0Dc6OTw0H4PA_eBgGuQyp',
  webhookUrl: '',                 // Endpoint que recebe o lead em JSON a cada etapa (stage: 'partial' ou 'complete', upsert por lead_id). Vazio = não envia.
  video: { type: 'youtube', id: 'Odu25S1tcZc' }, // type: 'youtube' (id do vídeo) ou 'mp4' (id = URL do arquivo)
  funnel: 'chatclean_lp_quiz',
  privacyUrl: 'https://www.chatclean.com.br/politica-de-privacidade'
};
