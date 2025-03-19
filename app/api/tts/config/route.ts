import { NextRequest } from 'next/server';

export const runtime = 'edge';

// 将字符串转换为 Uint8Array
function stringToUint8Array(str: string) {
  return new TextEncoder().encode(str);
}

// 将 ArrayBuffer 转换为 Base64 字符串
function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// 使用 Web Crypto API 生成 HMAC-SHA256 签名
async function generateHmacSha256(message: string, key: string) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const messageData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    messageData
  );

  return arrayBufferToBase64(signature);
}

export async function GET(req: NextRequest) {
  try {
    // 生成鉴权参数
    const date = new Date().toUTCString();
    const host = 'cn-huabei-1.xf-yun.com';
    const path = '/v1/private/voice_clone';
    const requestLine = `GET ${path} HTTP/1.1`;
    const tmp = `host: ${host}\ndate: ${date}\n${requestLine}`;

    // 使用 Web Crypto API 生成签名
    const signature = await generateHmacSha256(tmp, process.env.NEXT_PUBLIC_TTS_API_SECRET || '');

    const authOrigin = `api_key="${process.env.NEXT_PUBLIC_TTS_API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
    const authorization = btoa(authOrigin);

    // 构建 WebSocket URL
    const wsUrl = `wss://${host}${path}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${encodeURIComponent(host)}`;

    // 返回配置信息
    return new Response(
      JSON.stringify({
        wsUrl,
        appId: process.env.NEXT_PUBLIC_TTS_APPID,
        resId: process.env.NEXT_PUBLIC_TTS_RES_ID
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('TTS API error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );
  }
} 