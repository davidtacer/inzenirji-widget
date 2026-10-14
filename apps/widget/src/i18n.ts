/**
 * All user-visible strings. Slovenian is the default; English must have exactly the same keys
 * (enforced by the type and by a test).
 */
const sl = {
  title: "Urejevalnik",
  close: "Zapri",
  invalidSite: "Urejevalnika ni mogoče odpreti: manjka ali je napačna oznaka strani.",
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
  editorIntro:
    "Napišite, kaj želite spremeniti. Na primer: »Bučna juha naj stane 6,50 €« ali »Dodaj obvestilo, da smo 1. novembra zaprti«.",
  messageLabel: "Vaše sporočilo",
  send: "Pošlji",
  working: "Urejam … to lahko traja do minute.",
  you: "Vi",
  editor: "Urejevalnik",
  cost: "Strošek",
  testSite: "Testna stran",
  liveSite: "Prava stran",
  buildPending: "se pripravlja …",
  buildReady: "pripravljena",
  buildFailed: "napaka pri pripravi",
  unpublished: "Neobjavljene spremembe",
  noUnpublished: "Vse spremembe so objavljene.",
  publish: "Objavi v živo",
  confirmPublish: "Da, objavi",
  published: "Objavljeno. Prava stran se osveži v minuti ali dveh.",
  nothingToPublish: "Ni ničesar za objavo.",
  undo: "Razveljavi zadnjo objavo",
  confirmUndo: "Da, razveljavi",
  undone: "Zadnja objava je razveljavljena.",
  nothingToUndo: "Ni objave, ki bi jo lahko razveljavili.",
  discard: "Zavrzi neobjavljeno",
  confirmDiscard: "Da, zavrzi",
  discarded: "Neobjavljene spremembe so zavržene.",
  cancel: "Prekliči",
  noChange: "Ni sprememb.",
  escalated: "Za to nas kontaktirajte.",
  errAgentUnavailable: "Urejevalnik trenutno ne more urejati. Poskusite kasneje.",
  errNotConnected: "Ta stran še ni povezana z urejevalnikom.",
  errConflict: "Testna stran se je medtem spremenila. Pošljite sporočilo znova.",
  errGithub: "Shranjevanje sprememb trenutno ne deluje. Poskusite kasneje.",
} as const;

export type MessageKey = keyof typeof sl;
export type Lang = "sl" | "en";

const en: Record<MessageKey, string> = {
  title: "Editor",
  close: "Close",
  invalidSite: "The editor cannot open: the site id is missing or invalid.",
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
  editorIntro:
    'Write what you would like to change. For example: "Pumpkin soup costs 6.50 €" or "Add a notice that we are closed on 1 November".',
  messageLabel: "Your message",
  send: "Send",
  working: "Editing … this can take up to a minute.",
  you: "You",
  editor: "Editor",
  cost: "Cost",
  testSite: "Test site",
  liveSite: "Live site",
  buildPending: "being prepared …",
  buildReady: "ready",
  buildFailed: "build failed",
  unpublished: "Unpublished changes",
  noUnpublished: "Everything is published.",
  publish: "Publish live",
  confirmPublish: "Yes, publish",
  published: "Published. The live site updates within a minute or two.",
  nothingToPublish: "Nothing to publish.",
  undo: "Undo last publish",
  confirmUndo: "Yes, undo",
  undone: "The last publish was undone.",
  nothingToUndo: "There is no publish to undo.",
  discard: "Discard unpublished",
  confirmDiscard: "Yes, discard",
  discarded: "Unpublished changes discarded.",
  cancel: "Cancel",
  noChange: "No changes.",
  escalated: "Please contact us for this.",
  errAgentUnavailable: "The editor cannot edit right now. Please try again later.",
  errNotConnected: "This site is not connected to the editor yet.",
  errConflict: "The test site changed in the meantime. Please send your message again.",
  errGithub: "Saving changes does not work right now. Please try again later.",
};

export const messages: Record<Lang, Record<MessageKey, string>> = { sl, en };

export function pickLang(value: string | null | undefined): Lang {
  return value?.toLowerCase().startsWith("en") ? "en" : "sl";
}

export function t(lang: Lang, key: MessageKey): string {
  return messages[lang][key];
}
