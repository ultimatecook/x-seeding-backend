import { StrictMode } from 'react';
import { HydratedRouter } from 'react-router/dom';
import { hydrateRoot } from 'react-dom/client';

// React 18.3.x logs #418/#423 to console BEFORE calling onRecoverableError,
// so we also patch console.error to suppress the noise from Shopify App Bridge
// postMessage hydration mismatches. This is purely cosmetic — the app recovers fine.
const _origConsoleError = console.error.bind(console);
console.error = (...args) => {
  const msg = args[0] != null ? String(args[0]) : '';
  if (
    msg.includes('Minified React error #418') ||
    msg.includes('Minified React error #423') ||
    msg.includes('postMessage')
  ) return;
  _origConsoleError(...args);
};

hydrateRoot(
  document,
  <StrictMode>
    <HydratedRouter />
  </StrictMode>,
  {
    onRecoverableError(error) {
      const msg = error?.message ?? String(error);
      if (
        msg.includes('postMessage') ||
        msg.includes('Minified React error #418') ||
        msg.includes('Minified React error #423')
      ) {
        return;
      }
      _origConsoleError('[hydration]', error);
    },
  }
);
