import React, { useEffect, useState, useRef } from 'react';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ArrowPathIcon,
  Bars3Icon,
  XMarkIcon,
  PaperAirplaneIcon,
  ChatBubbleLeftIcon,
  PlayIcon,
  PauseIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import FullAnswerDisplay from '../components/FullAnswerDisplay';
import { motion, AnimatePresence } from 'framer-motion';

// ====================== 用户ID管理 ======================

function getUserId() {
  if (typeof window === 'undefined') return '';
  
  let userId = localStorage.getItem('user_id');
  if (!userId) {
    // 生成一个随机的用户ID
    userId = 'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('user_id', userId);
  }
  return userId;
}

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
function buildTTSRequestPayload(text: string, config: any) {
  const cleanedText = cleanTextForTTS(text);
  const textBase64 = btoa(unescape(encodeURIComponent(cleanedText)));
  return {
    header: {
      app_id: config.appId,
      status: 2,
      res_id: config.resId
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
  noTTS?: boolean;
}

const isClient = typeof window !== 'undefined';

// ====================== 主页面组件 ======================

const HomePage: React.FC = () => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [inputValue, setInputValue] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [userId] = useState<string>(() => getUserId());

  // 保存选中的会话ID到localStorage
  useEffect(() => {
    if (selectedSessionId && isClient) {
      localStorage.setItem('lastSelectedSessionId', selectedSessionId);
    }
  }, [selectedSessionId]);

  // 初始化时加载会话列表
  useEffect(() => {
    if (userId) {
      fetchSessions();
    }
  }, [userId]);

  // 当会话列表加载完成后，尝试（仅在没有选中会话时）恢复上次选中的会话
  useEffect(() => {
    if (!selectedSessionId && isClient && sessions.length > 0) {
      const lastSessionId = localStorage.getItem('lastSelectedSessionId');
      if (lastSessionId) {
        const session = sessions.find(s => s.id === lastSessionId);
        if (session) {
          handleSelectSession(session);
        }
      }
    }
  }, [sessions, selectedSessionId]);

  async function fetchSessions() {
    try {
      const res = await fetch(`${API_BASE}/sessions?user_id=${userId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const result = await res.json();
      if (result.code === 0) {
        setSessions(result.data || []);
      } else {
        console.error('fetchSessions failed:', result.message);
      }
    } catch (e) {
      console.error('fetchSessions error:', e);
    }
  }

  async function createSession(firstUserQuestion: string) {
    try {
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          name: '新对话',
          user_id: userId
        })
      });
      const json = await res.json();
      if (json.code === 0) {
        const sessionId = json.data.id;
        
        // 设置会话ID并清空消息
        setSelectedSessionId(sessionId);
        
        // 添加欢迎词消息
        const welcomeMsg: LocalMessage = {
          id: `assistant-welcome-${Date.now()}`,
          role: 'assistant',
          content: '你好！我是陈主任，有什么可以帮到你的吗？',
          noTTS: true, // 不显示TTS按钮
        };
        setMessages([welcomeMsg]);
        
        // 立即刷新会话列表
        await fetchSessions();

        // 如果有初始问题，就发送
        if (firstUserQuestion.trim()) {
          // 更新会话名称
          const newName = firstUserQuestion.trim().slice(0, 20) 
            + (firstUserQuestion.trim().length > 20 ? '...' : '');
          await updateSessionName(sessionId, newName);
          setSessions(prev =>
            prev.map(s => (s.id === sessionId ? { ...s, name: newName } : s))
          );

          // 发送第一条消息
          await sendMessage(firstUserQuestion, sessionId);
        }
      } else {
        console.error('createSession failed:', json);
      }
    } catch (error) {
      console.error('创建会话失败:', error);
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
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          ids: [sessionId],
          user_id: userId
        })
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
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          id: sessionId, 
          name: newName,
          user_id: userId
        })
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
    const activeSessionId = sessionId || selectedSessionId;
    if (!activeSessionId) {
      await createSession(question);
      return;
    }
    if (!question.trim()) {
      alert('问题不能为空');
      return;
    }

    // 如果是新对话，还叫"新对话"，则用用户输入更新一下标题
    const currentSession = sessions.find(s => s.id === activeSessionId);
    if (currentSession && currentSession.name === '新对话') {
      const newName = question.trim().slice(0, 20) + (question.trim().length > 20 ? '...' : '');
      await updateSessionName(activeSessionId, newName);
      setSessions(prev =>
        prev.map(s => (s.id === activeSessionId ? { ...s, name: newName } : s))
      );
    }

    // 先把用户消息塞进本地
    const userMsg: LocalMessage = { id: `user-${Date.now()}`, role: 'user', content: question };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');

    // 再放一个空的 AI 消息，用于流式更新
    const tempAI: LocalMessage = { id: `assistant-${Date.now() + 1}`, role: 'assistant', content: '', streaming: true };
    setMessages(prev => [...prev, tempAI]);

    try {
      const response = await fetch(`${API_BASE}/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        },
        body: JSON.stringify({ 
          question, 
          stream: true, 
          session_id: activeSessionId,
          user_id: userId
        }),
        cache: 'no-store',
        credentials: 'same-origin'
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
          
          // 解码新的数据块
          const newText = decoder.decode(value, { stream: true });
          console.log('Received chunk:', newText); // 添加调试日志
          
          buffer += newText;
          let lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) {
              console.log('Skipping non-data line:', trimmed); // 添加调试日志
              continue;
            }
            
            const jsonStr = trimmed.slice('data:'.length).trim();
            if (!jsonStr) {
              console.log('Empty JSON string'); // 添加调试日志
              continue;
            }
            
            try {
              const data = JSON.parse(jsonStr);
              console.log('Parsed data:', data); // 添加调试日志
              
              if (data.code === 0) {
                if (data.data === true) continue;
                if (data.data && typeof data.data.answer === 'string') {
                  const answerText = data.data.answer;
                  const referenceObj = data.data.reference || {};
                  setMessages(prev => {
                    const newMessages = prev.map((m, i) => {
                      if (i === prev.length - 1 && m.streaming) {
                        return {
                          ...m,
                          content: answerText,
                          reference: referenceObj,
                          streaming: true
                        };
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
              console.error('解析流数据出错:', err, 'Line:', trimmed);
            }
          }
        }
      } catch (err) {
        console.error('读取流数据出错:', err);
        throw err;
      } finally {
        setMessages(prev => {
          const newMessages = prev.map((m, i) => {
            if (i === prev.length - 1 && m.streaming) {
              return { ...m, streaming: false };
            }
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
    // 将消息列表截断至这条用户消息之前，重新请求
    setMessages(prev => prev.slice(0, idx));
    await sendMessage(userMsg.content);
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* 侧边栏 */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            className="fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-lg"
          >
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-xl font-semibold text-gray-800">对话列表</h2>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="p-4">
              <button
                onClick={() => createSession('')}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <PlusIcon className="w-5 h-5" />
                新建对话
              </button>
            </div>
            <div className="overflow-y-auto h-[calc(100vh-8rem)]">
              {sessions.map((session) => (
                <motion.div
                  key={session.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-3 mx-2 mb-2 rounded-lg cursor-pointer transition-all ${
                    selectedSessionId === session.id
                      ? 'bg-blue-50 border-blue-200'
                      : 'hover:bg-gray-50'
                  }`}
                  onClick={() => handleSelectSession(session)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ChatBubbleLeftIcon className="w-5 h-5 text-gray-500" />
                      <span className="text-sm font-medium text-gray-700 truncate max-w-[160px]">
                        {session.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const newName = prompt('请输入新的对话名称', session.name);
                          if (newName) updateSessionName(session.id, newName);
                        }}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded"
                      >
                        <PencilIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('确定要删除这个对话吗？')) deleteSession(session.id);
                        }}
                        className="p-1 text-gray-400 hover:text-red-600 rounded"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col h-screen">
        {/* 顶部导航栏 */}
        <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <Bars3Icon className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-semibold text-gray-800">IBD助手</h1>
          <div className="w-10"></div>
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
          <AnimatePresence>
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className={`flex flex-col ${
                  message.role === 'assistant' ? 'items-start' : 'items-end'
                }`}
              >
                <div
                  className={`max-w-3xl rounded-lg px-2 py-1 ${
                    message.role === 'assistant'
                      ? 'bg-white shadow-sm'
                      : 'bg-blue-400/80 text-white'
                  }`}
                >
                  {message.editing ? (
                    <EditMessageForm
                      originalContent={message.content}
                      onSave={(newContent) => handleSaveEditedMessage(message.id, newContent)}
                    />
                  ) : (
                    <div className="prose max-w-none">
                      <FullAnswerDisplay response={{ code: 0, data: { answer: message.content, reference: message.reference || { chunks: [] } } }} />
                    </div>
                  )}
                </div>
                {message.role === 'user' && !message.editing && (
                  <div className="flex flex-row gap-2 mt-1 px-1">
                    <button
                      onClick={() => handleEditMessage(message.id)}
                      className="text-gray-400 hover:text-gray-600 flex items-center gap-1 text-xs transition-colors"
                      title="编辑消息"
                    >
                      <PencilIcon className="w-3 h-3" />
                      <span>编辑</span>
                    </button>
                    <button
                      onClick={() => handleRefreshFrom(message.id)}
                      className="text-gray-400 hover:text-gray-600 flex items-center gap-1 text-xs transition-colors"
                      title="重新提问"
                    >
                      <ArrowPathIcon className="w-3 h-3" />
                      <span>重新提问</span>
                    </button>
                  </div>
                )}
                {message.role === 'assistant' && !message.noTTS && (
                  <div className="mt-2 flex items-center gap-2">
                    <TTSAudioPlayer text={message.content} />
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* 输入框区域 */}
        <div className="border-t bg-white p-4">
          <div className="max-w-4xl mx-auto">
            <div className="relative">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (inputValue.trim()) {
                      sendMessage(inputValue);
                      setInputValue('');
                    }
                  }
                }}
                placeholder="输入您的问题..."
                className="w-full px-4 py-3 pr-12 rounded-lg border focus:border-blue-500 focus:ring-2 focus:ring-blue-200 resize-none"
                rows={3}
              />
              <button
                onClick={() => {
                  if (inputValue.trim()) {
                    sendMessage(inputValue);
                    setInputValue('');
                  }
                }}
                className="absolute right-2 bottom-3 p-2 text-blue-600 hover:text-blue-700 rounded-lg hover:bg-blue-50 transition-colors"
              >
                <PaperAirplaneIcon className="w-6 h-6" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ====================== 编辑消息表单组件 ======================
const EditMessageForm: React.FC<{ originalContent: string; onSave: (newContent: string) => void; }> = ({ originalContent, onSave }) => {
  const [value, setValue] = useState(originalContent);
  
  // This styling will override the parent container's styling
  useEffect(() => {
    // Find the parent div with bg-blue-400/80 class and temporarily remove color
    const textarea = document.querySelector('.bg-blue-400\\/80');
    if (textarea) {
      textarea.classList.remove('bg-blue-400/80');
      textarea.classList.remove('text-white');
      textarea.classList.add('bg-transparent');
      
      return () => {
        // Restore the original classes when component unmounts
        textarea.classList.add('bg-blue-400/80');
        textarea.classList.add('text-white');
        textarea.classList.remove('bg-transparent');
      };
    }
  }, []);
  
  return (
    <div className="relative bg-transparent">
      <textarea
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[100px] pr-20 bg-white"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSave(value);
          }
          if (e.key === 'Escape') {
            onSave(originalContent);
          }
        }}
        autoFocus
      />
      <div className="absolute bottom-2 right-2 flex gap-1">
        <button 
          className="p-1.5 text-xs text-gray-500 hover:text-gray-700 rounded-md hover:bg-gray-100 transition-colors bg-white"
          onClick={() => onSave(originalContent)}
          title="取消"
        >
          取消
        </button>
        <button 
          className="p-1.5 text-xs text-gray-500 hover:text-gray-700 rounded-md hover:bg-gray-100 transition-colors bg-white"
          onClick={() => onSave(value)}
          title="保存"
        >
          保存
        </button>
      </div>
    </div>
  );
};

// TTS 播放组件
const TTSAudioPlayer: React.FC<{ text: string }> = ({ text }) => {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

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
        ws.close();
      }
    } catch (err) {
      console.error('TTS message parsing error:', err, 'data:', textData);
    }
  };

  const handlePlay = async () => {
    if (audioUrl && audioRef.current) {
      audioRef.current.play().catch(err => console.error('Audio play error:', err));
      setIsPlaying(true);
      return;
    }

    setLoading(true);
    try {
      const configResponse = await fetch(`${API_BASE}/tts/config`);
      
      if (!configResponse.ok) {
        throw new Error(`Failed to get TTS config: ${configResponse.statusText}`);
      }
      
      const config = await configResponse.json();
      if (!config.wsUrl || !config.appId || !config.resId) {
        throw new Error('Invalid TTS configuration received');
      }

      let retryCount = 0;
      const maxRetries = 3;
      const connectWebSocket = () => {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(config.wsUrl);
          let audioData: Uint8Array[] = [];
          let connectionTimeout: NodeJS.Timeout;

          connectionTimeout = setTimeout(() => {
            ws.close();
            if (retryCount < maxRetries) {
              retryCount++;
              console.log(`Retrying WebSocket connection (${retryCount}/${maxRetries})...`);
              resolve(connectWebSocket());
            } else {
              reject(new Error('WebSocket connection timeout after retries'));
            }
          }, 5000);
          
          ws.onopen = () => {
            clearTimeout(connectionTimeout);
            console.log('WebSocket connected successfully');
            const ttsReq = buildTTSRequestPayload(text, config);
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
            }
          };
          
          ws.onerror = (e) => {
            console.error('TTS WebSocket error:', e);
            clearTimeout(connectionTimeout);
            if (retryCount < maxRetries) {
              retryCount++;
              console.log(`Retrying WebSocket connection (${retryCount}/${maxRetries})...`);
              ws.close();
              resolve(connectWebSocket());
            } else {
              reject(new Error('WebSocket connection failed after retries'));
            }
          };
          
          ws.onclose = () => {
            clearTimeout(connectionTimeout);
            setLoading(false);
          };
        });
      };

      await connectWebSocket();
    } catch (err) {
      console.error('TTS request error:', err);
      setLoading(false);
      alert(`语音合成失败: ${err.message}`);
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
    <div className="flex items-center gap-2">
      {!audioUrl ? (
        <button
          onClick={handlePlay}
          disabled={loading}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all ${
            loading 
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
              : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
          }`}
        >
          {loading ? (
            <>
              <ArrowPathIcon className="w-4 h-4 animate-spin" />
              <span>合成中...</span>
            </>
          ) : (
            <>
              <PlayIcon className="w-4 h-4" />
              <span>播放</span>
            </>
          )}
        </button>
      ) : (
        <button
          onClick={isPlaying ? handlePause : handlePlay}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
            isPlaying 
              ? 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100' 
              : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
          } transition-all`}
        >
          {isPlaying ? (
            <>
              <PauseIcon className="w-4 h-4" />
              <span>暂停</span>
            </>
          ) : (
            <>
              <PlayIcon className="w-4 h-4" />
              <span>播放</span>
            </>
          )}
        </button>
      )}
      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} onEnded={() => setIsPlaying(false)} />
      )}
    </div>
  );
};

export default HomePage;