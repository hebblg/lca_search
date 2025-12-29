export default function AboutPage() {
  return (
    <div className="card">
      <h1>About</h1>
      <p>
        LCA Wage Search helps you explore U.S. Department of Labor (DOL) public
        disclosure records for Labor Condition Applications (LCAs) associated
        with H-1B and related visa programs. You can search by employer, job
        title, and worksite location, and review reported wage fields.
      </p>

      <h2>Important disclaimers</h2>
      <ul>
        <li>
          <strong>Public disclosure data:</strong> The underlying LCA records are
          published as part of DOL public disclosure datasets.
        </li>
        <li>
          <strong>Not legal advice:</strong> This site is for informational
          purposes only and does not provide legal guidance.
        </li>
        <li>
          <strong>LCA does not equal approval:</strong> An LCA record does not
          mean a visa petition was filed, approved, or that employment occurred.
        </li>
        <li>
          <strong>Data may contain errors:</strong> The source data can include
          typos, missing fields, duplicates, or inconsistent formatting.
        </li>
      </ul>

      <h2>What we do (at a high level)</h2>
      <p>
        We standardize common fields (e.g., employer name, job title, worksite
        city/state), parse dates, and convert wage units into a comparable annual
        figure when possible. We retain the original fields where available and
        aim to be transparent about limitations.
      </p>

      <p className="small">
        If you spot an issue or have a correction request, please use the Contact
        page.
      </p>
    </div>
  );
}
