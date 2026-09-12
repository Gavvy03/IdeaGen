import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const accept = String(req.headers.accept || '').toLowerCase();
  const wantsEventStream = accept.includes('text/event-stream');

  const auth = req.headers.authorization;
  const hasBearerToken = Boolean(auth && auth.startsWith('Bearer '));
  if (!hasBearerToken && wantsEventStream) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const message = 'OPENAI_API_KEY is not configured';
    if (wantsEventStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`data: ${message}\n\n`);
      res.end();
      return;
    }

    res.status(500).json({ error: message });
    return;
  }

  if (wantsEventStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
  }

  try {
    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: 'Come up with a new business idea for AI Agents',
        },
      ],
      stream: false,
    });

    const content =
      completion.choices?.[0]?.message?.content ||
      'No business idea returned by the model.';

    if (wantsEventStream) {
      res.write(`data: ${content}\n\n`);
      res.end();
      return;
    }

    res.status(200).send(content);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown OpenAI error';

    if (wantsEventStream) {
      res.write(`data: Error generating idea: ${message}\n\n`);
      res.end();
      return;
    }

    res.status(500).json({ error: message });
  }
}
