import type { ReactNode } from 'react';
import { BrandMark } from './brand_mark';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <BrandMark size="lg" />
        <span>cortex</span>
      </div>
      {children}
    </div>
  );
}
