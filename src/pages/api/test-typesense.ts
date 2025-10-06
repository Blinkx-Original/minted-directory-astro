import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  return new Response(
    JSON.stringify({
      service: 'typesense',
      ok: false,
      error: 'Typesense diagnostics not implemented yet.',
      failedStep: 'pending',
      timestamp: new Date().toISOString(),
    }),
    {
      status: 501,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  );
};
