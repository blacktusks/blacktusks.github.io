import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import '@fontsource-variable/antonio';
import '@fontsource-variable/eb-garamond';
import '@fontsource-variable/eb-garamond/wght-italic.css';
import './styles/base.css';
import './styles/screens.css';
import { AuthProvider } from './lib/auth';
import App from './App';
import { watchForUpdates } from './lib/update';
import { splashPass } from './lib/splash';

watchForUpdates();

// The menu and headings are set in Antonio and the reading text in EB Garamond.
// The loading screen waits for both, so no text changes shape after it lifts.
const fonts = (document as any).fonts as FontFaceSet | undefined;
if (fonts?.load) {
  Promise.all([fonts.load('300 24px "Antonio Variable"'), fonts.load('400 18px "EB Garamond Variable"')])
    .catch(() => undefined).then(() => fonts.ready).catch(() => undefined).then(() => splashPass('fonts'));
} else splashPass('fonts');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>,
);
