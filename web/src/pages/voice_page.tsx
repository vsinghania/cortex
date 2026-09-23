import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppRail } from '../components/app_rail';
import { MobileShell } from '../components/mobile/mobile_shell';
import { MobileBar, MobileBarButton, MobileBarTitle } from '../components/mobile/mobile_bar';
import { VerifyBanner } from '../components/verify_banner';
import { VoiceView } from '../components/assistant/voice_view';
import { AppRoutes } from '../lib/app_routes';
import { useIsMobile } from '../lib/use_is_mobile';
import { VoiceLaunch } from '../lib/voice_launch';

const TITLE = 'Voice';
const SUBTITLE = 'Talk to your notes';

export function VoicePage() {
  const is_mobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();
  const autostart = VoiceLaunch.wantsAutostart(location.state);

  // Consumed once, so a reload or a back-navigation to this entry doesn't open the mic again.
  useEffect(() => {
    if (autostart) navigate(location.pathname, { replace: true, state: null });
  }, [autostart, location.pathname, navigate]);

  const rail = (variant: 'rail' | 'drawer', onClose?: () => void) => (
    <AppRail
      variant={variant}
      onClose={onClose}
      action={{ label: 'New note', icon: 'plus', onClick: () => navigate(AppRoutes.newNote()) }}
    />
  );

  if (is_mobile) {
    // The orb and its controls need the full height, so the tab bar steps aside as on a thread.
    return (
      <MobileShell rail={(close) => rail('drawer', close)} show_tabs={false}>
        {(openDrawer) => (
          <div className="m-body">
            <MobileBar>
              <MobileBarButton label="Menu" icon="menu" onClick={openDrawer} />
              <MobileBarTitle title={TITLE} subtitle={SUBTITLE} />
            </MobileBar>
            <VoiceView autostart={autostart} />
          </div>
        )}
      </MobileShell>
    );
  }

  return (
    <div className="workspace">
      {rail('rail')}
      <div className="workspace-main">
        <VerifyBanner />
        <header className="toolbar">
          <div className="toolbar-crumbs">
            <span className="crumb-current">{TITLE}</span>
            <span className="crumb-muted">{SUBTITLE}</span>
          </div>
        </header>
        <VoiceView autostart={autostart} />
      </div>
    </div>
  );
}
