import { NextRequest } from 'next/server';

export const runtime = 'edge';

// 构建完整的 API URL
function buildApiUrl(tunnelUrl: string, path: string, searchParams?: URLSearchParams) {
  const url = new URL(`${tunnelUrl}/api/v1/chats/${process.env.API_CHAT_ID}${path}`);
  if (searchParams) {
    searchParams.forEach((value, key) => {
      url.searchParams.append(key, value);
    });
  }
  return url.toString();
}

// 通用的请求处理函数
async function handleRequest(req: NextRequest, method: string) {
  try {
    const tunnelUrl = process.env.TUNNEL_ENDPOINT;
    if (!tunnelUrl) {
      throw new Error('TUNNEL_ENDPOINT not set');
    }

    let url: string;
    let body: string | null = null;
    
    if (method === 'GET') {
      const { searchParams } = new URL(req.url);
      url = buildApiUrl(tunnelUrl, '/sessions', searchParams);
    } else if (method === 'PUT') {
      // PUT 请求需要特殊处理，使用 PATCH 方法
      const data = await req.json();
      url = buildApiUrl(tunnelUrl, `/sessions/${data.id}`);
      body = JSON.stringify({
        name: data.name,
        user_id: data.user_id
      });
      method = 'PATCH'; // 改用 PATCH 方法
    } else {
      url = buildApiUrl(tunnelUrl, '/sessions');
      if (method !== 'GET') {
        body = await req.text();
      }
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.API_KEY || ''}`,
      },
      ...(body ? { body } : {}),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
      },
    });

  } catch (err: any) {
    console.error(`[Edge Function Error - ${method}]:`, err);
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

export async function GET(req: NextRequest) {
  return handleRequest(req, 'GET');
}

export async function POST(req: NextRequest) {
  return handleRequest(req, 'POST');
}

export async function PUT(req: NextRequest) {
  return handleRequest(req, 'PUT');
}

export async function PATCH(req: NextRequest) {
  return handleRequest(req, 'PATCH');
}

export async function DELETE(req: NextRequest) {
  return handleRequest(req, 'DELETE');
} 