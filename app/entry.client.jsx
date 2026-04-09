import { StrictMode } from 'react';
import { HydratedRouter } from 'react-router/dom';
import { hydrateRoot } from 'react-dom/client';

hydrateRoot(
  document,
  <StrictMode>
    <HydratedRouter />
  </StrictMode>,
  {
    onRecoverableError(error) {
      // Shopify App Bridge fires postMessage errors during embedded app init
      // that can cause minor hydration mismatches. Suppress them silently
      // rather than crashing the app.
      const msg = error?.message ?? String(error);
      if (
        msg.includes('postMessage') ||
        msg.includes('Minified React error #418') ||
        msg.includes('Minified React error #423')
      ) {
        return; // swallow — App Bridge noise, not a real app error
      }
      console.error('[hydration]', error);
    },
  }
);
