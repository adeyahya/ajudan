import type { APIRoute } from 'astro';
import router from '@/api/router';

export const ALL: APIRoute = async (ctx) => {
  return router.fetch(ctx.request);
};