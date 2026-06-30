import { useState, useEffect } from 'react';
import { Bot, MessageSquare, Plus, Smartphone, RefreshCw, Layers, Trash2, Inbox, BookOpen, Megaphone, Paperclip, Send, LogOut } from 'lucide-react';
import { supabase } from './supabaseClient';
import Auth from './Auth';

function Dashboard({ session }) {
  const fetch = async (url, options = {}) => {
    const headers = {
      ...options.headers,
      'x-user-id': session?.user?.id
    };
    return window.fetch(url, { ...options, headers });
  };
  const [status, setStatus] = useState('INITIALIZING');
  const [qrCode, setQrCode] = useState(null);
  const [phone, setPhone] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  
  // Automation State
  const [rules, setRules] = useState([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [newResponse, setNewResponse] = useState('');
  const [knowledge, setKnowledge] = useState('');
  const [knowledgeUrl, setKnowledgeUrl] = useState('');

  // Inbox State
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [messages, setMessages] = useState([]);

  // Inbox Manual Send
  const [replyMessage, setReplyMessage] = useState('');
  const [replyMedia, setReplyMedia] = useState(null);

  // Campaigns
  const [campaignNumbers, setCampaignNumbers] = useState('');
  const [campaignMessage, setCampaignMessage] = useState('');
  const [campaignMedia, setCampaignMedia] = useState(null);
  const [isAutomatic, setIsAutomatic] = useState(true);
  const [campaignStatus, setCampaignStatus] = useState('');
  const [manualQueue, setManualQueue] = useState([]);

  const handleMediaUpload = (e, setter) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setter({
        mimetype: file.type,
        data: ev.target.result.split(',')[1],
        filename: file.name
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSendReply = async () => {
    if (!selectedChat || (!replyMessage && !replyMedia)) return;
    try {
      await fetch(`/api/chats/${selectedChat.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: replyMessage, media: replyMedia })
      });
      setReplyMessage('');
      setReplyMedia(null);
      fetchMessages(selectedChat.id);
    } catch (err) {
      console.error('Failed to send reply', err);
    }
  };

  const handleStartCampaign = async () => {
    if (!campaignNumbers) return;
    const numbersArray = campaignNumbers.split(/[\n,]+/).map(n => n.trim()).filter(n => n);
    if (numbersArray.length === 0) return;
    try {
      setCampaignStatus('Processing...');
      await fetch('/api/bulk-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numbers: numbersArray,
          message: campaignMessage,
          media: campaignMedia,
          isAutomatic: isAutomatic
        })
      });
      if (!isAutomatic) {
        setManualQueue(numbersArray);
        setCampaignStatus('Manual queue ready. Please click Send for each user below.');
      } else {
        setCampaignStatus(`Campaign started! Background engine is sending with human delays...`);
      }
    } catch (err) {
      setCampaignStatus('Failed to start campaign.');
    }
  };

  const handleSendManualQueueItem = async (number) => {
    try {
      const jid = number.includes('@c.us') ? number : `${number.replace(/[^0-9]/g, '')}@c.us`;
      await fetch(`/api/chats/${jid}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: campaignMessage, media: campaignMedia })
      });
      setManualQueue(prev => prev.filter(n => n !== number));
    } catch (err) {
      alert(`Failed to send to ${number}`);
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatus(data.status);
      if (data.status === 'QR_READY') {
        setQrCode(data.qr);
      } else if (data.status === 'CONNECTED') {
        setPhone(data.phone);
      }
    } catch (err) {
      console.error('Failed to fetch status', err);
    }
  };

  useEffect(() => {
    const fetchRules = async () => {
      try {
        const res = await fetch('/api/rules');
        const data = await res.json();
        setRules(data);
      } catch (err) {
        console.error('Failed to fetch rules', err);
      }
    };

    const fetchKnowledge = async () => {
      try {
        const res = await fetch('/api/knowledge');
        const data = await res.json();
        setKnowledge(data.text || '');
        setKnowledgeUrl(data.url || '');
      } catch (err) {
        console.error('Failed to fetch knowledge', err);
      }
    };
    
    fetchStatus();
    fetchRules();
    fetchKnowledge();
    
    const interval = setInterval(() => {
      fetchStatus();
      // Only fetch chats periodically if we are connected
      if (activeTab === 'inbox') fetchChats();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchChats = async () => {
    if (status !== 'CONNECTED') return;
    try {
      const res = await fetch('/api/chats');
      const data = await res.json();
      setChats(data);
    } catch (err) {
      console.error('Failed to fetch chats', err);
    }
  };



  const handleDisconnect = async () => {
    if (!window.confirm('Are you sure you want to disconnect this WhatsApp number? You will need to scan a new QR code.')) return;
    try {
      await fetch('/api/logout', { method: 'POST' });
      alert('Phone disconnected! Please wait a moment for the new QR code to generate.');
      fetchStatus();
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const fetchMessages = async (chatId) => {
    try {
      const res = await fetch(`/api/chats/${chatId}/messages`);
      const data = await res.json();
      setMessages(data);
    } catch (err) {
      console.error('Failed to fetch messages', err);
    }
  };

  useEffect(() => {
    if (activeTab === 'inbox') {
      fetchChats();
    }
  }, [activeTab, status]);

  const handleSelectChat = (chat) => {
    setSelectedChat(chat);
    fetchMessages(chat.id);
  };

  const handleAddRule = async (e) => {
    e.preventDefault();
    if (!newKeyword || !newResponse) return;
    
    const rule = { trigger: 'keyword', keyword: newKeyword, response: newResponse };
    
    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule)
      });
      const data = await res.json();
      setRules([...rules, data.rule]);
      setNewKeyword('');
      setNewResponse('');
    } catch (err) {
      console.error('Failed to add rule', err);
    }
  };

  const handleDeleteRule = async (id) => {
    try {
      await fetch(`/api/rules/${id}`, { method: 'DELETE' });
      setRules(rules.filter(r => r.id !== id));
    } catch (err) {
      console.error('Failed to delete rule', err);
    }
  };

  const handleSaveKnowledge = async () => {
    try {
      await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: knowledge, url: knowledgeUrl })
      });
      alert('Knowledge Base saved! The AI will now use this context.');
    } catch (err) {
      console.error('Failed to save knowledge', err);
    }
  };

  return (
    <div className="dashboard-container">
      {/* Sidebar */}
      <aside className="sidebar glass-panel">
        <div className="sidebar-header">
          <Bot className="icon-primary" />
          <h2>AutomateAI</h2>
        </div>
        <nav className="nav-menu">
          <a href="#" className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}><Layers className="icon-small" /> Overview</a>
          <a href="#" className={`nav-item ${activeTab === 'inbox' ? 'active' : ''}`} onClick={() => setActiveTab('inbox')}><Inbox className="icon-small" /> Unified Inbox</a>
          <a href="#" className={`nav-item ${activeTab === 'automations' ? 'active' : ''}`} onClick={() => setActiveTab('automations')}><MessageSquare className="icon-small" /> Automations</a>
          <a href="#" className={`nav-item ${activeTab === 'campaigns' ? 'active' : ''}`} onClick={() => setActiveTab('campaigns')}><Megaphone className="icon-small" /> Bulk Campaigns</a>
          <a href="#" className={`nav-item ${activeTab === 'knowledge' ? 'active' : ''}`} onClick={() => setActiveTab('knowledge')}><BookOpen className="icon-small" /> Knowledge Base</a>
          <a href="#" className={`nav-item ${activeTab === 'connections' ? 'active' : ''}`} onClick={() => setActiveTab('connections')}><Smartphone className="icon-small" /> Connections</a>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="top-header glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>{activeTab === 'overview' ? 'Dashboard Overview' : activeTab === 'automations' ? 'Automation Rules' : activeTab === 'campaigns' ? 'Bulk Campaigns' : activeTab === 'knowledge' ? 'AI Knowledge Base' : activeTab === 'inbox' ? 'Unified Inbox' : 'Connections'}</h1>
          <div style={{ display: 'flex', gap: '10px' }}>
            {activeTab === 'overview' && <button className="btn-primary" onClick={() => setActiveTab('automations')}><Plus className="icon-small" /> New Automation</button>}
            <button className="btn-icon" onClick={() => supabase.auth.signOut()} title="Sign Out">
              <LogOut size={20} />
            </button>
          </div>
        </header>

        {['overview', 'connections'].includes(activeTab) && (
          <section className="content-grid">
            <div className="card glass-panel connection-card">
              <div className="card-header">
                <h3>WhatsApp Engine</h3>
                <span className={`status-badge ${status.toLowerCase()}`}>
                  {status === 'INITIALIZING' && <RefreshCw className="icon-spin icon-small" />}
                  {status}
                </span>
              </div>
              
              <div className="card-body">
                {status === 'ERROR' && (
                  <div className="error-info" style={{ color: 'var(--error-color)', padding: '10px', background: 'rgba(255,0,0,0.1)', borderRadius: '8px' }}>
                    <p><strong>Connection Error</strong></p>
                    <p>Failed to initialize the WhatsApp engine. The server is retrying...</p>
                    <button onClick={fetchStatus} className="btn-primary mt-2">Retry Now</button>
                  </div>
                )}

                {status === 'QR_READY' && qrCode && (
                  <div className="qr-container">
                    <p>Scan this QR code with your WhatsApp app to connect.</p>
                    <div className="qr-placeholder">
                      <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrCode)}`} alt="QR Code" />
                    </div>
                  </div>
                )}

                {status === 'CONNECTED' && (
                  <div className="connected-info">
                    <div className="success-circle">
                      <Smartphone size={32} />
                    </div>
                    <p>Connected as <strong>{phone}</strong></p>
                    <p className="sub-text">Engine is running and listening for messages.</p>
                    <button 
                      onClick={handleDisconnect} 
                      className="btn btn-outline mt-4" 
                      style={{ borderColor: 'var(--error-color)', color: 'var(--error-color)' }}>
                      Disconnect Phone
                    </button>
                  </div>
                )}

                {status === 'INITIALIZING' && (
                  <div className="loading-info">
                    <p>Starting Chromium engine. Please wait...</p>
                  </div>
                )}
              </div>
            </div>

            <div className="card glass-panel stats-card">
              <h3>Active Rules</h3>
              <div className="stat-number">{rules.length}</div>
              <p className="stat-label">Bots currently listening</p>
            </div>
          </section>
        )}

        {activeTab === 'inbox' && (
          <section className="inbox-section glass-panel">
            <div className="chats-sidebar">
              <div className="chats-header">
                <h3>Chats & Groups</h3>
              </div>
              <div className="chats-list">
                {chats.map(chat => (
                  <div 
                    key={chat.id} 
                    className={`chat-item ${selectedChat?.id === chat.id ? 'selected' : ''}`}
                    onClick={() => handleSelectChat(chat)}
                  >
                    <div className="chat-avatar">
                      {chat.isGroup ? 'G' : chat.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="chat-info">
                      <div className="chat-name-row">
                        <span className="chat-name">{chat.name}</span>
                        {chat.unreadCount > 0 && <span className="unread-badge">{chat.unreadCount}</span>}
                      </div>
                      <span className="chat-preview">{chat.lastMessage || 'Media/Voice'}</span>
                    </div>
                  </div>
                ))}
                {chats.length === 0 && <p className="text-secondary p-4 text-center">No recent chats found.</p>}
              </div>
            </div>
            
            <div className="messages-pane">
              {selectedChat ? (
                <>
                  <div className="messages-header">
                    <h3>{selectedChat.name} {selectedChat.isGroup && '(Group)'}</h3>
                  </div>
                  <div className="messages-list">
                    {messages.map(msg => (
                      <div key={msg.id} className={`message-bubble ${msg.fromMe ? 'outgoing' : 'incoming'}`}>
                        {msg.hasMedia && <span className="media-tag">[Media Attached]</span>}
                        <p>{msg.body || (msg.hasMedia ? 'Media Message' : 'Unsupported format')}</p>
                        <span className="message-time">{new Date(msg.timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      </div>
                    ))}
                  </div>
                  <div className="reply-box glass-panel mt-4 p-4" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <label className="btn-icon" style={{ cursor: 'pointer' }}>
                      <Paperclip size={20} />
                      <input type="file" style={{ display: 'none' }} onChange={e => handleMediaUpload(e, setReplyMedia)} />
                    </label>
                    <input 
                      type="text" 
                      placeholder={replyMedia ? `Attached: ${replyMedia.filename}` : "Type a manual reply..."} 
                      className="input-field" 
                      style={{ flex: 1, margin: 0 }}
                      value={replyMessage}
                      onChange={e => setReplyMessage(e.target.value)}
                      onKeyPress={e => e.key === 'Enter' && handleSendReply()}
                    />
                    <button className="btn-primary" onClick={handleSendReply}><Send size={18} /></button>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <Inbox size={48} className="text-secondary mb-4 opacity-50" />
                  <p className="text-secondary">Select a chat to view messages</p>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'automations' && (
          <section className="automations-section">
            <div className="card glass-panel">
              <h3>Create New Keyword Automation</h3>
              <form onSubmit={handleAddRule} className="automation-form">
                <div className="form-group">
                  <label>Trigger Keyword</label>
                  <input 
                    type="text" 
                    placeholder="e.g. price, help, address" 
                    value={newKeyword} 
                    onChange={e => setNewKeyword(e.target.value)}
                    className="input-field"
                  />
                </div>
                <div className="form-group">
                  <label>Bot Response</label>
                  <textarea 
                    placeholder="Enter the automated reply message..." 
                    value={newResponse} 
                    onChange={e => setNewResponse(e.target.value)}
                    className="input-field"
                    rows="3"
                  />
                </div>
                <button type="submit" className="btn-primary">Save Automation</button>
              </form>
            </div>

            <div className="rules-list mt-6">
              <h3>Active Automations</h3>
              {rules.length === 0 ? (
                <p className="text-secondary mt-2">No active rules. Create one above!</p>
              ) : (
                <div className="rules-grid mt-4">
                  {rules.map(rule => (
                    <div key={rule.id} className="card glass-panel rule-card">
                      <div className="rule-header">
                        <span className="badge-purple">Keyword Match</span>
                        <button onClick={() => handleDeleteRule(rule.id)} className="btn-icon-danger"><Trash2 size={16} /></button>
                      </div>
                      <div className="rule-content">
                        <p><strong>If message contains:</strong> "{rule.keyword}"</p>
                        <p><strong>Reply with:</strong> "{rule.response}"</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'knowledge' && (
          <section className="automations-section">
            <div className="card glass-panel">
              <h3>Business Context & Knowledge</h3>
              <p className="text-secondary mt-2 mb-4" style={{ fontSize: '0.875rem', lineHeight: '1.5' }}>
                Paste your business pricing, schedules, policies, or FAQ answers here. You can also provide your website URL to automatically fetch updates daily. 
                When a user messages you, the AI will automatically read this text to answer their questions 
                and try to convert them into a customer.
              </p>
              <div className="form-group mb-4">
                <label className="text-secondary" style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem' }}>Website Auto-Sync URL</label>
                <input 
                  type="url"
                  placeholder="https://yourwebsite.com" 
                  value={knowledgeUrl} 
                  onChange={e => setKnowledgeUrl(e.target.value)}
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label className="text-secondary" style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem' }}>Manual Knowledge Text</label>
                <textarea 
                  placeholder="e.g., Classes cost $50/month. We are open Mon-Fri 9AM-9PM. We offer a free trial class..." 
                  value={knowledge} 
                  onChange={e => setKnowledge(e.target.value)}
                  className="input-field"
                  rows="12"
                />
              </div>
              <button onClick={handleSaveKnowledge} className="btn-primary mt-4">Save Knowledge Base</button>
            </div>
          </section>
        )}

        {activeTab === 'campaigns' && (
          <section className="campaigns-section">
            <div className="card glass-panel">
              <h3>New Broadcast Campaign</h3>
              <p className="text-secondary mt-2 mb-4">Send a message to multiple numbers with built-in anti-ban delays.</p>
              
              <div className="form-group">
                <label>Phone Numbers (comma or newline separated)</label>
                <textarea 
                  className="input-field" 
                  rows="4" 
                  placeholder="e.g. 919876543210, 919876543211..."
                  value={campaignNumbers}
                  onChange={e => setCampaignNumbers(e.target.value)}
                />
              </div>

              <div className="form-group mt-4">
                <label>Message Content</label>
                <textarea 
                  className="input-field" 
                  rows="4" 
                  placeholder="Hey! We have a new offer..."
                  value={campaignMessage}
                  onChange={e => setCampaignMessage(e.target.value)}
                />
              </div>

              <div className="form-group mt-4">
                <label>Attach Image/Video</label>
                <input 
                  type="file" 
                  className="input-field"
                  onChange={e => handleMediaUpload(e, setCampaignMedia)}
                />
                {campaignMedia && <span className="badge-purple mt-2" style={{display:'inline-block'}}>Attached: {campaignMedia.filename}</span>}
              </div>

              <div className="form-group mt-4 flex" style={{ gap: '20px', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="radio" name="mode" checked={isAutomatic} onChange={() => setIsAutomatic(true)} />
                  <span style={{color: 'var(--text-primary)'}}>Automated (12-25s delays)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="radio" name="mode" checked={!isAutomatic} onChange={() => setIsAutomatic(false)} />
                  <span style={{color: 'var(--text-primary)'}}>Semi-Automated (Manual Click)</span>
                </label>
              </div>

              <button className="btn-primary mt-6" onClick={handleStartCampaign}>Start Campaign</button>
              
              {campaignStatus && <p className="mt-4 badge-purple" style={{padding:'10px'}}>{campaignStatus}</p>}
            </div>

            {!isAutomatic && manualQueue.length > 0 && (
              <div className="card glass-panel mt-6">
                <h3>Manual Send Queue ({manualQueue.length} remaining)</h3>
                <div className="queue-list mt-4" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {manualQueue.map(num => (
                    <div key={num} className="queue-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                      <span style={{color: 'var(--text-primary)'}}>{num}</span>
                      <button className="btn-primary" onClick={() => handleSendManualQueueItem(num)}>Send Now</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function App() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!session) {
    return <Auth />;
  }

  return <Dashboard session={session} />;
}

export default App;
