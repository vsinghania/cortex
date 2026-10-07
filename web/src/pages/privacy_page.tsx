import { Link } from 'react-router-dom';
import { BrandWordmark } from '../components/brand_wordmark';
import { ThemeToggleButton } from '../components/theme_toggle_button';
import { AppRoutes } from '../lib/app_routes';
import { LegalInfo } from '../lib/legal_info';

const CONTACT = LegalInfo.PRIVACY_CONTACT_EMAIL;

export function PrivacyPage() {
  const mail = <a className="text-link" href={`mailto:${CONTACT}`}>{CONTACT}</a>;

  return (
    <div className="legal-shell">
      <header className="legal-header">
        <div className="legal-header-inner">
          <Link to={AppRoutes.notes()} aria-label="Cortex home">
            <BrandWordmark />
          </Link>
          <ThemeToggleButton />
        </div>
      </header>

      <main className="legal-main">
        <article className="legal-article">
          <h1>Privacy Policy</h1>
          <p className="legal-updated">Last updated {LegalInfo.PRIVACY_POLICY_UPDATED}</p>

          <p className="legal-lead">
            Cortex is a notes app with an AI assistant. This page explains what we collect, why, who
            else handles it, and what you can do about it. Cortex is in private beta, so we keep things
            simple: no ads, no analytics or tracking, and we never sell your data.
          </p>

          <h2>What we collect</h2>
          <h3>Account information</h3>
          <ul>
            <li>Your <strong>name</strong> and <strong>email address</strong>.</li>
            <li>
              Your <strong>password</strong>, if you set one. We only store a one-way hash of it (bcrypt),
              never the password itself.
            </li>
            <li>
              If you sign in with Google: your Google <strong>account identifier</strong>, and the name,
              email address and email verification status Google shares with us. We don't request access
              to your contacts, Drive, Gmail or any other Google data.
            </li>
            <li>
              If you connect OneNote: the <strong>email address</strong> of the Microsoft account you
              connected, and an access grant that lets Cortex read your OneNote notebooks. The grant is
              encrypted before it is stored, and we request read-only access — Cortex never writes to or
              deletes anything in OneNote. You can disconnect at any time from Settings.
            </li>
            <li>When you signed up, last signed in, and verified your email address.</li>
          </ul>

          <h3>Your content</h3>
          <ul>
            <li>Notes, folders and tags you create.</li>
            <li>Conversations with the assistant.</li>
            <li>
              Voice notes you choose to save, including the transcript. Voice conversations that you don't
              save aren't stored by Cortex.
            </li>
            <li>A search index built from your notes, so the assistant can find relevant passages.</li>
          </ul>

          <h3>Technical information</h3>
          <ul>
            <li>
              For each signed-in session: the <strong>IP address</strong> and <strong>browser user agent</strong>{' '}
              it started from, so sessions can be secured and revoked.
            </li>
            <li>
              Server logs: request paths, response codes, timings and your account ID. For failed requests
              they can also include request headers such as your IP address and browser. Sign-in secrets
              are removed. Logs rotate automatically and are not archived.
            </li>
          </ul>

          <h2>How we use it</h2>
          <ul>
            <li>To run Cortex: store your notes, sign you in, and keep your account secure.</li>
            <li>
              To power AI features: search, assistant answers, filing suggestions and voice. These only
              process your content when you use them.
            </li>
            <li>To send account emails, such as email verification and password resets. No marketing email.</li>
            <li>To investigate errors and abuse.</li>
          </ul>
          <p>We don't use your content to train AI models, and we don't sell or rent your data to anyone.</p>

          <h2>Who else handles your data</h2>
          <p>We use a small number of service providers, each only for the purpose listed:</p>
          <div className="legal-table-wrap">
            <table className="legal-table">
              <thead>
                <tr><th>Provider</th><th>Purpose</th><th>Data involved</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>OpenAI</td>
                  <td>AI features: search indexing, the assistant, and voice</td>
                  <td>
                    Note text, assistant messages and relevant note excerpts; during voice sessions, your audio
                    goes directly from your browser to OpenAI
                  </td>
                </tr>
                <tr>
                  <td>Amazon Web Services</td>
                  <td>Hosting the app, database and backups (United States)</td>
                  <td>Everything Cortex stores</td>
                </tr>
                <tr>
                  <td>Resend</td>
                  <td>Delivering account emails</td>
                  <td>Your email address, name and the email's contents</td>
                </tr>
                <tr>
                  <td>Google</td>
                  <td>Sign in with Google, only if you use it</td>
                  <td>The sign-in exchange described above</td>
                </tr>
                <tr>
                  <td>Microsoft</td>
                  <td>Connecting OneNote, only if you use it</td>
                  <td>The sign-in exchange described above, and read-only access to your OneNote content</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            OpenAI processes data sent through its API under its own{' '}
            <a className="text-link" href="https://openai.com/policies/privacy-policy/" target="_blank" rel="noreferrer">
              policies
            </a>
            , which state that API data is not used to train its models by default.
          </p>
          <p>We may also disclose information if required by law, or to protect the safety of our users.</p>

          <h2>Cookies and local storage</h2>
          <ul>
            <li>
              <strong>Sign-in cookie</strong>: one HttpOnly cookie that keeps you signed in. It expires after 7
              days without use, or when you sign out.
            </li>
            <li>
              <strong>Google sign-in cookie</strong>: a temporary cookie that protects the sign-in flow. It's
              deleted as soon as you return from Google, and expires after 10 minutes.
            </li>
            <li>
              <strong>Local storage</strong>: your theme and a few layout preferences, kept only in your browser.
            </li>
          </ul>
          <p>No analytics, advertising or third-party tracking cookies. Our fonts are served by Cortex itself.</p>

          <h2>How long we keep it</h2>
          <ul>
            <li>Your account and content: until you delete them, or ask us to delete your account.</li>
            <li>Deleted notes and conversations: kept in trash for 30 days, then permanently removed.</li>
            <li>Sign-in sessions: expire after 7 days without use.</li>
            <li>Password reset and verification links: expire after 30 minutes and 24 hours respectively.</li>
            <li>Backups: daily snapshots are kept for 7 days, so deleted data can remain in backups for up to a week.</li>
          </ul>

          <h2>Your choices and rights</h2>
          <ul>
            <li><strong>Access or export</strong> a copy of your data: email us.</li>
            <li><strong>Correct</strong> your information: email us.</li>
            <li>
              <strong>Delete your account</strong> and all its content: email us from the address on your account.
              We'll confirm when it's done.
            </li>
            <li>
              <strong>Disconnect Google</strong>: remove Cortex from your{' '}
              <a className="text-link" href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">
                Google account connections
              </a>
              . This stops future Google sign-ins; it doesn't delete your Cortex account.
            </li>
            <li>
              <strong>Disconnect OneNote</strong>: use Disconnect in Settings. Cortex stops reading from
              OneNote and deletes the stored access grant. Notes already imported stay in Cortex, and
              nothing in OneNote is changed.
            </li>
          </ul>
          <p>
            Depending on where you live, you may have further rights under laws such as the GDPR or CCPA,
            including objecting to processing or complaining to a data protection authority. Email us and we'll
            respond within 30 days.
          </p>

          <h2>Security</h2>
          <p>
            Data is encrypted in transit with HTTPS. Passwords are hashed, sign-in tokens are stored only as
            hashes, and access tokens expire after 15 minutes. No system is perfectly secure, but we'll tell you
            promptly if a breach affects your data.
          </p>

          <h2>Children</h2>
          <p>
            Cortex isn't intended for children under 13, or under 16 in the EEA and UK. We don't knowingly
            collect their data; contact us if you believe a child has created an account and we'll delete it.
          </p>

          <h2>Changes to this policy</h2>
          <p>
            We'll update the date at the top when this policy changes. If we make a material change, such as
            collecting new kinds of data or using it in new ways, we'll tell you before it takes effect, by email
            or with a notice in Cortex.
          </p>

          <h2>Contact</h2>
          <p>Questions or requests about your privacy: {mail}.</p>
        </article>
      </main>
    </div>
  );
}
