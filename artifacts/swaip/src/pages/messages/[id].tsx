import { useState, useRef, useEffect } from "react";
import { useParams, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useGetMessages, useSendMessage, getGetMessagesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, ArrowLeft, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Chat() {
  const { id } = useParams<{ id: string }>();
  const convId = parseInt(id || "0", 10);
  const { hash } = useAuth();
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useGetMessages(
    convId,
    { limit: 100 },
    { 
      query: { 
        queryKey: getGetMessagesQueryKey(convId, { limit: 100 }),
        enabled: !!convId,
        refetchInterval: 3000 // Poll every 3s
      },
      request: { headers: { "x-user-hash": hash } }
    }
  );

  const sendMutation = useSendMessage({
    request: { headers: { "x-user-hash": hash } }
  });

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!content.trim() || !convId) return;

    sendMutation.mutate({
      id: convId,
      data: { content: content.trim() }
    }, {
      onSuccess: () => {
        setContent("");
        queryClient.invalidateQueries({ queryKey: getGetMessagesQueryKey(convId, { limit: 100 }) });
        setTimeout(() => {
          bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);
      }
    });
  };

  useEffect(() => {
    if (data?.messages?.length) {
      bottomRef.current?.scrollIntoView();
    }
  }, [data?.messages?.length]);

  if (!convId) return null;

  const messages = data?.messages ? [...data.messages].reverse() : [];
  // Try to find the other user from the first message they sent
  const otherMessage = messages.find(m => m.senderHash !== hash);
  const otherAuthor = otherMessage?.author || { name: "Chat", avatar: "", handle: "" };

  return (
    <div className="flex flex-col h-[100dvh] absolute inset-0 z-50 bg-background w-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-3 border-b border-white/5 bg-black/40 backdrop-blur-xl">
        <Link href="/messages">
          <Button variant="ghost" size="icon" className="shrink-0 rounded-full hover:bg-white/10">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <Avatar className="w-10 h-10 border border-primary/20">
          <AvatarImage src={otherAuthor.avatar || undefined} />
          <AvatarFallback className="bg-black">{otherAuthor.name?.charAt(0) || "?"}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="font-bold truncate text-foreground leading-tight">{otherAuthor.name}</div>
          {otherAuthor.handle && (
            <div className="text-xs text-muted-foreground truncate">@{otherAuthor.handle}</div>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-20">
        {isLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : messages.length ? (
          messages.map((msg, i) => {
            const isMe = msg.senderHash === hash;
            const showAvatar = !isMe && (i === 0 || messages[i-1].senderHash === hash);
            
            return (
              <div key={msg.id} className={`flex gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
                {!isMe && (
                  <div className="w-8 shrink-0 flex items-end">
                    {showAvatar && (
                      <Avatar className="w-8 h-8 border border-white/10">
                        <AvatarImage src={msg.author.avatar || undefined} />
                        <AvatarFallback className="bg-black text-[10px]">{msg.author.name?.charAt(0) || "?"}</AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                )}
                
                <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[75%]`}>
                  <div 
                    className={`px-4 py-2 rounded-2xl whitespace-pre-wrap break-words text-sm
                      ${isMe 
                        ? 'bg-primary text-black rounded-br-sm' 
                        : 'bg-white/10 text-foreground rounded-bl-sm'}`}
                  >
                    {msg.content}
                  </div>
                  {msg.createdAt && (
                    <span className="text-[10px] text-muted-foreground mt-1 px-1">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            Say hello...
          </div>
        )}
        <div ref={bottomRef} className="h-1" />
      </div>

      {/* Input Area */}
      <div className="p-3 border-t border-white/5 bg-black/40 backdrop-blur-xl pb-safe">
        <form onSubmit={handleSend} className="flex items-end gap-2">
          <Input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Message..."
            className="flex-1 bg-white/5 border-white/10 rounded-full h-11 px-4 focus-visible:ring-primary focus-visible:border-primary"
          />
          <Button 
            type="submit" 
            disabled={!content.trim() || sendMutation.isPending}
            size="icon"
            className="h-11 w-11 rounded-full shrink-0 bg-primary hover:bg-primary/80 text-black"
          >
            {sendMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </Button>
        </form>
      </div>
    </div>
  );
}
