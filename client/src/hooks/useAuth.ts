import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn, clearCsrfToken } from "@/lib/queryClient";

interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string;
  onboardingCompleted?: boolean;
  isDemo?: boolean;
  totpEnabled?: boolean;
}

export function useAuth() {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/v1/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: async (data: { email: string; password: string; turnstileToken?: string }) => {
      const res = await apiRequest("POST", "/api/v1/auth/login", data);
      return res.json();
    },
    onSuccess: () => {
      clearCsrfToken();
      queryClient.invalidateQueries({ queryKey: ["/api/v1/auth/me"] });
    },
  });

  const googleLoginMutation = useMutation({
    mutationFn: async (data: { credential: string }) => {
      const res = await apiRequest("POST", "/api/v1/auth/google", data);
      return res.json();
    },
    onSuccess: () => {
      clearCsrfToken();
      queryClient.invalidateQueries({ queryKey: ["/api/v1/auth/me"] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; password: string; referralCode?: string; turnstileToken?: string }) => {
      const res = await apiRequest("POST", "/api/v1/auth/register", data);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/v1/auth/me"] });
      }
    },
  });

  const resendVerificationMutation = useMutation({
    mutationFn: async (data: { email: string }) => {
      const res = await apiRequest("POST", "/api/v1/auth/resend-verification", data);
      return res.json();
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/v1/auth/logout");
    },
    onSuccess: () => {
      clearCsrfToken();
      queryClient.clear();
      queryClient.setQueryData(["/api/v1/auth/me"], null);
    },
  });

  return {
    user: user ?? null,
    isLoading,
    isAuthenticated: !!user,
    login: loginMutation,
    googleLogin: googleLoginMutation,
    register: registerMutation,
    resendVerification: resendVerificationMutation,
    logout: logoutMutation,
  };
}
