import '@wdio/tauri-plugin'
import './i18n'
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import { ThemeProvider } from "./components/theme/ThemeProvider";
import { LanguageProvider } from "./components/theme/LanguageProvider";
import { Toaster } from 'sonner'

// Set platform attribute on <html> so CSS can adapt title bar styling
// (macOS needs traffic-light clearance; Windows/Linux don't).
if (typeof document !== 'undefined') {
  const platform = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
    ? 'mac' : 'windows'
  document.documentElement.dataset.platform = platform
}

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
