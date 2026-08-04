import { useQuery } from "@tanstack/react-query";

import { petApi } from "@/services/modules/pet";

export function usePets() {
  return useQuery({ queryKey: ["pets"], queryFn: petApi.list });
}
