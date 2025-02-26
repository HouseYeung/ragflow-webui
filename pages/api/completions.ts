import { NextApiRequest, NextApiResponse } from 'next';
import fetch from 'node-fetch';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const response = await fetch(
      `${process.env.API_ENDPOINT}/api/v1/chats/${process.env.API_CHAT_ID}/completions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        },
        body: JSON.stringify(req.body)
      }
    );

    // 转发流式响应
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    response.body.pipe(res);

    req.on('close', () => {
      response.body.destroy();
    });
  } catch (error) {
    console.error('Completions API error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
} 