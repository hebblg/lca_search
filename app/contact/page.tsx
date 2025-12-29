export default function ContactPage() {
  return (
    <div className="card">
      <h1>Contact</h1>
      <p>
        Questions, feedback, or a data issue to report? Send us a message and
        include the case number (if applicable) plus a short description of what
        you’re seeing.
      </p>

      <h2>Email</h2>
      <p>
        Email: <strong>hello@yourdomain.com</strong>
        <br />
        <span className="small">
          Replace this address with your real support inbox.
        </span>
      </p>

      <h2>Important note</h2>
      <p className="small">
        We cannot provide legal advice. If you need immigration guidance, consult
        a qualified attorney. LCA records are public disclosure data and do not
        indicate petition approval or employment.
      </p>
    </div>
  );
}
