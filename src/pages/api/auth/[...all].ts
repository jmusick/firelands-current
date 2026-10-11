import type { APIRoute } from 'astro';
import { createAuth } from '../../../lib/auth';
import { handleAuthRequest } from '../../../lib/auth-events';

export const ALL: APIRoute = async ({ request }) => handleAuthRequest((req) => createAuth().handler(req), request);
