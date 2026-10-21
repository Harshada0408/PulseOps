import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';
import { env } from '../config/env';

export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      transport: WebSocket as unknown as WebSocketLikeConstructor,
    },
  }
);

export const supabaseAdmin = supabase;
