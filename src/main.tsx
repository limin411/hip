import '@wdio/tauri-plugin'
import './i18n'
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import { ThemeProvider } from "./components/theme/ThemeProvider";
import { LanguageProvider } from "./components/theme/LanguageProvider";
import { ToasterHost } from './components/ui/ToasterHost'
import { applyPlatformDataset } from './lib/platform'
import { applyPlatformWindowChrome } from './lib/windowChrome'
import { enableNativeVibrancy } from './lib/windowVibrancy'

// data-platform → CSS; Win frameless caption; then native material / solid.
if (typeof document !== 'undefined') {
  applyPlatformDataset()
  void (async () => {
    await applyPlatformWindowChrome()
    await enableNativeVibrancy()
  })()
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <ToasterHost />
        <App />
      </LanguageProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
