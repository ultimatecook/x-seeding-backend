import { Links, Meta, Outlet, Scripts, ScrollRestoration, useMatches } from 'react-router';

export default function App() {
  const matches = useMatches();
  const appLayout = matches.find((m) => m.id === 'routes/app');
  const preferences = appLayout?.data?.preferences ?? {
    highContrast: false,
    reducedMotion: false,
    fontScale: 1,
  };

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link rel="stylesheet" href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css" />
        <Meta />
        <Links />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; background: #F6F6F7; color: #1A1A1A; font-family: system-ui, sans-serif; font-size: calc(16px * var(--font-scale, 1)); }
          input::placeholder, textarea::placeholder { color: #9CA3AF; }
          input:focus, textarea:focus, select:focus { outline: 2px solid #D97757; outline-offset: 1px; }
          .high-contrast { filter: contrast(1.15); }
          .reduced-motion *, .reduced-motion *::before, .reduced-motion *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
          ::-webkit-scrollbar { width: 6px; height: 6px; }
          ::-webkit-scrollbar-track { background: #F6F6F7; }
          ::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 3px; }
          option { background: #fff; color: #1A1A1A; }
        `}</style>
      </head>
      <body>
        <div
          className={`${preferences.highContrast ? 'high-contrast' : ''} ${
            preferences.reducedMotion ? 'reduced-motion' : ''
          }`.trim()}
          style={{ ['--font-scale']: preferences.fontScale ?? 1 }}
        >
          <Outlet />
        </div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
