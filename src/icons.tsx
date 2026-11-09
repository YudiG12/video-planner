// Ícones sempre coloridos (regra do brandbook).
export const YT = ({ w = 18 }: { w?: number }) => (
  <svg width={w} height={(w * 13) / 18} viewBox="0 0 18 13"><rect width="18" height="13" rx="3" fill="#E5322D" /><path d="M7 3.5v6l5-3z" fill="#fff" /></svg>
);
export const IG = ({ s = 14 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 15 15"><rect x="1" y="1" width="13" height="13" rx="4" fill="none" stroke="#C23B5E" strokeWidth="1.6" /><circle cx="7.5" cy="7.5" r="3" fill="none" stroke="#C23B5E" strokeWidth="1.6" /><circle cx="11.1" cy="3.9" r=".9" fill="#C23B5E" /></svg>
);
export const FormatIcon = ({ f }: { f: "longo" | "vertical" }) => (f === "longo" ? <YT /> : <IG />);
const S = (p: { c: string; children: any; s?: number }) => (
  <svg width={p.s ?? 16} height={p.s ?? 16} viewBox="0 0 24 24" fill="none" stroke={p.c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p.children}</svg>
);
export const IKanban = () => <S c="#3767A8"><rect x="3" y="3" width="5" height="18" rx="1" /><rect x="10" y="3" width="5" height="12" rx="1" /><rect x="17" y="3" width="4" height="8" rx="1" /></S>;
export const ICal = ({ c = "#C23B5E" }: { c?: string }) => <S c={c}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></S>;
export const IDeriv = () => <S c="#0E7C86"><circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><circle cx="18" cy="6" r="3" /><path d="M9 6h6M6 9v3a6 6 0 0 0 6 6h3" /></S>;
export const IBulb = ({ c = "#B87A12" }: { c?: string }) => <S c={c}><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" /></S>;
export const IGrid = () => <S c="#5A4BD1" s={14}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></S>;
export const ICam = () => <S c="#B87A12"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></S>;
export const IPen = () => <S c="#5A4BD1"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></S>;
export const ICheck = () => <S c="#2F8A5B"><path d="M5 12l5 5 9-10" /></S>;
export const IX = () => <S c="#B83A31" s={15}><path d="M6 6l12 12M18 6L6 18" /></S>;
export const IExpand = () => <S c="#3767A8" s={15}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></S>;
export const IShorts = () => (
  <svg width="16" height="16" viewBox="0 0 24 24"><path d="M15 2 8 6c-2 1-2.5 3.5-1 5l1.2 1L7 12.7c-2 1.1-2.4 3.7-.8 5.2 1 1 2.6 1.2 3.9.5l7-4c2-1.1 2.5-3.6 1-5.1L17 8.3l1.2-.7c2-1.1 2.4-3.7.8-5.2-1-1-2.6-1.1-4-.4z" fill="#E5322D" /><path d="M10 9v6l5-3z" fill="#fff" /></svg>
);
export const ITikTok = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeLinecap="round"><path d="M14 3v11a3.5 3.5 0 1 1-3.5-3.5" stroke="#0E7C86" strokeWidth="2.4" /><path d="M14 3c.5 2.5 2.5 4.5 5 5" stroke="#C23B5E" strokeWidth="2.4" /></svg>
);
export const ILinkedIn = () => (
  <svg width="16" height="16" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#0A66C2" /><path d="M7 10v7M7 7v.01M11 17v-4a2 2 0 0 1 4 0v4M11 10v7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></svg>
);
export const IJournal = () => <S c="#B87A12"><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z" /><path d="M8 9h8M8 13h6" /></S>;
