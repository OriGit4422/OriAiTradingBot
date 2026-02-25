import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Shield, Trash2, UserCheck, UserX, Crown } from "lucide-react";
import { motion } from "framer-motion";

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  avatarColor: string;
  lastLogin: string | null;
};

export default function AdminPage() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const { data: users, isLoading } = useQuery<AdminUser[]>({ queryKey: ["/api/admin/users"] });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AdminUser> }) => apiRequest("PATCH", `/api/admin/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User deleted" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-4">
        <Skeleton className="h-10 w-48" />
        <Card><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
      </div>
    );
  }

  const totalUsers = users?.length || 0;
  const activeUsers = users?.filter(u => u.isActive).length || 0;
  const adminUsers = users?.filter(u => u.role === "admin").length || 0;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight" data-testid="text-admin-title">Admin Panel</h1>
        <p className="text-muted-foreground mt-1">Manage users, roles, and permissions</p>
      </div>

      <div className="grid grid-cols-3 gap-3 lg:gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-1 mb-2">
                <p className="text-xs lg:text-sm text-muted-foreground font-medium">Total Users</p>
                <Users className="w-4 h-4 text-primary" />
              </div>
              <p className="text-xl lg:text-2xl font-bold" data-testid="text-total-users">{totalUsers}</p>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-1 mb-2">
                <p className="text-xs lg:text-sm text-muted-foreground font-medium">Active</p>
                <UserCheck className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-xl lg:text-2xl font-bold text-emerald-500" data-testid="text-active-users">{activeUsers}</p>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-1 mb-2">
                <p className="text-xs lg:text-sm text-muted-foreground font-medium">Admins</p>
                <Crown className="w-4 h-4 text-amber-500" />
              </div>
              <p className="text-xl lg:text-2xl font-bold text-amber-500" data-testid="text-admin-count">{adminUsers}</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />User Management
            </CardTitle>
            <CardDescription>Manage user roles and access permissions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="hidden lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.map((user) => (
                    <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="w-8 h-8">
                            <AvatarFallback style={{ backgroundColor: user.avatarColor || "#3B82F6" }} className="text-white text-xs font-bold">
                              {user.name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-sm">{user.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{user.email}</TableCell>
                      <TableCell>
                        <Select
                          value={user.role}
                          onValueChange={(role) => updateMutation.mutate({ id: user.id, data: { role } })}
                          disabled={user.id === currentUser?.id}
                        >
                          <SelectTrigger data-testid={`select-role-${user.id}`} className="w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">User</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="viewer">Viewer</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Switch
                          data-testid={`switch-user-active-${user.id}`}
                          checked={user.isActive}
                          onCheckedChange={(isActive) => updateMutation.mutate({ id: user.id, data: { isActive } })}
                          disabled={user.id === currentUser?.id}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : "Never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          data-testid={`button-delete-user-${user.id}`}
                          variant="destructive"
                          size="sm"
                          disabled={user.id === currentUser?.id}
                          onClick={() => deleteMutation.mutate(user.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="lg:hidden space-y-3">
              {users?.map((user) => (
                <Card key={user.id} data-testid={`card-user-mobile-${user.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar className="w-8 h-8 shrink-0">
                          <AvatarFallback style={{ backgroundColor: user.avatarColor || "#3B82F6" }} className="text-white text-xs font-bold">
                            {user.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{user.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                        </div>
                      </div>
                      <Badge variant={user.isActive ? "default" : "outline"} className="text-xs shrink-0">
                        {user.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Select
                        value={user.role}
                        onValueChange={(role) => updateMutation.mutate({ id: user.id, data: { role } })}
                        disabled={user.id === currentUser?.id}
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex gap-2">
                        <Switch
                          checked={user.isActive}
                          onCheckedChange={(isActive) => updateMutation.mutate({ id: user.id, data: { isActive } })}
                          disabled={user.id === currentUser?.id}
                        />
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={user.id === currentUser?.id}
                          onClick={() => deleteMutation.mutate(user.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
