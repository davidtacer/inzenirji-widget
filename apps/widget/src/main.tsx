import { render } from "preact";
import { App } from "./App.tsx";
import { readParams } from "./params.ts";
import "./styles.css";

const root = document.getElementById("app");
if (root) render(<App params={readParams(window.location.search)} />, root);
