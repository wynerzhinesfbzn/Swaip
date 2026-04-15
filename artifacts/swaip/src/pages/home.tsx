import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useGetBroadcasts, useCreateBroadcast, getGetBroadcastsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BroadcastCard } from "@/components/broadcast-card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Zap } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function Home() {
  const { hash, mode } = useAuth();
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");

  const { data: broadcasts, isLoading } = useGetBroadcasts(
    { limit: 50 },
    { query: { queryKey: getGetBroadcastsQueryKey({ limit: 50 }) } }
  );

  const createMutation = useCreateBroadcast({
    request: { headers: { "x-user-hash": hash } }
  });

  const handlePost = () => {
    if (!content.trim()) return;
    createMutation.mutate({
      data: {
        content: content.trim(),
        authorMode: mode
      }
    }, {
      onSuccess: () => {
        setContent("");
        queryClient.invalidateQueries({ queryKey: getGetBroadcastsQueryKey({ limit: 50 }) });
      }
    });
  };

  return (
    <div className="flex flex-col min-h-full">
      {/* Create Post Area */}
      <div className="p-4 border-b border-white/10 bg-black/20 backdrop-blur-md sticky top-0 z-10">
        <div className="flex gap-3">
          <Avatar className={`w-10 h-10 border ${mode === 'scene' ? 'border-secondary' : 'border-primary'}`}>
            <AvatarFallback className="bg-black">Me</AvatarFallback>
          </Avatar>
          <div className="flex-1 flex flex-col gap-2">
            <Textarea
              placeholder={mode === 'scene' ? "The stage is yours..." : "What's happening?"}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[80px] bg-transparent border-none resize-none focus-visible:ring-0 px-0 py-2 text-base text-foreground placeholder:text-muted-foreground/50"
            />
            <div className="flex justify-between items-center border-t border-white/5 pt-2">
              <div className="text-xs text-muted-foreground">
                Posting as <span className={`font-bold ${mode === 'scene' ? 'text-secondary' : 'text-primary'}`}>{mode.toUpperCase()}</span>
              </div>
              <Button 
                onClick={handlePost} 
                disabled={!content.trim() || createMutation.isPending}
                size="sm"
                className={`rounded-full px-6 font-bold ${mode === 'scene' ? 'bg-secondary hover:bg-secondary/80 text-white' : 'bg-primary hover:bg-primary/80 text-black'}`}
              >
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                Send
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1">
        {isLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : broadcasts?.length ? (
          broadcasts.map(broadcast => (
            <BroadcastCard key={broadcast.id} broadcast={broadcast} />
          ))
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            <div className="w-16 h-16 mx-auto rounded-full bg-white/5 flex items-center justify-center mb-4">
              <Zap className="w-8 h-8 text-primary/50" />
            </div>
            <p className="font-medium text-foreground mb-1">No broadcasts yet</p>
            <p className="text-sm">Be the first to say something in the flow.</p>
          </div>
        )}
      </div>
    </div>
  );
}
