/* global fetch, AbortSignal */
import { buildExplanation } from '@pulseops/core';
import { env } from '../config/env';
import { AppError } from '../middleware/error';
import { getIncident, loadIncidentEvidence } from './incidentService';

/**
 * Optional AI investigation assistant.
 *
 *  - It NEVER decides whether an incident exists (the deterministic engine already did).
 *  - It only receives SANITISED evidence: no URL, hostname, headers, bodies, error text or ids -
 *    just rule, thresholds, status codes, latencies, error categories and relative times.
 *  - Provider-neutral: anything implementing AiProvider can be plugged in.
 */
export interface AiProvider {
  readonly name: string;
  complete(system: string, user: string): Promise<string>;
}

export function getAiProvider(): AiProvider | null {
  if (env.AI_PROVIDER === 'openai-compatible' && env.AI_BASE_URL && env.AI_API_KEY && env.AI_MODEL) {
    const base = env.AI_BASE_URL.replace(/\/+$/, '');
    return {
      name: 'openai-compatible',
      async complete(system, user) {
        const res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.AI_API_KEY}` },
          body: JSON.stringify({ model: env.AI_MODEL, temperature: 0.2, max_tokens: 600,
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`AI provider responded with HTTP ${res.status}`);
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const text = data.choices?.[0]?.message?.content;
        if (!text) throw new Error('AI provider returned no content');
        return text.trim();
      },
    };
  }
  return null;
}

export const aiStatus = () => ({ enabled: getAiProvider() !== null, provider: getAiProvider()?.name ?? 'none' });

export async function sanitizedEvidence(userId: string, incidentId: string) {
  const { incident } = await getIncident(userId, incidentId); // enforces ownership
  const evidence = await loadIncidentEvidence(incidentId);
  const t0 = new Date(incident.startedAt).getTime();
  return {
    type: incident.type,
    status: incident.status,
    rule: incident.triggerRule,
    checks: evidence.map((e) => ({
      role: e.role,
      secondsFromIncidentStart: Math.round((e.checkedAt.getTime() - t0) / 1000),
      httpStatus: e.statusCode, latencyMs: e.latencyMs, success: e.success, errorCategory: e.errorCategory,
    })),
  };
}

export async function summarizeIncident(userId: string, incidentId: string) {
  const provider = getAiProvider();
  if (!provider) throw new AppError('The AI assistant is not configured. Core incident detection works without it.', 503);
  const data = await sanitizedEvidence(userId, incidentId);
  const system =
    'You help a developer investigate an API incident. You are given sanitized monitoring evidence. ' +
    'Do not claim to know the root cause. Reply with: 1) a two-sentence summary of what the data shows, ' +
    '2) a prioritized troubleshooting checklist (max 6 items). Label every possible cause as a hypothesis.';
  const text = await provider.complete(system, JSON.stringify(data));
  return {
    label: 'AI-generated hypotheses - not confirmed causes',
    provider: provider.name,
    text,
  };
}

export { buildExplanation };
