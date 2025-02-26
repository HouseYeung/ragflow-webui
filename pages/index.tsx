import React, { useEffect, useState, useRef } from 'react';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import FullAnswerDisplay from '../components/FullAnswerDisplay';

// ====================== TTS 配置及辅助函数 ======================

const TTS_APPID = process.env.NEXT_PUBLIC_TTS_APPID;
const TTS_APISecret = process.env.NEXT_PUBLIC_TTS_API_SECRET;
const TTS_APIKey = process.env.NEXT_PUBLIC_TTS_API_KEY;
const TTS_res_id = process.env.NEXT_PUBLIC_TTS_RES_ID;
const API_BASE = process.env.NEXT_PUBLIC_API_BASE;
const CHAT_ID = process.env.NEXT_PUBLIC_CHAT_ID;
const API_KEY = process.env.NEXT_PUBLIC_API_KEY;

// 接口地址，注意需使用 wss:// 协议
const TTS_WS_URL = 'wss://cn-huabei-1.xf-yun.com/v1/private/voice_clone';

// 清洗文本的函数，移除不需要朗读的标记和格式
function cleanTextForTTS(text: string): string {
  return text
    .replace(/##\d+\$\$/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/([。，！？；：、])\1+/g, '$1')
    .trim();
}

// 根据官方鉴权说明生成带鉴权参数的 WebSocket URL
async function getTTSWebSocketUrl(): Promise<string> {
  const date = new Date().toUTCString();
  const host = 'cn-huabei-1.xf-yun.com';
  const path = '/v1/private/voice_clone';
  const requestLine = `GET ${path} HTTP/1.1`;
  const tmp = `host: ${host}\ndate: ${date}\n${requestLine}`;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(TTS_APISecret);
  const data = encoder.encode(tmp);

  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await window.crypto.subtle.sign('HMAC', cryptoKey, data);
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

  const authOrigin = `api_key="${TTS_APIKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const finalAuthorization = btoa(authOrigin);

  const url = `${TTS_WS_URL}?authorization=${encodeURIComponent(finalAuthorization)}&date=${encodeURIComponent(date)}&host=${encodeURIComponent(host)}`;
  return url;
}

// 构造 TTS 请求的 JSON 数据
function buildTTSRequestPayload(text: string) {
  const cleanedText = cleanTextForTTS(text);
  const textBase64 = btoa(unescape(encodeURIComponent(cleanedText)));
  return {
    header: {
      app_id: TTS_APPID,
      status: 2,
      res_id: TTS_res_id
    },
    parameter: {
      tts: {
        vcn: 'x5_clone',
        LanguageID: 0,
        volume: 50,
        speed: 50,
        pitch: 50,
        bgs: 0,
        reg: 0,
        rdn: 0,
        audio: {
          encoding: 'lame',
          sample_rate: 16000
        }
      }
    },
    payload: {
      text: {
        encoding: 'utf8',
        compress: 'raw',
        format: 'plain',
        status: 2,
        seq: 0,
        text: textBase64
      }
    }
  };
}

// ====================== 类型定义 ======================

interface ChatSession {
  id: string;
  name: string;
  create_time: number;
  update_time: number;
  messages: {
    role: 'user' | 'assistant';
    content: string;
    reference?: ReferenceType;
  }[];
}

interface ReferenceType {
  chunks: {
    id: string;
    document_name: string;
    content: string;
    similarity?: number;
  }[];
}

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  editing?: boolean;
  streaming?: boolean;
  edited?: boolean;
  reference?: ReferenceType;
}

const isClient = typeof window !== 'undefined';

// ====================== 主页面组件 ======================

const HomePage: React.FC = () => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [inputValue, setInputValue] = useState<string>('');

  useEffect(() => {
    fetchSessions();
  }, []);

  async function fetchSessions() {
    try {
      if (!API_BASE || !CHAT_ID || !API_KEY) {
        console.error('API configuration is missing');
        return;
      }

      const url = `${API_BASE}/api/v1/chats/${CHAT_ID}/sessions?page=1&page_size=30`;
      
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${API_KEY}` }
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      const result = await res.json();
      if (result.code === 0) {
        setSessions(result.data || []);
      } else {
        console.error('fetchSessions failed:', result);
      }
    } catch (e) {
      console.error('fetchSessions error:', e);
    }
  }

  async function createSession(firstUserQuestion: string) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/chats/${CHAT_ID}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({ name: '新对话' })
      });
      const json = await res.json();
      if (json.code === 0) {
        const sessionId = json.data.id;
        setSelectedSessionId(sessionId);

        const serverMsgs = json.data.messages || [];
        const localMsgs = serverMsgs.map((m: any, i: number) => ({
          id: `${sessionId}-${i}`,
          role: m.role,
          content: m.content
        }));
        setMessages(localMsgs);

        if (firstUserQuestion.trim()) {
          await sendMessage(firstUserQuestion, sessionId);
          const newName = firstUserQuestion.trim().slice(0, 20) + (firstUserQuestion.trim().length > 20 ? '...' : '');
          await updateSessionName(sessionId, newName);
          setSessions(prev =>
            prev.map(s => (s.id === sessionId ? { ...s, name: newName } : s))
          );
        }
        await fetchSessions();
      } else {
        console.error('createSession failed:', json);
      }
    } catch (err) {
      console.error('createSession error:', err);
    }
  }

  function handleSelectSession(session: ChatSession) {
    setSelectedSessionId(session.id);
    if (isClient) {
      const storedMessages = localStorage.getItem(`messages_${session.id}`);
      if (storedMessages) {
        setMessages(JSON.parse(storedMessages));
      } else {
        const localMsgs = session.messages.map((m, i) => ({
          id: `${session.id}-${i}`,
          role: m.role,
          content: m.content,
          reference: m.reference
        }));
        setMessages(localMsgs);
        localStorage.setItem(`messages_${session.id}`, JSON.stringify(localMsgs));
      }
    }
  }

  async function deleteSession(sessionId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/chats/${CHAT_ID}/sessions`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({ ids: [sessionId] })
      });
      const json = await res.json();
      if (json.code === 0) {
        await fetchSessions();
        if (sessionId === selectedSessionId) {
          setSelectedSessionId('');
          setMessages([]);
        }
      } else {
        console.error('deleteSession failed:', json);
      }
    } catch (err) {
      console.error('deleteSession error:', err);
    }
  }

  async function updateSessionName(sessionId: string, newName: string) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/chats/${CHAT_ID}/sessions/${sessionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({ name: newName })
      });
      const json = await res.json();
      if (json.code !== 0) {
        console.error('updateSessionName failed:', json);
      }
    } catch (err) {
      console.error('updateSessionName error:', err);
    }
  }

  async function sendMessage(question: string, sessionId?: string) {
    if (!sessionId && !selectedSessionId) {
      await createSession(question);
      return;
    }
    const activeSessionId = sessionId || selectedSessionId;
    if (!activeSessionId) return;
    if (!question.trim()) {
      alert('问题不能为空');
      return;
    }

    const currentSession = sessions.find(s => s.id === activeSessionId);
    if (currentSession && currentSession.name === '新对话') {
      const newName = question.trim().slice(0, 20) + (question.trim().length > 20 ? '...' : '');
      await updateSessionName(activeSessionId, newName);
      setSessions(prev =>
        prev.map(s => (s.id === activeSessionId ? { ...s, name: newName } : s))
      );
    }

    const userMsg: LocalMessage = { id: `user-${Date.now()}`, role: 'user', content: question };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');

    const tempAI: LocalMessage = { id: `assistant-${Date.now() + 1}`, role: 'assistant', content: '', streaming: true };
    setMessages(prev => [...prev, tempAI]);

    try {
      const response = await fetch(`${API_BASE}/api/v1/chats/${CHAT_ID}/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        },
        body: JSON.stringify({ question, stream: true, session_id: activeSessionId })
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body available');

      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice('data:'.length);
            if (!jsonStr) continue;
            try {
              const data = JSON.parse(jsonStr);
              if (data.code === 0) {
                if (data.data === true) continue;
                if (data.data && typeof data.data.answer === 'string') {
                  const answerText = data.data.answer;
                  const referenceObj = data.data.reference || {};
                  setMessages(prev => {
                    const newMessages = prev.map((m, i) => {
                      if (i === prev.length - 1 && m.streaming) {
                        return { ...m, content: answerText, reference: referenceObj, streaming: true };
                      }
                      return m;
                    });
                    if (isClient) {
                      localStorage.setItem(`messages_${activeSessionId}`, JSON.stringify(newMessages));
                    }
                    return newMessages;
                  });
                }
              } else {
                console.error('Stream error:', data);
                throw new Error(data.message || '流式错误');
              }
            } catch (err) {
              if (trimmed !== '') {
                console.error('解析流数据出错:', err, 'Line:', trimmed);
              }
            }
          }
        }
      } catch (err) {
        console.error('读取流数据出错:', err);
        throw err;
      } finally {
        setMessages(prev => {
          const newMessages = prev.map((m, i) => {
            if (i === prev.length - 1 && m.streaming) return { ...m, streaming: false };
            return m;
          });
          if (isClient) {
            localStorage.setItem(`messages_${activeSessionId}`, JSON.stringify(newMessages));
          }
          return newMessages;
        });
        reader.releaseLock();
      }
    } catch (err) {
      console.error('请求出错:', err);
      setMessages(prev => {
        const newMessages = prev.filter(m => !m.streaming);
        if (isClient) {
          localStorage.setItem(`messages_${activeSessionId}`, JSON.stringify(newMessages));
        }
        return newMessages;
      });
    }
  }

  function handleEditMessage(msgId: string) {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, editing: true } : m));
  }

  function handleSaveEditedMessage(msgId: string, newContent: string) {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: newContent, editing: false, edited: true } : m));
  }

  async function handleRefreshFrom(msgId: string) {
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx === -1) return;
    const userMsg = messages[idx];
    if (userMsg.role !== 'user') return;
    setMessages(prev => prev.slice(0, idx));
    await sendMessage(userMsg.content);
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* 左侧会话列表 */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <button
            className="btn btn-primary w-full flex items-center justify-center space-x-2"
            onClick={async () => { setSelectedSessionId(''); setMessages([]); await createSession(''); }}
          >
            <PlusIcon className="w-5 h-5" />
            <span>新对话</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {sessions.map(s => (
            <div
              key={s.id}
              className={`p-3 rounded-lg transition-colors duration-200 cursor-pointer ${s.id === selectedSessionId ? 'bg-blue-100 border-blue-300' : 'hover:bg-gray-100'}`}
              onClick={() => handleSelectSession(s)}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium truncate flex-1">{s.name}</div>
                <button className="p-1 hover:bg-gray-200 rounded" onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}>
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* 右侧对话窗口 */}
      <div className="flex-1 flex flex-col bg-white">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg p-4 ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'} relative group`}>
                {msg.role === 'user' && (
                  <div className="absolute -top-8 right-0 flex space-x-1 bg-white rounded-md shadow p-1">
                    <button className="p-1 hover:bg-gray-100 rounded text-gray-600" onClick={() => handleEditMessage(msg.id)}>
                      <PencilIcon className="w-4 h-4" />
                    </button>
                    {msg.edited && (
                      <button className="p-1 hover:bg-gray-100 rounded text-gray-600" onClick={() => handleRefreshFrom(msg.id)}>
                        <ArrowPathIcon className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
                {!msg.editing ? (
                  <div>
                    {msg.role === 'assistant' ? (
                      <div>
                        <FullAnswerDisplay response={{ code: 0, data: { answer: msg.content, reference: msg.reference || { chunks: [] } } }} />
                        <TTSAudioPlayer text={msg.content} />
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    )}
                  </div>
                ) : (
                  <EditMessageForm
                    originalContent={msg.content}
                    onSave={(newContent: string) => handleSaveEditedMessage(msg.id, newContent)}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
        {/* 底部输入框 */}
        <div className="border-t border-gray-200 p-4">
          <div className="max-w-4xl mx-auto flex space-x-2">
            <textarea
              className="flex-1 border border-gray-300 rounded p-2"
              rows={3}
              placeholder="请输入你的问题..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(inputValue); } }}
            />
            <button className="bg-blue-600 text-white px-4 py-2 rounded" onClick={() => sendMessage(inputValue)}>
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// 编辑消息表单组件
const EditMessageForm: React.FC<{ originalContent: string; onSave: (newContent: string) => void; }> = ({ originalContent, onSave }) => {
  const [value, setValue] = useState(originalContent);
  return (
    <div className="flex flex-col space-y-2">
      <textarea
        className="border border-gray-300 rounded p-2 min-h-[100px] text-gray-800 bg-white"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(value); }
          if (e.key === 'Escape') { onSave(originalContent); }
        }}
      />
      <div className="flex space-x-2">
        <button className="bg-blue-600 text-white px-3 py-1 rounded" onClick={() => onSave(value)}>保存</button>
        <button className="bg-gray-300 text-gray-700 px-3 py-1 rounded" onClick={() => onSave(originalContent)}>取消</button>
      </div>
    </div>
  );
};

// TTS 播放组件
const TTSAudioPlayer: React.FC<{ text: string }> = ({ text }) => {
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const processTTSMessage = (textData: string, ws: WebSocket, audioData: Uint8Array[]) => {
    try {
      const msg = JSON.parse(textData);
      if (msg.header.code !== 0) {
        console.error('TTS error:', msg.header);
        return;
      }
      const audioBase64 = msg?.payload?.audio?.audio;
      if (audioBase64) {
        const raw = window.atob(audioBase64);
        const u8arr = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
          u8arr[i] = raw.charCodeAt(i);
        }
        audioData.push(u8arr);
      }
      if (msg.header.status === 2) {
        const blob = new Blob(audioData, { type: 'audio/mpeg' });
        const finalUrl = URL.createObjectURL(blob);
        setAudioUrl(finalUrl);
        audioRef.current = new Audio(finalUrl);
        audioRef.current.addEventListener('ended', () => setIsPlaying(false));
        audioRef.current.play().catch(err => console.error('Audio play error:', err));
        setIsPlaying(true);
        ws.close();
      }
    } catch (err) {
      console.error('TTS message parsing error:', err, 'data:', textData);
    }
  };

  const handlePlay = async () => {
    if (audioUrl) {
      if (!audioRef.current) {
        audioRef.current = new Audio(audioUrl);
        audioRef.current.addEventListener('ended', () => setIsPlaying(false));
      }
      audioRef.current.play().catch(err => console.error('Audio play error:', err));
      setIsPlaying(true);
      return;
    }
    setLoading(true);
    try {
      const wsUrl = await getTTSWebSocketUrl();
      const ttsReq = buildTTSRequestPayload(text);
      const ws = new WebSocket(wsUrl);
      let audioData: Uint8Array[] = [];
      ws.onopen = () => {
        ws.send(JSON.stringify(ttsReq));
      };
      ws.onmessage = (evt) => {
        if (typeof evt.data === 'string') {
          processTTSMessage(evt.data, ws, audioData);
        } else if (evt.data instanceof Blob) {
          const reader = new FileReader();
          reader.onload = () => {
            processTTSMessage(reader.result as string, ws, audioData);
          };
          reader.readAsText(evt.data);
        } else {
          console.error('Unexpected message data type:', evt.data);
        }
      };
      ws.onerror = (e) => {
        console.error('TTS WebSocket error:', e);
        setLoading(false);
      };
      ws.onclose = () => {
        setLoading(false);
      };
    } catch (err) {
      console.error('TTS request error:', err);
      setLoading(false);
    }
  };

  const handlePause = () => {
    if (audioRef.current) {
      if (!audioRef.current.paused) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play().catch(err => console.error('Audio resume error:', err));
        setIsPlaying(true);
      }
    }
  };

  return (
    <div className="mt-2 flex space-x-2">
      {!audioUrl ? (
        <button
          onClick={handlePlay}
          className="px-3 py-1 bg-green-500 text-white rounded"
          disabled={loading}
        >
          {loading ? '合成中...' : '播放语音'}
        </button>
      ) : (
        <button
          onClick={isPlaying ? handlePause : handlePlay}
          className={`px-3 py-1 ${isPlaying ? 'bg-yellow-500' : 'bg-green-500'} text-white rounded`}
        >
          {isPlaying ? '暂停' : '播放'}
        </button>
      )}
    </div>
  );
};

export default HomePage; 