// Cross-component UI state: dialogs and panel focus that any surface
// (including the agent's intent chips) can drive.

import { create } from 'zustand';

interface UiState {
  importExportOpen: boolean;
  setImportExportOpen: (open: boolean) => void;
  rightTab: 'inspector' | 'agent';
  setRightTab: (tab: 'inspector' | 'agent') => void;
  addPropertyIntent: boolean;
  setAddPropertyIntent: (v: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  importExportOpen: false,
  setImportExportOpen: (importExportOpen) => set({ importExportOpen }),
  rightTab: 'agent', // agentic-first: the conversation is the front door
  setRightTab: (rightTab) => set({ rightTab }),
  addPropertyIntent: false,
  setAddPropertyIntent: (addPropertyIntent) => set({ addPropertyIntent }),
}));
