import type { ReactNode } from 'react';
import { BrandWordmark } from '../brand_wordmark';
import { ThemeToggleButton } from '../theme_toggle_button';

const GRID_VERTICAL_LINES = 12;
const GRID_HORIZONTAL_LINES = 18;
const GRID_STEP = 55;

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <section className="auth-hero" aria-hidden="true">
        <svg className="auth-hero-grid" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice">
          {Array.from({ length: GRID_VERTICAL_LINES }, (_, i) => (
            <line key={`v${i}`} x1={i * GRID_STEP} y1="0" x2={i * GRID_STEP} y2="800" />
          ))}
          {Array.from({ length: GRID_HORIZONTAL_LINES }, (_, i) => (
            <line key={`h${i}`} x1="0" y1={i * GRID_STEP} x2="600" y2={i * GRID_STEP} />
          ))}
          <line x1="0" y1="800" x2="600" y2="0" className="auth-hero-diagonal" />
          <line x1="120" y1="800" x2="600" y2="180" className="auth-hero-diagonal auth-hero-diagonal-faint" />
        </svg>
        <div className="auth-hero-glow" />
        <BrandWordmark size="lg" />
        <div className="auth-hero-copy">
          <p className="auth-hero-title">
            Think faster.
            <br />
            <span>Work smarter.</span>
          </p>
          <p className="auth-hero-subtitle">
            Your notes, searchable and ready to talk through - by typing or out loud.
          </p>
        </div>
        <div className="auth-hero-badges">
          <span className="badge">Private beta</span>
        </div>
      </section>

      <main className="auth-main">
        {/* The rail's settings menu is the only other way to switch themes, and it isn't here. */}
        <ThemeToggleButton className="auth-theme-toggle" />
        <div className="auth-column">
          <div className="auth-compact-brand">
            <BrandWordmark size="lg" />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
