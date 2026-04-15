import { useParams } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useGetAccount, useGetBroadcasts, useGetFollows, useToggleFollow, useCreateConversation, getGetAccountQueryKey, getGetFollowsQueryKey, getGetBroadcastsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { BroadcastCard } from "@/components/broadcast-card";
import { Loader2, MessageSquare, UserPlus, UserCheck } from "lucide-react";

export default function Profile() {
  const { hash: profileHash } = useParams<{ hash: string }>();
  const { hash: myHash } = useAuth();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const isMe = profileHash === myHash;

  const { data: account, isLoading: accountLoading } = useGetAccount(
    profileHash || "",
    { query: { queryKey: getGetAccountQueryKey(profileHash || ""), enabled: !!profileHash } }
  );

  const { data: follows } = useGetFollows(
    profileHash || "",
    { 
      query: { queryKey: getGetFollowsQueryKey(profileHash || ""), enabled: !!profileHash },
      request: { headers: { "x-user-hash": myHash } }
    }
  );

  const { data: broadcasts, isLoading: broadcastsLoading } = useGetBroadcasts(
    { author: profileHash },
    { query: { queryKey: getGetBroadcastsQueryKey({ author: profileHash }), enabled: !!profileHash } }
  );

  const toggleFollow = useToggleFollow({
    request: { headers: { "x-user-hash": myHash } }
  });

  const createConv = useCreateConversation({
    request: { headers: { "x-user-hash": myHash } }
  });

  const handleFollow = () => {
    if (!profileHash) return;
    toggleFollow.mutate({ data: { targetHash: profileHash } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetFollowsQueryKey(profileHash) });
      }
    });
  };

  const handleMessage = () => {
    if (!profileHash) return;
    createConv.mutate({ data: { otherHash: profileHash } }, {
      onSuccess: (res) => {
        if (res.conversation?.id) {
          setLocation(`/messages/${res.conversation.id}`);
        }
      }
    });
  };

  if (accountLoading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Assuming account API returns the user object directly, but let's check structure.
  // Using user as account directly for now based on typings or data.
  const user = account?.data || account as any;

  if (!user || !user.hash) {
    return <div className="p-8 text-center text-muted-foreground">User not found</div>;
  }

  const isScene = user.mode === 'scene';

  return (
    <div className="flex flex-col min-h-full">
      {/* Cover / Header */}
      <div className={`h-32 w-full ${isScene ? 'bg-gradient-to-br from-secondary/40 to-black' : 'bg-gradient-to-br from-primary/40 to-black'} relative`}>
        <div className="absolute -bottom-12 left-4">
          <Avatar className={`w-24 h-24 border-4 border-background ${isScene ? 'ring-2 ring-secondary' : 'ring-2 ring-primary/50'}`}>
            <AvatarImage src={user.avatar || undefined} />
            <AvatarFallback className="bg-black text-2xl font-bold">{user.name?.charAt(0) || "?"}</AvatarFallback>
          </Avatar>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end p-4 gap-2">
        {!isMe && (
          <>
            <Button 
              variant="outline" 
              size="icon" 
              className="rounded-full border-white/10 hover:bg-white/5 hover:text-primary"
              onClick={handleMessage}
              disabled={createConv.isPending}
            >
              {createConv.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
            </Button>
            <Button 
              onClick={handleFollow}
              disabled={toggleFollow.isPending}
              className={`rounded-full px-6 font-bold ${follows?.isFollowing ? 'bg-white/10 text-white hover:bg-destructive hover:text-white' : 'bg-primary text-black hover:bg-primary/80'}`}
            >
              {toggleFollow.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 
               follows?.isFollowing ? <><UserCheck className="w-4 h-4 mr-2" /> Following</> : <><UserPlus className="w-4 h-4 mr-2" /> Follow</>}
            </Button>
          </>
        )}
      </div>

      {/* Info */}
      <div className="px-4 pb-6 border-b border-white/5">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{user.name || "Anonymous"}</h1>
          {isScene && (
            <span className="text-[10px] uppercase tracking-wider bg-secondary/20 text-secondary px-2 py-0.5 rounded font-bold">Scene Mode</span>
          )}
        </div>
        <p className="text-muted-foreground font-mono text-sm mb-4">@{user.handle || user.hash.slice(0, 8)}</p>
        
        {user.bio && (
          <p className="text-foreground/90 leading-relaxed mb-4">{user.bio}</p>
        )}

        <div className="flex gap-6 text-sm">
          <div className="flex gap-1.5">
            <span className="font-bold text-foreground">{follows?.following || 0}</span>
            <span className="text-muted-foreground">Following</span>
          </div>
          <div className="flex gap-1.5">
            <span className="font-bold text-foreground">{follows?.followers || 0}</span>
            <span className="text-muted-foreground">Followers</span>
          </div>
        </div>
      </div>

      {/* Posts */}
      <div className="flex-1">
        <div className="px-4 py-3 font-bold border-b border-white/5 text-muted-foreground">
          Broadcasts
        </div>
        {broadcastsLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : broadcasts?.length ? (
          broadcasts.map(broadcast => (
            <BroadcastCard key={broadcast.id} broadcast={broadcast} />
          ))
        ) : (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No broadcasts found.
          </div>
        )}
      </div>
    </div>
  );
}
