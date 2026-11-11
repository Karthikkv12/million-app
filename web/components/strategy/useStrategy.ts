"use client";
/** The owner's strategy (GET /strategy). Saving refreshes the desk's books. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchStrategy, saveStrategy, StrategyInfo, StrategyState, StrategyUpdate } from "@/lib/api";

export function useStrategy() {
  const qc = useQueryClient();
  const q = useQuery<StrategyState>({ queryKey: ["strategy"], queryFn: fetchStrategy, staleTime: 60_000 });
  const save = useMutation({
    mutationFn: (body: StrategyUpdate) => saveStrategy(body),
    onSuccess: (st) => {
      qc.setQueryData<StrategyState>(["strategy"], (old) => (old ? { ...old, ...st } : old));
      qc.invalidateQueries({ queryKey: ["hedge-books"] });          // the desk's actions follow the strategy
    },
  });
  const current: StrategyInfo | undefined = q.data?.strategies.find((s) => s.key === q.data?.strategy);
  return { ...q, current, save };
}
