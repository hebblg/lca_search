export default function Loading() {
  return (
    <main style={{ maxWidth: 1160, margin: "0 auto", padding: "26px 16px" }}>
      <div style={{ height: 22, width: 340, background: "rgba(0,0,0,0.08)", borderRadius: 8 }} />
      <div style={{ height: 14, width: 520, background: "rgba(0,0,0,0.06)", borderRadius: 8, marginTop: 10 }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 18 }}>
        <div style={{ height: 250, background: "rgba(0,0,0,0.05)", borderRadius: 12 }} />
        <div style={{ height: 250, background: "rgba(0,0,0,0.05)", borderRadius: 12 }} />
      </div>
      <div style={{ height: 180, background: "rgba(0,0,0,0.05)", borderRadius: 12, marginTop: 16 }} />
      <div style={{ height: 240, background: "rgba(0,0,0,0.05)", borderRadius: 12, marginTop: 16 }} />
    </main>
  );
}