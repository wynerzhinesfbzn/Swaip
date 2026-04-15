import { useGetConversations, getGetConversationsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Loader2 } from "lucide-react";

export default function Messages() {
  const { hash } = useAuth();
  
  const { data, isLoading } = useGetConversations({
    request: { headers: { "x-user-hash": hash } },
    query: { queryKey: getGetConversationsQueryKey() }
  });

  return (
    <div className="flex flex-col min-h-full">
      <div className="p-4 border-b border-white/5 bg-black/20 backdrop-blur-md sticky top-0 z-10">
        <h1 className="text-xl font-bold tracking-tight">Messages</h1>
      </div>

      <div className="flex-1">
        {isLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : data?.conversations?.length ? (
          <div className="divide-y divide-white/5">
            {data.conversations.map((conv) => (
              <Link key={conv.id} href={`/messages/${conv.id}`}>
                <div className="flex items-center gap-4 p-4 hover:bg-white/5 transition-colors cursor-pointer group">
                  <div className="relative">
                    <Avatar className="w-12 h-12 border border-primary/20 group-hover:border-primary/50 transition-colors">
                      <AvatarImage src={conv.otherInfo.avatar || undefined} />
                      <AvatarFallback className="bg-black">{conv.otherInfo.name?.charAt(0) || "?"}</AvatarFallback>
                    </Avatar>
                    {conv.unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                        {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                      </span>
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold truncate text-foreground group-hover:text-primary transition-colors">
                        {conv.otherInfo.name || "Anonymous"}
                      </span>
                      {conv.lastMessage?.createdAt && (
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {formatDistanceToNow(new Date(conv.lastMessage.createdAt), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <p className={`text-sm truncate ${conv.unreadCount > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                        {conv.lastMessage?.content || "Started a conversation"}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-20 px-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-white/5 flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-primary/50" />
            </div>
            <p className="font-medium text-foreground mb-1">No messages yet</p>
            <p className="text-sm">Start a conversation from a user's profile.</p>
          </div>
        )}
      </div>
    </div>
  );
}
