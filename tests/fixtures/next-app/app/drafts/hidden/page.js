export const metadata = { title: 'Fixture Draft' };

// Present in the app; excluded from capture via routes.exclude ['/drafts/**'].
export default function HiddenDraftPage() {
  return (
    <main>
      <h1>Hidden Draft</h1>
      <p>This page must be excluded by configuration globs.</p>
    </main>
  );
}
