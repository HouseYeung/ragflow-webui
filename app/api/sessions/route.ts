import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  try {
    // 获取查询参数
    const { searchParams } = new URL(req.url);
    const page = searchParams.get('page') || '1';
    const pageSize = searchParams.get('page_size') || '30';
    const userId = searchParams.get('user_id');

    // 获取隧道域名
    const tunnelUrl = process.env.TUNNEL_ENDPOINT;
    if (!tunnelUrl) {
      throw new Error('TUNNEL_ENDPOINT not set');
    }

    // 构建完整的 URL
    const url = new URL(`${tunnelUrl}/api/v1/chats/${process.env.API_CHAT_ID}/sessions`);
    url.searchParams.set('page', page);
    url.searchParams.set('page_size', pageSize);
    if (userId) {
      url.searchParams.set('user_id', userId);
    }

    // 发送请求
    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${process.env.API_KEY || ''}`,
      },
    });

    // 如果响应不成功，抛出错误
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }

    // 返回响应
    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
      },
    });

  } catch (err: any) {
    console.error('[Edge Function Error]:', err);
    return new Response(
      JSON.stringify({ 
        error: err.message || 'Internal Server Error',
        timestamp: new Date().toISOString()
      }),
      { 
        status: err.status || 500,
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );
  }
} 