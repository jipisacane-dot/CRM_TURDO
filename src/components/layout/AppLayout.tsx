import type { ReactNode } from 'react';
import { Sidebar, MobileNav } from './Sidebar';

export const AppLayout = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-screen bg-bg-main">
    <Sidebar />
    <main className="flex-1 min-w-0 pb-20 md:pb-0 overflow-y-auto">
      {children}
    </main>
    <MobileNav />
  </div>
);
