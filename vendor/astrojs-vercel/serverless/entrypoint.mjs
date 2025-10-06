import { NodeApp } from 'astro/app/node';

export function createExports(manifest) {
  const app = new NodeApp(manifest);
  return {
    default: async function handler(req, res) {
      const request = NodeApp.createRequest(req);
      const response = await app.render(request);
      await NodeApp.writeResponse(response, res);
    }
  };
}
