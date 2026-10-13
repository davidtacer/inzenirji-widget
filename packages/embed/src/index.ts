import { mount } from "./embed.ts";

// Entry point of embed.js: runs once when the client's /uredi page loads the script.
const script = document.currentScript instanceof HTMLScriptElement ? document.currentScript : null;
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => mount(script), { once: true });
} else {
  mount(script);
}
