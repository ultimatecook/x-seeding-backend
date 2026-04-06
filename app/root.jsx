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
          html, body { margin: 0; padding: 0; background: #F6F6F7; color: #1A1A1A; font-family: system-ui, sans-serif; }
          input::placeholder, textarea::placeholder { color: #9CA3AF; }
          input:focus, textarea:focus, select:focus { outline: 2px solid #D97757; outline-offset: 1px; }
          ::-webkit-scrollbar { width: 6px; height: 6px; }
          ::-webkit-scrollbar-track { background: #F6F6F7; }
          ::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 3px; }
          option { background: #fff; color: #1A1A1A; }
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
