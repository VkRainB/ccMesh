import { create } from "zustand";

interface UpdateState {
  available: boolean;
  version: string;
  set: (available: boolean, version: string) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  available: false,
  version: "",
  set: (available, version) => set({ available, version }),
}));
