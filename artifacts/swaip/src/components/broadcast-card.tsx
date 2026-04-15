import { formatDistanceToNow } from "date-fns";
import { Heart, MessageCircle, Share2, Trash2 } from "lucide-react";
import { Link } from "wouter";
import type { BroadcastWithMeta } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useDeleteBroadcast, useReactToBroadcast, getGetBroadcastsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical } from "lucide-react";

export function BroadcastCard({ broadcast }: { broadcast: BroadcastWithMeta }) {
  const { hash } = useAuth();
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteBroadcast({
    request: { headers: { "x-user-hash": hash } }
  });
  const reactMutation = useReactToBroadcast({
    request: { headers: { "x-user-hash": hash } }
  });

  const isAuthor = broadcast.authorHash === hash;
  const isScene = broadcast.authorMode === "scene";

  const handleDelete = () => {
    if (confirm("Delete this broadcast?")) {
      deleteMutation.mutate({ id: broadcast.id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBroadcastsQueryKey() });
        }
      });
    }
  };

  const handleReact = () => {
    reactMutation.mutate({ 
      id: broadcast.id,
      data: { emoji: "❤️" }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBroadcastsQueryKey() });
      }
    });
  };

  const likeReaction = broadcast.reactions?.find(r => r.emoji === "❤️");

  return (
    <div className={`p-4 border-b border-white/5 transition-colors ${isScene ? 'bg-secondary/5 hover:bg-secondary/10' : 'hover:bg-white/[0.02]'}`}>
      <div className="flex gap-3">
        <Link href={`/profile/${broadcast.authorHash}`}>
          <Avatar className={`w-10 h-10 border ${isScene ? 'border-secondary' : 'border-primary/50'}`}>
            <AvatarImage src={broadcast.author.avatar || undefined} />
            <AvatarFallback className="bg-black text-white">{broadcast.author.name?.charAt(0) || "?"}</AvatarFallback>
          </Avatar>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <Link href={`/profile/${broadcast.authorHash}`} className="flex items-center gap-1.5 truncate">
              <span className={`font-bold truncate ${isScene ? 'text-secondary-foreground' : 'text-foreground'}`}>
                {broadcast.author.name || "Anonymous"}
              </span>
              <span className="text-sm text-muted-foreground truncate">
                @{broadcast.author.handle || broadcast.authorHash.slice(0, 8)}
              </span>
              {isScene && (
                <span className="text-[10px] uppercase tracking-wider bg-secondary/20 text-secondary px-1.5 py-0.5 rounded">Scene</span>
              )}
            </Link>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-muted-foreground">
                {broadcast.createdAt ? formatDistanceToNow(new Date(broadcast.createdAt), { addSuffix: true }) : ""}
              </span>
              {isAuthor && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="w-6 h-6 text-muted-foreground">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-card border-white/10">
                    <DropdownMenuItem onClick={handleDelete} className="text-destructive focus:bg-destructive/10">
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words mb-3 text-foreground/90">
            {broadcast.content}
          </p>

          <div className="flex items-center justify-between text-muted-foreground mt-2 max-w-xs">
            <button 
              onClick={handleReact}
              disabled={reactMutation.isPending}
              className={`flex items-center gap-1.5 group transition-colors ${likeReaction ? 'text-rose-500' : 'hover:text-rose-400'}`}
            >
              <Heart className={`w-4 h-4 transition-transform group-hover:scale-110 ${likeReaction ? 'fill-current' : ''}`} />
              <span className="text-xs">{likeReaction?.count || 0}</span>
            </button>
            <Link href={`/broadcast/${broadcast.id}`} className="flex items-center gap-1.5 group transition-colors hover:text-primary">
              <MessageCircle className="w-4 h-4 transition-transform group-hover:scale-110" />
              <span className="text-xs">{broadcast.commentCount || 0}</span>
            </Link>
            <button className="flex items-center gap-1.5 group transition-colors hover:text-primary">
              <Share2 className="w-4 h-4 transition-transform group-hover:scale-110" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
