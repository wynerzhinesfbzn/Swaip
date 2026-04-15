import { useState } from "react";
import { useSearchUsers, getSearchUsersQueryKey } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Search as SearchIcon, Loader2, UserPlus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Link } from "wouter";

export default function Search() {
  const [query, setQuery] = useState("");
  
  const { data, isLoading } = useSearchUsers(
    { q: query },
    { 
      query: { 
        queryKey: getSearchUsersQueryKey({ q: query }),
        enabled: query.length > 0
      } 
    }
  );

  return (
    <div className="flex flex-col min-h-full p-4">
      <div className="relative mb-6">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          placeholder="Search handles or names..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-10 bg-black/50 border-white/10 rounded-full h-12 text-base focus-visible:ring-primary"
        />
      </div>

      <div className="flex-1">
        {isLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : data?.results?.length ? (
          <div className="space-y-4">
            {data.results.map((user) => (
              <Link key={user.hash} href={`/profile/${user.hash}`}>
                <div className="flex items-center gap-3 p-3 rounded-2xl hover:bg-white/5 transition-colors cursor-pointer border border-transparent hover:border-white/5">
                  <Avatar className={`w-12 h-12 border ${user.mode === 'scene' ? 'border-secondary' : 'border-primary/50'}`}>
                    <AvatarImage src={user.avatar || undefined} />
                    <AvatarFallback className="bg-black text-white">{user.name?.charAt(0) || "?"}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold truncate text-foreground">{user.name || "Anonymous"}</span>
                      {user.mode === "scene" && (
                        <span className="text-[10px] uppercase tracking-wider bg-secondary/20 text-secondary px-1.5 py-0.5 rounded flex-shrink-0">Scene</span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">@{user.handle || user.hash.slice(0, 8)}</div>
                    {user.bio && (
                      <p className="text-xs text-foreground/70 truncate mt-0.5">{user.bio}</p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : query.length > 0 ? (
          <div className="text-center text-muted-foreground py-12">
            No users found for "{query}"
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-12">
            <div className="w-16 h-16 mx-auto rounded-full bg-white/5 flex items-center justify-center mb-4">
              <UserPlus className="w-8 h-8 text-primary/50" />
            </div>
            <p>Find people to follow</p>
          </div>
        )}
      </div>
    </div>
  );
}
