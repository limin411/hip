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
// Note: on Windows/Linux we keep OS decorations (see TitleBar); this flag only
// tunes inset/background — not frameless chrome.
if (typeof document !== 'undefined') {
  const ua = navigator.platform || navigator.userAgent
  const isMac = /Mac|iPhone|iPad|iPod/i.test(ua)
  const isLinux = !isMac && /Linux/i.test(navigator.userAgent)
  document.documentElement.dataset.platform = isMac ? 'mac' : isLinux ? 'linux' : 'windows'
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
