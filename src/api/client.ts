import type { AppType } from '@/api/router';
import { hc } from 'hono/client';

export const client = hc<AppType>('/');