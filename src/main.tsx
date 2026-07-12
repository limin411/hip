import '@wdio/tauri-plugin'
import './i18n'
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import { ThemeProvider } from "./components/theme/ThemeProvider";
import { LanguageProvider } from "./components/theme/LanguageProvider";
import { Toaster } from 'sonner'

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <Toaster richColors position="bottom-right" />
        <App />
      </LanguageProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
