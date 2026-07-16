export const metadata = { title: 'Fixture Home' };

export default function HomePage() {
  // Baked in at build/render time to prove logical-date injection (plan §8.2).
  const visualTestDate = process.env.VISUAL_TEST_DATE ?? 'VISUAL_TEST_DATE-unset';
  return (
    <main>
      <h1>Fixture Home</h1>
      <p data-testid="visual-test-date">{visualTestDate}</p>
      <div className="spinner" aria-hidden="true" />
      <video className="media" width="320" height="180" poster="/poster.png" muted playsInline />
      <div className="spacer" aria-hidden="true" />
      <img
        src="/lazy.png"
        alt="Deterministic below-the-fold fixture image"
        width="320"
        height="180"
        loading="lazy"
      />
      <div className="spacer" aria-hidden="true" />
      <p data-testid="deep-marker">Deep content several viewport heights down the page.</p>
    </main>
  );
}
