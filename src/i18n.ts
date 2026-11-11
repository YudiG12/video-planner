// UI is English by default; LOCALE=pt-BR (Worker secret) switches it to Portuguese.
// Values stored in the DB (status, format) stay in Portuguese; only the display changes.
let locale = "en";
export const setLocale = (l?: string) => { locale = l === "pt-BR" ? "pt-BR" : "en"; };
export const getLocale = () => locale;
const EN: Record<string, string> = {
  "Kanban": "Kanban", "Calendário": "Calendar", "Derivados": "Derivatives", "Ideias": "Ideas",
  "Todos": "All", "Longos": "Long", "Verticais": "Vertical", "+ Novo vídeo": "+ New video", "Novo vídeo": "New video",
  "+ Nova ideia": "+ New idea", "Nova ideia": "New idea",
  "Esse mês": "This month", "Produzindo": "Recording", "Editando": "Editing", "Finalizado": "Published", "Cancelados": "Cancelled",
  "Título + thumbnail · teste A/B": "Title + thumbnail · A/B test", "Cortar título como no YouTube": "Truncate title like YouTube",
  "Este bloco foi alterado em outro lugar": "This block was changed somewhere else", "Versão mais nova": "Newer version",
  "Seu texto continua no editor abaixo.": "Your text is still in the editor below.", "Manter o meu": "Keep mine", "Usar a versão nova": "Use the newer version",
  "PRINCIPAL": "MAIN", "Título…": "Title…", "caracteres": "characters",
  "Descrição das thumbnails": "Thumbnail notes", "O que vai na tela, textos, prints, ideias…": "What goes on screen: text, screenshots, ideas…",
  "Editar thumbnail": "Edit thumbnail", "Enviar imagem": "Upload image", "Remover imagem": "Remove image",
  "Descrição da thumb (texto, ideia ou URL)": "Thumbnail note (text, idea or URL)",
  "1 · Hook": "1 · Hook", "1 · Gancho": "1 · Hook", "2 · Conteúdo": "2 · Content", "3 · Conclusão": "3 · Conclusion",
  "Confirmação": "Confirmation", "Promessa": "Promise", "Curiosidade": "Curiosity", "Pessoalidade": "Personal", "Fala da série": "Series line",
  "Inserção": "Sponsor segment", "Onde entra e o que falar…": "Where it goes and what to say…", "Sua reflexão final…": "Your closing thought…",
  "Escreva…": "Write…", "Digite ou use o + pra inserir blocos": "Type, or use + to insert blocks",
  "Frase da série": "Series line", "Fechamento": "Closing", "Sem capa": "No cover", "Clique pra colar a URL da capa": "Click to paste the cover URL",
  "URL da capa (frame real do vlog)": "Cover URL",
  "Status": "Status", "Publicação": "Publish date", "Série": "Series", "Episódio": "Episode", "Patrocinador": "Sponsor", "Sem publi": "No sponsor",
  "Formato": "Format", "Longo · YouTube": "Long · YouTube", "Vertical": "Vertical", "Onde postar": "Where to post",
  "Histórico": "History", "Você": "You", "Agente": "Agent", "Carregando…": "Loading…",
  "Abrir em tela cheia": "Open full screen", "Fechar": "Close", "Opções": "Options", "Abrir detalhes": "Open details",
  "Apagar ideia": "Delete idea", "Apagar roteiro": "Delete script", "Apagar": "Delete", "Cancelar": "Cancel", "Não dá pra desfazer.": "This can't be undone.",
  "Hoje": "Today", "hoje": "today",
  "Vídeo longo publicado": "Published video", "Publicado": "Published", "Falta": "Missing", "pend.": "left", "ok": "ok",
  "Nenhum vídeo longo finalizado ainda.": "No published videos yet.",
  "2 cortes IG": "2 IG clips", "Shorts": "Shorts", "TikTok": "TikTok", "2 posts LinkedIn": "2 LinkedIn posts", "Journal": "Article", "Reels": "Reels",
  "Título": "Heading", "Subtítulo": "Subheading", "Lista": "List", "Lista numerada": "Numbered list", "Checklist": "Checklist", "Citação": "Quote",
  "Print / imagem": "Screenshot / image", "Vídeo do YouTube": "YouTube video", "Divisor": "Divider", "Inserir bloco": "Insert block",
  "Negrito ⌘B": "Bold ⌘B", "Itálico ⌘I": "Italic ⌘I", "Riscado": "Strikethrough", "Código": "Code", "Link ⌘K": "Link ⌘K",
  "Link do vídeo do YouTube": "YouTube video link", "Link": "Link", "Use um link http:// ou https://": "Use an http:// or https:// link", "Remover": "Remove", "Subir": "Move up", "Recentes": "Recent", "Descer": "Move down",
  "Ver detalhes": "Details", "Editou": "Edited", "Criou": "Created", "Moveu para": "Moved to",
};
export const t = (pt: string) => (locale === "en" ? EN[pt] ?? pt : pt);
export const dateLocale = () => (locale === "en" ? "en-US" : "pt-BR");
export const weekdays = () => (locale === "en" ? ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] : ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"]);
export const tAction = (a: string) => {
  if (locale !== "en") return a;
  let m = /^Mudou o status pra (.+)$/.exec(a); if (m) return `Moved to ${t(m[1])}`;
  if (a === "Criou o vídeo") return "Created";
  m = /^Editou (.+)$/.exec(a); if (m) return `Edited ${m[1]}`;
  return a;
};
