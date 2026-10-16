import { render } from "preact";
import { App } from "./App.tsx";
import { Demo } from "./Demo.tsx";
import { readParams } from "./params.ts";
import "./styles.css";

const root = document.getElementById("app");
const params = readParams(window.location.search);
if (root) {
  render(
    params.mode === "demo" ? <Demo parentOrigin={params.parentOrigin} /> : <App params={params} />,
    root,
  );
}
