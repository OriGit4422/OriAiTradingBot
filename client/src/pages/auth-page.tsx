import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, registerSchema, resetPasswordSchema } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, TrendingUp, Shield, Zap, ArrowRight, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import { z } from "zod";

export default function AuthPage() {
  const [tab, setTab] = useState("login");
  const [showReset, setShowReset] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login, register } = useAuth();
  const { toast } = useToast();

  const loginForm = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const registerForm = useForm({ resolver: zodResolver(registerSchema), defaultValues: { email: "", password: "", name: "" } });
  const resetForm = useForm({ resolver: zodResolver(resetPasswordSchema), defaultValues: { email: "" } });

  const handleLogin = async (data: z.infer<typeof loginSchema>) => {
    try {
      await login(data.email, data.password);
      toast({ title: "Welcome back!", description: "Successfully logged in." });
    } catch (e: any) {
      toast({ title: "Login failed", description: e.message, variant: "destructive" });
    }
  };

  const handleRegister = async (data: z.infer<typeof registerSchema>) => {
    try {
      await register(data.email, data.password, data.name);
      toast({ title: "Account created!", description: "Welcome to CryptoBot AI." });
    } catch (e: any) {
      toast({ title: "Registration failed", description: e.message, variant: "destructive" });
    }
  };

  const handleReset = async (data: z.infer<typeof resetPasswordSchema>) => {
    try {
      await apiRequest("POST", "/api/auth/forgot-password", data);
      toast({ title: "Check your email", description: "If that email is registered, a password reset link has been sent." });
      setShowReset(false);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  if (showReset) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center">
                <Shield className="w-6 h-6 text-primary" />
              </div>
              <CardTitle className="text-xl">Reset Password</CardTitle>
              <CardDescription>Enter your email to receive a reset link</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...resetForm}>
                <form onSubmit={resetForm.handleSubmit(handleReset)} className="space-y-4">
                  <FormField control={resetForm.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input data-testid="input-reset-email" type="email" placeholder="your@email.com" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button data-testid="button-send-reset" type="submit" className="w-full" disabled={resetForm.formState.isSubmitting}>
                    {resetForm.formState.isSubmitting ? "Sending..." : "Send Reset Link"}
                  </Button>
                  <Button data-testid="button-back-login" type="button" variant="ghost" className="w-full" onClick={() => setShowReset(false)}>
                    Back to Login
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col lg:flex-row">
      <div className="hidden lg:flex lg:w-1/2 bg-primary/5 relative items-center justify-center p-12">
        <div className="max-w-lg">
          <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6 }}>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-12 h-12 rounded-md bg-primary flex items-center justify-center">
                <Bot className="w-7 h-7 text-primary-foreground" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">CryptoBot AI</h1>
            </div>
            <p className="text-lg text-muted-foreground mb-12 leading-relaxed">
              AI-powered cryptocurrency trading bot with real-time signals, advanced strategies, and intelligent risk management.
            </p>
            <div className="space-y-6">
              {[
                { icon: TrendingUp, title: "AI Trading Signals", desc: "Real-time buy/sell signals with confidence scores" },
                { icon: Zap, title: "Automated Strategies", desc: "Create and deploy custom trading strategies" },
                { icon: Shield, title: "Risk Management", desc: "Advanced stop-loss and position sizing controls" },
              ].map((f, i) => (
                <motion.div key={f.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.15 }} className="flex gap-4">
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <f.icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{f.title}</h3>
                    <p className="text-sm text-muted-foreground">{f.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4 lg:p-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center">
              <Bot className="w-6 h-6 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">CryptoBot AI</h1>
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full grid grid-cols-2 mb-6">
              <TabsTrigger data-testid="tab-login" value="login">Sign In</TabsTrigger>
              <TabsTrigger data-testid="tab-register" value="register">Create Account</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <Card>
                <CardHeader>
                  <CardTitle>Welcome back</CardTitle>
                  <CardDescription>Sign in to your trading dashboard</CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...loginForm}>
                    <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
                      <FormField control={loginForm.control} name="email" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl><Input data-testid="input-login-email" type="email" placeholder="your@email.com" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={loginForm.control} name="password" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input data-testid="input-login-password" type={showPassword ? "text" : "password"} placeholder="Enter password" {...field} />
                              <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 no-default-hover-elevate no-default-active-elevate" onClick={() => setShowPassword(!showPassword)}>
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </Button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <Button data-testid="button-login" type="submit" className="w-full" disabled={loginForm.formState.isSubmitting}>
                        {loginForm.formState.isSubmitting ? "Signing in..." : "Sign In"}
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                      <Button data-testid="button-forgot-password" type="button" variant="link" className="w-full text-sm" onClick={() => setShowReset(true)}>
                        Forgot your password?
                      </Button>
                    </form>
                  </Form>
                  <div className="mt-4 p-3 rounded-md bg-muted/50 text-xs text-muted-foreground">
                    <p className="font-medium mb-1">Demo Accounts:</p>
                    <p>Admin: admin@cryptobot.com / admin123</p>
                    <p>Trader: trader@cryptobot.com / trader123</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="register">
              <Card>
                <CardHeader>
                  <CardTitle>Create account</CardTitle>
                  <CardDescription>Start your AI trading journey</CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...registerForm}>
                    <form onSubmit={registerForm.handleSubmit(handleRegister)} className="space-y-4">
                      <FormField control={registerForm.control} name="name" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full Name</FormLabel>
                          <FormControl><Input data-testid="input-register-name" placeholder="John Doe" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={registerForm.control} name="email" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl><Input data-testid="input-register-email" type="email" placeholder="your@email.com" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={registerForm.control} name="password" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl><Input data-testid="input-register-password" type="password" placeholder="Min 6 characters" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <Button data-testid="button-register" type="submit" className="w-full" disabled={registerForm.formState.isSubmitting}>
                        {registerForm.formState.isSubmitting ? "Creating..." : "Create Account"}
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </div>
  );
}
