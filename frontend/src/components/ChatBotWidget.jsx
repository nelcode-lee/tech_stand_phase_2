import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
import { queryDocuments } from '../api';
import './ChatBotWidget.css';

export default function ChatBotWidget({ documentId, docLayer }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  async function handleSubmit(e) {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: q }]);
    setLoading(true);

    try {
      const { answer, citations } = await queryDocuments(q, documentId, docLayer);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: answer, citations: citations || [] },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Sorry, something went wrong: ${err.message}`,
          citations: [],
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="chat-widget-fab"
        onClick={() => setOpen(!open)}
        aria-label={open ? 'Close chat' : 'Ask about documents'}
      >
        {open ? <X size={24} /> : <MessageCircle size={24} />}
      </button>

      {open && (
        <div className="chat-widget-drawer">
          <div className="chat-widget-header">
            <h3>Ask about documents</h3>
            <p className="chat-widget-subtitle">
              {documentId ? `Scoped to current document` : 'Searching across all documents'}
            </p>
          </div>

          <div className="chat-widget-messages">
            {messages.length === 0 && (
              <div className="chat-widget-empty">
                <p>Ask a question about your technical standards.</p>
                <p className="chat-widget-empty-hint">
                  e.g. &quot;What are the requirements for packaging?&quot;
                </p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`chat-widget-msg chat-widget-msg--${msg.role}`}>
                <div className="chat-widget-msg-content">{msg.content}</div>
                {msg.citations && msg.citations.length > 0 && (
                  <div className="chat-widget-citations">
                    <span className="chat-widget-citations-label">Sources:</span>
                    {msg.citations.map((c, j) => (
                      <span key={j} className="chat-widget-citation">
                        {c.title || c.document_id}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="chat-widget-msg chat-widget-msg--assistant">
                <div className="chat-widget-typing">Thinking…</div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="chat-widget-form" onSubmit={handleSubmit}>
            <input
              type="text"
              className="chat-widget-input"
              placeholder="Ask a question…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
            />
            <button type="submit" className="chat-widget-send" disabled={loading || !input.trim()}>
              <Send size={18} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
