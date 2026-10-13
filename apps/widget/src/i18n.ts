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
  checking: "Preverjam prijavo …",
  signingIn: "Prijavljam …",
  loginTitle: "Prijava",
  loginIntro: "Vpišite e-naslov, s katerim urejate to stran. Poslali vam bomo povezavo za prijavo.",
  emailLabel: "E-naslov",
  sendLink: "Pošlji povezavo",
  sending: "Pošiljam …",
  invalidEmail: "Vpišite veljaven e-naslov.",
  linkSentTitle: "Preverite e-pošto",
  linkSent:
    "Če je ta e-naslov vpisan za to stran, smo nanj poslali povezavo za prijavo. Velja 15 minut. Odprite jo na tej napravi.",
  useAnotherEmail: "Uporabi drug e-naslov",
  linkInvalid: "Povezava ni več veljavna ali je bila že uporabljena. Zahtevajte novo.",
  rateLimited: "Preveč poskusov. Poskusite znova čez nekaj časa.",
  networkError: "Povezava s strežnikom ni uspela. Poskusite znova.",
  signedInAs: "Prijavljeni kot",
  logout: "Odjava",
} as const;

export type MessageKey = keyof typeof sl;
export type Lang = "sl" | "en";

const en: Record<MessageKey, string> = {
  title: "Editor",
  subtitle: "Write what you would like to change on your site.",
  close: "Close",
  invalidSite: "The editor cannot open: the site id is missing or invalid.",
  comingSoon: "Chatting with the editor is coming soon.",
  checking: "Checking your login …",
  signingIn: "Signing in …",
  loginTitle: "Sign in",
  loginIntro: "Enter the e-mail address you edit this site with. We will send you a login link.",
  emailLabel: "E-mail",
  sendLink: "Send link",
  sending: "Sending …",
  invalidEmail: "Enter a valid e-mail address.",
  linkSentTitle: "Check your e-mail",
  linkSent:
    "If this address is registered for this site, we have sent it a login link. It is valid for 15 minutes. Open it on this device.",
  useAnotherEmail: "Use another e-mail",
  linkInvalid: "The link is no longer valid or was already used. Request a new one.",
  rateLimited: "Too many attempts. Please try again later.",
  networkError: "Could not reach the server. Please try again.",
  signedInAs: "Signed in as",
  logout: "Sign out",
};

export const messages: Record<Lang, Record<MessageKey, string>> = { sl, en };

export function pickLang(value: string | null | undefined): Lang {
  return value?.toLowerCase().startsWith("en") ? "en" : "sl";
}

export function t(lang: Lang, key: MessageKey): string {
  return messages[lang][key];
}
