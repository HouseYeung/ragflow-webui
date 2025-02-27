import { NextApiRequest, NextApiResponse } from 'next';
import fetch from 'node-fetch';
import { Transform } from 'stream';
import getRawBody from 'raw-body';

// 定义带有 leftover 的自定义 Transform 接口
interface CustomTransform extends Transform {
  leftover?: string;
}

// 禁用 body 解析，确保流式传输
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body: any = {};
  try {
    // 手动读取并解析请求体
    const raw = await getRawBody(req);
    body = JSON.parse(raw.toString());
  } catch (e) {
    console.error('Error parsing JSON body:', e);
    return res.status(400).json({
      code: -1,
      message: 'Invalid JSON body',
      data: null
    });
  }

  const { user_id, question, session_id, stream } = body;

  if (!user_id) {
    return res.status(400).json({
      code: -1,
      message: 'Missing user_id',
      data: null
    });
  }

  try {
    const url = new URL(`${process.env.API_ENDPOINT}/api/v1/chats/${process.env.API_CHAT_ID}/completions`);
    url.searchParams.append('user_id', user_id);

    console.log('Sending request to:', url.toString());
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      },
      body: JSON.stringify({ user_id, question, session_id, stream })
    });

    console.log('Response status:', response.status);

    // 对于非流式错误响应的处理
    const contentType = response.headers.get('content-type');
    if (!response.ok && contentType?.includes('application/json')) {
      const errorData = await response.json();
      console.error('Error response:', errorData);
      return res.status(response.status).json({
        code: errorData.code || -1,
        message: errorData.message || 'Server error',
        data: null
      });
    }

    // 设置响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
      'Transfer-Encoding': 'chunked'
    });

    // 让客户端尽快收到头，避免底层缓冲
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
    // 避免 TCP 层的 Nagle 算法带来的延迟
    if (res.socket) {
      res.socket.setNoDelay(true);
    }

    // 用 Transform 将原始 chunk 拆行，并加上 `data:`
    const transformStream = new Transform({
      decodeStrings: false,
      transform(this: CustomTransform, chunk, encoding, callback) {
        try {
          // 初始化 leftover 缓存
          if (!this.leftover) this.leftover = '';
          
          // 将本次 chunk 加入 leftover
          this.leftover += chunk.toString();
          
          // 按行分割
          const lines = this.leftover.split('\n');
          // 最后一行可能不完整，保存到下一次
          this.leftover = lines.pop() || '';
          
          // 处理完整的行
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('data:')) {
              this.push(trimmed + '\n\n');
            } else {
              this.push(`data: ${trimmed}\n\n`);
            }
          }
          callback();
        } catch (error) {
          console.error('Transform error:', error);
          callback(error);
        }
      },

      flush(this: CustomTransform, callback) {
        try {
          // 处理最后剩余的数据
          if (this.leftover && this.leftover.trim()) {
            const trimmed = this.leftover.trim();
            if (trimmed.startsWith('data:')) {
              this.push(trimmed + '\n\n');
            } else {
              this.push(`data: ${trimmed}\n\n`);
            }
          }
          callback();
        } catch (error) {
          console.error('Flush error:', error);
          callback(error);
        }
      }
    }) as CustomTransform;

    // 将后端响应的 body -> transformStream -> res
    if (response.body) {
      response.body.pipe(transformStream).pipe(res);

      // 如果客户端断开连接，就销毁流
      req.on('close', () => {
        console.log('Client connection closed');
        transformStream.destroy();
      });
    } else {
      // 如果后端没有 body，直接结束
      res.end();
    }

  } catch (error) {
    console.error('Completions API error:', error);
    return res.status(500).json({
      code: -1,
      message: error instanceof Error ? error.message : 'Internal Server Error',
      data: null
    });
  }
}
