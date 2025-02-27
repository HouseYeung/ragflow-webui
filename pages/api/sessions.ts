import { NextApiRequest, NextApiResponse } from 'next';
import fetch from 'node-fetch';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method, query, body } = req;

  try {
    let url = `${process.env.API_ENDPOINT}/api/v1/chats/${process.env.API_CHAT_ID}/sessions`;
    let options: any = {
      method,
      headers: {
        'Authorization': `Bearer ${process.env.API_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    // 处理不同的HTTP方法
    switch (method) {
      case 'GET':
        url += `?page=1&page_size=30&user_id=${query.user_id || ''}`;
        break;
      case 'POST':
        options.body = JSON.stringify({
          ...body,
          user_id: body.user_id || query.user_id
        });
        break;
      case 'PUT':
        const { id, user_id, ...updateData } = body;
        url += `/${id}?user_id=${user_id || query.user_id || ''}`;
        options.body = JSON.stringify(updateData);
        break;
      case 'DELETE':
        options.body = JSON.stringify({ ids: body.ids });
        break;
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const response = await fetch(url, options);
    const data = await response.json();
    
    // 处理服务器返回的错误
    if (!response.ok) {
      console.error('Server error:', data);
      return res.status(response.status).json({
        code: data.code || -1,
        message: data.message || 'Server error',
        data: null
      });
    }

    // 确保返回格式一致
    return res.status(200).json({
      code: data.code || 0,
      message: data.message || 'Success',
      data: data.data || []
    });
  } catch (error) {
    console.error('Sessions API error:', error);
    return res.status(500).json({
      code: -1,
      message: error instanceof Error ? error.message : 'Internal Server Error',
      data: null
    });
  }
} 