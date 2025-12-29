export default function TermsPage() {
  return (
    <div className="card">
      <h1>Terms of Use</h1>
      <p>
        By accessing or using this website, you agree to these Terms of Use. If
        you do not agree, please do not use the site.
      </p>

      <h2>Disclaimers</h2>
      <ul>
        <li>
          <strong>Public disclosure data:</strong> The dataset is derived from
          DOL public disclosure LCA records.
        </li>
        <li>
          <strong>Not legal advice:</strong> Content is provided for informational
          purposes only and is not legal advice.
        </li>
        <li>
          <strong>LCA does not equal approval:</strong> LCA filings do not imply
          that a petition was approved or that employment occurred.
        </li>
        <li>
          <strong>No warranty:</strong> The site and data are provided “as is”
          without warranties of any kind. Source data may contain errors; our
          processing may not catch all issues.
        </li>
      </ul>

      <h2>Acceptable use</h2>
      <ul>
        <li>Do not attempt to disrupt, overload, or reverse engineer the service.</li>
        <li>Do not use the site to violate privacy, labor, or anti-discrimination laws.</li>
        <li>
          Automated scraping should be reasonable and must not impair site
          performance.
        </li>
      </ul>

      <h2>Intellectual property</h2>
      <p>
        Public records remain subject to applicable public disclosure terms and
        source attribution. Site design, branding, and original explanatory text
        are owned by the site operator unless otherwise stated.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, the site operator will not be
        liable for any indirect, incidental, special, consequential, or punitive
        damages, or any loss of data, profits, or revenues arising from your use
        of the site.
      </p>

      <p className="small">
        These terms may be updated from time to time. Continued use of the site
        indicates acceptance of the updated terms.
      </p>
    </div>
  );
}
