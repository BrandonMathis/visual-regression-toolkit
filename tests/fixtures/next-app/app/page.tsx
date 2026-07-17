const pixel =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Crect width='24' height='24' fill='%230b6'/%3E%3C/svg%3E";

export default function Home() {
  const changed = process.env.VISUAL_FIXTURE_VARIANT === "changed";
  return (
    <main
      data-visual-ready="true"
      style={changed ? { background: "rgb(0, 40, 180)" } : undefined}
    >
      <h1>Deterministic visual fixture</h1>
      <p>Logical date: {process.env.VISUAL_TEST_DATE ?? "not-set"}</p>
      <p className="animated">Animations and carets are stabilized.</p>
      <input defaultValue="caret" aria-label="Caret fixture" />
      <div
        data-visual-mask
      >{`masked-${process.env.VISUAL_TEST_DATE ?? "dynamic"}`}</div>
      <video poster={pixel} muted aria-label="Video fixture" />
      <div className="spacer" />
      <img
        src={pixel}
        loading="lazy"
        width="24"
        height="24"
        alt="Lazy fixture"
      />
    </main>
  );
}
