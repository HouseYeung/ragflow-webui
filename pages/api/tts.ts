import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 这里处理TTS相关的逻辑
    const { text } = req.body;
    
    // 返回TTS所需的配置信息，但不直接暴露密钥
    res.status(200).json({
      wsUrl: 'wss://cn-huabei-1.xf-yun.com/v1/private/voice_clone',
      appId: process.env.TTS_APPID,
      resId: process.env.TTS_RES_ID,
      // 在这里生成签名等安全信息
    });
  } catch (error) {
    console.error('TTS API error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
} 