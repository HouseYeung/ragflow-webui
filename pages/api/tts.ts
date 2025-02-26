import { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text } = req.body;
    
    // 生成鉴权参数
    const date = new Date().toUTCString();
    const host = 'cn-huabei-1.xf-yun.com';
    const path = '/v1/private/voice_clone';
    const requestLine = `GET ${path} HTTP/1.1`;
    const tmp = `host: ${host}\ndate: ${date}\n${requestLine}`;

    // 使用 HMAC-SHA256 生成签名
    const signature = crypto
      .createHmac('sha256', process.env.TTS_API_SECRET || '')
      .update(tmp)
      .digest('base64');

    const authOrigin = `api_key="${process.env.TTS_API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
    const authorization = Buffer.from(authOrigin).toString('base64');

    // 构建 WebSocket URL
    const wsUrl = `wss://${host}${path}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${encodeURIComponent(host)}`;

    // 返回配置信息
    res.status(200).json({
      wsUrl,
      appId: process.env.TTS_APPID,
      resId: process.env.TTS_RES_ID
    });
  } catch (error) {
    console.error('TTS API error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 