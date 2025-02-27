import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    // 从请求中获取所有参数
    const body = await req.json();
    
    // 获取隧道域名
    const tunnelUrl = process.env.TUNNEL_ENDPOINT;
    if (!tunnelUrl) {
      throw new Error('TUNNEL_ENDPOINT not set');
    }

    // 发送请求到隧道域名，保持原始路径
    const response = await fetch(`${tunnelUrl}/api/v1/chats/${process.env.API_CHAT_ID}/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.API_KEY || ''}`,
      },
      body: JSON.stringify(body),
    });

    // 如果响应不成功，抛出错误
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }

    // 检查响应是否为流式响应
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('text/event-stream')) {
      // 创建一个新的 ReadableStream
      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          if (!reader) {
            controller.close();
            return;
          }

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                break;
              }
              controller.enqueue(value);
            }
          } catch (error) {
            controller.error(error);
            throw error;
          }
        },
      });

      // 返回流式响应
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // 如果不是流式响应，直接返回 JSON
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