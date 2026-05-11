type Props = {
  role: 'user' | 'assistant';
  text: string;
};

export function ChatMessage({ role, text }: Props) {
  return (
    <div className={`chat-message chat-message-${role}`}>
      <div className="chat-message-role">{role === 'user' ? 'You' : 'Assistant'}</div>
      <div className="chat-message-body">{text}</div>
    </div>
  );
}
