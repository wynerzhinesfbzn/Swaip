import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useGetAccount, useUpdateAccount, getGetAccountQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function Me() {
  const { hash, mode } = useAuth();
  const queryClient = useQueryClient();
  
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");

  const { data: account, isLoading } = useGetAccount(
    hash,
    { query: { queryKey: getGetAccountQueryKey(hash), enabled: !!hash } }
  );

  const updateMutation = useUpdateAccount({
    request: { headers: { "x-user-hash": hash } }
  });

  useEffect(() => {
    if (account) {
      const user = account.data || account as any;
      setName(user.name || "");
      setHandle(user.handle || "");
      setBio(user.bio || "");
      setAvatar(user.avatar || "");
    }
  }, [account]);

  const handleSave = () => {
    updateMutation.mutate({
      hash,
      data: { data: { name, handle, bio, avatar, mode } }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey(hash) });
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

  const isScene = mode === 'scene';

  return (
    <div className="flex flex-col min-h-full p-4 max-w-md mx-auto">
      <div className="mb-8 mt-4 text-center">
        <h1 className="text-2xl font-bold tracking-tight mb-2">Edit Persona</h1>
        <p className="text-sm text-muted-foreground">
          Currently editing <span className={`font-bold ${isScene ? 'text-secondary' : 'text-primary'}`}>{mode.toUpperCase()}</span> mode
        </p>
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-4 mb-2">
          <Avatar className={`w-24 h-24 border-2 ${isScene ? 'border-secondary' : 'border-primary/50'}`}>
            <AvatarImage src={avatar || undefined} />
            <AvatarFallback className="bg-black text-2xl font-bold">{name?.charAt(0) || "?"}</AvatarFallback>
          </Avatar>
          <div className="w-full">
            <Label className="text-xs text-muted-foreground mb-1.5 block text-center">Avatar URL</Label>
            <Input 
              value={avatar} 
              onChange={(e) => setAvatar(e.target.value)} 
              placeholder="https://..."
              className="bg-black/50 border-white/10 text-center"
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-muted-foreground">Display Name</Label>
            <Input 
              id="name"
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              placeholder={isScene ? "Your stage name" : "Your real name"}
              className="bg-black/50 border-white/10 focus-visible:ring-primary h-12"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="handle" className="text-muted-foreground">Handle</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
              <Input 
                id="handle"
                value={handle} 
                onChange={(e) => setHandle(e.target.value)} 
                placeholder="username"
                className="pl-8 bg-black/50 border-white/10 focus-visible:ring-primary h-12 font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bio" className="text-muted-foreground">Bio</Label>
            <Textarea 
              id="bio"
              value={bio} 
              onChange={(e) => setBio(e.target.value)} 
              placeholder="Tell the world..."
              className="bg-black/50 border-white/10 focus-visible:ring-primary min-h-[100px] resize-none"
            />
          </div>
        </div>

        <Button 
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className={`w-full mt-4 h-12 font-bold text-lg rounded-full ${isScene ? 'bg-secondary hover:bg-secondary/80 text-white' : 'bg-primary hover:bg-primary/80 text-black'}`}
        >
          {updateMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Save className="w-5 h-5 mr-2" />}
          Save Persona
        </Button>
        
        <div className="text-center mt-6 text-xs text-muted-foreground font-mono">
          Your Identity Hash: <br/>
          <span className="text-foreground/50 select-all break-all">{hash}</span>
        </div>
      </div>
    </div>
  );
}
