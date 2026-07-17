export function generateStaticParams() {
  return [{ slug: "alpha" }, { slug: "unicode-cafe" }];
}
export default async function Generated({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <main data-visual-ready="true">
      <h1>Generated: {slug}</h1>
    </main>
  );
}
