// Spike S3: constrained decoding vs free JSON on the local model. Run: pnpm eval:s3
import { stockLibrary } from '@eraserlabs/diagram-templates';
import { stockNormalizers } from '@eraserlabs/diagram-templates/normalizers';
import { createResolver } from '@eraserlabs/resolve';
import { it } from 'vitest';
import names from '../icons/names.json';
import { chat, listModels } from '../src/main/llm';
import { extractJson, toSplit } from '../src/renderer/ai/parse';
import { buildMessages, iconSubset, RESPONSE_SCHEMA } from '../src/renderer/ai/prompt';
import { DEFAULT_SETTINGS, DEFAULT_URLS } from '../src/shared/ipc';

const PROMPT = 'AWS serverless API: API Gateway, Lambda, DynamoDB and S3 inside a VPC';

it('S3 probe', async () => {
  const resolver = await createResolver({ library: stockLibrary, normalizers: stockNormalizers });
  const s = {
    ...DEFAULT_SETTINGS,
    provider: 'lmstudio' as const,
    baseUrl: process.env.DG_LLM_BASE_URL ?? DEFAULT_URLS.lmstudio,
  };
  s.model = process.env.DG_LLM_MODEL ?? (await listModels(s, undefined))[0]!;
  const runs = Number(process.env.RUNS ?? 2);
  const msgs = buildMessages(
    'generate',
    PROMPT,
    { entities: [], connections: [] },
    iconSubset(PROMPT, names),
    (t) => resolver.tagSchema(t),
  );
  for (const mode of (process.env.MODES ?? 'schema').split(',') as ('schema' | 'free')[]) {
    for (let i = 0; i < runs; i++) {
      const t0 = Date.now();
      const text = await chat(
        s,
        undefined,
        { messages: msgs, ...(mode === 'schema' ? { schema: RESPONSE_SCHEMA } : {}) },
        () => {},
        new AbortController().signal,
      );
      const ms = Date.now() - t0;
      let verdict: string;
      try {
        const v = await resolver.validate(toSplit(extractJson(text)));
        verdict = v.ok
          ? `valid (${v.warnings.length} warnings)`
          : `invalid: ${v.errors
              .slice(0, 2)
              .map((e) => e.code)
              .join(',')}`;
      } catch (e) {
        verdict = `parse error: ${(e as Error).message} :: ${text.slice(0, 200)}`;
      }
      process.stderr.write(`S3 ${s.model} ${mode} run${i + 1}: ${ms} ms, ${text.length} chars, ${verdict}\n`);
    }
  }
});
