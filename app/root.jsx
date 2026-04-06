import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

export default function App() {
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
          html, body { margin: 0; padding: 0; background: #1C1917; color: #F0EAE0; font-family: system-ui, sans-serif; }
          input::placeholder, textarea::placeholder { color: #5C5650; }
          input:focus, textarea:focus, select:focus { outline: 2px solid #D97757; outline-offset: 1px; }
          ::-webkit-scrollbar { width: 6px; height: 6px; }
          ::-webkit-scrollbar-track { background: #1C1917; }
          ::-webkit-scrollbar-thumb { background: #3A3630; border-radius: 3px; }
          option { background: #252219; color: #F0EAE0; }
        `}</style>
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
