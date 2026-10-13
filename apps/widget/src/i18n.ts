/**
 * All user-visible strings. Slovenian is the default; English must have exactly the same keys
 * (enforced by the type and by a test).
 */
const sl = {
  title: "Urejevalnik",
  subtitle: "Napišite, kaj želite spremeniti na svoji strani.",
  close: "Zapri",
  invalidSite: "Urejevalnika ni mogoče odpreti: manjka ali je napačna oznaka strani.",
  comingSoon: "Pogovor z urejevalnikom bo na voljo kmalu.",
} as const;

export type MessageKey = keyof typeof sl;
export type Lang = "sl" | "en";

const en: Record<MessageKey, string> = {
  title: "Editor",
  subtitle: "Write what you would like to change on your site.",
  close: "Close",
  invalidSite: "The editor cannot open: the site id is missing or invalid.",
  comingSoon: "Chatting with the editor is coming soon.",
};

export const messages: Record<Lang, Record<MessageKey, string>> = { sl, en };

export function pickLang(value: string | null | undefined): Lang {
  return value?.toLowerCase().startsWith("en") ? "en" : "sl";
}

export function t(lang: Lang, key: MessageKey): string {
  return messages[lang][key];
}
