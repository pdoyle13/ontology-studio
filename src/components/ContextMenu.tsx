// Generic context menu: any surface opens it via the ui store with positioned
// items; Escape / click-away / action dismisses.

import { useEffect, useRef } from 'react';
import { create } from 'zustand';

export interface MenuItem {
    label: string;
    onClick?: () => void;
    danger?: boolean;
    separator?: boolean;
    disabled?: boolean;
}

interface MenuState {
    x: number;
    y: number;
    items: MenuItem[];
    open: boolean;
    show: (x: number, y: number, items: MenuItem[]) => void;
    hide: () => void;
}

export const useContextMenu = create<MenuState>((set) => ({
    x: 0,
    y: 0,
    items: [],
    open: false,
    show: (x, y, items) => set({ x, y, items, open: true }),
    hide: () => set({ open: false }),
}));

export function ContextMenu() {
    const { x, y, items, open, hide } = useContextMenu();
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const away = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) hide();
        };
        const key = (e: KeyboardEvent) => e.key === 'Escape' && hide();
        window.addEventListener('mousedown', away);
        window.addEventListener('keydown', key);
        return () => {
            window.removeEventListener('mousedown', away);
            window.removeEventListener('keydown', key);
        };
    }, [open, hide]);

    if (!open) return null;
    // keep the menu on-screen
    const style = {
        left: Math.min(x, window.innerWidth - 230),
        top: Math.min(y, window.innerHeight - items.length * 30 - 16),
    };
    return (
        <div ref={ref} className="context-menu" style={style}>
            {items.map((item, i) =>
                item.separator ? (
                    <div key={i} className="menu-sep" />
                ) : (
                    <button
                        key={i}
                        className={`menu-item ${item.danger ? 'danger-text' : ''}`}
                        disabled={item.disabled}
                        onClick={() => {
                            hide();
                            item.onClick?.();
                        }}
                    >
                        {item.label}
                    </button>
                ),
            )}
        </div>
    );
}
