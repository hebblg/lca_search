export default function PrivacyPage() {
  return (
    <div className="card">
      <h1>Privacy Policy</h1>
      <p>
        This site is designed to be usable without creating an account. We aim to
        collect as little personal information as possible.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Basic usage data (optional):</strong> We may use privacy-minded
          analytics to understand overall traffic trends (e.g., page views, broad
          location, device type). This data is aggregated and not intended to
          identify you personally.
        </li>
        <li>
          <strong>Cookies/local storage:</strong> We may store preferences (for
          example, pagination or UI settings). We do not use these to track you
          across other websites.
        </li>
        <li>
          <strong>Contact messages:</strong> If you contact us, we receive the
          information you choose to provide (such as your email address and
          message content).
        </li>
      </ul>

      <h2>What we do not do</h2>
      <ul>
        <li>We do not sell personal information.</li>
        <li>We do not knowingly collect information from children.</li>
        <li>
          We do not publish personal contact details from LCA filings beyond what
          is present in the public disclosure dataset.
        </li>
      </ul>

      <h2>Data source disclaimer</h2>
      <p className="small">
        LCA records are public disclosure data. This site is informational only
        and not legal advice. An LCA record does not indicate petition approval
        or employment.
      </p>

      <h2>Contact</h2>
      <p>
        For privacy questions, please contact us via the Contact page.
      </p>
    </div>
  );
}
