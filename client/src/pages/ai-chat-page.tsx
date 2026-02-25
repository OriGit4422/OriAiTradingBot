import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Brain, Send, Plus, Trash2, MessageSquare, Bot, User, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Conversation, Message } from "@shared/schema";

export default function AIChatPage() {
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [inputMsg, setInputMsg] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { data: conversations, isLoading: convsLoading } = useQuery<Conversation[]>({ queryKey: ["/api/conversations"] });
  const { data: messages, isLoading: msgsLoading } = useQuery<Message[]>({
    queryKey: ["/api/conversations", activeConvId, "messages"],
    enabled: !!activeConvId,
  });

  const createConvMutation = useMutation({
    mutationFn: (title: string) => apiRequest("POST", "/api/conversations", { title }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setActiveConvId(data.id);
    },
  });

  const deleteConvMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/conversations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      if (activeConvId) setActiveConvId(null);
    },
  });

  const sendMsgMutation = useMutation({
    mutationFn: (content: string) => apiRequest("POST", `/api/conversations/${activeConvId}/messages`, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", activeConvId, "messages"] });
      setInputMsg("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sendMsgMutation.isPending]);

  const handleSend = () => {
    const msg = inputMsg.trim();
    if (!msg || !activeConvId) return;
    sendMsgMutation.mutate(msg);
  };

  const handleNewChat = () => {
    createConvMutation.mutate("New Chat");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const suggestedPrompts = [
    "What's the current BTC market outlook?",
    "Explain RSI and MACD indicators for crypto",
    "Best risk management strategies for day trading",
    "Analyze ETH/USDT for potential swing trades",
    "Compare scalping vs swing trading strategies",
    "What are the key support levels for SOL?",
  ];

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)]">
      <div className="w-full lg:w-72 border-b lg:border-b-0 lg:border-r bg-muted/30 flex flex-col">
        <div className="p-3 border-b">
          <Button data-testid="button-new-chat" className="w-full" onClick={handleNewChat} disabled={createConvMutation.isPending}>
            <Plus className="w-4 h-4 mr-2" />New Chat
          </Button>
        </div>
        <ScrollArea className="flex-1 max-h-32 lg:max-h-none">
          <div className="p-2 space-y-1">
            {convsLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
            ) : conversations?.length === 0 ? (
              <p className="text-xs text-center text-muted-foreground py-4">No conversations yet</p>
            ) : (
              conversations?.map(c => (
                <div key={c.id}
                  className={`flex items-center gap-2 p-2 rounded-md cursor-pointer group transition-colors
                    ${activeConvId === c.id ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                  onClick={() => setActiveConvId(c.id)}
                  data-testid={`button-conversation-${c.id}`}
                >
                  <MessageSquare className="w-4 h-4 shrink-0" />
                  <span className="text-sm truncate flex-1">{c.title}</span>
                  <Button variant="ghost" size="sm" className="w-6 h-6 p-0 opacity-0 group-hover:opacity-100"
                    onClick={(e) => { e.stopPropagation(); deleteConvMutation.mutate(c.id); }}
                    data-testid={`button-delete-conv-${c.id}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {!activeConvId ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center max-w-lg">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Brain className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-2xl font-bold mb-2" data-testid="text-ai-chat-title">WINM AI Assistant</h2>
              <p className="text-muted-foreground mb-6">
                Powered by Claude AI. Ask about market analysis, trading strategies, risk management, and crypto insights.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {suggestedPrompts.map((prompt, i) => (
                  <Button key={i} variant="outline" className="text-left text-xs h-auto py-2 px-3 justify-start"
                    data-testid={`button-suggested-prompt-${i}`}
                    onClick={() => {
                      if (!activeConvId) {
                        createConvMutation.mutate(prompt.slice(0, 40));
                        setInputMsg(prompt);
                      }
                    }}
                  >
                    <Sparkles className="w-3 h-3 mr-2 shrink-0 text-primary" />
                    <span className="truncate">{prompt}</span>
                  </Button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b px-4 py-3 flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary" />
              <span className="font-semibold text-sm">WINM AI</span>
              <Badge variant="secondary" className="text-xs gap-1"><Sparkles className="w-2.5 h-2.5" />Claude</Badge>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
              {msgsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-3/4" />)}
                </div>
              ) : messages?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Send a message to start the conversation</p>
                </div>
              ) : (
                <AnimatePresence>
                  {messages?.map((msg, i) => (
                    <motion.div key={msg.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                      className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
                    >
                      {msg.role === "assistant" && (
                        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                          <Bot className="w-4 h-4 text-primary" />
                        </div>
                      )}
                      <div className={`max-w-[80%] rounded-lg p-3 text-sm leading-relaxed whitespace-pre-wrap
                        ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                        data-testid={`text-message-${msg.id}`}
                      >
                        {msg.content}
                      </div>
                      {msg.role === "user" && (
                        <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                          <User className="w-4 h-4" />
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
              {sendMsgMutation.isPending && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-primary animate-pulse" />
                  </div>
                  <div className="bg-muted rounded-lg p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" />
                        <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0.1s" }} />
                        <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0.2s" }} />
                      </div>
                      <span className="text-muted-foreground text-xs">Claude is thinking...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t p-4">
              <div className="flex gap-2">
                <Textarea
                  data-testid="input-ai-chat"
                  value={inputMsg}
                  onChange={e => setInputMsg(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about crypto trading, market analysis, strategies..."
                  className="min-h-[44px] max-h-32 resize-none"
                  rows={1}
                />
                <Button data-testid="button-send-message" onClick={handleSend} disabled={!inputMsg.trim() || sendMsgMutation.isPending}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Press Enter to send, Shift+Enter for new line</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
