// Acting identity: who you are in the governance model. Injected as
// X-Studio-User on every same-origin request via a fetch wrapper, so every
// surface (SPARQL, virtual layer, agent, proposals) acts as the chosen user.

import { create } from 'zustand';

export interface GovUser {
  name: string;
  role: 'admin' | 'steward' | 'editor' | 'viewer';
  governs: string[];
}

interface IdentityState {
  actingUser: string;
  users: GovUser[];
  setActingUser: (name: string) => void;
  loadUsers: () => Promise<void>;
  current: () => GovUser;
}

export const useIdentity = create<IdentityState>((set, get) => ({
  actingUser: localStorage.getItem('studio.actingUser') ?? 'pat',
  users: [],
  setActingUser: (actingUser) => {
    localStorage.setItem('studio.actingUser', actingUser);
    set({ actingUser });
    // no explicit workspace chosen yet -> follow the new role's default
    if (!localStorage.getItem('studio.workspace')) {
      const role = get().users.find((u) => u.name === actingUser)?.role ?? 'viewer';
      import('./workspace').then(({ useWorkspace, roleDefaultWorkspace }) =>
        useWorkspace.getState().setWorkspace(roleDefaultWorkspace(role))
      );
    }
  },
  loadUsers: async () => {
    try {
      const res = await fetch('/api/governance/users');
      if (res.ok) set({ users: await res.json() });
    } catch { /* server offline */ }
  },
  current: () => {
    const { users, actingUser } = get();
    return users.find((u) => u.name === actingUser) ?? { name: actingUser, role: 'viewer', governs: [] };
  },
}));

let installed = false;

/** Wrap fetch once: same-origin /db and /api requests carry the acting user. */
export function startIdentity() {
  if (installed) return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('/db') || url.startsWith('/api')) {
      const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has('X-Studio-User')) headers.set('X-Studio-User', useIdentity.getState().actingUser);
      return original(input, { ...init, headers });
    }
    return original(input, init);
  };
  useIdentity.getState().loadUsers();
}
