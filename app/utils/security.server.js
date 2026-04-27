const ALLOWED_ORIGINS = new Set([
  'https://www.zeedy.xyz',
    'https://x-seeding-backend.vercel.app',
      'https://admin.shopify.com',
      ]);

      export function isCorsPreFlight(request) {
        return request.method === 'OPTIONS';
        }

        export function applyCors(request, headers) {
          const origin = request.headers.get('Origin');
            if (origin && ALLOWED_ORIGINS.has(origin)) {
                headers.set('Access-Control-Allow-Origin', origin);
                    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
                        headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
                            headers.set('Access-Control-Max-Age', '86400');
                                headers.set('Vary', 'Origin');
                                  }
                                    return headers;
                                    }

                                    export function handlePreflight(request) {
                                      if (!isCorsPreFlight(request)) return null;
                                        const headers = new Headers();
                                          applyCors(request, headers);
                                            return new Response(null, { status: 204, headers });
                                            }

                                            export function withCors(request, response) {
                                              const origin = request.headers.get('Origin');
                                                if (!origin || !ALLOWED_ORIGINS.has(origin)) return response;
                                                  const headers = new Headers(response.headers);
                                                    applyCors(request, headers);
                                                      return new Response(response.body, {
                                                          status: response.status,
                                                              statusText: response.statusText,
                                                                  headers,
                                                                    });
                                                                    }
