import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    // 1. 解析请求体
    const { user_id, question, session_id, stream } = await req.json();
    
    // 2. 构造后端接口请求
    const apiEndpoint = process.env.API_ENDPOINT;
    if (!apiEndpoint) {
      throw new Error('API_ENDPOINT environment variable is not set');
    }

    // 验证 API endpoint 是否是有效的域名（不是 IP 地址）
    try {
      const url = new URL(apiEndpoint);
      if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(url.hostname)) {
        throw new Error('IP addresses are not allowed in Vercel Edge environment');
      }
    } catch (error) {
      throw new Error('Invalid API endpoint configuration');
    }

    const url = new URL(`${apiEndpoint}/api/v1/chats/${process.env.API_CHAT_ID}/completions`);
    url.searchParams.append('user_id', user_id);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
      body: JSON.stringify({
        user_id,
        question,
        session_id,
        stream,
      }),
    });

    // 如果后端报错，且返回 JSON
    if (!response.ok && response.headers.get('content-type')?.includes('application/json')) {
      const errorData = await response.json();
      return new Response(
        JSON.stringify({
          code: errorData.code || -1,
          message: errorData.message || 'Server error',
          data: null,
        }),
        { 
          status: response.status, 
          headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-transform',
          } 
        }
      );
    }

    // 如果没有 body，可直接返回
    if (!response.body) {
      return new Response(
        JSON.stringify({
          code: -1,
          message: 'No response body from upstream',
          data: null,
        }),
        { 
          status: 400,
          headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-transform',
          }
        }
      );
    }

    // 3. 以 ReadableStream 的方式流式转发数据（SSE）
    const encoder = new TextEncoder();
    let leftover = ''; // 用于处理不完整的行

    const readableStream = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();

        async function readChunk() {
          try {
            const { value, done } = await reader.read();
            if (done) {
              // 处理可能剩余的最后一行
              if (leftover.trim()) {
                const finalLine = leftover.trim().startsWith('data:')
                  ? leftover.trim()
                  : `data: ${leftover.trim()}`;
                controller.enqueue(encoder.encode(finalLine + '\n\n'));
              }
              controller.close();
              return;
            }

            // 4. 处理当前 chunk，把它拆分成多行 SSE
            if (value) {
              const textChunk = new TextDecoder().decode(value);
              leftover += textChunk;
              const lines = leftover.split('\n');
              leftover = lines.pop() || ''; // 最后一行可能不完整，留到下次拼接

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                // 如果已经包含 'data:'，直接输出，否则加上 'data:'
                const sseLine = trimmed.startsWith('data:')
                  ? trimmed
                  : `data: ${trimmed}`;
                controller.enqueue(encoder.encode(sseLine + '\n\n'));
              }
            }

            await readChunk();
          } catch (error) {
            console.error('[Stream Error]', error);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  code: -1,
                  message: 'Stream processing error',
                  data: null,
                })}\n\n`
              )
            );
            controller.close();
          }
        }

        // 启动读循环
        await readChunk();
      },
    });

    // 5. 返回给客户端
    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  } catch (err: any) {
    console.error('[Completions Error]', err);
    return new Response(
      JSON.stringify({
        code: -1,
        message: err?.message || 'Internal Server Error',
        data: null,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-transform',
        },
      }
    );
  }
} 