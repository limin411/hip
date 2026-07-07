import '@wdio/tauri-plugin'
import './i18n'
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import { ThemeProvider } from "./components/theme/ThemeProvider";
import { Toaster } from 'sonner'

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <Toaster richColors position="bottom-right" />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
