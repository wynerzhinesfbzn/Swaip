import { useState } from "react";
import { useParams, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useGetBroadcast, useAddComment, getGetBroadcastQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BroadcastCard } from "@/components/broadcast-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function BroadcastDetail() {
  const { id } = useParams<{ id: string }>();
  const broadcastId = parseInt(id || "0", 10);
  const { hash } = useAuth();
  const queryClient = useQueryClient();
  const [commentContent, setCommentContent] = useState("");

  const { data: broadcast, isLoading } = useGetBroadcast(
    broadcastId,
    { 
      query: { 
        queryKey: getGetBroadcastQueryKey(broadcastId), 
        enabled: !!broadcastId 
      } 
    }
  );

  const commentMutation = useAddComment({
    request: { headers: { "x-user-hash": hash } }
  });

  const handleComment = () => {
    if (!commentContent.trim() || !broadcastId) return;
    commentMutation.mutate({
      id: broadcastId,
      data: { content: commentContent.trim() }
    }, {
      onSuccess: () => {
        setCommentContent("");
        queryClient.invalidateQueries({ queryKey: getGetBroadcastQueryKey(broadcastId) });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!broadcast) {
    return <div className="p-8 text-center text-muted-foreground">Broadcast not found</div>;
  }

  return (
    <div className="flex flex-col min-h-full pb-20">
      <div className="flex items-center gap-3 p-3 border-b border-white/5 bg-black/40 backdrop-blur-xl sticky top-0 z-10">
        <Link href="/">
          <Button variant="ghost" size="icon" className="shrink-0 rounded-full hover:bg-white/10">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <h1 className="text-lg font-bold">Broadcast</h1>
      </div>

      <BroadcastCard broadcast={{ ...broadcast, commentCount: broadcast.comments?.length ?? 0 }} />

      <div className="p-4 border-b border-white/5 bg-black/20">
        <div className="flex gap-3">
          <Avatar className="w-8 h-8 border border-primary/50">
            <AvatarFallback className="bg-black">Me</AvatarFallback>
          </Avatar>
          <div className="flex-1 flex flex-col gap-2">
            <Textarea
              placeholder="Reply to this broadcast..."
              value={commentContent}
              onChange={(e) => setCommentContent(e.target.value)}
              className="min-h-[60px] bg-white/5 border-white/10 resize-none focus-visible:ring-primary text-sm"
            />
            <div className="flex justify-end">
              <Button 
                onClick={handleComment}
                disabled={!commentContent.trim() || commentMutation.isPending}
                size="sm"
                className="rounded-full font-bold bg-primary text-black hover:bg-primary/80"
              >
                {commentMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                Reply
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1">
        {broadcast.comments?.length ? (
          <div className="divide-y divide-white/5">
            {broadcast.comments.map(comment => (
              <div key={comment.id} className="p-4 hover:bg-white/[0.02] transition-colors">
                <div className="flex gap-3">
                  <Link href={`/profile/${comment.authorHash}`}>
                    <Avatar className="w-8 h-8 border border-white/10">
                      <AvatarImage src={comment.author?.avatar || undefined} />
                      <AvatarFallback className="bg-black">{comment.author?.name?.charAt(0) || "?"}</AvatarFallback>
                    </Avatar>
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <Link href={`/profile/${comment.authorHash}`} className="flex items-center gap-1.5 truncate">
                        <span className="font-bold text-sm truncate text-foreground">
                          {comment.author?.name || "Anonymous"}
                        </span>
                        <span className="text-xs text-muted-foreground truncate">
                          @{comment.author?.handle || comment.authorHash.slice(0, 8)}
                        </span>
                      </Link>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {comment.createdAt ? formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true }) : ""}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-foreground/90 break-words whitespace-pre-wrap">
                      {comment.content}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No replies yet.
          </div>
        )}
      </div>
    </div>
  );
}
