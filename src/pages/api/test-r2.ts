import type { APIRoute } from 'astro';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { performance } from 'node:perf_hooks';

import { getR2Bucket, getR2Client } from '../../lib/r2';

interface StepResult {
  name: 'list' | 'put' | 'get' | 'del';
  ok: boolean;
  ms: number;
  error?: string;
}

const MAX_KEY_LENGTH = 64;

function createDiagKey(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `diag/ping-${timestamp}.json`;
  return key.length > MAX_KEY_LENGTH ? `diag/ping-${Date.now()}.json` : key;
}

function createFailureResponse(step: StepResult['name'], error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const body = JSON.stringify({
    service: 'r2',
    ok: false,
    error: message,
    failedStep: step,
    timestamp: new Date().toISOString(),
  });

  return new Response(body, {
    status: 500,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function streamToString(body: unknown): Promise<string> {
  if (typeof body === 'string') {
    return body;
  }

  if (body && typeof (body as any).transformToString === 'function') {
    return (body as any).transformToString();
  }

  const chunks: Uint8Array[] = [];
  const readable = body as NodeJS.ReadableStream;

  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

export const GET: APIRoute = async () => {
  const client = getR2Client();
  const bucket = getR2Bucket();
  const steps: StepResult[] = [];
  const key = createDiagKey();
  let objectCreated = false;

  const runStep = async (
    name: StepResult['name'],
    operation: () => Promise<void>,
  ): Promise<void> => {
    const start = performance.now();
    try {
      await operation();
      steps.push({ name, ok: true, ms: Math.round(performance.now() - start) });
    } catch (error) {
      const elapsed = Math.round(performance.now() - start);
      steps.push({ name, ok: false, ms: elapsed, error: error instanceof Error ? error.message : 'Unknown error' });
      throw { step: name, error };
    }
  };

  try {
    await runStep('list', async () => {
      await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: 'diag/',
          MaxKeys: 1,
        }),
      );
    });

    const diagBody = JSON.stringify({ ok: true, t: new Date().toISOString() });

    await runStep('put', async () => {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: diagBody,
          ContentType: 'application/json',
        }),
      );
      objectCreated = true;
    });

    await runStep('get', async () => {
      const getResult = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
      const bodyStream = (getResult as { Body?: unknown }).Body;
      if (!bodyStream) {
        throw new Error('Empty response body');
      }
      const body = await streamToString(bodyStream);
      JSON.parse(body);
    });

    await runStep('del', async () => {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
    });

    const totalMs = steps.reduce((sum, step) => sum + step.ms, 0);
    const bodyJson = JSON.stringify({
      service: 'r2',
      ok: true,
      steps,
      totalMs,
      timestamp: new Date().toISOString(),
    });

    return new Response(bodyJson, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (caught) {
    if (objectCreated) {
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        );
      } catch {
        // ignore cleanup failures
      }
    }
    const step = (caught as { step?: StepResult['name'] }).step ?? 'list';
    const error = (caught as { error?: unknown }).error ?? caught;
    return createFailureResponse(step, error);
  }
};
