import '@wdio/tauri-plugin'
import './i18n'
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Bundled variable fonts (Latin UI / code / mono fallback). Must precede tokens.css
// so font faces are registered before the font-family tokens resolve.
// CJK deliberately stays on system fonts (English-first product; see
// docs/design/doc-international-font-guide).
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/noto-sans-mono'
import "./styles/tokens.css";
import { ThemeProvider } from "./components/theme/ThemeProvider";
import { LanguageProvider } from "./components/theme/LanguageProvider";
import { ToasterHost } from './components/ui/ToasterHost'
import { applyPlatformDataset } from './lib/platform'
import { applyPlatformWindowChrome } from './lib/windowChrome'
import { enableNativeVibrancy } from './lib/windowVibrancy'
import { installScrollReveal } from './lib/scrollReveal'

// data-platform → CSS; Win frameless caption; then native material / solid.
if (typeof document !== 'undefined') {
  applyPlatformDataset()
  installScrollReveal()
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
